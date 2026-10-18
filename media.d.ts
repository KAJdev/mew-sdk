export type MediaTarget = { provider: "youtube"; kind: "video" | "playlist"; id: string }
  | { provider: "spotify"; kind: "track" | "album" | "playlist" | "episode" | "show"; id: string };
export type MediaResult = { status: "opened" | "cancelled" | "unsupported" };
export function mediaTarget(value: unknown): MediaTarget | null;
export function mediaDestination(target: MediaTarget): { name: string; href: string; embed: string };
