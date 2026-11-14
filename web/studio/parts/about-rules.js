// About this post: the little things about a post (what kind it is, the line under the title, the
// summary, the address, who wrote it), as values Write keeps beside the words. Every value is
// written under the name the post already uses (her `summary:` stays `summary:`), only when it
// changed, and a key Studio doesn't edit goes back untouched. Also the checks before a save and
// her words for every refusal the server names by code (G36). DOM-free.

import { byLine } from "./credit-rules.js";
import { groupKeys, kindLabel } from "./profile-words.js";

/** Each value the sheet edits, by Studio's name, with the names the engine reads (first canonical). */
export const ABOUT_NAMES = Object.freeze({
  profile: ["profile"],
  subtitle: ["subtitle", "subheading", "dek"],
  seriesOrder: ["seriesOrder", "series_order", "part"],
  comments: ["comments"],
  description: ["description", "summary", "brief", "excerpt"],
  cardTitle: ["cardTitle"],
  cardDescription: ["cardDescription"],
  slug: ["slug"],
  canonical: ["canonical", "canonicalUrl"],
  theme: ["theme"],
  coverCredit: ["coverCredit"],
});

export const ABOUT_KEYS = Object.freeze(Object.keys(ABOUT_NAMES));

/** The recipe numbers stay on Write itself (parts/recipe-numbers.js), not in the sheet. */
const ON_WRITE = new Set(["servings", "prepTime", "cookTime"]);

const text = (value) => (Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value));
const filled = (value) => text(value).trim() !== "";

/**
 * The key each value is written under in this post: a name with a value wins, in the engine's
 * order; then a name that is there but empty; else the canonical one. Profile fields come with
 * their aliases from `meta.profiles` (a recipe's `makes:` stays `makes:`).
 * @returns {Record<string, string>}
 */
export function aboutKeys(fields = {}, profiles = []) {
  const names = { ...ABOUT_NAMES };
  for (const profile of profiles || []) {
    for (const field of profile.fields || []) {
      if (ON_WRITE.has(field.key) || names[field.key]) continue;
      names[field.key] = [field.key, ...(field.aliases || [])];
    }
  }
  const has = (key) => fields != null && Object.hasOwn(fields, key);
  return Object.fromEntries(Object.entries(names).map(([name, list]) => [name,
    list.find((key) => has(key) && filled(fields[key])) ?? list.find(has) ?? list[0]]));
}

/** The kind a post is: its `profile`, or a legacy recipe marker; else a story. */
export function kindOf(fields = {}, resolved = "") {
  const profile = text(fields.profile).trim().toLowerCase();
  if (profile) return profile;
  if (["true", "yes", "on"].includes(text(fields.recipe).trim().toLowerCase())) return "recipe";
  if (["type", "layout", "kind"].some((key) => text(fields[key]).trim().toLowerCase() === "recipe")) return "recipe";
  return resolved || "article";
}

/** The sheet's values from the post's fields: every value as text, by Studio's name. */
export function aboutFromDocument(fields = {}, keys = aboutKeys(fields), resolved = "") {
  const out = {};
  for (const [name, key] of Object.entries(keys)) out[name] = text(fields[key]);
  out.profile = kindOf(fields, resolved);
  return out;
}

/** A value as it is saved: one line under the title, spaces collapsed, else trimmed. */
function clean(name, value) {
  const raw = text(value);
  if (name === "subtitle" || name === "coverCredit" || name === "cardTitle") return raw.replace(/\s+/g, " ").trim();
  return raw.trim();
}

/**
 * What a save adds to the post's fields for the sheet: `{ <the post's own key>: text }` for each
 * value that changed since it was opened ("" removes the key), nothing for the rest. The line
 * under the title is written as `subtitle`, and its older names go when it changes.
 */
export function aboutExtra(keys, initial = {}, current = {}) {
  const out = {};
  for (const name of Object.keys(current)) {
    if (clean(name, current[name]) === clean(name, initial[name])) continue;
    const value = clean(name, current[name]);
    if (name === "subtitle") {
      out.subtitle = value;
      for (const old of ["subheading", "dek"]) out[old] = "";
      continue;
    }
    out[keys[name] || name] = value;
  }
  return out;
}

