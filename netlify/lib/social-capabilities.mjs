// The versioned provider capability contract, hosted half (epic #381, ADRs 0325 to 0327). The Rust
// half is crates/openblog-core/src/provider_manifest.rs; both read, refuse and check exactly what
// tests/fixtures/provider-manifests.json says.
//
// A provider manifest says what this release's adapter does at one destination: which capabilities
// it performs through the provider's API ("adapter"), which only the author can do by hand in the
// provider ("manual"), and which are not possible ("unsupported"); how it logs in; the limits it
// holds a request to; how the canonical address travels; and the dated provider policy the facts
// were verified against. The contract is closed: anything unknown refuses the whole manifest, and
// a capability that is not done by the adapter makes a destination ineligible, never skipped.
//
// socialAdapters (social-adapters.mjs) registers a provider's adapter only when its manifest reads
// and its adapter does everything an announcement needs, so a manifest that drifts or is broken
// turns delivery to that provider off instead of guessing. Pure: no network, no environment, no
// credential; errors are fixed text and never repeat a value they refused.

export const MANIFEST_VERSION = 1;
export const CAPABILITIES = Object.freeze(["link", "text", "article", "image", "video", "draft", "schedule"]);
const SUPPORT = Object.freeze(["unsupported", "manual", "adapter"]);
const PROVIDERS = Object.freeze({ dev: "syndication", hashnode: "syndication", ghost: "syndication", wordpress: "syndication", medium: "syndication", linkedin: "social", facebook: "social", "hacker-news": "community", reddit: "community" });
const LOGIN_METHODS = Object.freeze(["none", "environment-credential", "oauth2"]);
const CANONICAL = Object.freeze(["sent", "linked", "manual", "not-supported"]);
const PUBLISHING = Object.freeze(["explicit-approval", "draft-only", "manual"]);
const CONSTRAINTS = Object.freeze(["maxTextChars", "maxTags", "maxTagNameChars", "maxRequestBodyBytes", "scheduleMinLeadSeconds", "scheduleMaxHorizonSeconds"]);
const FIELDS = Object.freeze(["manifestVersion", "provider", "family", "label", "policyVersion", "capabilities", "login", "constraints", "canonical", "publishing", "sources"]);
const U32_MAX = 4294967295;

// What every announcement asks of its destination: a caption, a link to the canonical post, and
// delivery at the author's chosen time (ADRs 0308, 0316).
export const ANNOUNCEMENT_NEEDS = Object.freeze(["link", "text", "schedule"]);

const MESSAGES = {
  "manifest-malformed": "The provider manifest is not a manifest object with only known fields.",
  "unsupported-manifest-version": "The provider manifest uses a format version this release does not read.",
  "unknown-provider": "The provider is not one this release supports.",
  "family-mismatch": "The provider manifest names the wrong family for its provider.",
  "unknown-capability": "A capability is not one this release knows, so nothing is assumed about it.",
  "missing-capability": "The provider manifest does not declare every capability.",
  "unknown-support": "A capability has a support level this release does not know.",
  "invalid-label": "The provider label must be 1 to 60 printable characters.",
  "invalid-policy-version": "The policy version must be a date such as 2026-10-29, optionally followed by .N.",
  "invalid-login": "The provider login must name a known method and plain scope names.",
  "invalid-constraint": "A provider limit must be a positive whole number or absent.",
  "invalid-policy": "The canonical link or publishing policy is not one this release knows.",
  "invalid-source": "Every source must be an https address of the provider's documentation.",
  "manifest-inconsistent": "The provider manifest contradicts itself.",
};

export class ManifestError extends Error {
  constructor(code) {
    super(MESSAGES[code] || MESSAGES["manifest-malformed"]);
    this.name = "ManifestError";
    this.code = Object.hasOwn(MESSAGES, code) ? code : "manifest-malformed";
  }
}

const fail = (code) => {
  throw new ManifestError(code);
};
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (object, key) => Object.hasOwn(object, key);
const stringList = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

// YYYY-MM-DD or YYYY-MM-DD.N (N 1 to 99), compared as [date, N].
export function policyVersionKey(value) {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})(?:\.([1-9]\d?))?$/.exec(value) : null;
  if (!match) return null;
  const [, year, month, day, revision] = match;
  if (year < "2020" || +month < 1 || +month > 12 || +day < 1 || +day > 31) return null;
  return [`${year}-${month}-${day}`, revision ? Number(revision) : 0];
}

const validScope = (scope) => /^[A-Za-z0-9_.:-]{1,80}$/.test(scope);

function validSource(source) {
  if (source.length > 500) return false;
  try {
    const url = new URL(source);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".");
  } catch {
    return false;
  }
}

function limit(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= U32_MAX) return value;
  return fail("invalid-constraint");
}

