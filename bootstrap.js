function bootstrap(hostOrigins) {
  "use strict";
  const protocol = "mew-app-v1";
  let session = null;
  let hostOrigin = null;
  let port = null;
  let postMessage = null;
  let initialized = false;
  let mediaSupported = false;
  let voiceSupported = false;
  let weatherSupported = false;
  let sequence = 0;
  const pending = new Map();
  const listeners = new Set();
  let theme = null;
  let context = Object.freeze({ widget: Object.freeze({ name: "main", type: "page" }) });
  const events = { state: new Set(), realtime: new Set(), message: new Set(), voice: new Set() };
  let reportedHeight = 0;
  let reportedWidth = 0;
  let measuring = false;
  let contentReady = false;
  let initialHeight = 0;
  const idleWaiters = new Set();
  const stringify = JSON.stringify.bind(JSON);
  const parse = JSON.parse.bind(JSON);
  const createObject = Object.create.bind(Object);
  const assignObject = Object.assign.bind(Object);
  const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
  const encoder = new TextEncoder();
  const encode = encoder.encode.bind(encoder);
  const schedule = window.setTimeout.bind(window);
  const cancel = window.clearTimeout.bind(window);
  const Link = URL;
  const currentEvent = Object.getOwnPropertyDescriptor(window, "event").get.bind(window);
  const eventPhase = Function.prototype.call.bind(Object.getOwnPropertyDescriptor(Event.prototype, "eventPhase").get);
  const eventData = Function.prototype.call.bind(Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data").get);
  let gesture = null;
  let postGesture = null;

  function packet(fields) {
    return assignObject(createObject(null), fields);
  }

  function recordPostGesture(event) {
    if (!event.isTrusted) return;
    postGesture = event;
    schedule(() => { if (postGesture === event) postGesture = null; }, 0);
  }

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
    if (!contentReady || !port || !Number.isFinite(height)) return;
    const value = Math.max(0, Math.min(10_000, Math.ceil(height)));
    const width = Math.max(0, Math.min(10_000, Math.round(innerWidth)));
    if (value === reportedHeight && width === reportedWidth) return;
    reportedHeight = value;
    reportedWidth = width;
    postMessage(stringify(packet({ type: "resize", session, height: value, width })));
  }

  function measure() {
    if (measuring) return;
    measuring = true;
    window.requestAnimationFrame(async () => {
      const images = measuredImages();
      await Promise.all([document.fonts.ready, ...images.map((image) => image.decode().catch(() => {}))]);
      measuring = false;
      const body = document.body;
      if (!body) return;
      if (document.fonts.status === "loading" || images.length !== document.images.length || images.some((image, index) => image !== document.images[index] || !image.complete)) { measure(); return; }
      const style = window.getComputedStyle(body);
      sendHeight(body.getBoundingClientRect().bottom + parseFloat(style.marginBottom || "0") + window.scrollY);
    });
  }

  function measuredImages() {
    const images = [...document.images];
    for (const image of images) if (image.loading === "lazy") image.loading = "eager";
    return images;
  }

  function send(fields) {
    if (!initialized || !port || pending.size >= 4) return Promise.reject(new Error("App connection is unavailable or busy"));
    const id = sequence + 1;
    const data = stringify(packet({ session, id, ...fields }));
    if (encode(data).length > 65_536) return Promise.reject(new Error("Request is too large"));
    sequence = id;
    return new Promise((resolve, reject) => {
      const timeout = schedule(() => { pending.delete(id); reject(new Error("Request timed out")); notifyIdle(); }, 30_000);
      pending.set(id, { resolve, reject, timeout });
      postMessage(data);
    });
  }

  function notifyIdle() {
    if (pending.size) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  }

  function open(url) {
    if (typeof url !== "string" || url.length > 2048) throw new Error("Invalid link");
    let parsed;
    try { parsed = new Link(url); } catch { throw new Error("Invalid link"); }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) throw new Error("Only http and https links without credentials can be opened");
    if (initialized && port && gesture && currentEvent() === gesture && eventPhase(gesture) !== 0) {
      postMessage(stringify(packet({ type: "open", session, url: parsed.href, gesture: true })));
    }
  }

  function interceptLinks(event) {
    recordPostGesture(event);
    if (event.isTrusted) {
      gesture = event;
      schedule(() => { if (gesture === event) gesture = null; }, 0);
    }
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const link = event.target.closest("a[href]");
    const href = link ? link.getAttribute("href").trim() : "";
    if (!/^https?:/i.test(href)) return;
    event.preventDefault();
    if (!event.isTrusted) return;
    try { open(href); } catch { return; }
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
    open,
    weather: Object.freeze({
      get supported() { return weatherSupported; },
      open: (target) => send({ method: "weather.open", target }),
    }),
    media: Object.freeze({
      get supported() { return mediaSupported; },
      open: (target) => {
        if (!target || typeof target !== "object" || Array.isArray(target) || Object.keys(target).length !== 3) return Promise.reject(new Error("Invalid media target"));
        return send({ method: "media.open", target: { provider: target.provider, kind: target.kind, id: target.id } });
      },
    }),
    voice: Object.freeze({
      get supported() { return voiceSupported; },
      get: () => send({ method: "voice.get" }),
      streams: (cursor) => send({ method: "voice.streams", ...(cursor === undefined ? {} : { cursor }) }),
      join: () => send({ method: "voice.join" }),
      leave: () => send({ method: "voice.leave" }),
      publish: (source) => send({ method: "voice.publish", source }),
      subscribe: (stream) => send({ method: "voice.subscribe", stream }),
      stop: (handle) => send({ method: "voice.stop", handle }),
      activity: Object.freeze({
        get: () => send({ method: "voice.activity.get" }),
        join: () => send({ method: "voice.activity.join" }),
        leave: () => send({ method: "voice.activity.leave" }),
        control: (command) => send({ method: "voice.activity.control", command }),
      }),
    }),
    on,
    messages: Object.freeze({
      post: (message = {}) => {
        if (!message || typeof message !== "object" || hasOwn(message, "as")) return Promise.reject(new Error("Widget messages are posted as the person using the app"));
        const { type, data, content } = message;
        if (!postGesture || currentEvent() !== postGesture || eventPhase(postGesture) === 0) return Promise.reject(new Error("Posting requires a click or key press in this app"));
        return send({ method: "message.post", author: "user", type, data, content, gesture: true });
      },
    }),
    chatbar: Object.freeze({
      setDraft: (draft) => {
        if (context.widget?.type !== "chatbar") return Promise.reject(new Error("Chatbar drafts are only available in chatbar widgets"));
        return send({ method: "chatbar.draft", draft });
      },
    }),
    frame: Object.freeze({
      setHeight: (height) => {
        if (typeof height !== "number" || !Number.isFinite(height) || height < 0) throw new Error("Invalid frame height");
        if (!contentReady) initialHeight = Math.min(10_000, Math.ceil(height));
        else sendHeight(height);
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
    return context.widget && (context.widget.type === "message" || context.widget.type === "profile" || context.widget.type === "chatbar");
  }

  async function build(html, css, js, frameTheme) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const scripts = [...parsed.querySelectorAll("script")];
    for (const script of scripts) script.remove();
    document.head.replaceChildren(...parsed.head.childNodes);
    document.body.replaceChildren(...parsed.body.childNodes);
    const style = document.createElement("style");
    style.textContent = "html{color:var(--mew-primary);background:var(--mew-background);font:14px/1.4 ui-monospace,monospace}body{margin:16px}*{box-sizing:border-box}";
    if (sized()) style.textContent += "html{background:transparent}body{margin:0}";
    document.head.prepend(style);
    if (css) {
      const sheet = document.createElement("style");
      sheet.textContent = css;
      document.head.append(sheet);
    }
    applyTheme(frameTheme);
    const modules = [];
    const append = (script) => {
      if (script.type === "module") {
        const complete = "mew:module:" + crypto.randomUUID();
        modules.push(new Promise((resolve) => {
          document.addEventListener(complete, resolve, { once: true });
          window.addEventListener("error", resolve, { once: true });
        }));
        script.textContent += "\n;document.dispatchEvent(new Event(" + stringify(complete) + "));";
      }
      document.body.append(script);
    };
    for (const original of scripts) {
      if (original.src) continue;
      const script = document.createElement("script");
      if (original.type) script.type = original.type;
      script.textContent = original.textContent;
      append(script);
    }
    if (js) {
      const script = document.createElement("script");
      script.type = "module";
      script.textContent = js;
      append(script);
    }
    if (sized()) {
      const observer = new ResizeObserver(measure);
      observer.observe(document.documentElement);
      observer.observe(document.body);
      window.addEventListener("load", measure, true);
      document.fonts.addEventListener("loadingdone", measure);
      measure();
    }
    await Promise.all(modules);
    for (;;) {
      if (pending.size) await new Promise((resolve) => idleWaiters.add(resolve));
      const images = measuredImages();
      document.body.getBoundingClientRect();
      await Promise.all([document.fonts.ready, ...images.map((image) => image.decode().catch(() => {}))]);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (pending.size || document.fonts.status === "loading" || images.length !== document.images.length || images.some((image, index) => image !== document.images[index] || !image.complete)) continue;
      const style = getComputedStyle(document.body);
      const height = Math.max(0, Math.min(10_000, Math.max(initialHeight, Math.ceil(document.body.getBoundingClientRect().bottom + parseFloat(style.marginBottom || "0") + scrollY))));
      contentReady = true;
      reportedHeight = height;
      reportedWidth = Math.max(0, Math.min(10_000, Math.round(innerWidth)));
      postMessage(stringify(packet({ type: "rendered", session, height, width: reportedWidth })));
      break;
    }
  }

  function text(value) {
    return typeof value === "string" ? value : "";
  }

  function receive(data) {
    if (typeof data !== "string" || data.length > 16 * 1024 * 1024) return;
    let message;
    try { message = parse(data); } catch { return; }
    if (!message || message.session !== session) return;
    if (message.type === "initialize" && !initialized) {
      mediaSupported = message.capabilities?.media === true;
      voiceSupported = message.capabilities?.voice === true;
      weatherSupported = message.capabilities?.weather === true;
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
      window.addEventListener("click", interceptLinks, true);
      window.addEventListener("keydown", recordPostGesture, true);
      void build(html, css, js, message.theme).catch(() => {});
    } else if (message.type === "theme" && initialized) {
      applyTheme(message.theme);
    } else if (message.type === "state" && initialized && typeof message.scope === "string" && Number.isSafeInteger(message.revision)) {
      emit("state", freeze({ scope: message.scope, revision: message.revision, value: message.value }));
    } else if (message.type === "realtime" && initialized && typeof message.topic === "string") {
      emit("realtime", freeze({ topic: message.topic, data: message.data }));
    } else if (message.type === "voice" && initialized && message.room && typeof message.room === "object") {
      emit("voice", freeze(message.room));
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
      notifyIdle();
    }
  }

  function handshake(event) {
    if (event.source !== parent || !hostOrigins.includes(event.origin) || (hostOrigin && event.origin !== hostOrigin) || port) return;
    const data = event.data;
    if (!data || data.protocol !== protocol || typeof data.session !== "string" || !/^[a-f0-9-]{36}$/.test(data.session)) return;
    if (data.type === "challenge" && !session && !event.ports.length) {
      hostOrigin = event.origin;
      session = data.session;
      parent.postMessage(packet({ protocol, type: "ready", session }), hostOrigin);
    } else if (data.type === "connect" && data.session === session && event.ports.length === 1) {
      port = event.ports[0];
      postMessage = port.postMessage.bind(port);
      window.removeEventListener("message", handshake);
      port.onmessage = (event) => {
        const value = eventData(event);
        if (typeof value === "string" && value.length <= 16 * 1024 * 1024) schedule(() => receive(value), 0);
      };
      port.start();
    }
  }
  window.addEventListener("message", handshake);
}