/** Whether her comments choice is open (no key, or `open`), closed (`locked`) or hidden. */
export const commentsChoice = (value) => (["locked", "hidden"].includes(text(value).trim().toLowerCase()) ? text(value).trim().toLowerCase() : "");

/**
 * The line on the About this post button: up to three facts, " · " between.
 * "A recipe · Summary set · By Grammi", "Summary set · Comments open · By Grammi and Ruth".
 * With changes kept on this device for a published post, it starts with "Changes not on your site yet".
 */
export function aboutLine({ about = {}, commentsSetUp = false, names = [], unsent = false } = {}) {
  const kind = about.profile && about.profile !== "article" ? kindLabel(about.profile) : "";
  const summary = clean("description", about.description) ? "Summary set" : "No summary yet";
  const choice = commentsChoice(about.comments);
  const comments = commentsSetUp ? (choice === "locked" ? "Comments closed" : choice === "hidden" ? "No comments" : "Comments open") : "";
  const by = byLine(names);
  let facts = [kind, summary, comments, by].filter(Boolean);
  if (facts.length > 3) facts = [kind, summary, by];
  return [unsent ? "Changes not on your site yet" : "", ...facts].filter(Boolean).join(" · ");
}

/** The engine's slug: letters and digits kept (any language), anything else one hyphen, lowercase. */
export function slugify(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

/** The address a file's own name gives (`2026-11-06-pumpkin-bread.md` is `pumpkin-bread`). */
export function fileSlug(path) {
  const stem = String(path || "").split("/").pop().replace(/\.(md|markdown)$/, "");
  return slugify(/^\d{4}-\d{2}-\d{2}-/.test(stem) && stem.length > 11 ? stem.slice(11) : stem);
}

/**
 * Whether the address may change: only for a new post, or a draft the server says was never on
 * the site (G38 `wasPublished`; unknown counts as "it was"). A scheduled or published post, or one
 * that may have been seen, keeps its address so saved links keep working. No file is ever moved.
 */
export function slugEditable({ state, wasPublished } = {}) {
  return state === "new" || (state === "draft" && wasPublished === false);
}

/**
 * "grammishouse.com/pumpkin-bread/": what the address will be. `slug` is what she typed; empty
 * means the file's own name (an existing post) or the title (a new one).
 */
export function slugPreview({ siteUrl = "", postPath = "/posts/{slug}/", slug = "", title = "", path = "" } = {}) {
  const resolved = slugify(slug) || (path ? fileSlug(path) : slugify(title));
  let host = "your blog's address";
  let base = "";
  try {
    const url = new URL(siteUrl);
    host = url.host.replace(/^www\./, "");
    base = url.pathname.replace(/\/$/, "");
  } catch { /* no site address yet */ }
  const pattern = String(postPath || "/posts/{slug}/").includes("{slug}") ? postPath : "/posts/{slug}/";
  return `${host}${base}${pattern.replace("{slug}", resolved || "…")}`;
}

/** Her words for an address that can't be used, or "". */
export function slugProblem(value) {
  const typed = String(value || "").trim();
  if (!typed) return "";
  if (typed.length > 80) return "Shorter, please: 80 letters at most.";
  if (!slugify(typed)) return "An address needs at least one letter or number.";
  return "";
}

const isWebAddress = (value) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(String(value || "").trim());
const isYouTube = (value) => /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/)|youtu\.be\/)/i.test(String(value || "").trim());
const isNumber = (value) => /^-?\d+(?:[.,]\d+)?$/.test(String(value || "").trim());

/**
 * The checks before any save (an autosave too): [{ name, words }], first problem first. Only the
 * values the post shows are checked: its kind's own, and the part number with a collection.
 */
