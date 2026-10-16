export interface BuiltProject {
  config: Record<string, unknown>;
  manifest: {
    sdk_version: 2;
    state_version: number;
    permissions: string[];
    widgets: Record<string, { type: "page" | "panel" | "message" | "profile"; title?: string; anchors?: string[]; message_type?: string; max_height?: number; height?: number }>;
    handler?: { events: string[]; actions: string[]; crons: string[]; routes: { method: string; path: string }[] };
  };
  widgets: Record<string, { js?: string; css?: string; html?: string }>;
  handler_bundle?: string;
  /** text project files, present when they total at most 2 MiB */
  source?: Record<string, string>;
}

export function buildProject(
  files: Record<string, string | Uint8Array>,
  options: {
    esbuild: { build: (options: object) => Promise<{ outputFiles: { path: string; text: string }[] }> };
    describe?: (commonjsSource: string) => unknown | Promise<unknown>;
    modules?: Record<string, string>;
    resolveDir?: string;
  },
): Promise<BuiltProject>;
