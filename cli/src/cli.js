import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiClient } from './client.js';
import { handlerSource, sampleHtml, version } from '../../assets.mjs';
import { buildProject } from '../../build.mjs';
import { collect, describeInVm } from './project.js';

const help = `mew app development

  version                             print the CLI version
  init <folder>                       create a counter/preferences app
  deploy [folder]                     publish an immutable version
  list [--after <cursor>]              list one page of owned apps
  catalog [--after <cursor>]           list one page of public apps
  installations <channel> [--after <cursor>]  list one page of channel apps
  inspect <app-id>                     inspect an app and its publication head
  install <app-id> personal            create a private channel and install
  install <app-id> <channel>           install in a channel you manage
  approve <installation-id>           approve permissions a newer version requests
  disable <installation-id>           disable an installation
  uninstall <installation-id>         uninstall and delete app state
  state <installation-id> <scope>     read private or shared state
  dev [folder] [--port <port>]        preview the app UI locally with in-memory state
  dev <folder> <event.json>           invoke a local operator-owned handler (repository checkout)

MEW_API_URL is the API base before /v1 and defaults to https://mew.space/api;
set it to http://127.0.0.1:8000 for a local API. MEW_TOKEN is an account token
held in the environment.
Publishing does not start hosted execution. Scoped CI tokens, managed logs and
secret operations are not available in this milestone.`;

function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(value)) throw new Error('Invalid identifier');
  return encodeURIComponent(value);
}

function pageQuery(args, usage) {
  if (!args.length) return '';
  if (args.length !== 2 || args[0] !== '--after' || !/^[\x20-\x7e]{1,128}$/.test(args[1])) throw new Error(`Usage: ${usage}`);
  return `?${new URLSearchParams({ after: args[1] })}`;
}

async function configuration(folder) {
  const dir = await realpath(path.resolve(folder ?? '.'));
  const configPath = path.join(dir, 'app.json');
  if ((await stat(configPath)).size > 16_384) throw new Error('app.json exceeds 16 KiB');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      !Number.isSafeInteger(config.expected_version) || config.expected_version < 0) {
    throw new Error('app.json requires a nonnegative expected_version');
  }
  const source = async (file, max) => {
    if (typeof file !== 'string' || path.isAbsolute(file)) throw new Error('Artifact paths must be relative to the app folder');
    const resolved = await realpath(path.resolve(dir, file));
    if (!resolved.startsWith(`${dir}${path.sep}`)) throw new Error('Artifacts must remain inside the app folder');
    if ((await stat(resolved)).size > max) throw new Error('Artifact exceeds publication size limit');
    return readFile(resolved, 'utf8');
  };
  return { dir, config, source };
}

async function save(dir, config) {
  const temporary = path.join(dir, `.app-${randomUUID()}.json`);
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temporary, path.join(dir, 'app.json'));
}