export function aboutProblems(about = {}, { collection = false, slugOpen = false } = {}) {
  const out = [];
  const has = (name) => String(about[name] ?? "").trim() !== "";
  const kindKeys = new Set(groupKeys(about.profile));
  const check = (name, ok, words) => { if (has(name) && !ok(about[name])) out.push({ name, words }); };
  if (slugOpen) {
    const words = slugProblem(about.slug);
    if (words) out.push({ name: "slug", words });
  }
  if (collection) check("seriesOrder", (v) => /^\d+$/.test(String(v).trim()) && Number(v) >= 1 && Number(v) <= 9999, "A whole number, like 3.");
  check("canonical", isWebAddress, "A full web address, starting with https://.");
  if (kindKeys.has("adaptedFrom")) check("adaptedFrom", isWebAddress, "That needs to be a web address, starting with https://. To thank a person, say so in your words.");
  if (kindKeys.has("videoUrl")) check("videoUrl", isYouTube, "That isn't a YouTube link. Copy it from Share under the video.");
  if (kindKeys.has("videoTitle")) check("videoTitle", (v) => String(v).trim().length <= 100, `YouTube takes up to 100 letters; this has ${String(about.videoTitle || "").trim().length}.`);
  if (kindKeys.has("license")) check("license", isWebAddress, "A full web address, starting with https://.");
  for (const name of ["distanceKm", "elevationGainM"]) if (kindKeys.has(name)) check(name, isNumber, "A number, like 4.2.");
  for (const name of ["seasonNumber", "episodeNumber"]) if (kindKeys.has(name)) check(name, (v) => /^\d+$/.test(String(v).trim()), "A whole number, like 3.");
  return out;
}

/** "Google usually shows about 160 letters; this has 212. The rest may be cut off." or "". */
export function summaryCount(value) {
  const n = String(value || "").trim().length;
  return n > 160 ? `Google usually shows about 160 letters; this has ${n}. The rest may be cut off.` : "";
}

/** The Pin limits, counted as Pinterest does (the Photo by name counts in the description). */
export function pinCounts({ cardTitle = "", cardDescription = "", coverCredit = "" } = {}) {
  const title = String(cardTitle).trim().length;
  const credit = String(coverCredit).trim();
  const description = String(cardDescription).trim().length + (credit ? credit.length + 10 : 0);
  return {
    title: title > 100 ? `Pinterest shows up to 100 letters; this has ${title}.` : "",
    description: description > 500 ? `Pinterest takes 500 letters, and the Photo by name counts; this has ${description}.` : "",
  };
}

/** The summary as the card shows it: clipped at 160 letters with "…". */
export function cardSummary(value) {
  const words = String(value || "").trim().replace(/\s+/g, " ");
  return words.length > 160 ? `${words.slice(0, 159).trimEnd()}…` : words;
}

const hasRecipeParts = (body) => /^##\s+ingredients\b/im.test(body) && /^##\s+(steps|method|directions|instructions)\b/im.test(body);

/**
 * What changing the kind does to her words, and what it says under the choice:
 * { body?: the words to put in (only for empty words), help, addParts?: offer "Add the recipe parts" }.
 */
export function kindChange(from, to, body = "", { starter = "", scaffold = "" } = {}) {
  const empty = !String(body || "").trim();
  if (to === "job") return { help: "Fill in About this job, under the title.", ...(empty && scaffold ? { body: scaffold } : {}) };
  if (to === "recipe") {
    if (empty && starter) return { help: "Your recipe boxes are ready.", body: starter };
    return { help: "Your words stay as they are.", addParts: !hasRecipeParts(body) };
  }
  if (from === "job") return { help: "The job details are kept if you change back." };
  if (from === "recipe") return { help: "Your recipe stays in your words. The recipe card comes off this post. Its numbers are kept if you change back." };
  return { help: "" };
}

