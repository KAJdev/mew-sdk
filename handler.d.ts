import type { Embed } from "./embeds.js";
export type { Embed, CompactEmbed, RichEmbed, EmbedBadge, MessagePayload } from "./embeds.js";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** shared installation state: a json object of at most 16 KiB serialized, depth 16, finite numbers only */
export type State = { [key: string]: JsonValue };

export interface MessageEvent {
  readonly version: 1;
  readonly type: "message.mentioned" | "message.replied";
  readonly event_id: string;
  readonly delivery_id: string;
  readonly subscription_id: string;
  readonly bot_id: string;
  readonly sequence: string;
  readonly channel_id: string;
  readonly message_id: string;
  /** id of the message this one replies to, or null */
  readonly reply_to_id: string | null;
  readonly message: {
    readonly content: string;
    readonly author_id: string;
    readonly created_at: string;
  };
}

export interface Result {
  /** replaces the shared installation state */
  state: State;
  /** posted as the app's reply; content must contain non-whitespace and at most 4000 unicode code points */
  reply: { content: string } | null;
}

export interface Handler {
  event(event: MessageEvent, state: State): Result | Promise<Result>;
}

export interface User {
  readonly id: string;
  readonly username: string;
  readonly display_name?: string | null;
}

export interface Message {
  readonly id: string;
  readonly channel_id: string;
  readonly author: User & { readonly bot: boolean };
  readonly content: string;
  readonly embeds?: readonly Embed[];
  readonly app?: { readonly installation_id: string; readonly type: string; readonly data: { [key: string]: JsonValue } } | null;
  readonly reply_to?: string | null;
  readonly mentions: readonly string[];
  readonly created_at: string;
}

export interface Events {
  install: { readonly installer: User };
  update: Record<string, never>;
  messageCreate: Message;
  mention: Message;
  memberJoin: { readonly user: User };
  memberLeave: { readonly user: User };
}

export interface SharedState {
  get(): Promise<{ revision: number; value: State; state_version: number | null }>;
  put(update: { expected_revision: number; value: State }): Promise<{ revision: number; value: State; state_version: number | null }>;
  /** reads, applies change and writes with compare-and-swap, retrying on conflicts */
  update(change: (value: State) => State | Promise<State>, options?: { attempts?: number }): Promise<{ revision: number; value: State; state_version: number | null }>;
}

export interface Storage {
  get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined>;
  put(key: string, value: JsonValue): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: string[]; cursor: string | null }>;
  sql<T = Record<string, JsonValue>>(query: string, ...params: JsonValue[]): Promise<T[]>;
}

export interface MewClient {
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  readonly messages: {
    post(message: { content: string; type?: string; data?: { [key: string]: JsonValue }; embeds?: Embed[]; channel_id?: string }): Promise<Message>;
    edit(id: string, change: { content?: string; data?: { [key: string]: JsonValue }; channel_id?: string }): Promise<Message>;
    delete(id: string, options?: { channel_id?: string }): Promise<void>;
    history(query?: { channel_id?: string; limit?: number; before_id?: string; after_id?: string }): Promise<Message[]>;
  };
}

export interface Context<Env = Record<string, string>> {
  readonly installation: { readonly id: string; readonly app_id: string; readonly channel_id: string; readonly personal: boolean };
  readonly env: Env;
  readonly storage: Storage;
  readonly state: { readonly shared: SharedState };
  readonly realtime: { publish(topic: string, data: JsonValue, options?: { user_id?: string }): Promise<void> };
  readonly mew: MewClient;
  readonly log: { info(message: string, fields?: object): void; warn(message: string, fields?: object): void; error(message: string, fields?: object): void };
  waitUntil(promise: Promise<unknown>): void;
}

export interface EventContext<Env = Record<string, string>> extends Context<Env> {
  /** stable across retries of the same delivery */
  readonly event: { readonly id: string; readonly name: keyof Events };
}

export interface ActionContext<Env = Record<string, string>> extends Context<Env> {
  readonly caller: User;
  readonly widget: { readonly name: string; readonly type: "page" | "panel" | "message" };
  /** the verified app message when the call comes from a message widget */
  readonly message: { readonly id: string; readonly type: string; readonly data: { [key: string]: JsonValue }; readonly content: string; readonly channel_id: string } | null;
}

export interface HttpContext<Env = Record<string, string>> extends Context<Env> {
  readonly params: Record<string, string>;
}

type Route<Env> = (path: string, handler: (ctx: HttpContext<Env>, request: Request) => Response | Promise<Response>) => App<Env>;

export class MewError extends Error {
  readonly status: number;
  readonly body: unknown;
}

export class App<Env = Record<string, string>> {
  on<E extends keyof Events>(event: E, handler: (ctx: EventContext<Env>, payload: Events[E]) => void | Promise<void>): this;
  action<Args extends JsonValue = any, R extends JsonValue | void = any>(name: string, handler: (ctx: ActionContext<Env>, args: Args) => R | Promise<R>): this;
  cron(expression: string, handler: (ctx: Context<Env>, info: { scheduled_time: string }) => void | Promise<void>): this;
  readonly http: { get: Route<Env>; post: Route<Env>; put: Route<Env>; patch: Route<Env>; delete: Route<Env> };
  describe(): { events: (keyof Events)[]; actions: string[]; crons: string[]; routes: { method: string; path: string }[] };
  fetch(request: Request, env: Env, executionContext?: { waitUntil(promise: Promise<unknown>): void }): Promise<Response>;
}
