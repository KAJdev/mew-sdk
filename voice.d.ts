export type VoiceParticipant = { id: string; user_id: string; username: string; display_name: string | null; muted: boolean };
export type VoiceActivity = {
  room_instance: string; revision: number; server_time_ms: number;
  installation_id: string; installation_revision: number;
  controller_participant_id: string | null;
  watchers: { participant_id: string; user_id: string }[];
  queue: string[]; selected_index: number | null; paused: boolean;
  position_seconds: number; effective_at_ms: number;
};
export type VoiceRoom = {
  installation_id: string; installation_revision: number; channel_id: string; enabled: boolean;
  participants: VoiceParticipant[];
  capabilities: { read: boolean; connect: boolean; publish: boolean; youtube: boolean };
  activity: VoiceActivity | null;
};
export type VoiceActivityCommand = { room_instance: string; expected_revision: number } & (
  { op: "claim" | "play" | "pause" } | { op: "enqueue"; video_id: string } | { op: "select" | "remove"; index: number }
  | { op: "seek"; position_seconds: number } | { op: "transfer"; participant_id: string }
);
export type VoiceUnavailable = { status: "cancelled" | "unsupported" };
export type VoiceStreamHandle = { handle: string; kind: "microphone" | "camera" | "screen"; role: "publication" | "subscription" };
export type VoiceStream = {
  stream_id: string; revision: number; kind: "microphone" | "camera" | "screen";
  actor: { type: "human"; user_id: string; participant_id: string; installation_id: string };
  tracks: { mid: string; kind: "audio" | "video" }[];
};
export interface AppVoice {
  readonly supported: boolean;
  get(): Promise<VoiceRoom>;
  streams(cursor?: string): Promise<{ streams: VoiceStream[]; next_cursor: string | null }>;
  join(): Promise<{ status: "joined"; actor: "human"; participant_id: string } | VoiceUnavailable>;
  leave(): Promise<{ status: "left" } | VoiceUnavailable>;
  publish(source: { kind: "microphone" | "camera" | "screen"; audio?: boolean }): Promise<({ status: "published" } & VoiceStreamHandle) | VoiceUnavailable>;
  subscribe(stream: { stream_id: string; revision: number }): Promise<({ status: "subscribed" } & VoiceStreamHandle) | VoiceUnavailable>;
  stop(handle: string): Promise<void>;
  readonly activity: {
    get(): Promise<VoiceActivity | null>;
    join(): Promise<{ status: "joined"; activity: VoiceActivity } | VoiceUnavailable>;
    leave(): Promise<void>;
    control(command: VoiceActivityCommand): Promise<VoiceActivity>;
  };
}
