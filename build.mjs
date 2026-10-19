const WIDGET_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const MESSAGE_TYPE = /^[a-z][a-z0-9_-]{0,31}$/;
const ANCHORS = ["top", "bottom", "left", "right"];
const WIDGET_BYTES = 2 * 1024 * 1024;
const HANDLER_BYTES = 10 * 1024 * 1024;
const SOURCE_BYTES = 2 * 1024 * 1024;
const ASSETS = { ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".gif": "dataurl", ".svg": "dataurl", ".webp": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".json": "json", ".txt": "text" };
const TEXT = /\.(?:[cm]?[jt]sx?|css|html|json|md|txt|svg)$/;
export const APP_PERMISSIONS = ['storage:private', 'storage:shared', 'handler:events', 'messages:post', 'messages:post_as_app', 'messages:read', 'members:read', 'network', 'storage:backend', 'schedule', 'http', 'secrets:publisher', 'profile:publish', 'media:youtube', 'media:spotify', 'voice:read', 'voice:connect', 'voice:publish', 'maps:ventusky'];

function capabilities(config, permissions) {
  const names = config.secrets ?? [];
  if (!Array.isArray(names) || names.length > 64 || new Set(names).size !== names.length
    || names.some((name) => typeof name !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(name))
    || (names.length && (!config.handler || !permissions.includes('secrets:publisher')))) throw new Error('publisher secrets require distinct declared names, a handler and secrets:publisher');
  const network = config.network;
  if (network === undefined) {
    if (permissions.includes('network')) throw new Error('network permission requires a network policy');
  } else {
    const keys = ['origins', 'methods', 'request_headers', 'response_headers'];
    if (!network || typeof network !== 'object' || Array.isArray(network) || Object.keys(network).length !== 4
      || !permissions.includes('network') || !config.handler
      || keys.some((key) => !Array.isArray(network[key]) || network[key].length > 64 || new Set(network[key]).size !== network[key].length
        || network[key].some((value) => typeof value !== 'string'))) throw new Error('network needs a handler and declared origins, methods, request_headers and response_headers');
    if (!network.origins.length || !network.methods.length || network.origins.some((origin) => {
      try { const url = new URL(origin); return url.protocol !== 'https:' || url.origin !== origin || url.port || url.username || url.password || !url.hostname.includes('.') || /[\[\]:]/.test(url.hostname); }
      catch { return true; }
    }) || network.methods.some((method) => !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
      || [...network.request_headers, ...network.response_headers].some((name) => !/^[a-z0-9-]{1,64}$/.test(name)
        || ['host', 'cookie', 'set-cookie', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'trailer', 'te', 'expect'].includes(name)
        || /^(proxy-|x-forwarded-|x-mew-)/.test(name))) throw new Error('invalid network policy');
  }
  return { ...(names.length ? { secrets: names } : {}), ...(network === undefined ? {} : { network }) };
}

const bytes = (value) => new TextEncoder().encode(value).length;

/** resolves . and .. segments and backslashes in a project-relative path; throws when it leaves the project */
export function normalize(path) {
  const parts = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error(`${path} leaves the project folder`);
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

function join(base, relative) {
  return normalize(`${base.split("/").slice(0, -1).join("/")}/${relative}`);
}

function widgetManifest(name, widget) {
  if (!WIDGET_NAME.test(name)) throw new Error(`widget name ${name} must match ${WIDGET_NAME}`);
  if (!widget || typeof widget !== "object") throw new Error(`widget ${name} must be an object`);
  for (const key of ["entry", "html"]) {
    if (widget[key] !== undefined && (typeof widget[key] !== "string" || !widget[key])) throw new Error(`widget ${name} ${key} must be a file path`);
  }
  if (!widget.entry && !widget.html) throw new Error(`widget ${name} needs an entry, an html template or both`);
  const { type } = widget;
  const allowed = { page: ["title"], panel: ["anchors"], message: ["message_type"], profile: [], chatbar: ["message_type", "title"] }[type];
  if (!allowed) throw new Error(`widget ${name} has unknown type ${type}`);
  for (const key of Object.keys(widget)) {
    if (!["type", "entry", "html", ...allowed].includes(key)) throw new Error(`widget ${name} does not take ${key}`);
  }
  const out = { type };
  if (type === "page") {
    if (widget.title !== undefined && (typeof widget.title !== "string" || !widget.title.trim() || [...widget.title].length > 100)) throw new Error(`widget ${name} title must be 1 to 100 characters`);
    if (widget.title !== undefined) out.title = widget.title;
  }
  if (type === "panel") {
    const anchors = widget.anchors;
    if (!Array.isArray(anchors) || !anchors.length || new Set(anchors).size !== anchors.length || anchors.some((a) => !ANCHORS.includes(a))) throw new Error(`widget ${name} anchors must be distinct values from ${ANCHORS.join(", ")}`);
    out.anchors = anchors;
  }
  if (type === "message") {
    if (typeof widget.message_type !== "string" || !MESSAGE_TYPE.test(widget.message_type)) throw new Error(`widget ${name} message_type must match ${MESSAGE_TYPE}`);
    out.message_type = widget.message_type;
  }
  if (type === "chatbar") {
    if (typeof widget.message_type !== "string" || !MESSAGE_TYPE.test(widget.message_type)) throw new Error(`widget ${name} message_type must match ${MESSAGE_TYPE}`);
    if (widget.title !== undefined && (typeof widget.title !== "string" || !widget.title.trim() || [...widget.title].length > 100)) throw new Error(`widget ${name} title must be 1 to 100 characters`);
    out.message_type = widget.message_type;
    if (widget.title !== undefined) out.title = widget.title;
  }
  return out;
}

function projectPlugin(files, modules, resolveDir) {
  return {
    name: "mew-project",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.kind === "entry-point") return { path: normalize(args.path), namespace: "project" };
        if (Object.hasOwn(modules, args.path)) return { path: args.path, namespace: "module" };
        if (args.path.startsWith(".") || args.path.startsWith("/")) {
          const base = args.namespace === "project" ? args.importer : "";
          const target = args.path.startsWith("/") ? normalize(args.path) : join(base, args.path);
          const candidates = [target, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".css"].map((ext) => target + ext), ...["index.ts", "index.js"].map((index) => `${target}/${index}`)];
          const found = candidates.find((candidate) => Object.hasOwn(files, candidate));
          if (!found) return { errors: [{ text: `cannot find ${args.path} from ${args.importer || "the project"}` }] };
          return { path: found, namespace: "project" };
        }
        if (resolveDir && !args.pluginData?.npm) {
          const result = await build.resolve(args.path, { kind: args.kind, resolveDir, pluginData: { npm: true } });
          return result.errors.length ? { errors: result.errors } : { path: result.path, namespace: result.namespace, sideEffects: result.sideEffects };
        }
        if (args.pluginData?.npm) return undefined;
        return { errors: [{ text: `${args.path} is an npm dependency; build projects with npm dependencies using mew deploy` }] };
      });
      build.onLoad({ filter: /.*/, namespace: "project" }, (args) => {
        const extension = args.path.slice(args.path.lastIndexOf("."));
        const loader = ASSETS[extension] ?? ({ ".ts": "ts", ".tsx": "tsx", ".js": "js", ".jsx": "jsx", ".mjs": "js", ".css": "css" })[extension];
        if (!loader) return { errors: [{ text: `unsupported file type ${args.path}` }] };
        const content = files[args.path];
        return { contents: typeof content === "string" ? content : new Uint8Array(content), loader };
      });
      build.onLoad({ filter: /.*/, namespace: "module" }, (args) => ({ contents: modules[args.path], loader: "js" }));
    },
  };
}

