import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as esbuild from "esbuild";
import { buildProject, checkConfig } from "../build.mjs";
import { describeInVm } from "../cli/src/project.js";

const handlerSource = readFileSync(new URL("../handler.js", import.meta.url), "utf8");
const modules = { "mew-sdk/handler": handlerSource };

const files = () => ({
  "app.json": JSON.stringify({
    name: "polls",
    permissions: ["storage:shared", "messages:post"],
    widgets: {
      dashboard: { type: "page", title: "Polls", entry: "src/dashboard.ts" },
      poll: { type: "message", message_type: "poll", entry: "src/poll.ts", html: "src/poll.html" },
      top: { type: "panel", anchors: ["top"], html: "src/top.html" },
    },
    handler: "src/backend.ts",
  }),
  "src/dashboard.ts": "import './style.css';\nimport { label } from './label';\nconst n: number = 2;\ndocument.body.textContent = label(n);\n",
  "src/label.ts": "export const label = (n: number) => `polls: ${n}`;\n",
  "src/style.css": "body { color: red; }\n",
  "src/poll.ts": "mew.on('message', () => {});\n",
  "src/poll.html": "<div id=root></div>",
  "src/top.html": "<!doctype html><p>top</p>",
  "src/backend.ts": "import { App } from 'mew-sdk/handler';\nconst app = new App();\napp.on('messageCreate', async () => {});\napp.action('vote', async (ctx, args: { option: number }) => ({ ok: args.option }));\napp.cron('*/5 * * * *', async () => {});\napp.http.post('/hook', async () => new Response('ok'));\nexport default app;\n",
});

test("builds widgets, the handler and its registrations", async () => {
  const built = await buildProject(files(), { esbuild, describe: describeInVm, modules });
  assert.deepEqual(built.manifest, {
    sdk_version: 2,
    state_version: 1,
    permissions: ["storage:shared", "messages:post"],
    widgets: {
      dashboard: { type: "page", title: "Polls" },
      poll: { type: "message", message_type: "poll" },
      top: { type: "panel", anchors: ["top"] },
    },
    handler: { events: ["messageCreate"], actions: ["vote"], crons: ["*/5 * * * *"], routes: [{ method: "POST", path: "/hook" }] },
  });
  assert.match(built.widgets.dashboard.js, /polls: /);
  assert.match(built.widgets.dashboard.css, /color:\s*red/);
  assert.equal(built.widgets.poll.html, "<div id=root></div>");
  assert.ok(built.widgets.poll.js);
  assert.deepEqual(Object.keys(built.widgets.top), ["html"]);
  assert.match(built.handler_bundle, /export\s*\{/);
  assert.ok(built.source["src/backend.ts"]);
});

test("output is deterministic", async () => {
  const a = await buildProject(files(), { esbuild, describe: describeInVm, modules });
  const b = await buildProject(files(), { esbuild, describe: describeInVm, modules });
  assert.deepEqual(a, b);
});

test("widget manifests declare content and placement without dimensions", () => {
  const widgets = {
    message: { type: "message", message_type: "poll", html: "widget.html" },
    profile: { type: "profile", html: "widget.html" },
    panel: { type: "panel", anchors: ["top"], html: "widget.html" },
  };
  assert.deepEqual(checkConfig({ widgets }).widgets, {
    message: { type: "message", message_type: "poll" },
    profile: { type: "profile" },
    panel: { type: "panel", anchors: ["top"] },
  });
  for (const [name, key] of [["message", "max_height"], ["panel", "max_height"], ["profile", "height"]]) {
    assert.throws(() => checkConfig({ widgets: { [name]: { ...widgets[name], [key]: 160 } } }), new RegExp(`does not take ${key}`));
  }
});

test("rejects npm dependencies without a resolve directory, bad widgets and duplicate message types", async () => {
  const withDep = files();
  withDep["src/label.ts"] = "import x from 'left-pad';\nexport const label = () => x;\n";
  await assert.rejects(buildProject(withDep, { esbuild, describe: describeInVm, modules }), /npm dependency/);
  const bad = files();
  bad["app.json"] = JSON.stringify({ widgets: { Bad: { type: "page", html: "src/top.html" } } });
  await assert.rejects(buildProject(bad, { esbuild }), /widget name/);
  const dup = files();
  dup["app.json"] = JSON.stringify({ widgets: { a: { type: "message", message_type: "poll", html: "src/top.html" }, b: { type: "message", message_type: "poll", html: "src/top.html" } } });
  await assert.rejects(buildProject(dup, { esbuild }), /declared twice/);
  const escape = files();
  escape["src/label.ts"] = "import '../../etc/passwd';\nexport const label = () => 1;\n";
  await assert.rejects(buildProject(escape, { esbuild, describe: describeInVm, modules }), /leaves the project folder|cannot find/);
});

test("describe refuses network access during evaluation", async () => {
  const net = files();
  net["src/backend.ts"] = "import { App } from 'mew-sdk/handler';\nfetch('https://example.com');\nexport default new App();\n";
  await assert.rejects(buildProject(net, { esbuild, describe: describeInVm, modules }), /network access is not available/);
});

test("resolves npm dependencies from the project folder when given one", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mew-build-"));
  mkdirSync(path.join(dir, "node_modules", "shout"), { recursive: true });
  writeFileSync(path.join(dir, "node_modules", "shout", "package.json"), JSON.stringify({ name: "shout", main: "index.js" }));
  writeFileSync(path.join(dir, "node_modules", "shout", "index.js"), "module.exports = (s) => s.toUpperCase() + '!';");
  const project = files();
  project["src/label.ts"] = "import shout from 'shout';\nexport const label = (n: number) => shout(`polls: ${n}`);\n";
  const built = await buildProject(project, { esbuild, describe: describeInVm, modules, resolveDir: dir });
  assert.match(built.widgets.dashboard.js, /toUpperCase/);
});

