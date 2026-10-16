export type Scope = "private" | "shared";
export type State = { revision: number; value: Record<string, unknown>; state_version: number | null };
export type StateUpdate = { expected_revision: number; value: Record<string, unknown> };
export type Theme = Readonly<{ version: 1; primary: string; background: string; secondary: string; tertiary: string }>;
export interface MewSDK {
  readonly version: 1;
  readonly state: {
    get(scope: Scope): Promise<State>;
    put(scope: Scope, update: StateUpdate): Promise<State>;
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
