// Moved from web/admin/proof.js (the old Admin's model) for the old Admin's retirement: the
// pure rules only, so Studio loads nothing from /admin/. Studio draws its own screen.
// The Reviews screen (ADR 0389, #520): a customer's real review, saved with where it came from. A list under
// `#/reviews`, and a form for one (`#/reviews/new`, `#/reviews/edit/<path>`) with the reviewer's name, the day
// it was written, where it was left, its link, its stars and its words. A review comes in one of two ways:
// typed in by hand, or copied once from its link through the same URL snapshot route the Assistant uses
// (`assistant/context/url/retrieve`), so the limits and refusals are that route's own. Nothing is fetched
// again later: the copy's time is written into the file and only a new review fetches anything.
//
// It edits the `proof/` collection through the same document routes services, posts and pages use; the
// server judges every file with the build's own rules. Designed at 400px first: one column, every control
// at least 44px tall. The pure functions at the top are the contract and are tested without a page.


export const PROOF_VERSION = 1;
export const SNAPSHOT_ROUTE = "assistant/context/url/retrieve";

export const LIMITS = Object.freeze({ id: 64, author: 80, text: 5000, url: 500 });

export const PLATFORMS = Object.freeze([
  ["google", "Google"],
  ["facebook", "Facebook"],
  ["nextdoor", "Nextdoor"],
  ["yelp", "Yelp"],
  ["houzz", "Houzz"],
  ["angi", "Angi"],
  ["other", "Somewhere else"],
]);

// The same hosts the build accepts for each platform (crates/openblog-core/src/proof.rs).
const BRANDS = Object.freeze({
  google: [["google"], ["g.page", "goo.gl"]],
  facebook: [["facebook"], ["fb.com", "fb.me"]],
  nextdoor: [["nextdoor"], []],
  yelp: [["yelp"], []],
  houzz: [["houzz"], []],
  angi: [["angi", "angieslist"], []],
});

// Keys the form owns; any other key in a file is carried through a save untouched.
const MANAGED = new Set(["version", "id", "author", "date", "platform", "sourceUrl", "rating", "provenance", "retrievedAt", "draft"]);
const CONTROL = /[\u0000-\u001f\u007f]/;
const TEXT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const clean = (value) => (typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value).trim());
const sentence = (message) => {
  const text = String(message || "").trim();
  if (!text) return "";
  const capital = text[0].toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
};

/** Whether `host` is the platform's own site, by the build's rule. `other` accepts any host. */
export function platformOwnsHost(platform, host) {
  if (platform === "other") return true;
  const known = BRANDS[platform];
  if (!known) return false;
  const name = String(host || "").toLowerCase().replace(/\.$/, "");
  if (known[1].some((short) => name === short || name.endsWith(`.${short}`))) return true;
  const labels = name.split(".");
  return labels.some((label, at) => known[0].includes(label) && at + 1 < labels.length && labels.slice(at + 1).every((tld) => tld.length >= 2 && tld.length <= 3));
}

/** The platform a link is on, or `other`. */
export function platformForUrl(address) {
  let host = "";
  try {
    host = new URL(address).hostname;
  } catch {
    return "other";
  }
  return Object.keys(BRANDS).find((platform) => platformOwnsHost(platform, host)) || "other";
}

/** A review id made from the reviewer's name and the day: lowercase letters, digits and hyphens. */
export function reviewId(author, date) {
  const base = clean(author)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return [base, clean(date)].filter(Boolean).join("-").slice(0, LIMITS.id).replace(/-+$/g, "");
}