// The shape the Rust reader enforces before it looks at any value: every field present, no field
// it does not know, and each of the expected JSON type.
function shaped(value) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== FIELDS.length || !FIELDS.every((field) => own(value, field))) return false;
  for (const field of ["provider", "family", "label", "policyVersion", "canonical", "publishing"]) if (typeof value[field] !== "string") return false;
  if (!isObject(value.capabilities) || !Object.values(value.capabilities).every((support) => typeof support === "string")) return false;
  const login = value.login;
  if (!isObject(login) || Object.keys(login).length !== 2 || !own(login, "method") || !own(login, "scopes") || typeof login.method !== "string" || !stringList(login.scopes)) return false;
  if (!isObject(value.constraints) || !Object.keys(value.constraints).every((key) => CONSTRAINTS.includes(key))) return false;
  return stringList(value.sources);
}

// Reads a manifest, refusing it whole (a ManifestError with a fixed code) on anything unknown or
// out of shape. Returns a frozen copy holding only known fields.
export function parseManifest(value) {
  if (!isObject(value) || !own(value, "manifestVersion")) fail("manifest-malformed");
  if (value.manifestVersion !== MANIFEST_VERSION) fail("unsupported-manifest-version");
  if (!shaped(value)) fail("manifest-malformed");
  const provider = value.provider;
  if (!own(PROVIDERS, provider)) fail("unknown-provider");
  if (value.family !== PROVIDERS[provider]) fail("family-mismatch");
  const label = value.label;
  const labelChars = [...label].length;
  if (labelChars < 1 || labelChars > 60 || label.trim() !== label || /[\u0000-\u001f\u007f-\u009f]/.test(label)) fail("invalid-label");
  if (!policyVersionKey(value.policyVersion)) fail("invalid-policy-version");
  const capabilities = {};
  for (const name of Object.keys(value.capabilities).sort()) {
    if (!CAPABILITIES.includes(name)) fail("unknown-capability");
    const support = value.capabilities[name];
    if (!SUPPORT.includes(support)) fail("unknown-support");
    capabilities[name] = support;
  }
  if (Object.keys(capabilities).length !== CAPABILITIES.length) fail("missing-capability");
  const { method, scopes } = value.login;
  if (!LOGIN_METHODS.includes(method)) fail("invalid-login");
  if (scopes.length > 20 || !scopes.every(validScope) || new Set(scopes).size !== scopes.length || (method !== "oauth2" && scopes.length)) fail("invalid-login");
  const constraints = {};
  for (const name of CONSTRAINTS) constraints[name] = limit(value.constraints[name]);
  const sources = value.sources;
  if (!sources.length || sources.length > 20 || !sources.every(validSource)) fail("invalid-source");
  if (!CANONICAL.includes(value.canonical) || !PUBLISHING.includes(value.publishing)) fail("invalid-policy");
  const manifest = {
    manifestVersion: MANIFEST_VERSION,
    provider,
    family: value.family,
    label,
    policyVersion: value.policyVersion,
    capabilities: Object.freeze(capabilities),
    login: Object.freeze({ method, scopes: Object.freeze([...scopes]) }),
    constraints: Object.freeze(constraints),
    canonical: value.canonical,
    publishing: value.publishing,
    sources: Object.freeze([...sources]),
  };
  // Facts that cannot hold together (the same rules as the Rust half).
  const anyAdapter = Object.values(capabilities).includes("adapter");
  const { scheduleMinLeadSeconds: min, scheduleMaxHorizonSeconds: max } = constraints;
  if (
    (anyAdapter && method === "none") ||
    (manifest.publishing === "manual" && anyAdapter) ||
    (manifest.publishing === "draft-only" && capabilities.draft !== "adapter") ||
    (manifest.family === "social" && manifest.canonical !== "linked") ||
    // A community destination is submitted to by the author, by hand, never by open.blog (ADR 0800).
    (manifest.family === "community" &&
      (anyAdapter || method !== "none" || manifest.publishing !== "manual" || manifest.canonical !== "linked" || capabilities.link !== "manual")) ||
    (min !== null && max !== null && min >= max)
  )
    fail("manifest-inconsistent");
  return Object.freeze(manifest);
}

// Reads requested capability names, refusing the whole list on one unknown name. Returns them
// once each, in the contract's order.
export function parseCapabilities(names) {
  if (!Array.isArray(names) || !names.every((name) => typeof name === "string" && CAPABILITIES.includes(name))) fail("unknown-capability");
  return CAPABILITIES.filter((capability) => names.includes(capability));
}

const count = (value) => (Number.isInteger(value) && value >= 0 ? value : null);

