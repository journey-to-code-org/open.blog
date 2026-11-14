// The words that never appear on her layer (studio-ux, "Her words, not the system's"): the one copy
// of the list. Her-layer word ids are checked against it in the tests, and so is every change a
// site makes to them (the server drops one that uses a word here, and so does `configureWords`).
// "browser" is allowed only to name the app she is in ("Safari", "Chrome"), so it is here too.

/** The banned words and phrases, lower case, as `studio-ux` lists them. */
export const HER_BANNED_WORDS = Object.freeze([
  "deploy", "upload", "sync", "offline", "queue", "storage", "capture", "push", "subscription", "pwa",
  "service worker", "permission", "endpoint", "device", "browser", "slug", "front matter", "metadata",
  "canonical", "noindex", "profile", "credits", "contributor", "seo", "json", "git", "status code",
  "studio", "admin",
  // R6: what she puts in her words is "a tip", "a photo", "a table", never its syntax.
  "markdown", "shortcode", "syntax", "fence", "block", "piece", "snippet", "embed", "iframe", "html",
  "callout", "alt text", "caption",
]);

/** Matches any banned word or phrase as a whole word, in any case. */
export const HER_BANNED = new RegExp(`\\b(${HER_BANNED_WORDS.map((w) => w.replace(/ /g, "\\s+")).join("|")})\\b`, "i");

/** The first banned word in `text`, or "". */
export function bannedIn(text) {
  const found = HER_BANNED.exec(String(text ?? ""));
  return found ? found[1].toLowerCase().replace(/\s+/g, " ") : "";
}
