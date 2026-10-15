export function normalizeHostOrigins(value: string | string[]): string[];
export function sandboxHeaders(hostOrigins: string | string[]): Record<string, string>;
export function sandboxDocument(hostOrigins: string | string[], bootstrap: string): { headers: Record<string, string>; html: string };