async function bundle(esbuild, files, entry, options, plugin) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    outdir: "out",
    logLevel: "silent",
    legalComments: "none",
    charset: "utf8",
    plugins: [plugin],
    ...options,
  });
  const outputs = Object.fromEntries(result.outputFiles.map((file) => [file.path.slice(file.path.lastIndexOf(".") + 1), file.text]));
  return outputs;
}

/**
 * checks a parsed app.json and returns the manifest it describes, without handler
 * registrations. buildProject runs the same checks before bundling.
 */
export function checkConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("app.json must be an object");
  const permissions = config.permissions ?? [];
  if (!Array.isArray(permissions) || permissions.some((p) => !APP_PERMISSIONS.includes(p)) || new Set(permissions).size !== permissions.length) throw new Error("permissions must be distinct supported permissions");
  if (!config.widgets || typeof config.widgets !== "object" || Array.isArray(config.widgets) || !Object.keys(config.widgets).length) throw new Error("app.json needs at least one widget");
  if (config.handler !== undefined && (typeof config.handler !== "string" || !config.handler)) throw new Error("handler must be a file path");
  if (config.state_version !== undefined && config.state_version !== 1) throw new Error("state_version must be 1");
  const types = new Set();
  const manifest = { sdk_version: 2, state_version: 1, permissions, ...capabilities(config, permissions), widgets: {} };
  for (const name of Object.keys(config.widgets).sort()) {
    const widget = config.widgets[name];
    manifest.widgets[name] = widgetManifest(name, widget);
    if (widget.type === "message") {
      if (types.has(widget.message_type)) throw new Error(`message type ${widget.message_type} is declared twice`);
      types.add(widget.message_type);
    }
  }
  if (config.home !== undefined) {
    if (typeof config.home !== "string" || config.widgets[config.home]?.type !== "page") throw new Error("home must name a page widget");
    manifest.home = config.home;
  } else if (Object.values(config.widgets).some((widget) => widget.type !== "profile")) {
    throw new Error("apps with page, panel, message or chatbar widgets need a home page widget");
  }
  const chatbars = Object.values(config.widgets).filter((widget) => widget?.type === "chatbar");
  if (permissions.includes('profile:publish') && (!config.handler || !permissions.includes('storage:private') || !Object.values(config.widgets).some((widget) => widget.type === 'profile'))) throw new Error('profile publication requires a handler, private storage and a profile widget');
  if (chatbars.length && (!permissions.includes("messages:post") || chatbars.some((widget) => !types.has(widget.message_type)))) throw new Error("chatbar widgets need messages:post and a declared message_type");
  return manifest;
}

