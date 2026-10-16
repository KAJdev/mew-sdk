import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const SKIP = new Set(['node_modules', '.git', 'dist', '.mew']);
const BINARY = /\.(?:png|jpe?g|gif|webp|woff2?|ttf)$/i;
const PROJECT_BYTES = 32 * 1024 * 1024;

export async function collect(dir) {
  const files = {};
  let total = 0;
  async function walk(relative) {
    for (const entry of await readdir(path.join(dir, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) {
        total += (await stat(path.join(dir, child))).size;
        if (total > PROJECT_BYTES) throw new Error('Project files exceed 32 MiB; move build output and large files out of the app folder');
        const content = await readFile(path.join(dir, child));
        files[child] = BINARY.test(child) ? new Uint8Array(content) : content.toString('utf8');
      }
    }
  }
  await walk('');
  return files;
}

export function describeInVm(source, timeout = 5_000) {
  const blocked = () => { throw new Error('network access is not available while reading handler registrations'); };
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports, console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    URL, URLSearchParams, TextEncoder, TextDecoder, Request, Response, Headers, FormData, Blob,
    AbortController, structuredClone, atob, btoa, crypto: webcrypto, fetch: blocked,
    setTimeout() {}, clearTimeout() {}, queueMicrotask() {},
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { timeout, filename: 'handler.cjs' });
  const app = module.exports?.default ?? module.exports;
  if (!app || typeof app.describe !== 'function') throw new Error('The handler must `export default app` where app is new App() from mew-sdk/handler');
  return JSON.parse(JSON.stringify(app.describe()));
}