/** Whether a review can keep `address` as its link: a plain http(s) web link, no sign-in, within the limit. */
export function isKeepableLink(address) {
  const link = clean(address);
  if (!link || link.length > LIMITS.url || /\s/.test(link)) return false;
  try {
    const url = new URL(link);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isReviewId(value) {
  return /^[A-Za-z0-9_-]+$/.test(value) && value.length <= LIMITS.id;
}

export function blankReview() {
  return { id: "", author: "", date: "", platform: "", sourceUrl: "", rating: "", provenance: "entered", retrievedAt: "", draft: false, text: "", extra: {} };
}

/** The form for a stored document: its front matter fields and its body (the review's words). */
export function formFromDocument(fields = {}, body = "") {
  const form = blankReview();
  for (const [key, value] of Object.entries(fields)) if (!MANAGED.has(key)) form.extra[key] = value;
  for (const key of ["id", "author", "date", "platform", "sourceUrl", "rating", "retrievedAt"]) form[key] = clean(fields[key]);
  form.platform = form.platform.toLowerCase();
  form.provenance = clean(fields.provenance).toLowerCase() === "snapshot" ? "snapshot" : "entered";
  form.draft = ["true", "yes", "on"].includes(clean(fields.draft).toLowerCase());
  form.text = typeof body === "string" ? body.replace(/\r\n?/g, "\n").trim() : "";
  return form;
}

/** The front matter fields a save sends: the form's answers, then every key it does not own, as it was. */
export function fieldsFromForm(form) {
  const fields = { ...form.extra, version: String(PROOF_VERSION) };
  for (const key of ["id", "author", "date", "platform", "sourceUrl", "rating"]) {
    if (clean(form[key])) fields[key] = clean(form[key]);
  }
  fields.provenance = form.provenance === "snapshot" ? "snapshot" : "entered";
  if (form.provenance === "snapshot" && clean(form.retrievedAt)) fields.retrievedAt = clean(form.retrievedAt);
  if (form.draft) fields.draft = "true";
  return fields;
}

/**
 * The form after a snapshot of `address` came back: the link, the platform it is on and the time it was
 * copied are filled in, and the words too when the page held no more than a review can. The reviewer's
 * name, the day and the stars are the owner's to read off the page; nothing is guessed for them.
 */
export function formFromSnapshot(form, snapshot) {
  const next = { ...form, extra: { ...form.extra } };
  next.sourceUrl = clean(snapshot?.sourceUrl);
  next.retrievedAt = clean(snapshot?.retrievedAt);
  next.provenance = "snapshot";
  next.platform = platformForUrl(next.sourceUrl);
  // A short or shared link that led onto a named platform keeps that platform with the address it led to,
  // so the link the review keeps is on the platform it names (ADR 0390). An address the review could not
  // keep (too long, or not a plain web link) is left alone: the link box is read-only after a copy, so the
  // pasted link stays, on Somewhere else, rather than an error the owner could never fix (ADR 0391).
  const landed = clean(snapshot?.canonicalUrl);
  if (next.platform === "other" && isKeepableLink(landed) && platformForUrl(landed) !== "other") {
    next.platform = platformForUrl(landed);
    next.sourceUrl = landed;
  }
  // A pasted link too long to keep gives way to the address it led to when that one can be kept (ADR 0392).
  if (!isKeepableLink(next.sourceUrl) && isKeepableLink(landed)) {
    next.sourceUrl = landed;
    next.platform = platformForUrl(landed);
  }
  const words = clean(snapshot?.text);
  if (!clean(next.text) && words && [...words].length <= LIMITS.text) next.text = words;
  return next;
}

/**
 * Why a copy cannot be used, or "" when it can. A copy whose pasted link and landing address are both too
 * long (or not plain web links) would leave a read-only link box the review could never be saved with, so
 * it is refused before the form changes (ADR 0392).
 */
export function snapshotProblem(form, snapshot) {
  if (isKeepableLink(formFromSnapshot(form, snapshot).sourceUrl)) return "";
  return `That link is too long for your site to keep (over ${LIMITS.url} characters). Use the review's Share link instead, or type the review in below.`;
}

/** What the owner is told after a delete whose rebuild failed, or "" when the site was rebuilt. */
export function deleteBuildText(result) {
  if (!result?.build || result.build.ok !== false) return "";
  const detail = clean(result.build.error);
  return `Deleted. The review is in the trash, but your site could not be rebuilt yet${detail ? `: ${detail}` : "."}`;
}

/** What the snapshot route is sent: the link, and the owner's say-so that it may be fetched now. */
export function snapshotRequest(address) {
  return { url: clean(address), confirmed: true };
}

/** The problems the build would find, as `{ field, message }`. A draft is only held to having an id. */
export function validateForm(form) {
  const problems = [];
  const add = (field, message) => problems.push({ field, message });
  const id = clean(form.id);
  if (!id) add("id", "Add a short id, such as dana-r-2026-10-20. A job uses it to show this review.");
  else if (!isReviewId(id)) add("id", `Use letters, digits, - and _, up to ${LIMITS.id} characters.`);
  if (form.draft) return problems;

  const author = clean(form.author);
  if (!author) add("author", "Add the name the reviewer shows, such as Dana R.");
  else if (CONTROL.test(author) || [...author].length > LIMITS.author) add("author", `Use 1 to ${LIMITS.author} characters on one line.`);

  const date = clean(form.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) add("date", "Add the day the review was written.");
  else if (form.provenance === "snapshot" && clean(form.retrievedAt) && date > clean(form.retrievedAt).slice(0, 10)) add("date", "A review cannot be written after the day it was copied.");

  const platform = clean(form.platform);
  if (!PLATFORMS.some(([value]) => value === platform)) add("platform", "Choose where the review was left.");

  const link = clean(form.sourceUrl);
  if (!link) add("sourceUrl", "Add the link to the review, starting https://.");
  else if (!isKeepableLink(link)) add("sourceUrl", "Use the review's full link, starting https://.");
  else if (platform && !platformOwnsHost(platform, new URL(link).hostname)) {
    const label = PLATFORMS.find(([value]) => value === platform)?.[1] || platform;
    add("sourceUrl", `That link is not on ${label}. Use the review's link there, or choose Somewhere else.`);
  }

  const rating = clean(form.rating);
  if (rating && !/^[1-5]$/.test(rating)) add("rating", "Choose 1 to 5 stars, or no stars.");

  const text = clean(form.text);
  if (!text) add("text", "Add the review's words.");
  else if (TEXT_CONTROL.test(text) || [...text].length > LIMITS.text) add("text", `Use up to ${LIMITS.text} characters of plain text.`);
  return problems;
}

const FIELD_NAMES = ["id", "author", "date", "platform", "sourceUrl", "rating", "retrievedAt", "provenance", "text"];

/** The server's problem sentences (`proof/x.md: rating: ...; text: ...`) as the form's `{ field, message }`. */
export function problemsFromServer(items) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const text = String(item).replace(/^[^\s:]*\.md: /, "");
    for (const part of text.split(/; (?=(?:version|id|author|date|platform|sourceUrl|rating|retrievedAt|provenance|text): )/)) {
      const named = /^([A-Za-z]+): (.*)$/s.exec(part);
      if (named && FIELD_NAMES.includes(named[1])) {
        const field = named[1] === "retrievedAt" || named[1] === "provenance" ? "sourceUrl" : named[1];
        out.push({ field, message: sentence(named[2]) });
      } else out.push({ field: "", message: sentence(part) });
    }
  }
  return out;
}

