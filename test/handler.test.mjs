import test from "node:test";
import assert from "node:assert/strict";
import { App, MewError } from "../handler.js";

const installation = { id: "i1", app_id: "a1", channel_id: "c1", personal: false };

function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method, body });
    const handler = routes[`${init.method} ${url}`];
    if (!handler) return new Response(JSON.stringify({ message: "missing" }), { status: 404 });
    const [status, value] = handler(body, calls);
    return new Response(value === undefined ? "" : JSON.stringify(value), { status });
  };
  return calls;
}

const envelope = (kind, extra) => new Request("https://handler.invalid/", {
  method: "POST",
  headers: { "x-mew-kind": kind },
  body: JSON.stringify({ installation, ...extra }),
});

test("describe lists registrations", () => {
  const app = new App();
  app.on("messageCreate", () => {}).action("vote", () => {}).cron("*/5 * * * *", () => {});
  app.http.post("/hooks/:id", () => new Response("ok"));
  assert.deepEqual(app.describe(), {
    events: ["messageCreate"],
    actions: ["vote"],
    crons: ["*/5 * * * *"],
    routes: [{ method: "POST", path: "/hooks/:id" }],
  });
});

test("registration rejects unknown events, bad names and duplicates", () => {
  const app = new App();
  assert.throws(() => app.on("reactionAdd", () => {}));
  assert.throws(() => app.action("1bad", () => {}));
  app.action("vote", () => {});
  assert.throws(() => app.action("vote", () => {}));
  assert.throws(() => app.cron("* * *", () => {}));
});

test("actions receive caller, widget and message and return results", async () => {
  const app = new App();
  app.action("vote", (ctx, args) => ({ who: ctx.caller.id, widget: ctx.widget.name, message: ctx.message.id, option: args.option }));
  const response = await app.fetch(envelope("action", {
    action: { name: "vote", args: { option: 2 }, caller: { id: "u1", username: "u" }, widget: { name: "poll", type: "message" }, message: { id: "m1", type: "poll", data: {}, content: "", channel_id: "c1" } },
  }), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: { who: "u1", widget: "poll", message: "m1", option: 2 } });
});

test("thrown action errors become 422 and unknown actions 404", async () => {
  const app = new App();
  app.action("boom", () => { throw new Error("nope"); });
  const original = console.error;
  console.error = () => {};
  const failed = await app.fetch(envelope("action", { action: { name: "boom", args: {}, caller: {}, widget: {} } }), {});
  console.error = original;
  assert.equal(failed.status, 422);
  assert.deepEqual(await failed.json(), { error: { code: "handler_error", message: "nope" } });
  const missing = await app.fetch(envelope("action", { action: { name: "other", args: {}, caller: {}, widget: {} } }), {});
  assert.equal(missing.status, 404);
});

test("events run every handler with a stable event id", async () => {
  const seen = [];
  const app = new App();
  app.on("messageCreate", (ctx, message) => seen.push([ctx.event.id, message.content]));
  app.on("messageCreate", () => seen.push(["second"]));
  const response = await app.fetch(envelope("event", { event: { id: "e1", name: "messageCreate", payload: { content: "hi" } } }), {});
  assert.equal(response.status, 204);
  assert.deepEqual(seen, [["e1", "hi"], ["second"]]);
});

test("http routes match params and strip dispatch headers", async () => {
  const app = new App();
  app.http.post("/hooks/:id", async (ctx, request) => new Response(`${ctx.params.id}:${request.headers.has("x-mew-envelope")}:${await request.text()}`));
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ installation }))));
  const response = await app.fetch(new Request("https://apps.mew.space/hooks/gh", {
    method: "POST",
    headers: { "x-mew-kind": "http", "x-mew-envelope": encoded },
    body: "payload",
  }), {});
  assert.equal(await response.text(), "gh:false:payload");
});

test("bot messages post app types and shared state retries conflicts", async () => {
  let revision = 1;
  const calls = stubFetch({
    "POST https://mew.space/api/v1/channels/c1/messages": (body) => [201, { id: "m9", ...body }],
    "GET https://mew.space/api/v1/app-installations/i1/state/shared": () => [200, { revision, value: { n: revision }, state_version: 1 }],
    "PUT https://mew.space/api/v1/app-installations/i1/state/shared": (body) => {
      if (body.expected_revision !== 2) { revision = 2; return [409, { message: "conflict" }]; }
      return [200, { revision: 3, value: body.value, state_version: 1 }];
    },
  });
  const app = new App();
  app.action("go", async (ctx) => {
    const message = await ctx.mew.messages.post({ content: "poll", type: "poll", data: { q: "lunch" } });
    const state = await ctx.state.shared.update((value) => ({ n: value.n + 10 }));
    return { message: message.app, state: state.value };
  });
  const response = await app.fetch(envelope("action", { action: { name: "go", args: {}, caller: {}, widget: {} } }), {});
  assert.deepEqual(await response.json(), { result: { message: { type: "poll", data: { q: "lunch" } }, state: { n: 12 } } });
  assert.equal(calls.filter((c) => c.method === "PUT").length, 2);
});

test("api errors surface as MewError", async () => {
  stubFetch({});
  const app = new App();
  let caught;
  app.action("x", async (ctx) => { try { await ctx.realtime.publish("t", {}); } catch (error) { caught = error; } return null; });
  await app.fetch(envelope("action", { action: { name: "x", args: {}, caller: {}, widget: {} } }), {});
  assert.ok(caught instanceof MewError);
  assert.equal(caught.status, 404);
});
