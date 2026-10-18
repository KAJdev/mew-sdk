export type WeatherTarget = {
  latitude: number;
  longitude: number;
  zoom?: number;
  layer: "temperature-2m" | "rain-3h" | "wind-10m";
};
export type WeatherResult = { status: "opened" | "cancelled" | "unsupported"; url: string };
export function weatherTarget(value: unknown): (WeatherTarget & { zoom: number }) | null;
export function weatherLocation(target: WeatherTarget): string;