export async function run(args, { env = process.env, output = console.log } = {}) {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === 'help') return output(help);
  if (command === '--version' || command === 'version') return output(version);
  if (command === 'init') {
    if (rest.length !== 1) throw new Error('Usage: mew init <new-folder>');
    const dir = path.resolve(rest[0]);
    await mkdir(dir);
    await writeFile(path.join(dir, 'index.html'), sampleHtml, { flag: 'wx' });
    await writeFile(path.join(dir, 'handler.js'), `export default {\n  async event(event, state) {\n    return { state: { count: (state?.count ?? 0) + 1 }, reply: { content: 'mew received your event' } };\n  }\n};\n`, { flag: 'wx' });
    await save(dir, {
      name: 'counter and preferences', description: 'A shared counter and a private preference.', visibility: 'unlisted',
      expected_version: 0, manifest: { sdk_version: 1, permissions: ['storage:private', 'storage:shared'], state_version: 1 },
      ui: 'index.html', handler: 'handler.js',
    });
    output(`Created ${dir}. Review app.json, then run mew deploy ${JSON.stringify(dir)}.`);
    return;
  }
  if (command === 'dev' && (rest.length !== 2 || rest.includes('--port'))) {
    const [folder = '.', flag, value] = rest[0] === '--port' ? ['.', ...rest] : rest;
    const port = flag === undefined ? 4175 : Number(value);
    if (rest.length > 3 || (flag !== undefined && flag !== '--port') || !Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new Error('Usage: mew dev [folder] [--port <port>]');
    }
    const { createDevServer } = await import('../../dev.mjs');
    const server = await createDevServer({ folder, port });
    output(`Previewing ${path.resolve(folder)} at ${server.url}. State is in memory. Press Ctrl+C to stop.`);
    return server;
  }
  if (command === 'dev') {
    if (rest.length !== 2) throw new Error('Usage: mew dev <folder> <event.json>');
    const { config, source } = await configuration(rest[0]);
    if (!config.handler) throw new Error('app.json requires a handler entry for local execution');
    if ((await stat(rest[1])).size > 32_768) throw new Error('Event fixture exceeds 32 KiB');
    const event = JSON.parse(await readFile(rest[1], 'utf8'));
    const { invokeHandler } = await import(new URL('../../../app-runtime/index.mjs', import.meta.url).href).catch((error) => {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
      throw new Error('Local handler invocation needs app-runtime from a mew repository checkout and Docker. See https://mew.space/docs');
    });
    const result = await invokeHandler({ handlerSource: await source(config.handler, 262_144), event, state: {} });
    output(JSON.stringify(result, null, 2));
    return;
  }
  const api = new ApiClient(env.MEW_API_URL ?? 'https://mew.space/api', env.MEW_TOKEN);
  const print = (value) => output(JSON.stringify(value, null, 2));
  if (command === 'deploy') {
    if (rest.length > 1) throw new Error('Usage: mew deploy [folder]');
    const { dir, config, source } = await configuration(rest[0]);
    if (config.widgets) {
      const esbuild = await import('esbuild').catch(() => {
        throw new Error('Bundling needs the npm package: npm i -g mew-sdk');
      });
      const built = await buildProject(await collect(dir), { esbuild, describe: describeInVm, modules: { 'mew-sdk/handler': handlerSource }, resolveDir: dir });
      if (!config.app_id) {
        if (config.expected_version !== 0) throw new Error('A new app must have expected_version 0');
        const app = await api.request('apps', 'POST', { name: config.name, description: config.description, visibility: config.visibility });
        config.app_id = app.id;
        await save(dir, config);
      }
      const version = await api.request(`apps/${identifier(config.app_id)}/versions`, 'POST', {
        expected_version: config.expected_version, manifest: built.manifest, widgets: built.widgets,
        ...(built.handler_bundle === undefined ? {} : { handler_bundle: built.handler_bundle }),
        ...(built.source === undefined ? {} : { source: built.source }),
      });
      config.expected_version = version.version;
      await save(dir, config);
      print({ app_id: config.app_id, version: version.version, widgets: Object.keys(built.widgets), handler: built.manifest.handler ?? null });
      return;
    }
    const ui_html = await source(config.ui, 262_144);
    const handler_source = config.handler ? await source(config.handler, 262_144) : undefined;
    if (config.documents !== undefined && (!config.documents || typeof config.documents !== 'object' || Array.isArray(config.documents) ||
        Object.keys(config.documents).some((key) => !['panel', 'message', 'widget'].includes(key)))) {
      throw new Error('app.json documents may only name panel, message and widget files');
    }
    const documents = config.documents ? Object.fromEntries(await Promise.all(Object.entries(config.documents).map(async ([surface, file]) => [surface, await source(file, 262_144)]))) : undefined;
    if (!config.app_id) {
      if (config.expected_version !== 0) throw new Error('A new app must have expected_version 0');
      const app = await api.request('apps', 'POST', { name: config.name, description: config.description, visibility: config.visibility });
      config.app_id = app.id;
      await save(dir, config);
    }
    const version = await api.request(`apps/${identifier(config.app_id)}/versions`, 'POST', {
      expected_version: config.expected_version, manifest: config.manifest, ui_html,
      ...(handler_source === undefined ? {} : { handler_source }),
      ...(documents === undefined ? {} : { documents }),
    });
    config.expected_version = version.version;
    await save(dir, config);
    print({ app_id: config.app_id, version: version.version, execution: 'publication only' });
    return;
  }
  if (command === 'list' || command === 'catalog') {
    const query = pageQuery(rest, `mew ${command} [--after <cursor>]`);
    return print(await api.request((command === 'list' ? 'apps' : 'apps/catalog') + query));
  }
  if (command === 'installations') {
    if (!rest.length) throw new Error('Usage: mew installations <channel> [--after <cursor>]');
    const query = pageQuery(rest.slice(1), 'mew installations <channel> [--after <cursor>]');
    return print(await api.request(`channels/${identifier(rest[0])}/apps${query}`));
  }
  if (command === 'inspect') {
    if (rest.length !== 1) throw new Error('Usage: mew inspect <app-id>');
    return print(await api.request(`apps/${identifier(rest[0])}`));
  }
  if (command === 'install') {
    if (rest.length !== 2) throw new Error('Usage: mew install <app-id> personal|<channel-id>');
    const app = identifier(rest[0]);
    const permissions = accepted((await api.request(`apps/${app}`)).permissions, 'this app');
    print(await api.request(`apps/${app}/installations`, 'POST', {
      accepted_permissions: permissions,
      target: rest[1] === 'personal' ? { type: 'personal' } : { type: 'channel', channel_id: decodeURIComponent(identifier(rest[1])) },
    }));
    return;
  }
  if (command === 'approve') {
    if (rest.length !== 1) throw new Error('Usage: mew approve <installation-id>');
    const endpoint = `app-installations/${identifier(rest[0])}`;
    const installation = await api.request(endpoint);
    if (!Array.isArray(installation.pending_permissions)) throw new Error('This installation has no pending permissions');
    const permissions = accepted(installation.pending_permissions, 'the pending permissions');
    print(await api.request(`${endpoint}/approve`, 'POST', { permissions, expected_revision: installation.revision }));
    return;
  }
  if (command === 'disable' || command === 'uninstall') {
    if (rest.length !== 1) throw new Error(`Usage: mew ${command} <installation-id>`);
    const endpoint = `app-installations/${identifier(rest[0])}`;
    const installation = await api.request(endpoint);
    print(await api.request(endpoint, command === 'disable' ? 'PATCH' : 'DELETE', {
      expected_revision: installation.revision, ...(command === 'disable' ? { enabled: false } : {}),
    }));
    return;
  }
  if (command === 'state') {
    if (rest.length !== 2 || !['private', 'shared'].includes(rest[1])) throw new Error('Usage: mew state <installation-id> private|shared');
    const endpoint = `app-installations/${identifier(rest[0])}`;
    const installation = await api.request(endpoint);
    return print(await api.request(`${endpoint}/state/${rest[1]}`, 'GET', undefined, installation.revision));
  }
  throw new Error(`Unknown command. Run mew --help.`);

  function accepted(permissions, subject) {
    if (!Array.isArray(permissions)) throw new Error('Unexpected permission list');
    if (typeof env.MEW_ACCEPT_PERMISSIONS !== 'string' || JSON.stringify([...permissions].sort()) !==
        JSON.stringify(env.MEW_ACCEPT_PERMISSIONS.split(',').filter(Boolean).sort())) {
      throw new Error(`Review ${subject}. App code can read and disclose granted data. To consent, set MEW_ACCEPT_PERMISSIONS=${JSON.stringify(permissions.join(','))}`);
    }
    return permissions;
  }
}