// Everything that keeps `manifest`'s destination from taking `request` through its adapter, as
// [{ code, capability?, message }] in a fixed order; empty means eligible. Messages name only the
// provider, the capability and the declared limit, never the author's content.
export function checkRequest(manifest, request = {}) {
  const label = manifest.label;
  const problems = [];
  const capabilities = parseCapabilities(request.capabilities ?? []);
  for (const capability of capabilities) {
    const support = manifest.capabilities[capability] ?? "unsupported";
    if (support === "manual") problems.push({ code: "capability-manual", capability, message: `${label} can take ${capability} only by hand; open.blog will not do it for you.` });
    else if (support !== "adapter") problems.push({ code: "capability-unsupported", capability, message: `${label} cannot take ${capability} from open.blog.` });
  }
  const c = manifest.constraints;
  const over = (value, max) => value !== null && max !== null && value > max;
  if (over(count(request.textChars), c.maxTextChars)) problems.push({ code: "text-too-long", message: `${label} takes at most ${c.maxTextChars} characters of text.` });
  if (over(count(request.tags ?? 0), c.maxTags)) problems.push({ code: "too-many-tags", message: `${label} takes at most ${c.maxTags} tags.` });
  if (over(count(request.longestTagChars ?? 0), c.maxTagNameChars)) problems.push({ code: "tag-too-long", message: `${label} takes tags of at most ${c.maxTagNameChars} characters.` });
  if (over(count(request.bodyBytes), c.maxRequestBodyBytes)) problems.push({ code: "body-too-large", message: `${label} takes a request of at most ${c.maxRequestBodyBytes} bytes.` });
  const lead = Number.isInteger(request.scheduleLeadSeconds) ? request.scheduleLeadSeconds : null;
  if (lead !== null) {
    if (!capabilities.includes("schedule")) problems.push({ code: "schedule-not-requested", message: `A time was given for ${label} without asking to schedule.` });
    else if (c.scheduleMinLeadSeconds !== null && lead < c.scheduleMinLeadSeconds) problems.push({ code: "schedule-too-soon", message: `${label} needs a scheduled time at least ${c.scheduleMinLeadSeconds} seconds ahead.` });
    else if (c.scheduleMaxHorizonSeconds !== null && lead > c.scheduleMaxHorizonSeconds) problems.push({ code: "schedule-too-far", message: `${label} takes a scheduled time at most ${c.scheduleMaxHorizonSeconds} seconds ahead.` });
  }
  return problems;
}

// The manifests the social adapters of this release implement, identical to the Rust half's
// built-in ones (the fixture holds both to the same JSON). Changing one is a provider policy
// change: raise its policyVersion (ADR 0327).
const SCHEDULE = { scheduleMinLeadSeconds: 60, scheduleMaxHorizonSeconds: 366 * 86400 };
const SOCIAL_CAPABILITIES = { article: "unsupported", draft: "unsupported", image: "manual", link: "adapter", schedule: "adapter", text: "adapter", video: "manual" };
const none = { maxRequestBodyBytes: null, maxTagNameChars: null, maxTags: null, maxTextChars: null };
export const MANIFESTS = Object.freeze({
  linkedin: parseManifest({
    canonical: "linked",
    capabilities: SOCIAL_CAPABILITIES,
    constraints: { ...none, maxTextChars: 3000, ...SCHEDULE },
    family: "social",
    label: "LinkedIn",
    login: { method: "oauth2", scopes: ["openid", "profile", "w_member_social"] },
    manifestVersion: 1,
    policyVersion: "2026-10-29",
    provider: "linkedin",
    publishing: "explicit-approval",
    sources: [
      "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api",
      "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema",
    ],
  }),
  facebook: parseManifest({
    canonical: "linked",
    capabilities: SOCIAL_CAPABILITIES,
    constraints: { ...none, ...SCHEDULE },
    family: "social",
    label: "Facebook",
    login: { method: "oauth2", scopes: ["pages_show_list", "pages_manage_posts"] },
    manifestVersion: 1,
    policyVersion: "2026-10-29",
    provider: "facebook",
    publishing: "explicit-approval",
    sources: ["https://developers.facebook.com/docs/pages-api/posts", "https://developers.facebook.com/docs/graph-api/reference/page/feed"],
  }),
});

// The manifest an adapter for `provider` may be registered under, or null: it must read, be a
// social manifest of that very provider, and do every announcement need through the adapter.
export function admittedManifest(provider, manifests = MANIFESTS) {
  if (typeof provider !== "string" || !isObject(manifests) || !own(manifests, provider)) return null;
  try {
    const manifest = parseManifest(manifests[provider]);
    if (manifest.provider !== provider || manifest.family !== "social") return null;
    return checkRequest(manifest, { capabilities: ANNOUNCEMENT_NEEDS }).length ? null : manifest;
  } catch {
    return null;
  }
}
