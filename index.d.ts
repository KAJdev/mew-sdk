export type { Embed, CompactEmbed, RichEmbed, EmbedBadge, MessagePayload } from "./embeds.js";
import type { MediaTarget, MediaResult } from "./media.js";
import type { AppVoice, VoiceRoom } from "./voice.js";
import type { WeatherTarget, WeatherResult } from "./weather.js";
export type { WeatherTarget, WeatherResult } from "./weather.js";
export type { AppVoice, VoiceRoom, VoiceActivity, VoiceActivityCommand, VoiceStreamHandle, VoiceStream, VoiceParticipant } from "./voice.js";
export type { MediaTarget, MediaResult } from "./media.js";

export type Scope = "private" | "shared" | "profile";
export type State = { revision: number; value: Record<string, unknown>; state_version: number | null };
export type StateUpdate = { expected_revision: number; value: Record<string, unknown> };
export type StateEvent = Readonly<{ scope: Scope; revision: number; value: Record<string, unknown> }>;
export type RealtimeEvent = Readonly<{ topic: string; data: unknown }>;
export type Theme = Readonly<{ version: 1; primary: string; background: string; secondary: string; tertiary: string }>;
export type WidgetType = "page" | "panel" | "message" | "profile" | "chatbar";
export type ContextMessage = Readonly<{ id: string; type: string; data: Readonly<Record<string, unknown>>; content: string; author_id: string; created_at: string }>;
export type Context = Readonly<{
  installation_id: string;
  widget: Readonly<{ name: string; type: WidgetType }>;
  /** profile widgets only learn whether the viewer owns the profile */
  viewer: Readonly<{ id: string; username: string }> | Readonly<{ is_owner: boolean }>;
  anchor?: "left" | "right" | "top" | "bottom";
  message?: ContextMessage;
}>;
export type PostedMessage = { type: string; data: Record<string, unknown>; content: string };
export interface Events {
  state: StateEvent;
  realtime: RealtimeEvent;
  message: ContextMessage;
  theme: Theme;
  voice: Readonly<VoiceRoom>;
}
export interface MewSDK {
  readonly version: 1;
  readonly context: Context;
  call<T = unknown>(name: string, args?: unknown): Promise<T>;
  /** asks the host to open an http or https link in a new tab after a click in this frame. the host shows the domain and asks first. */
  open(url: string): void;
  readonly media: {
    readonly supported: boolean;
    open(target: MediaTarget): Promise<MediaResult>;
  };
  readonly voice: AppVoice;
  readonly weather: {
    readonly supported: boolean;
    open(target: WeatherTarget): Promise<WeatherResult>;
  };
  on<K extends keyof Events>(event: K, listener: (value: Events[K]) => void): () => void;
  readonly messages: {
    post(message: PostedMessage): Promise<{ id: string }>;
  };
  readonly chatbar: {
    setDraft(message: PostedMessage | null): Promise<void>;
  };
  readonly frame: {
    setHeight(height: number): void;
  };
  readonly state: {
    get(scope: Scope): Promise<State>;
    put(scope: Scope, update: StateUpdate): Promise<State>;
    watch(scope: Scope, listener: (state: State) => void): () => void;
  };
  readonly theme: {
    get(): Theme;
    subscribe(listener: (theme: Theme) => void): () => void;
  };
}
declare global {
  const mew: MewSDK;
  interface Window { readonly mew: MewSDK }
}

export function getMew(): MewSDK;
export function updateState(
  scope: Scope,
  update: (value: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>,
  options?: { attempts?: number },
): Promise<State>;
export function watchTheme(listener: (theme: Theme) => void): () => void;