/** Plain words for a snapshot the route refused or could not make. */
export function snapshotErrorText(error) {
  const detail = String(error?.data?.error || error?.message || "").trim();
  const fallback = " You can type the review in instead.";
  if (error?.status === 401) return "You were signed out. Sign in again, then fetch the page.";
  if (/local or private/i.test(detail)) return `That link points to a private or local address, which is never fetched.${fallback}`;
  if (/timed out/i.test(detail)) return `The page took too long to answer.${fallback}`;
  if (/KiB/i.test(detail)) return `That page is too big to copy.${fallback}`;
  if (/only HTML|content type|UTF-8/i.test(detail)) return `That link is not a page of text.${fallback}`;
  if (/redirect/i.test(detail)) return `That link sent us on too many times.${fallback}`;
  if (/HTTP (\d+)/.test(detail)) return `The page answered with an error (HTTP ${/HTTP (\d+)/.exec(detail)[1]}). Check the link.${fallback}`;
  if (/complete HTTP|only HTTP|credentials|requires a host/i.test(detail)) return "Use the review's full link, starting https://.";
  return detail ? `That page could not be copied: ${detail}.${fallback}` : `That page could not be copied.${fallback}`;
}

export function reviewErrorText(error, { creating = false, deleting = false, id = "" } = {}) {
  const status = error?.status;
  if (deleting) {
    if (status === 401) return "You were signed out. Sign in again, then delete it.";
    const detail = String(error?.data?.error || error?.message || "").trim();
    return detail ? `The review was not deleted. ${detail}` : "The review was not deleted. Check your connection and try again.";
  }
  if (status === 401) return "You were signed out. Sign in again, then save.";
  if (status === 413) return "That is too much to save. Shorten the review and try again.";
  if (status === 409 && creating) {
    const named = clean(id) ? ` called ${clean(id)}` : "";
    return `The review was not saved. You already have a review${named}. Change the id, for example by adding -2 to the end, then save again.`;
  }
  if (status === 409) return "This review changed in another window. Reload it, then make your changes again.";
  const detail = String(error?.data?.error || error?.message || "").trim();
  return detail ? `The review was not saved. ${detail}` : "The review was not saved. Check your connection and try again.";
}

const stars = (rating) => (/^[1-5]$/.test(clean(rating)) ? `${"★".repeat(Number(rating))}${"☆".repeat(5 - Number(rating))}` : "");
const longDay = (value) => {
  const date = new Date(`${clean(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? clean(value) : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
};

let uid = 0;

