// Sending the site out after a publish, and links to a post on the site. Shared by every screen
// that publishes, so each one says the same true thing about where a post went.

/**
 * How this site goes out: { kind: "none" } (no repository or no remote: saved on this server only),
 * { kind: "auto" } (the site sends itself after saving), { kind: "manual" } (Studio sends it).
 * Unknown (the call failed) is "none" with `unknown: true`.
 */
let known = null; // { at, how }: the setting rarely changes, so it's asked at most once a minute

export async function howItGoesOut(api, { now = Date.now() } = {}) {
  if (known && now - known.at < 60000 && known.api === api) return known.how;
  try {
    const info = await api.get("publish");
    const how = !info?.repo || !info.remote ? { kind: "none", info } : { kind: info.auto ? "auto" : "manual", info };
    known = { at: now, how, api };
    return how;
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
 * Whether this server is the site readers visit (its public address is here), so a post saved
 * here is on the site. When the public address is elsewhere and nothing sends the site out, a
 * publish only changes the copy here.
 */
export function servedHere(meta, origin = globalThis.location?.origin || "") {
  try {
    return !meta?.siteUrl || new URL(meta.siteUrl).origin === origin;
  } catch {
    return true;
  }
}

/** What to tell her after a publish, an update or taking a post off, in her words. */
export function wentOutWords(result, { meta, action = "published", origin } = {}) {
  const verb = { published: "Published", updated: "Updated", saved: "Saved", takenOff: "Taken off your site. It's a draft again" }[action];
  if (result.sent === "failed") return { words: action === "takenOff" ? "It's a draft again here, but your site hasn't caught up yet, so readers may still see it." : `${verb} here, but it hasn't reached your readers yet.`, variant: "warning" };
  if (result.sent === "none" && !servedHere(meta, origin)) {
    return { words: action === "takenOff" ? "It's a draft again here. Your public site doesn't update from Studio yet, so ask the person who set it up." : `${verb} here. Your public site doesn't update from Studio yet, so ask the person who set it up.`, variant: "warning" };
  }
  if (action === "takenOff") return { words: `${verb}.`, variant: "success" };
  if (result.sent === "none") return { words: `${verb}. It's on your site.`, variant: "success" };
  return { words: `${verb}. Your readers will see it in about a minute.`, variant: "success" };
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