/**
 * builds an app project into a publishable version. files maps project-relative paths
 * to text (or bytes for assets); esbuild is the esbuild or esbuild-wasm module; describe
 * evaluates the commonjs handler bundle in an isolated context and returns app.describe().
 * resolveDir lets the cli resolve npm dependencies from disk.
 */
export async function buildProject(files, { esbuild, describe, modules = {}, resolveDir } = {}) {
  if (!esbuild?.build) throw new Error("buildProject needs an esbuild module");
  if (!files["app.json"]) throw new Error("app.json is missing");
  const config = JSON.parse(files["app.json"]);
  const manifest = checkConfig(config);
  const widgets = {};
  const plugin = projectPlugin(files, modules, resolveDir);
  const shared = resolveDir ? { absWorkingDir: resolveDir, nodePaths: [`${resolveDir}/node_modules`] } : {};
  for (const name of Object.keys(config.widgets).sort()) {
    const widget = config.widgets[name];
    const artifact = {};
    if (widget.html) {
      const html = files[normalize(widget.html)];
      if (typeof html !== "string") throw new Error(`widget ${name} html ${widget.html} is missing`);
      artifact.html = html;
    }
    if (widget.entry) {
      const out = await bundle(esbuild, files, widget.entry, { format: "esm", platform: "browser", target: "es2022", minify: true, loader: ASSETS, ...shared }, plugin);
      if (out.js) artifact.js = out.js;
      if (out.css) artifact.css = out.css;
    }
    if (!Object.keys(artifact).length) throw new Error(`widget ${name} entry ${widget.entry} builds to nothing; add code to it`);
    if (bytes(artifact.html ?? "") + bytes(artifact.js ?? "") + bytes(artifact.css ?? "") > WIDGET_BYTES) throw new Error(`widget ${name} is larger than 2 MiB`);
    widgets[name] = artifact;
  }
  let handler_bundle;
  if (config.handler) {
    const handlerOptions = { platform: "neutral", target: "es2022", conditions: ["workerd", "worker", "browser"], mainFields: ["module", "main"], loader: ASSETS, ...shared };
    handler_bundle = (await bundle(esbuild, files, config.handler, { ...handlerOptions, format: "esm" }, plugin)).js;
    if (bytes(handler_bundle) > HANDLER_BYTES) throw new Error("handler bundle is larger than 10 MiB");
    if (typeof describe !== "function") throw new Error("buildProject needs describe to read handler registrations");
    const commonjs = (await bundle(esbuild, files, config.handler, { ...handlerOptions, format: "cjs" }, plugin)).js;
    manifest.handler = await describe(commonjs);
  }
  const source = {};
  let total = 0;
  for (const path of Object.keys(files).sort()) {
    if (typeof files[path] !== "string" || !TEXT.test(path) || path.startsWith("node_modules/")) continue;
    total += bytes(files[path]);
    source[path] = files[path];
  }
  return {
    config,
    manifest,
    widgets,
    ...(handler_bundle === undefined ? {} : { handler_bundle }),
    ...(total <= SOURCE_BYTES ? { source } : {}),
  };
}
