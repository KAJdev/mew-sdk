import { createServer } from "node:http";
import { watch } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { sandboxDocument } from "./document.mjs";
import { bootstrapSource } from "./assets.mjs";
import { controlTheme } from "./ui-runtime.js";

const MAX_DOCUMENT_BYTES = 262_144;
const MAX_STATE_BYTES = 16_384;

async function loadApp(dir) {
  const configPath = path.join(dir, "app.json");
  if ((await stat(configPath)).size > 16_384) throw new Error("app.json exceeds 16 KiB");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (typeof config?.ui !== "string" || path.isAbsolute(config.ui)) throw new Error("app.json requires a relative ui path");
  const ui = await realpath(path.resolve(dir, config.ui));
  if (!ui.startsWith(`${dir}${path.sep}`)) throw new Error("The ui file must remain inside the app folder");
  if ((await stat(ui)).size > MAX_DOCUMENT_BYTES) throw new Error("The ui file exceeds 256 KiB");
  const permissions = Array.isArray(config.manifest?.permissions) ? config.manifest.permissions : [];
  const stateVersion = Number.isSafeInteger(config.manifest?.state_version) ? config.manifest.state_version : 1;
  return { html: await readFile(ui, "utf8"), permissions, stateVersion };
}

function hostPage(nonce) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>mew dev</title><style>
:root{--color-primary:#d3f9d8;--color-background:#101010;--color-secondary:#a3a3a3;--color-tertiary:#3f3f3f}
:root.light{--color-primary:#1f2d22;--color-background:#f7f7f2;--color-secondary:#5c5c5c;--color-tertiary:#d6d6d0}
html,body{height:100%;margin:0}body{display:flex;flex-direction:column;color:var(--color-primary);background:var(--color-background);font:14px/1.4 ui-monospace,monospace}
nav{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--color-tertiary)}nav span{color:var(--color-secondary);margin-left:auto}
button{font:inherit;color:inherit;background:var(--color-tertiary);border:0;padding:4px 10px;cursor:pointer}
#status{padding:0 16px;color:var(--color-secondary)}iframe{flex:1;border:0;width:100%}
</style></head><body><nav><strong>mew dev</strong><button id="reload">[ Reload app ]</button><button id="theme">[ Toggle theme ]</button><button id="reset">[ Reset state ]</button><span>local state only</span></nav><p id="status" role="status"></p><iframe id="frame" sandbox="allow-scripts" src="/sandbox?v=mew-app-v3" title="App"></iframe>
<script nonce="${nonce}">
const frame = document.getElementById("frame");
const status = document.getElementById("status");
const theme = () => { const s = getComputedStyle(document.documentElement); return { version: 1, ...Object.fromEntries(["primary","background","secondary","tertiary"].map((k) => [k, s.getPropertyValue("--color-" + k).trim()])), controls: (${controlTheme.toString()})(s) }; };
let close = () => {};
async function mount() {
  close();
  const response = await fetch("/app", { cache: "no-store" });
  const app = await response.json();
  if (!response.ok) { status.textContent = app.error; return; }
  status.textContent = "";
  const session = crypto.randomUUID();
  let port = null, lastId = 0, closed = false;
  const fail = (message) => { close(); status.textContent = message; };
  const handshake = (event) => {
    if (closed || port || event.source !== frame.contentWindow || event.origin !== "null") return;
    const data = event.data;
    if (!data || data.protocol !== "mew-app-v1" || data.type !== "ready" || data.session !== session || event.ports.length) return;
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = async ({ data }) => {
      let request;
      try { request = JSON.parse(data); } catch { return fail("The app sent an invalid message."); }
      if (request && ["rendered", "resize"].includes(request.type) && Object.keys(request).length === 4 && request.session === session && Number.isSafeInteger(request.height) && request.height >= 0 && request.height <= 10000 && Number.isSafeInteger(request.width) && request.width >= 0 && request.width <= 10000) return;
      if (request && request.type === "open" && Object.keys(request).length === 4 && request.session === session && request.gesture === true && typeof request.url === "string") {
        let link = null;
        try { link = new URL(request.url); } catch { return; }
        if ((link.protocol === "http:" || link.protocol === "https:") && !link.username && !link.password && confirm("open link to " + link.hostname + "?")) window.open(link.href, "_blank", "noopener,noreferrer");
        return;
      }
      if (request?.method === "media.open" && request.session === session && request.id === lastId + 1 && Object.keys(request).length === 4) {
        lastId = request.id;
        port.postMessage(JSON.stringify({ type: "result", session, id: request.id, value: { status: "unsupported" } }));
        return;
      }
      if (!request || request.session !== session || request.id !== lastId + 1 || !["state.get","state.put"].includes(request.method) || !["private","shared"].includes(request.scope)) return fail("The app sent an invalid or replayed request.");
      lastId = request.id;
      const put = request.method === "state.put";
      const result = await fetch("/state/" + request.scope, put ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_revision: request.expected_revision, value: request.value }) } : {});
      const body = await result.json();
      if (closed) return;
      if (!result.ok) console.warn("mew dev: " + body.error);
      port.postMessage(JSON.stringify(result.ok ? { type: "result", session, id: request.id, value: body } : { type: "result", session, id: request.id, error: "State request failed. Reload state before retrying a write." }));
    };
    port.start();
    frame.contentWindow.postMessage({ protocol: "mew-app-v1", type: "connect", session }, "*", [channel.port2]);
    port.postMessage(JSON.stringify({ type: "initialize", session, html: app.html, theme: theme() }));
  };
  close = () => { closed = true; port?.close(); window.removeEventListener("message", handshake); };
  window.addEventListener("message", handshake);
  frame.contentWindow.postMessage({ protocol: "mew-app-v1", type: "challenge", session }, "*");
  window.sendTheme = () => port?.postMessage(JSON.stringify({ type: "theme", session, theme: theme() }));
}
const reload = () => { close(); frame.src = "/sandbox?v=mew-app-v3"; };
frame.addEventListener("load", mount);
document.getElementById("reload").onclick = reload;
document.getElementById("theme").onclick = () => { document.documentElement.classList.toggle("light"); window.sendTheme?.(); };
document.getElementById("reset").onclick = async () => { await fetch("/state", { method: "DELETE" }); reload(); };
new EventSource("/events").onmessage = reload;
</script></body></html>`;
}

export async function createDevServer({ folder = ".", host = "127.0.0.1", port = 4175 } = {}) {
  if (!["127.0.0.1", "::1"].includes(host)) throw new Error("mew dev only listens on 127.0.0.1 or ::1");
  const dir = await realpath(path.resolve(folder));
  await loadApp(dir);
  const states = new Map();
  const clients = new Set();
  let origin;
  let sandbox;
  const json = (response, status, value) => response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(value));
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host) return json(response, 421, { error: "Unexpected Host header" });
      if (request.method !== "GET" && request.headers.origin !== origin) return json(response, 403, { error: "Cross-origin request refused" });
      const url = new URL(request.url, origin);
      if (request.method === "GET" && url.pathname === "/") {
        const nonce = randomBytes(16).toString("base64");
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        }).end(hostPage(nonce));
        return;
      }
      if (request.method === "GET" && url.pathname === "/sandbox" && url.search === "?v=mew-app-v3") return response.writeHead(200, sandbox.headers).end(sandbox.html);
      if (request.method === "GET" && url.pathname === "/app") return json(response, 200, await loadApp(dir));
      if (request.method === "GET" && url.pathname === "/events") {
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" }).write(": connected\n\n");
        clients.add(response);
        request.on("close", () => clients.delete(response));
        return;
      }
      if (request.method === "DELETE" && url.pathname === "/state") {
        states.clear();
        return json(response, 200, {});
      }
      const match = /^\/state\/(private|shared)$/.exec(url.pathname);
      if (match && ["GET", "PUT"].includes(request.method)) {
        const scope = match[1];
        const { permissions, stateVersion } = await loadApp(dir);
        if (!permissions.includes(`storage:${scope}`)) return json(response, 403, { error: `app.json manifest does not grant storage:${scope}` });
        const current = states.get(scope) ?? { revision: 0, value: {}, state_version: null };
        if (request.method === "GET") return json(response, 200, current);
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 65_536) return json(response, 413, { error: "State request is too large" });
        }
        const update = JSON.parse(body);
        if (!update?.value || typeof update.value !== "object" || Array.isArray(update.value) || Buffer.byteLength(JSON.stringify(update.value)) > MAX_STATE_BYTES) {
          return json(response, 400, { error: "State values must be JSON objects of at most 16 KiB" });
        }
        if (update.expected_revision !== current.revision) return json(response, 409, { error: "state revision conflict" });
        const next = { revision: current.revision + 1, value: update.value, state_version: stateVersion };
        states.set(scope, next);
        return json(response, 200, next);
      }
      json(response, 404, { error: "Not found" });
    } catch (error) {
      json(response, 400, { error: error.message });
    }
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(port, host, resolve));
  const address = server.address();
  origin = `http://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`;
  sandbox = sandboxDocument([origin], bootstrapSource);
  let pending;
  const watcher = watch(dir, { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(() => { for (const client of clients) client.write("data: reload\n\n"); }, 100);
  });
  return {
    url: `${origin}/`,
    close: () => new Promise((resolve) => {
      clearTimeout(pending);
      watcher.close();
      for (const client of clients) client.end();
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}
