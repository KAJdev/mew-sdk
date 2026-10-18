export function weatherTarget(value) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length < 3 || keys.length > 4 || keys.some((key) => !["latitude", "longitude", "zoom", "layer"].includes(key))) return null;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (keys.some((key) => !("value" in fields[key])) || !fields.latitude || !fields.longitude || !fields.layer) return null;
    const latitude = fields.latitude.value;
    const longitude = fields.longitude.value;
    const layer = fields.layer.value;
    const zoom = fields.zoom ? fields.zoom.value : 7;
    if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || !Number.isInteger(zoom) || zoom < 1 || zoom > 10
      || !["temperature-2m", "rain-3h", "wind-10m"].includes(layer)) return null;
    return { latitude, longitude, zoom, layer };
  } catch {
    return null;
  }
}

export function weatherLocation(value) {
  const target = weatherTarget(value);
  if (!target) throw new TypeError("Invalid weather target");
  const url = new URL("https://embed.ventusky.com/");
  url.search = new URLSearchParams({ p: `${target.latitude};${target.longitude};${target.zoom}`, l: target.layer }).toString();
  return url.href;
}