test("checkConfig reports app.json problems before bundling", () => {
  const config = JSON.parse(files()["app.json"]);
  assert.deepEqual(Object.keys(checkConfig(config).widgets), ["dashboard", "poll", "top"]);
  assert.throws(() => checkConfig({ ...config, widgets: {} }), /at least one widget/);
  assert.throws(() => checkConfig({ ...config, widgets: { top: { type: "panel", anchors: [], html: "a.html" } } }), /anchors/);
  assert.throws(() => checkConfig({ ...config, widgets: { a: { type: "message", message_type: "x", entry: "a.ts" }, b: { type: "message", message_type: "x", entry: "b.ts" } } }), /declared twice/);
  assert.throws(() => checkConfig({ ...config, handler: 3 }), /file path/);
  assert.throws(() => checkConfig({ ...config, widgets: { top: { type: "page", html: 5 } } }), /html must be a file path/);
  assert.throws(() => checkConfig({ ...config, state_version: 2 }), /state_version must be 1/);
});

test("chatbar widgets bind to a declared user-posted message type", () => {
  const config = JSON.parse(files()["app.json"]);
  config.widgets.compose = { type: "chatbar", message_type: "poll", title: "Create a poll", entry: "src/poll.ts" };
  assert.deepEqual(checkConfig(config).widgets.compose, { type: "chatbar", message_type: "poll", title: "Create a poll" });
  config.permissions = ["storage:shared"];
  assert.throws(() => checkConfig(config), /messages:post/);
  config.permissions = ["messages:post"];
  config.widgets.compose.message_type = "missing";
  assert.throws(() => checkConfig(config), /declared message_type/);
});

test("a widget whose entry builds to nothing is refused", async () => {
  const empty = { "app.json": JSON.stringify({ widgets: { main: { type: "page", entry: "main.ts" } } }), "main.ts": "" };
  await assert.rejects(buildProject(empty, { esbuild }), /builds to nothing/);
});
