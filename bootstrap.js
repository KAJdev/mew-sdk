function bootstrap(hostOrigins) {
  "use strict";
  const protocol = "mew-app-v1";
  let session = null;
  let hostOrigin = null;
  let port = null;
  let initialized = false;
  let sequence = 0;
  const pending = new Map();
  const listeners = new Set();
  let theme = null;
  const stringify = JSON.stringify.bind(JSON);
  const parse = JSON.parse.bind(JSON);
  const encoder = new TextEncoder();
  const encode = encoder.encode.bind(encoder);
  const schedule = window.setTimeout.bind(window);
  const cancel = window.clearTimeout.bind(window);

  function applyTheme(value) {
    if (!value || value.version !== 1) return;
    theme = Object.freeze({ ...value });
    for (const key of ["primary", "background", "secondary", "tertiary"]) {
      document.documentElement.style.setProperty(`--mew-${key}`, theme[key]);
    }
    for (const listener of listeners) {
      try { listener(theme); } catch { continue; }
    }
  }

  function request(method, scope, value, expected_revision) {
    if (!initialized || !port || pending.size >= 4) return Promise.reject(new Error("App connection is unavailable or busy"));
    const id = sequence + 1;
    const data = stringify({ session, id, method, scope, ...(method === "state.put" ? { value, expected_revision } : {}) });
    if (encode(data).length > 65_536) return Promise.reject(new Error("State request is too large"));
    sequence = id;
    return new Promise((resolve, reject) => {
      const timeout = schedule(() => { pending.delete(id); reject(new Error("State request timed out")); }, 30_000);
      pending.set(id, { resolve, reject, timeout });
      port.postMessage(data);
    });
  }

  const sdk = Object.freeze({
    version: 1,
    state: Object.freeze({
      get: (scope) => request("state.get", scope),
      put: (scope, { value, expected_revision }) => request("state.put", scope, value, expected_revision),
    }),
    theme: Object.freeze({
      get: () => theme,
      subscribe: (listener) => {
        if (typeof listener !== "function" || listeners.size >= 20) throw new Error("Invalid theme subscription");
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
  });

  function receive(event) {
    if (typeof event.data !== "string" || event.data.length > 262_144 * 6 + 8192) return;
    let message;
    try { message = parse(event.data); } catch { return; }
    if (!message || message.session !== session) return;
    if (message.type === "initialize" && !initialized) {
      if (typeof message.html !== "string" || encode(message.html).length > 262_144) return;
      initialized = true;
      Object.defineProperty(window, "mew", { value: sdk, configurable: false, writable: false });
      const parsed = new DOMParser().parseFromString(message.html, "text/html");
      const scripts = [...parsed.querySelectorAll("script")];
      for (const script of scripts) script.remove();
      document.head.replaceChildren(...parsed.head.childNodes);
      document.body.replaceChildren(...parsed.body.childNodes);
      const style = document.createElement("style");
      style.textContent = "html{color:var(--mew-primary);background:var(--mew-background);font:14px/1.4 ui-monospace,monospace}body{margin:16px}*{box-sizing:border-box}";
      document.head.prepend(style);
      applyTheme(message.theme);
      for (const original of scripts) {
        if (original.src) continue;
        const script = document.createElement("script");
        if (original.type) script.type = original.type;
        script.textContent = original.textContent;
        document.body.append(script);
      }
    } else if (message.type === "theme" && initialized) {
      applyTheme(message.theme);
    } else if (message.type === "result") {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      cancel(item.timeout);
      if (message.error) item.reject(new Error(message.error));
      else item.resolve(message.value);
    }
  }

  function handshake(event) {
    if (event.source !== parent || !hostOrigins.includes(event.origin) || (hostOrigin && event.origin !== hostOrigin) || port) return;
    const data = event.data;
    if (!data || data.protocol !== protocol || typeof data.session !== "string" || !/^[a-f0-9-]{36}$/.test(data.session)) return;
    if (data.type === "challenge" && !session && !event.ports.length) {
      hostOrigin = event.origin;
      session = data.session;
      parent.postMessage({ protocol, type: "ready", session }, hostOrigin);
    } else if (data.type === "connect" && data.session === session && event.ports.length === 1) {
      port = event.ports[0];
      window.removeEventListener("message", handshake);
      port.onmessage = receive;
      port.start();
    }
  }
  window.addEventListener("message", handshake);
}
