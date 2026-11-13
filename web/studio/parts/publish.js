// Sending the site out after a publish, and links to a post on the site. Shared by every screen
// that publishes, so each one says the same true thing about where a post went.

/**
 * How this site goes out: { kind: "none" } (no repository or no remote: saved on this server only),
 * { kind: "auto" } (the site sends itself after saving), { kind: "manual" } (Studio sends it).
 * Unknown (the call failed) is "none" with `unknown: true`.
 */
export async function howItGoesOut(api) {
  try {
    const info = await api.get("publish");
    if (!info?.repo || !info.remote) return { kind: "none", info };
    return { kind: info.auto ? "auto" : "manual", info };
  } catch {
    return { kind: "none", unknown: true, info: null };
  }
}

/**
 * Send it out if Studio is the one that does that. Resolves to what really happened:
 * { sent: "none" | "auto" | "pushed" | "failed", message, commit, committed }.
 */
export async function sendOut(api, summary) {
  const how = await howItGoesOut(api);
  if (how.kind === "none") return { sent: "none", message: "Saved on your site's server. Nothing is set up to send it out." };
  if (how.kind === "auto") return { sent: "auto", message: "Your site sends itself out after saving." };
  try {
    const reply = await api.post("publish", { summary: String(summary || "A post").slice(0, 120) });
    return {
      sent: reply.pushed ? "pushed" : "failed",
      message: reply.message || "",
      commit: reply.commit || "",
      committed: reply.committed || [],
    };
  } catch (error) {
    return { sent: "failed", message: error.message };
  }
}

/**
 * A post's address on the site. The server gives a site-relative URL without the site's base path;
 * a site that only lives on this server ("none") is reached through this server, otherwise
 * through its public address.
 */
export function siteLink(meta, url, { local = false, origin = globalThis.location?.origin || "" } = {}) {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url;
  let site = null;
  try {
    site = meta?.siteUrl ? new URL(meta.siteUrl) : null;
  } catch {
    site = null;
  }
  const base = site ? site.pathname.replace(/\/$/, "") : "";
  const path = base && !url.startsWith(`${base}/`) ? `${base}${url}` : url;
  return `${local || !site ? origin : site.origin}${path}`;
}