/** Her words with the recipe's two parts added at the end, headings taken from the starter. */
export function withRecipeParts(body = "", starter = "") {
  const headings = String(starter || "").split("\n").filter((line) => /^##\s+/.test(line));
  const parts = (headings.length ? headings : ["## Ingredients", "## Steps"]).join("\n\n");
  return `${String(body || "").replace(/\s+$/, "")}\n\n${parts}\n`;
}

/**
 * Her words for a save the server refused (G36), and where they go: { where, field?, words }.
 * `where`: "title" | "about" | "credits" | "date" | "job" | "banner" | "status" | "conflict" |
 * "gone" | "signin".
 */
export function saveProblem(error) {
  const status = error?.status ?? 0;
  const data = error?.data || {};
  const code = data.code || "";
  if (status === 401) return { where: "signin", words: "Sign in again" };
  if (status === 404) return { where: "gone", words: "This post isn't on your blog any more. It may have been deleted on another computer." };
  if (status === 413 || code === "too-large") return { where: "banner", words: "This post is too long to save in one piece. Split it into two posts. Your words are kept on this computer." };
  if (code === "credits-changed") return { where: "credits", field: "credits", words: "Who wrote this post was changed on another computer." };
  if (status === 409 && code === "exists") return data.slug
    ? { where: "about", field: "slug", words: "Another post already has this address. Add a word to it." }
    : { where: "title", field: "title", words: "There's already a post with this title. Change it a little and it will save." };
  if (status === 409 && (code === "changed" || !code)) return { where: "conflict", words: "" };
  if (status === 422) {
    const issue = (Array.isArray(data.issues) ? data.issues : [])[0] || { code, field: data.field || "" };
    return issueWords(issue);
  }
  if (status === 0 || status >= 500) return { where: "status", words: "Not saved yet. Your blog didn't answer; your words are kept on this computer. It tries again when you next change something." };
  return { where: "banner", words: "Something in this post stops your blog from building it. Tell the person who set up your site." };
}

/** One of the build's coded problems, in her words and where it belongs. */
export function issueWords(issue = {}) {
  const code = issue.code || "";
  const field = issue.field || "";
  if (code === "slug-taken") return { where: "about", field: "slug", words: "Another post already uses this address. Add a word to it." };
  if (code === "date") return { where: "date", field: "date", words: "That date can't be read. Pick it from the calendar." };
  if (code === "comments") return { where: "about", field: "comments", words: "Choose one of the three." };
  if (field.startsWith("job")) return { where: "job", field, words: "" };
  if (code === "credit-unknown-person") return { where: "credits", field: "credits", words: "Someone on the list isn't in People any more. Choose someone else, or remove them." };
  if (code === "credit-unknown-role") return { where: "about", field: "roles", words: "Remove roles your blog doesn't know." };
  if (code === "credit-no-role") return { where: "about", field: "roles", words: "Give everyone at least one role." };
  if (code === "credit-duplicate") return { where: "credits", field: "credits", words: "Someone is listed twice. Remove one of them." };
  if (code === "shared-order" || code === "shared-rebind") return { where: "credits", field: "credits", words: "This was written together with others, so who wrote each part can't change here." };
  if (code === "alias") return { where: "about", field: "aliases", words: "An old address in this post can't be used. The person who set up your site can fix it in the file." };
  if (code === "profile-field" && field) return { where: "about", field, words: PROFILE_FIELD_WORDS[field] || "This doesn't look right. Check it against the help under it." };
  return { where: "banner", words: "Something in this post stops your blog from building it. Tell the person who set up your site." };
}

const PROFILE_FIELD_WORDS = {
  videoUrl: "That isn't a YouTube link. Copy it from Share under the video.",
  adaptedFrom: "That needs to be a web address, starting with https://. To thank a person, say so in your words.",
  productionStatus: "Choose one of the stages.",
  locationPrivacy: "Choose how much of the place readers see.",
  distanceKm: "A number, like 4.2.",
  elevationGainM: "A number, like 4.2.",
  videoTitle: "YouTube takes up to 100 letters.",
  doi: "DOI name or https://doi.org/ link.",
  license: "A full web address, starting with https://.",
};

/** The keys a post has that Studio doesn't edit, for "Also in this post" (kept exactly as written). */
export function otherKeys(fields = {}, keys = {}, { onWrite = [] } = {}) {
  const edited = new Set([...Object.values(keys), "title", "date", "tags", "cover", "coverAlt", "draft", "series", ...onWrite,
    "subheading", "dek", "recipe", "servings", "serves", "prepTime", "prep", "prep_time", "cookTime", "cook", "cook_time"]);
  return Object.keys(fields).filter((key) => !edited.has(key) && !key.startsWith("job.")).sort();
}
