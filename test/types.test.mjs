import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm, symlink, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function typescript() {
  try { return createRequire(path.join(root, "package.json"))("typescript"); } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
  return null;
}

async function check(ts, files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mew-sdk-types-"));
  try {
    await mkdir(path.join(dir, "node_modules"));
    await symlink(root, path.join(dir, "node_modules", "mew-sdk"), "dir");
    const names = [];
    for (const [name, source] of Object.entries(files)) {
      await writeFile(path.join(dir, name), source);
      names.push(path.join(dir, name));
    }
    const program = ts.createProgram(names, {
      allowJs: true, checkJs: true, noEmit: true, strict: true, skipLibCheck: false,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], types: [],
    });
    return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("handler and frame types typecheck through the package exports", async (t) => {
  const ts = typescript();
  if (!ts) return t.skip("typescript is not installed");
  const good = await check(ts, {
    "package.json": JSON.stringify({ type: "module" }),
    "handler.mjs": `/** @type {import("mew-sdk/handler").Handler} */
export default {
  async event(event, state) {
    const count = typeof state.count === "number" ? state.count + 1 : 1;
    const kind = event.type === "message.replied" ? event.reply_to_id : event.message.content;
    return { state: { ...state, count, kind }, reply: { content: "hi" } };
  },
};
`,
    "frame.ts": `import type { State, Theme } from "mew-sdk";
const state: Promise<State> = mew.state.get("shared");
const theme: Theme = mew.theme.get();
void state; void theme;
`,
  });
  assert.deepEqual(good, []);
  const bad = await check(ts, {
    "package.json": JSON.stringify({ type: "module" }),
    "handler.mjs": `/** @type {import("mew-sdk/handler").Handler} */
export default {
  async event(event, state) {
    return { state: { when: new Date() }, reply: event.message.content };
  },
};
`,
  });
  assert.ok(bad.length >= 1, "invalid state and reply shapes are rejected");
});
