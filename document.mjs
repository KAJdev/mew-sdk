import { createHash } from "node:crypto";
import { createUI, controlTheme } from "./ui-runtime.js";
import { controlStyles } from "./ui-styles.js";
import { uiFontSource } from "./assets.mjs";

export function normalizeHostOrigins(value) {
  const origins = Array.isArray(value) ? value : typeof value === "string" ? value.split(",").map((item) => item.trim()) : [];
  if (!origins.length || origins.length > 4 || new Set(origins).size !== origins.length) throw new Error("Set one to four distinct trusted chat origins");
  for (const value of origins) {
    const origin = new URL(value);
    if (origin.origin !== value || origin.hostname.includes("*") || !(origin.protocol === "https:" || (origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)))) throw new Error("Trusted chat origins must be exact HTTPS origins or loopback HTTP");
  }
  return origins;
}

export function sandboxHeaders(hostOrigins) {
  const origins = normalizeHostOrigins(hostOrigins);
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${origins.join(" ")}; sandbox allow-scripts`,
    "Permissions-Policy": "accelerometer=(), ambient-light-sensor=(), autoplay=(), bluetooth=(), camera=(), clipboard-read=(), clipboard-write=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), web-share=(), xr-spatial-tracking=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
}

export function sandboxDocument(hostOrigins, bootstrap) {
  const origins = normalizeHostOrigins(hostOrigins);
  const headers = sandboxHeaders(origins);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script>(${bootstrap})(${JSON.stringify(origins).replaceAll("<", "\\u003c")},${createUI.toString()},${JSON.stringify(controlStyles).replaceAll("<", "\\u003c")},${controlTheme.toString()},${JSON.stringify(uiFontSource).replaceAll("<", "\\u003c")})</script></body></html>`;
  const etag = `"${createHash("sha256").update(html).digest("hex")}"`;
  return { headers, html, etag, cachedHeaders: { ...headers, "Cache-Control": "public, max-age=3600", ETag: etag } };
}
