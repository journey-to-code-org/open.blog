// People: who can be named on her posts (`openblog.json` `contributors`). The registry's drafts
// and checks are lifted from the old Admin's Contributors (normalizeContributorDraft,
// validateContributorDraft, contributorDraftPayload keep their behaviour and tests); Studio adds a
// stable id made from a new person's name, the ORCID check digit, and her words for every refusal
// the server names by code (G41). DOM-free.

export function normalizeContributorDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).map(([id, contributor]) => ({
    id,
    originalId: id,
    name: typeof contributor?.name === "string" ? contributor.name : "",
    url: typeof contributor?.url === "string" ? contributor.url : "",
    sameAs: Array.isArray(contributor?.sameAs) ? contributor.sameAs.filter((item) => typeof item === "string").join("\n") : "",
    orcid: typeof contributor?.orcid === "string" ? contributor.orcid : "",
  }));
}

function contributorUrls(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isAbsoluteHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isPublicProfileUrl(value) {
  if (!value) return true;
  return (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !/\s/.test(value)) || isAbsoluteHttpUrl(value);
}

export function validateContributorDraft(drafts) {
  const rows = Array.isArray(drafts) ? drafts : [];
  const ids = new Set();
  for (const contributor of rows) {
    const id = String(contributor?.id || "").trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return "Each contributor ID must be a lowercase ASCII slug such as ada-lovelace.";
    if (contributor.originalId && contributor.originalId !== id) return `Existing contributor ID “${contributor.originalId}” cannot be renamed.`;
    if (ids.has(id)) return `Contributor ID “${id}” is used more than once.`;
    ids.add(id);
    if (!String(contributor.name || "").trim()) return `Contributor “${id}” needs a name.`;
    const profileUrl = String(contributor.url || "").trim();
    if (!isPublicProfileUrl(profileUrl)) return `Contributor “${id}” needs an HTTP(S) URL or site-root path.`;
    if (contributorUrls(contributor.sameAs).some((url) => !isAbsoluteHttpUrl(url))) return `Contributor “${id}” same-as links must be absolute HTTP(S) URLs.`;
  }
  return "";
}

export function contributorDraftPayload(drafts) {
  return Object.fromEntries(
    (Array.isArray(drafts) ? drafts : []).map((contributor) => [
      String(contributor.id || "").trim(),
      {
        name: String(contributor.name || "").trim(),
        url: String(contributor.url || "").trim(),
        sameAs: contributorUrls(contributor.sameAs),
        orcid: String(contributor.orcid || "").trim(),
      },
    ]),
  );
}

/**
 * The id a new person gets from their name: lowercase letters and digits joined by hyphens
 * ("Ruth Nichols" → "ruth-nichols"), unique among `taken` ("ruth-nichols-2"). Never changed after.
 */
export function newId(name, taken = []) {
  const base = String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "person";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Whether a value is an ORCID iD (16 digits, the last a check digit, or X) or its orcid.org address. */
export function orcidOk(value) {
  const text = String(value || "").trim().replace(/^https?:\/\/orcid\.org\//, "");
  const match = /^(\d{4})-?(\d{4})-?(\d{4})-?(\d{3})([\dX])$/.exec(text);
  if (!match) return false;
  const digits = match.slice(1, 5).join("");
  let total = 0;
  for (const digit of digits) total = (total + Number(digit)) * 2;
  const check = (12 - (total % 11)) % 11;
  return match[5] === (check === 10 ? "X" : String(check));
}

/** Her checks before Save: { field, words } or null. */
export function personProblem({ name, url, sameAs = "", orcid = "" }) {
  if (!String(name || "").trim()) return { field: "name", words: "Add their name." };
  const site = String(url || "").trim();
  if (site && !isAbsoluteHttpUrl(site)) return { field: "url", words: "A full web address, starting with https://." };
  if (contributorUrls(sameAs).some((item) => !isAbsoluteHttpUrl(item))) return { field: "sameAs", words: "Each one needs to be a full web address, starting with https://." };
  if (String(orcid || "").trim() && !orcidOk(orcid)) return { field: "orcid", words: "That isn't an ORCID iD." };
  return null;
}

/** "ruthbakes.com" from "https://www.ruthbakes.com/", for the list; "" when there is none. */
export function siteWords(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return String(url || "");
  }
}

/**
 * Her words for a refusal (G41), by code: { words, field?, posts?, reload? }. `name` is the person's.
 */
export function peopleProblem(error, name = "They") {
  const data = error?.data || {};
  const code = data.code || "";
  if (error?.status === 409 || code === "changed") return { words: "People was changed on another computer. Here it is now; make your change again.", reload: true };
  if (code === "named-on-posts") {
    const posts = Array.isArray(data.posts) ? data.posts : (data.paths || []).map((path) => ({ path, title: path }));
    const count = posts.length;
    return { words: `${name} is named on ${count} post${count === 1 ? "" : "s"}, so ${name} stays for now. Take ${name} off ${count === 1 ? "it" : "them"} first:`, posts };
  }
  if (code === "in-shared-reflection") return { words: `${name} wrote part of a reflection with others, so ${name} stays.` };
  if (code === "named-in-sources") return { words: `${name} is named in your research notes, so ${name} stays. The person who set up your site can change that.` };
  if (code === "invalid" && data.field) {
    const words = { name: "Add their name.", url: "A full web address, starting with https://.", sameAs: "Each one needs to be a full web address, starting with https://.", orcid: "That isn't an ORCID iD.", id: "That didn't save. Tell the person who set up your site." }[data.field];
    return { words: words || "That didn't save. Tell the person who set up your site.", field: data.field };
  }
  if (error?.status === 0) return { words: "Not saved yet. Your blog didn't answer. Try again in a moment." };
  return { words: "That didn't save. Tell the person who set up your site." };
}
