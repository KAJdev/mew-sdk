export function mediaTarget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 3) return null;
  const { provider, kind, id } = value;
  if (typeof kind !== "string" || typeof id !== "string") return null;
  if (provider === "youtube" && !/[^A-Za-z0-9_-]/.test(id)
    && ((kind === "video" && id.length === 11) || (kind === "playlist" && id.length >= 10 && id.length <= 100))) return { provider, kind, id };
  if (provider === "spotify" && ["track", "album", "playlist", "episode", "show"].includes(kind)
    && id.length === 22 && !/[^A-Za-z0-9]/.test(id)) return { provider, kind, id };
  return null;
}

export function mediaDestination(target) {
  if (target.provider === "spotify") return {
    name: "Spotify", href: `https://open.spotify.com/${target.kind}/${target.id}`,
    embed: `https://open.spotify.com/embed/${target.kind}/${target.id}`,
  };
  const embed = new URL(target.kind === "video" ? `https://www.youtube-nocookie.com/embed/${target.id}` : "https://www.youtube-nocookie.com/embed");
  if (target.kind === "playlist") { embed.searchParams.set("listType", "playlist"); embed.searchParams.set("list", target.id); }
  for (const [key, value] of Object.entries({ autoplay: "0", playsinline: "1", controls: "1", fs: "0", enablejsapi: "0" })) embed.searchParams.set(key, value);
  return { name: "YouTube", href: target.kind === "video" ? `https://www.youtube.com/watch?v=${target.id}` : `https://www.youtube.com/playlist?list=${target.id}`, embed: embed.href };
}
