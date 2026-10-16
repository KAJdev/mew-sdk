import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getMew, updateState, watchTheme } from "../index.js";
import { createDevServer } from "../dev.mjs";

function fakeMew() {
  const records = { private: { revision: 0, value: {} }, shared: { revision: 0, value: {} } };
  const listeners = new Set();
  let conflicts = 0;
  return {
    records, listeners,
    conflictOnce() { conflicts = 1; },
    sdk: {
      version: 1,
      state: {
        get: async (scope) => records[scope],
        put: async (scope, { expected_revision, value }) => {
          if (conflicts-- > 0) { records[scope] = { revision: records[scope].revision + 1, value: { count: 10 } }; throw new Error("conflict"); }
          if (expected_revision !== records[scope].revision) throw new Error("conflict");
          return (records[scope] = { revision: expected_revision + 1, value });
        },
      },
      theme: { get: () => ({ version: 1, primary: "#fff", background: "#000", secondary: "#aaa", tertiary: "#333" }), subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } },
    },
  };
}

test("helpers require the injected SDK", () => {
  delete globalThis.mew;
  assert.throws(() => getMew(), /only available inside a mew app frame/);
});

test("updateState retries a conflicting write from fresh state", async (t) => {
  const fake = fakeMew();
  globalThis.mew = fake.sdk;
  t.after(() => delete globalThis.mew);
  fake.conflictOnce();
  const result = await updateState("shared", (value) => ({ count: Number(value.count ?? 0) + 1 }));
  assert.deepEqual(result, { revision: 2, value: { count: 11 } });
  await assert.rejects(updateState("shared", (value) => value, { attempts: 0 }), /attempts/);
});

test("watchTheme delivers the current theme and unsubscribes", (t) => {
  const fake = fakeMew();
  globalThis.mew = fake.sdk;
  t.after(() => delete globalThis.mew);
  const seen = [];
  const stop = watchTheme((theme) => seen.push(theme.primary));
  assert.deepEqual(seen, ["#fff"]);
  assert.equal(fake.listeners.size, 1);
  stop();
  assert.equal(fake.listeners.size, 0);
});

test("dev server serves the production sandbox document and enforces local state rules", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mew-sdk-dev-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, "index.html"), await readFile(new URL("../sample.html", import.meta.url), "utf8"));
  await writeFile(path.join(dir, "app.json"), JSON.stringify({ ui: "index.html", manifest: { sdk_version: 1, permissions: ["storage:shared"], state_version: 1 } }));
  await assert.rejects(createDevServer({ folder: dir, host: "0.0.0.0" }), /127\.0\.0\.1/);
  const server = await createDevServer({ folder: dir, port: 0 });
  t.after(() => server.close());
  const origin = new URL(server.url).origin;
  const host = await fetch(server.url);
  assert.match(host.headers.get("content-security-policy"), /frame-src 'self'/);
  const sandbox = await fetch(`${origin}/sandbox`);
  assert.match(sandbox.headers.get("content-security-policy"), new RegExp(`frame-ancestors ${origin}; sandbox allow-scripts$`));
  assert.match(await sandbox.text(), /mew-app-v1/);
  assert.equal((await (await fetch(`${origin}/app`)).json()).html.includes("Shared counter"), true);
  assert.deepEqual(await (await fetch(`${origin}/state/shared`)).json(), { revision: 0, value: {}, state_version: null });
  assert.equal((await fetch(`${origin}/state/private`)).status, 403);
  const put = (body, headers = { origin }) => fetch(`${origin}/state/shared`, { method: "PUT", headers, body: JSON.stringify(body) });
  assert.equal((await put({ expected_revision: 0, value: { count: 1 } }, {})).status, 403);
  assert.deepEqual(await (await put({ expected_revision: 0, value: { count: 1 } })).json(), { revision: 1, value: { count: 1 }, state_version: 1 });
  assert.equal((await put({ expected_revision: 0, value: { count: 2 } })).status, 409);
  assert.equal((await put({ expected_revision: 1, value: { big: "x".repeat(17_000) } })).status, 400);
  assert.equal((await fetch(`${origin}/state`, { method: "DELETE", headers: { origin } })).status, 200);
  assert.deepEqual(await (await fetch(`${origin}/state/shared`)).json(), { revision: 0, value: {}, state_version: null });
});
