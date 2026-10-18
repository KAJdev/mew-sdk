const API = "https://mew.space/api";
const STORAGE = "https://storage.mew.internal";
const EVENTS = new Set(["install", "update", "messageCreate", "mention", "memberJoin", "memberLeave"]);
const METHODS = ["get", "post", "put", "patch", "delete"];
const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

class MewError extends Error {
  constructor(status, body) {
    super(typeof body?.message === "string" ? body.message : `mew api returned ${status}`);
    this.name = "MewError";
    this.status = status;
    this.body = body;
  }
}

async function call(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) throw new MewError(response.status, parsed);
  return parsed;
}

function pattern(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 256) throw new TypeError("route paths start with / and are at most 256 characters");
  const keys = [];
  const source = path.split("/").map((part) => {
    if (part.startsWith(":")) {
      keys.push(part.slice(1));
      return "([^/]+)";
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  return { regex: new RegExp(`^${source}/?$`), keys };
}

function json(status, value) {
  return new Response(value === undefined ? null : JSON.stringify(value), {
    status,
    headers: value === undefined ? {} : { "content-type": "application/json" },
  });
}

function storage(installationId) {
  const op = (name, body) => call(`${STORAGE}/${name}`, "POST", { installation_id: installationId, ...body });
  return {
    async get(key) {
      const { value } = await op("get", { key });
      return value ?? undefined;
    },
    async put(key, value) {
      await op("put", { key, value });
    },
    async delete(key) {
      const { deleted } = await op("delete", { key });
      return deleted;
    },
    list(options = {}) {
      return op("list", options);
    },
    async sql(query, ...params) {
      const { rows } = await op("sql", { query, params });
      return rows;
    },
  };
}

function shared(installationId) {
  const path = `${API}/v1/app-installations/${installationId}/state/shared`;
  const state = {
    get: () => call(path, "GET"),
    put: (update) => call(path, "PUT", update),
    async update(change, { attempts = 5 } = {}) {
      for (let attempt = 1; ; attempt++) {
        const current = await state.get();
        const value = await change(structuredClone(current.value));
        try {
          return await state.put({ expected_revision: current.revision, value });
        } catch (error) {
          if (!(error instanceof MewError) || error.status !== 409 || attempt >= attempts) throw error;
        }
      }
    },
  };
  return state;
}

function client(installation) {
  const request = (method, path, body) => call(`${API}${path}`, method.toUpperCase(), body);
  const channel = (id) => encodeURIComponent(id ?? installation.channel_id);
  return {
    request,
    messages: {
      post({ content, type, data, embeds, channel_id } = {}) {
        const body = { content };
        if (embeds !== undefined) body.embeds = embeds;
        if (type !== undefined) body.app = { type, data: data ?? {} };
        return request("POST", `/v1/channels/${channel(channel_id)}/messages`, body);
      },
      edit(id, { content, data, channel_id } = {}) {
        const body = {};
        if (content !== undefined) body.content = content;
        if (data !== undefined) body.app = { data };
        return request("PATCH", `/v1/channels/${channel(channel_id)}/messages/${encodeURIComponent(id)}`, body);
      },
      delete(id, { channel_id } = {}) {
        return request("DELETE", `/v1/channels/${channel(channel_id)}/messages/${encodeURIComponent(id)}`);
      },
      history({ channel_id, ...query } = {}) {
        const search = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
        const suffix = search.size ? `?${search}` : "";
        return request("GET", `/v1/channels/${channel(channel_id)}/messages${suffix}`);
      },
    },
  };
}

function logger(fields) {
  const line = (level) => (message, extra) => console[level](JSON.stringify({ level, message: String(message), ...fields, ...(extra ?? {}) }));
  return { info: line("log"), warn: line("warn"), error: line("error") };
}

export class App {
  #events = new Map();
  #actions = new Map();
  #crons = new Map();
  #routes = [];

  constructor() {
    this.http = Object.fromEntries(METHODS.map((method) => [method, (path, handler) => this.#route(method.toUpperCase(), path, handler)]));
  }

  on(event, handler) {
    if (!EVENTS.has(event)) throw new TypeError(`unknown event ${event}`);
    if (typeof handler !== "function") throw new TypeError("handler must be a function");
    const list = this.#events.get(event) ?? [];
    list.push(handler);
    this.#events.set(event, list);
    return this;
  }

  action(name, handler) {
    if (!NAME.test(name)) throw new TypeError(`invalid action name ${name}`);
    if (this.#actions.has(name)) throw new TypeError(`action ${name} is already registered`);
    if (typeof handler !== "function") throw new TypeError("handler must be a function");
    this.#actions.set(name, handler);
    return this;
  }

  cron(expression, handler) {
    if (typeof expression !== "string" || expression.trim().split(/\s+/).length !== 5) throw new TypeError("cron expressions have five fields");
    if (this.#crons.has(expression)) throw new TypeError(`cron ${expression} is already registered`);
    if (typeof handler !== "function") throw new TypeError("handler must be a function");
    this.#crons.set(expression, handler);
    return this;
  }

  #route(method, path, handler) {
    if (this.#routes.some((r) => r.method === method && r.path === path)) throw new TypeError(`route ${method} ${path} is already registered`);
    if (typeof handler !== "function") throw new TypeError("handler must be a function");
    this.#routes.push({ method, path, handler, ...pattern(path) });
    return this;
  }

  describe() {
    return {
      events: [...this.#events.keys()],
      actions: [...this.#actions.keys()],
      crons: [...this.#crons.keys()],
      routes: this.#routes.map(({ method, path }) => ({ method, path })),
    };
  }

  async fetch(request, env, executionContext) {
    const kind = request.headers.get("x-mew-kind");
    const envelope = kind === "http"
      ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(request.headers.get("x-mew-envelope") ?? ""), (c) => c.charCodeAt(0))))
      : await request.json();
    const installation = envelope.installation;
    const ctx = {
      installation,
      env,
      storage: storage(installation.id),
      state: { shared: shared(installation.id) },
      realtime: {
        publish: (topic, data, options = {}) => call(`${API}/v1/app-installations/${installation.id}/realtime`, "POST", { topic, data, ...options }),
      },
      mew: client(installation),
      log: logger({ kind, installation_id: installation.id }),
      waitUntil: (promise) => executionContext?.waitUntil(promise),
    };
    try {
      if (kind === "action") {
        const handler = this.#actions.get(envelope.action.name);
        if (!handler) return json(404, { error: { code: "unknown_action", message: `no action ${envelope.action.name}` } });
        Object.assign(ctx, { caller: envelope.action.caller, widget: envelope.action.widget, message: envelope.action.message ?? null });
        const result = await handler(ctx, envelope.action.args ?? {});
        return json(200, { result: result ?? null });
      }
      if (kind === "event") {
        ctx.event = { id: envelope.event.id, name: envelope.event.name };
        for (const handler of this.#events.get(envelope.event.name) ?? []) await handler(ctx, envelope.event.payload);
        return json(204);
      }
      if (kind === "cron") {
        const handler = this.#crons.get(envelope.cron.expression);
        if (!handler) return json(404, { error: { code: "unknown_cron", message: `no cron ${envelope.cron.expression}` } });
        await handler(ctx, { scheduled_time: envelope.cron.scheduled_time });
        return json(204);
      }
      if (kind === "http") {
        const url = new URL(request.url);
        for (const route of this.#routes) {
          if (route.method !== request.method) continue;
          const match = route.regex.exec(url.pathname);
          if (!match) continue;
          ctx.params = Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]));
          const clean = new Request(request);
          clean.headers.delete("x-mew-kind");
          clean.headers.delete("x-mew-envelope");
          return await route.handler(ctx, clean);
        }
        return new Response("not found", { status: 404 });
      }
      return json(400, { error: { code: "unknown_kind", message: `unknown dispatch kind ${kind}` } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.log.error(message, { stack: error instanceof Error ? error.stack : undefined });
      return json(kind === "action" ? 422 : 500, { error: { code: "handler_error", message: message.slice(0, 500) } });
    }
  }
}

export { MewError };
