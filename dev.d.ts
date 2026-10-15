export interface DevServer {
  readonly url: string;
  close(): Promise<void>;
}
export function createDevServer(options?: { folder?: string; host?: "127.0.0.1" | "::1"; port?: number }): Promise<DevServer>;
