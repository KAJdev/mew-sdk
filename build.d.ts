export interface BuiltProject {
  config: Record<string, unknown>;
  manifest: {
    sdk_version: 2;
    state_version: 1;
    permissions: string[];
    widgets: Record<string, { type: "page" | "panel" | "message" | "profile" | "chatbar"; title?: string; anchors?: string[]; message_type?: string }>;
    /** the page widget that opens first; required unless every widget is a profile widget */
    home?: string;
    handler?: { events: string[]; actions: string[]; crons: string[]; routes: { method: string; path: string }[] };
  };
  widgets: Record<string, { js?: string; css?: string; html?: string }>;
  handler_bundle?: string;
  /** text project files, present when they total at most 2 MiB */
  source?: Record<string, string>;
}

/** resolves . and .. segments and backslashes in a project-relative path; throws when it leaves the project */
export function normalize(path: string): string;

/** checks a parsed app.json and returns its manifest without handler registrations; throws on the first problem */
export function checkConfig(config: unknown): Omit<BuiltProject["manifest"], "handler">;

export function buildProject(
  files: Record<string, string | Uint8Array>,
  options: {
    esbuild: { build: (options: object) => Promise<{ outputFiles: { path: string; text: string }[] }> };
    describe?: (commonjsSource: string) => unknown | Promise<unknown>;
    modules?: Record<string, string>;
    resolveDir?: string;
  },
): Promise<BuiltProject>;
