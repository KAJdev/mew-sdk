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
  let context = Object.freeze({ widget: Object.freeze({ name: "main", type: "page" }) });
  const events = { state: new Set(), realtime: new Set(), message: new Set() };
  let reportedHeight = 0;
  let measuring = false;
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

  function freeze(value) {
    if (value && typeof value === "object") {
      for (const key of Object.keys(value)) freeze(value[key]);
      Object.freeze(value);
    }
    return value;
  }

  function sendHeight(height) {
    if (!initialized || !port || !Number.isFinite(height)) return;
    const value = Math.max(0, Math.min(10_000, Math.ceil(height)));
    if (value === reportedHeight) return;
    reportedHeight = value;
    port.postMessage(stringify({ type: "resize", session, height: value }));
  }

  function measure() {
    if (measuring) return;
    measuring = true;
    window.requestAnimationFrame(() => {
      measuring = false;
      const body = document.body;
      if (!body) return;
      const style = window.getComputedStyle(body);
      sendHeight(body.getBoundingClientRect().bottom + parseFloat(style.marginBottom || "0") + window.scrollY);
    });
  }

  function send(fields) {
    if (!initialized || !port || pending.size >= 4) return Promise.reject(new Error("App connection is unavailable or busy"));
    const id = sequence + 1;
    const data = stringify({ session, id, ...fields });
    if (encode(data).length > 65_536) return Promise.reject(new Error("Request is too large"));
    sequence = id;
    return new Promise((resolve, reject) => {
      const timeout = schedule(() => { pending.delete(id); reject(new Error("Request timed out")); }, 30_000);
      pending.set(id, { resolve, reject, timeout });
      port.postMessage(data);
    });
  }

  function request(method, scope, value, expected_revision) {
    return send({ method, scope, ...(method === "state.put" ? { value, expected_revision } : {}) });
  }

  function emit(kind, value) {
    for (const listener of events[kind]) {
      try { listener(value); } catch { continue; }
    }
  }

  function on(kind, listener) {
    if (typeof listener !== "function") throw new Error("Invalid event listener");
    if (kind === "theme") return sdk.theme.subscribe(listener);
    const set = events[kind];
    if (!set || set.size >= 50) throw new Error("Invalid event subscription");
    set.add(listener);
    return () => set.delete(listener);
  }

  function watch(scope, listener) {
    if (typeof listener !== "function") throw new Error("Invalid state listener");
    let latest = -1;
    let active = true;
    const deliver = (state) => {
      if (!active || !state || state.revision <= latest) return;
      latest = state.revision;
      try { listener(state); } catch { return; }
    };
    const stop = on("state", (state) => { if (state.scope === scope) deliver({ revision: state.revision, value: state.value }); });
    request("state.get", scope).then(deliver, () => {});
    return () => { active = false; stop(); };
  }

  const sdk = Object.freeze({
    version: 1,
    get context() { return context; },
    call: (name, args) => send({ method: "backend.call", name, args: args === undefined ? null : args }),
    on,
    messages: Object.freeze({
      post: ({ type, data, content } = {}) => send({ method: "message.post", type, data, content }),
    }),
    frame: Object.freeze({
      setHeight: (height) => {
        if (typeof height !== "number" || !Number.isFinite(height) || height < 0) throw new Error("Invalid frame height");
        sendHeight(height);
      },
    }),
    state: Object.freeze({
      get: (scope) => request("state.get", scope),
      put: (scope, { value, expected_revision }) => request("state.put", scope, value, expected_revision),
      watch,
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

  function sized() {
    return context.widget && (context.widget.type === "message" || context.widget.type === "profile");
  }

  function build(html, css, js, frameTheme) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const scripts = [...parsed.querySelectorAll("script")];
    for (const script of scripts) script.remove();
    document.head.replaceChildren(...parsed.head.childNodes);
    document.body.replaceChildren(...parsed.body.childNodes);
    const style = document.createElement("style");
    style.textContent = "html{color:var(--mew-primary);background:var(--mew-background);font:14px/1.4 ui-monospace,monospace}body{margin:16px}*{box-sizing:border-box}";
    if (sized()) style.textContent += "body{margin:8px 10px}";
    document.head.prepend(style);
    if (css) {
      const sheet = document.createElement("style");
      sheet.textContent = css;
      document.head.append(sheet);
    }
    applyTheme(frameTheme);
    for (const original of scripts) {
      if (original.src) continue;
      const script = document.createElement("script");
      if (original.type) script.type = original.type;
      script.textContent = original.textContent;
      document.body.append(script);
    }
    if (js) {
      const script = document.createElement("script");
      script.type = "module";
      script.textContent = js;
      document.body.append(script);
    }
    if (sized()) {
      const observer = new ResizeObserver(measure);
      observer.observe(document.documentElement);
      observer.observe(document.body);
      window.addEventListener("load", measure);
      measure();
    }
  }

  function text(value) {
    return typeof value === "string" ? value : "";
  }

  function receive(event) {
    if (typeof event.data !== "string" || event.data.length > 16 * 1024 * 1024) return;
    let message;
    try { message = parse(event.data); } catch { return; }
    if (!message || message.session !== session) return;
    if (message.type === "initialize" && !initialized) {
      const widget = message.widget && typeof message.widget === "object" ? message.widget : { html: message.html };
      const html = text(widget.html);
      const css = text(widget.css);
      const js = text(widget.js);
      if (encode(html).length + encode(css).length + encode(js).length > 2 * 1024 * 1024) return;
      initialized = true;
      if (message.context && typeof message.context === "object" && !Array.isArray(message.context)) {
        try { context = freeze(parse(stringify(message.context))); } catch { context = Object.freeze({}); }
      }
      Object.defineProperty(window, "mew", { value: sdk, configurable: false, writable: false });
      build(html, css, js, message.theme);
    } else if (message.type === "theme" && initialized) {
      applyTheme(message.theme);
    } else if (message.type === "state" && initialized && typeof message.scope === "string" && Number.isSafeInteger(message.revision)) {
      emit("state", freeze({ scope: message.scope, revision: message.revision, value: message.value }));
    } else if (message.type === "realtime" && initialized && typeof message.topic === "string") {
      emit("realtime", freeze({ topic: message.topic, data: message.data }));
    } else if (message.type === "message" && initialized && message.message && typeof message.message === "object") {
      const update = freeze(message.message);
      context = freeze({ ...context, message: update });
      emit("message", update);
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
