// open.blog admin editor: <ob-admin>. A single autonomous custom element that
// renders the sign-in, publishing workspace, and editor with plain DOM calls.
// Nothing user-controlled is ever assigned through innerHTML. Publishing-engine
// previews are served from an authenticated URL into an opaque-origin sandbox.

const ADMIN_SCHEME_KEY = "ob-admin-scheme";
const ADMIN_PREVIEW_WIDTH_KEY = "ob-admin-preview-width";

function preferredAdminScheme() {
  try {
    const saved = localStorage.getItem(ADMIN_SCHEME_KEY) || localStorage.getItem("ob-scheme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage can be blocked; fall back to the system preference.
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyAdminScheme(scheme, persist = false) {
  document.documentElement.dataset.theme = scheme;
  if (!persist) return;
  try {
    localStorage.setItem(ADMIN_SCHEME_KEY, scheme);
  } catch {
    // The visual change still works when storage is blocked.
  }
}

if (typeof document !== "undefined") applyAdminScheme(preferredAdminScheme());

// ---------------------------------------------------------------- helpers

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    // The admin's CSP forbids style *attributes*; assigning through the CSSOM is allowed.
    else if (key === "style") el.style.cssText = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (["value", "checked", "disabled", "selected"].includes(key)) el[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function themeButton() {
  const icon = h("span", { class: "oba-theme-icon", "aria-hidden": "true" });
  const label = h("span", { class: "oba-theme-label" });
  const button = h("button", { class: "oba-btn oba-theme-toggle", type: "button" }, icon, label);
  const sync = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    const next = dark ? "light" : "dark";
    icon.textContent = dark ? "☀" : "☾";
    label.textContent = dark ? "Light" : "Dark";
    button.setAttribute("aria-label", "Dark mode");
    button.setAttribute("title", `Switch to ${next} mode`);
    button.setAttribute("aria-pressed", String(dark));
  };
  button.addEventListener("click", () => {
    applyAdminScheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
    sync();
  });
  sync();
  return button;
}

const pad = (n) => String(n).padStart(2, "0");

/** ISO instant -> value for <input type="datetime-local"> in the browser's zone. */
function toLocalInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Value from <input type="datetime-local"> -> UTC ISO instant ("" if empty/invalid). */
function fromLocalInput(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function searchCommands(commands, query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return commands;
  return commands.filter((command) => {
    const haystack = `${command.label} ${command.category} ${command.keywords || ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function closeCommandDialog(dialog) {
  const returnFocus = dialog.returnFocus;
  dialog.close();
  dialog.remove();
  if (returnFocus && typeof returnFocus.focus === "function") returnFocus.focus();
}

export function parseAdminHash(value) {
  const hash = value.replace(/^#\/?/, "");
  const [route, query = ""] = hash.split("?");
  const [head, ...rest] = route.split("/");
  return { head, tail: rest.join("/"), params: new URLSearchParams(query) };
}

export function shouldGuardNavigation(dirty, currentHash, nextHash) {
  return Boolean(dirty && currentHash && nextHash !== currentHash);
}

export function normalizeStatusFilter(value) {
  return ["published", "scheduled", "draft", "error"].includes(value) ? value : "all";
}

export function saveStateForVersions(saveVersion, editVersion) {
  return saveVersion === editVersion
    ? { dirty: false, label: "Saved", messageIsCurrent: true }
    : { dirty: true, label: "Unsaved changes", messageIsCurrent: false };
}

export function resolveProfileSelection(fields, profiles = [], resolvedValue = "article") {
  const canonicalValue = typeof fields.profile === "string" ? fields.profile.trim() : "";
  const match = (value) => profiles.find((profile) => profile.id.toLowerCase() === value.toLowerCase());
  if (canonicalValue) {
    const knownProfile = match(canonicalValue);
    return { value: knownProfile?.id || canonicalValue, unknown: !knownProfile };
  }
  const value = resolvedValue || "article";
  return { value, unknown: !match(value) };
}

export function preserveProfileFieldDrafts(drafts, controls) {
  const next = new Map(drafts);
  for (const [key, control] of controls) next.set(key, control.value);
  return next;
}

export function applyProfileFieldDrafts(fields, drafts) {
  const next = { ...fields };
  for (const [key, rawValue] of drafts) {
    const value = String(rawValue ?? "").trim();
    if (value) next[key] = value;
    else delete next[key];
  }
  return next;
}

export function normalizeCreditDraft(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((credit) => {
    if (!credit || typeof credit !== "object" || typeof credit.contributor !== "string") return [];
    const roles = Array.isArray(credit.roles)
      ? credit.roles.flatMap((role) =>
          role && typeof role === "object" && typeof role.vocabulary === "string" && typeof role.role === "string"
            ? [{ vocabulary: role.vocabulary, role: role.role }]
            : [],
        )
      : [];
    const seenRoles = new Set();
    return [
      {
        contributor: credit.contributor,
        roles: roles.filter((role) => {
          const key = `${role.vocabulary}:${role.role}`;
          if (seenRoles.has(key)) return false;
          seenRoles.add(key);
          return true;
        }),
      },
    ];
  });
}

export function creditPayload(mode, credits) {
  if (mode === "unresolved") return undefined;
  if (mode === "inherited") return null;
  return normalizeCreditDraft(credits);
}

export function moveCredit(credits, from, to) {
  const next = normalizeCreditDraft(credits);
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [credit] = next.splice(from, 1);
  next.splice(to, 0, credit);
  return next;
}

export function toggleCreditRole(credit, role, checked) {
  const next = normalizeCreditDraft([credit])[0] || { contributor: "", roles: [] };
  const same = (candidate) => candidate.vocabulary === role.vocabulary && candidate.role === role.role;
  next.roles = checked ? [...next.roles.filter((candidate) => !same(candidate)), { vocabulary: role.vocabulary, role: role.role }] : next.roles.filter((candidate) => !same(candidate));
  return next;
}

export function validateCreditDraft(mode, credits) {
  if (mode === "unresolved") return "Choose how to repair the malformed contributor credits.";
  if (mode !== "explicit") return "";
  const normalized = normalizeCreditDraft(credits);
  const contributors = normalized.map((credit) => credit.contributor);
  if (contributors.some((contributor) => !contributor)) return "Choose a contributor for every credit.";
  if (new Set(contributors).size !== contributors.length) return "Each contributor can appear only once. Combine their roles in one credit.";
  if (normalized.some((credit) => credit.roles.length === 0)) return "Give every contributor at least one role.";
  return "";
}

export function creditHasAuthor(credits, contributors = {}) {
  return normalizeCreditDraft(credits).some(
    (credit) =>
      Boolean(contributors[credit.contributor]?.name) &&
      credit.roles.some((role) => role.vocabulary === "crossref" && role.role === "author"),
  );
}

export function focusCreditControl(ui, index, schedule = globalThis.requestAnimationFrame) {
  const run = typeof schedule === "function" ? schedule : (callback) => callback();
  run(() => {
    if (index >= 0) ui.creditList?.querySelector(`#oba-credit-${index}-contributor`)?.focus();
    else ui.addCredit?.focus();
  });
}

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

function isAbsoluteHttpUrl(value) {
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

export function contributorSaveState(saveVersion, editVersion, mountedView, currentView) {
  if (mountedView !== currentView) return { active: false, dirty: null, messageIsCurrent: false };
  return { active: true, ...saveStateForVersions(saveVersion, editVersion) };
}

export function previewWarningsForDisplay(warnings) {
  return Array.isArray(warnings) ? warnings.filter((warning) => typeof warning === "string" && warning.trim()) : [];
}

const ACCESSIBILITY_OUTCOMES = [
  { outcome: "detected", label: "Detected" },
  { outcome: "potential", label: "Potential" },
  { outcome: "needs-review", label: "Needs review" },
];

export function accessibilityReview(findings) {
  const supported = new Set(ACCESSIBILITY_OUTCOMES.map(({ outcome }) => outcome));
  const normalized = (Array.isArray(findings) ? findings : []).flatMap((finding) => {
    if (!finding || typeof finding !== "object" || !supported.has(finding.outcome)) return [];
    if (typeof finding.message !== "string" || typeof finding.repair !== "string") return [];
    const source = finding.source && typeof finding.source === "object" ? finding.source : {};
    const path = typeof source.path === "string" && source.path ? source.path : "Current document";
    let sourceLabel = path;
    if (Number.isInteger(source.line) && source.line > 0) {
      sourceLabel += `:${source.line}`;
      if (Number.isInteger(source.column) && source.column > 0) sourceLabel += `:${source.column}`;
    } else if (typeof source.field === "string" && source.field) {
      sourceLabel += ` · ${source.field}`;
    }
    return [
      {
        code: typeof finding.code === "string" ? finding.code : "unclassified",
        outcome: finding.outcome,
        scope: typeof finding.scope === "string" ? finding.scope : "content",
        sourceLabel,
        message: finding.message,
        repair: finding.repair,
        references: Array.isArray(finding.references) ? finding.references.filter((reference) => typeof reference === "string") : [],
      },
    ];
  });
  const counts = { detected: 0, potential: 0, "needs-review": 0 };
  for (const finding of normalized) counts[finding.outcome] += 1;
  const groups = ACCESSIBILITY_OUTCOMES.map(({ outcome, label }) => ({
    outcome,
    label,
    findings: normalized.filter((finding) => finding.outcome === outcome),
  })).filter((group) => group.findings.length > 0);
  return { total: normalized.length, counts, groups };
}

export function evidenceReview(findings) {
  return accessibilityReview(findings);
}

export function evidenceStudioState(findings, research) {
  if (!research) {
    return {
      active: false,
      status: "Evidence checks are not active for this content profile.",
      review: null,
    };
  }
  const review = evidenceReview(findings);
  return {
    active: true,
    status: `${review.total} evidence finding${review.total === 1 ? "" : "s"}`,
    review,
  };
}

export function applyPaneSelection(root, buttons, pane) {
  root.dataset.editorView = pane;
  for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.paneTarget === pane));
}

function markdownOutsideCode(source) {
  const kept = [];
  let fence = null;
  for (const line of source.split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
    if (fence) {
      if (marker && marker[0] === fence.character && marker.length >= fence.length && line.slice(line.indexOf(marker) + marker.length).trim() === "") fence = null;
      continue;
    }
    if (marker) {
      fence = { character: marker[0], length: marker.length };
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) continue;
    kept.push(line);
  }
  const text = kept.join("\n");
  const escaped = (index) => {
    let slashes = 0;
    for (let at = index - 1; at >= 0 && text[at] === "\\"; at -= 1) slashes += 1;
    return slashes % 2 === 1;
  };
  const nextDelimiter = (start) => {
    let index = text.indexOf("`", start);
    while (index >= 0 && escaped(index)) index = text.indexOf("`", index + 1);
    return index;
  };
  let output = "";
  let cursor = 0;
  while (cursor < text.length) {
    const opening = nextDelimiter(cursor);
    if (opening < 0) {
      output += text.slice(cursor);
      break;
    }
    output += text.slice(cursor, opening);
    let openingEnd = opening;
    while (text[openingEnd] === "`") openingEnd += 1;
    const length = openingEnd - opening;
    let search = openingEnd;
    let closing = -1;
    let closingEnd = -1;
    while (search < text.length) {
      const candidate = nextDelimiter(search);
      if (candidate < 0) break;
      let candidateEnd = candidate;
      while (text[candidateEnd] === "`") candidateEnd += 1;
      if (candidateEnd - candidate === length) {
        closing = candidate;
        closingEnd = candidateEnd;
        break;
      }
      search = candidateEnd;
    }
    if (closing < 0) {
      output += text.slice(opening, openingEnd);
      cursor = openingEnd;
      continue;
    }
    output += text.slice(opening, closingEnd).replace(/[^\n]/g, " ");
    cursor = closingEnd;
  }
  return output;
}

export function analyzeReadiness({ kind, title, description, slug, canonical, tags = [], cover, coverAlt, body, authorReady }) {
  const analysisBody = markdownOutsideCode(body).replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  const wordCount = (analysisBody.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  const opening = analysisBody
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part && !/^(?:#{1,6}\s|[-*+]\s|\d+\.\s|>|```|!\[)/.test(part));
  const openingLength = (opening || "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_~`]/g, "").length;
  let canonicalValid = true;
  if (canonical) {
    try {
      canonicalValid = ["http:", "https:"].includes(new URL(canonical).protocol);
    } catch {
      canonicalValid = false;
    }
  }
  const search = [
    { ready: title.length >= 10 && title.length <= 65, label: "Search title", detail: title ? `${title.length} characters; aim for 10–65` : "Add a specific title" },
    { ready: description.length >= 50 && description.length <= 180, label: "Search description", detail: description ? `${description.length} characters; aim for 50–180` : "Summarize the answer and why it matters" },
    { ready: slug.length > 0 && slug.length <= 80, label: "Readable URL", detail: slug ? `${slug.length} characters` : "Add a short descriptive slug" },
  ];
  if (kind === "posts") {
    const tagCount = tags.filter((tag) => tag.trim()).length;
    search.push({ ready: canonicalValid, label: "Canonical URL", detail: canonical ? (canonicalValid ? "Valid absolute HTTP(S) URL" : "Use a complete HTTP(S) URL") : "Uses this post’s generated URL" });
    search.push({ ready: tagCount > 0, label: "Topic signals", detail: tagCount ? `${tagCount} specific tag${tagCount === 1 ? "" : "s"}` : "Add at least one specific tag" });
  }
  const hasExternalSource = /\[[^\]]+\]\(https?:\/\//i.test(analysisBody) || /^\[\^[^\]]+\]:\s*https?:\/\//im.test(analysisBody);
  const answer = [
    { ready: openingLength >= 40 && openingLength <= 350, label: "Direct opening", detail: openingLength ? `${openingLength} characters before the first section; answer the core question early` : "Start with a concise answer paragraph" },
    { ready: /^#{2,3}\s+\S/m.test(analysisBody), label: "Scannable sections", detail: "Use descriptive H2/H3 headings" },
    { ready: wordCount >= 150, label: "Answer depth", detail: `${wordCount.toLocaleString()} words; use 150+ when the topic needs explanation` },
    {
      ready: hasExternalSource,
      label: "External source link",
      detail: hasExternalSource ? "An external link is present; verify that the source is relevant and authoritative" : "Add a relevant primary or authoritative source when the claim needs support",
    },
  ];
  const trust = [{ ready: !/\[(?:click here|here|read more|link)\]\(/i.test(analysisBody), label: "Descriptive links", detail: "Link text should explain its destination" }];
  if (kind === "posts") {
    trust.push({ ready: !cover || Boolean(coverAlt.trim()), label: "Accessible social image", detail: cover ? (coverAlt.trim() ? "Alternative text is present" : "Describe meaningful cover content") : "No cover image is configured" });
    trust.push({ ready: Boolean(authorReady), label: "Author identity", detail: authorReady ? "Named author and profile URL are configured" : "Set author.name and author.url in openblog.json" });
  }
  const groups = [
    { name: "Search", description: "Metadata and crawlable page signals", checks: search },
    { name: "Answer readiness", description: "Structure that helps people and answer engines extract useful context", checks: answer },
    { name: "Trust & access", description: "Authorship, link clarity, and inclusive media", checks: trust },
  ];
  const checks = groups.flatMap((group) => group.checks);
  const ready = checks.filter((check) => check.ready).length;
  return { score: Math.round((ready / checks.length) * 100), ready, total: checks.length, groups };
}

export function applyMarkdownCommand(value, start, end, command) {
  const selected = value.slice(start, end);
  const wrap = (before, after, placeholder) => {
    const content = selected || placeholder;
    const replacement = `${before}${content}${after}`;
    return {
      value: value.slice(0, start) + replacement + value.slice(end),
      start: start + before.length,
      end: start + before.length + content.length,
    };
  };
  if (command === "bold") return wrap("**", "**", "bold text");
  if (command === "italic") return wrap("_", "_", "italic text");
  if (command === "link") {
    if (!selected) return wrap("[", "](https://)", "link text");
    const replacement = `[${selected}](https://)`;
    const urlStart = start + selected.length + 3;
    return { value: value.slice(0, start) + replacement + value.slice(end), start: urlStart, end: urlStart + 8 };
  }
  if (command === "code") {
    const longestRun = Math.max(0, ...(selected.match(/`+/g) || []).map((run) => run.length));
    const delimiter = "`".repeat(Math.max(selected.includes("\n") ? 3 : 1, longestRun + 1));
    if (selected.includes("\n")) {
      const before = `${start > 0 && value[start - 1] !== "\n" ? "\n" : ""}${delimiter}${selected.startsWith("\n") ? "" : "\n"}`;
      const after = `${selected.endsWith("\n") ? "" : "\n"}${delimiter}${end < value.length && value[end] !== "\n" ? "\n" : ""}`;
      return wrap(before, after, "code");
    }
    const normalizedSpaces = /^\s/.test(selected) && /\s$/.test(selected) && /\S/.test(selected);
    const pad = selected.startsWith("`") || selected.endsWith("`") || normalizedSpaces ? " " : "";
    return wrap(delimiter + pad, pad + delimiter, "code");
  }

  const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nextBreak = value.indexOf("\n", effectiveEnd);
  const lineEnd = nextBreak < 0 ? value.length : nextBreak;
  const block = value.slice(lineStart, lineEnd);
  const prefix = command === "quote" ? "> " : command === "list" ? "- " : null;
  let replacement;
  if (command === "heading") replacement = block.replace(/^(?:#{1,6}\s+)?/, "## ");
  else if (prefix) replacement = block.split("\n").map((line) => (line ? prefix + line : line)).join("\n");
  else return { value, start, end };
  return {
    value: value.slice(0, lineStart) + replacement + value.slice(lineEnd),
    start: lineStart,
    end: lineStart + replacement.length,
  };
}

export function researchSectionIsPresent(findings, research, section) {
  if (!research) return null;
  const missingCode = section === "abstract" ? "abstract-missing" : section === "references" ? "references-missing" : null;
  if (!missingCode) return null;
  return !(Array.isArray(findings) ? findings : []).some((finding) => finding?.code === missingCode);
}

export function researchActionIsCurrent(request, current) {
  return (
    request.version === current.version &&
    request.path === current.path &&
    request.profile === current.profile &&
    request.body === current.body
  );
}

export function insertResearchSection(value, section, alreadyPresent = false) {
  const title = section === "abstract" ? "Abstract" : section === "references" ? "References" : "";
  if (!title) return { value, start: value.length, end: value.length, inserted: false };
  if (alreadyPresent) return { value, start: value.length, end: value.length, inserted: false };
  const separator = value.length === 0 ? "" : value.endsWith("\n\n") ? "" : value.endsWith("\n") ? "\n" : "\n\n";
  const next = `${value}${separator}## ${title}\n\n`;
  return { value: next, start: next.length, end: next.length, inserted: true };
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

class Api {
  csrf = "";

  async call(method, path, { json, body, headers } = {}) {
    const init = {
      method,
      credentials: "same-origin",
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.csrf ? { "X-CSRF-Token": this.csrf } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : body,
    };
    const res = await fetch(`/admin/api/${path}`, init);
    let data = null;
    try {
      data = await res.json();
    } catch {
      // A non-JSON error page; fall through with null.
    }
    if (!res.ok) throw new ApiError(data?.error || res.statusText || "Request failed", res.status, data);
    return data;
  }
}

const KINDS = {
  posts: { label: "Posts", single: "post", titleKey: "title" },
  pages: { label: "Pages", single: "page", titleKey: "title" },
  series: { label: "Series", single: "series", titleKey: "name" },
};

// ---------------------------------------------------------------- component

const AdminElement = globalThis.HTMLElement || class {};

export class ObAdmin extends AdminElement {
  api = new Api();
  meta = null;
  user = "";
  dirty = false;
  editVersion = 0;
  viewVersion = 0;
  skipRoute = false;
  currentHash = "";

  connectedCallback() {
    this.addEventListener("input", (e) => {
      if (this.editor && this.editor.root.contains(e.target)) {
        this.dirty = true;
        this.editor.markDirty();
      }
    });
    addEventListener("hashchange", () => this.onHash());
    addEventListener("beforeunload", (e) => {
      if (this.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        this.openCommandPalette();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && this.editor) {
        e.preventDefault();
        this.editor.save();
        return;
      }
      if (this.editor && e.altKey && ["1", "2", "3", "4", "5", "6", "7"].includes(e.key)) {
        e.preventDefault();
        const pane = ["write", "preview", "social", "optimize", "settings", "accessibility", "evidence"][Number(e.key) - 1];
        this.editor.activatePane(pane, true);
      }
    });
    this.start();
  }

  async start() {
    try {
      const s = await this.api.call("GET", "session");
      this.api.csrf = s.csrf;
      this.user = s.user;
      await this.enter();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) this.showLogin();
      else this.showFatal(err);
    }
  }

  async enter() {
    this.meta = await this.api.call("GET", "meta");
    document.title = `Admin · ${this.meta.siteTitle}`;
    this.onHash();
  }

  // ---- views

  mount(...nodes) {
    this.editor = null;
    this.viewVersion += 1;
    this.replaceChildren(...nodes);
  }

  showFatal(err) {
    this.mount(h("div", { class: "oba-card" }, h("h1", {}, "Something went wrong"), h("p", { class: "oba-error", role: "alert" }, err.message)));
  }

  showLogin(message = "") {
    const user = h("input", { id: "oba-user", type: "text", autocomplete: "username", required: true, autocapitalize: "none", spellcheck: "false" });
    const pass = h("input", { id: "oba-pass", type: "password", autocomplete: "current-password", required: true });
    const status = h("p", { class: "oba-error", role: "alert", hidden: !message }, message);
    const submit = h("button", { class: "oba-btn oba-btn-primary", type: "submit" }, "Sign in");
    const form = h(
      "form",
      {
        class: "oba-card",
        onSubmit: async (e) => {
          e.preventDefault();
          submit.disabled = true;
          status.hidden = true;
          try {
            const res = await this.api.call("POST", "login", { json: { username: user.value.trim(), password: pass.value } });
            this.api.csrf = res.csrf;
            this.user = res.user;
            pass.value = "";
            await this.enter();
          } catch (err) {
            status.textContent = err.message;
            status.hidden = false;
            pass.value = "";
            pass.focus();
          } finally {
            submit.disabled = false;
          }
        },
      },
      h("div", { class: "oba-login-head" }, h("div", {}, h("p", { class: "oba-eyebrow" }, "open.blog"), h("h1", {}, "Welcome back")), themeButton()),
      h("p", { class: "oba-login-copy" }, "Sign in to write, preview, and publish your blog."),
      h("div", { class: "oba-field" }, h("label", { for: "oba-user" }, "Username"), user),
      h("div", { class: "oba-field" }, h("label", { for: "oba-pass" }, "Password"), pass),
      status,
      submit,
    );
    this.mount(form);
    user.focus();
  }

  shell(active, ...content) {
    const publishBox = h("span", { class: "oba-publish" });
    this.loadPublishStatus(publishBox);
    const logout = h(
      "button",
      {
        class: "oba-btn",
        type: "button",
        "data-action": "logout",
        onClick: async () => {
          if (!(await this.confirmLeave())) return;
          try {
            await this.api.call("POST", "logout", { json: {} });
          } catch {
            // Already signed out is fine.
          }
          this.api.csrf = "";
          this.showLogin();
        },
      },
      "Sign out",
    );
    const commandTrigger = h(
      "button",
      { class: "oba-btn oba-command-trigger", type: "button", onClick: () => this.openCommandPalette() },
      h("span", {}, "Search workspace"),
      h("kbd", {}, "Ctrl K"),
    );
    const toolGroup = (label, ...tools) =>
      h("div", { class: "oba-tool-group" }, h("span", { class: "oba-tool-label" }, label), h("div", { class: "oba-tool-actions" }, tools));
    const contentTabs = [
      h("a", { class: "oba-tab", "aria-current": active === "overview" ? "page" : null, href: "#/overview" }, "Overview"),
      ...Object.entries(KINDS).map(([kind, info]) =>
        h("a", { class: "oba-tab", "aria-current": kind === active ? "page" : null, href: `#/${kind}` }, info.label),
      ),
    ];
    const activeInfo = active === "analytics"
      ? { title: "Analytics", detail: "Understand readership without tracking individual readers." }
      : active === "contributors"
        ? { title: "Contributors", detail: "Manage reusable public identities for bylines and contribution credits." }
      : active === "overview"
        ? { title: "Overview", detail: "See what is live, what needs attention, and what to work on next." }
        : { title: KINDS[active]?.label || "Workspace", detail: "Create, review, and publish content from the files you own." };
    return h(
      "div",
      { class: "oba-shell" },
      h(
        "header",
        { class: "oba-app-header" },
        h(
          "a",
          { class: "oba-brand", href: "#/overview", "aria-label": `${this.meta.siteTitle} admin home` },
          h("span", { class: "oba-brand-mark", "aria-hidden": "true" }, "ob"),
          h("span", { class: "oba-brand-copy" }, h("strong", {}, this.meta.siteTitle), h("small", {}, "Publishing studio")),
        ),
        h("span", { class: "oba-spacer" }),
        commandTrigger,
        h("span", { class: "oba-small oba-account-label" }, `Signed in as ${this.user}`),
        themeButton(),
        logout,
      ),
      h(
        "nav",
        { class: "oba-toolbelt", "aria-label": "Admin tools" },
        toolGroup("Content", ...contentTabs),
        toolGroup("Observe", h("a", { class: "oba-tab", "aria-current": active === "analytics" ? "page" : null, href: "#/analytics" }, "Analytics")),
        toolGroup(
          "Site",
          h("a", { class: "oba-tab", "aria-current": active === "contributors" ? "page" : null, href: "#/contributors" }, "Contributors"),
          h("a", { class: "oba-tab", href: "/", target: "_blank", rel: "noopener" }, "View site ↗"),
        ),
      ),
      h(
        "section",
        { class: "oba-context-bar", "aria-label": "Workspace status" },
        h("div", { class: "oba-context-copy" }, h("span", { class: "oba-eyebrow" }, "Workspace"), h("h1", {}, activeInfo.title), h("p", {}, activeInfo.detail)),
        h("span", { class: "oba-spacer" }),
        publishBox,
      ),
      h("main", { class: "oba-workspace-content" }, ...content),
    );
  }

  openCommandPalette() {
    const trigger = document.activeElement;
    const activeDialog = document.querySelector("dialog[open]");
    if (activeDialog?.classList.contains("oba-command-dialog")) {
      closeCommandDialog(activeDialog);
      return;
    }
    if (activeDialog) return;
    if (!this.meta) return;

    const go = (hash) => (location.hash = hash);
    const commands = [
      { label: "Overview", category: "Workspace", keywords: "home dashboard status", run: () => go("#/overview") },
      { label: "New post", category: "Create", keywords: "write article", run: () => go("#/new/posts") },
      { label: "New page", category: "Create", keywords: "write", run: () => go("#/new/pages") },
      { label: "New series", category: "Create", keywords: "collection", run: () => go("#/new/series") },
      { label: "Posts", category: "Content", keywords: "articles", run: () => go("#/posts") },
      { label: "Pages", category: "Content", run: () => go("#/pages") },
      { label: "Series", category: "Content", run: () => go("#/series") },
      { label: "Analytics", category: "Observe", keywords: "views visitors", run: () => go("#/analytics") },
      { label: "Contributors", category: "Site", keywords: "authors credits orcid identity", run: () => go("#/contributors") },
      { label: "View site", category: "Site", keywords: "public blog", run: () => open("/", "_blank", "noopener") },
      { label: "Switch theme", category: "Workspace", keywords: "dark light mode", run: () => document.querySelector(".oba-theme-toggle")?.click() },
      { label: "Sign out", category: "Account", keywords: "logout", run: () => this.querySelector('[data-action="logout"]')?.click() },
    ];
    if (this.editor) {
      commands.unshift({ label: "Save document", category: "Editor", keywords: "publish ctrl s", run: () => this.editor.save() });
      for (const pane of ["write", "preview", "social", "optimize", "settings", "accessibility"]) {
        commands.unshift({ label: `Show ${pane}`, category: "Editor", keywords: "view pane", run: () => this.editor.activatePane(pane) });
      }
    }

    const input = h("input", { id: "oba-command-search", type: "search", autocomplete: "off", placeholder: "Type a command…" });
    const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const results = h("div", { class: "oba-command-results", "aria-label": "Command results" });
    const dialog = h(
      "dialog",
      { class: "oba-dialog oba-command-dialog", "aria-labelledby": "oba-command-title" },
      h("div", { class: "oba-command-heading" }, h("div", {}, h("p", { class: "oba-eyebrow" }, "Quick navigation"), h("h2", { id: "oba-command-title" }, "Search workspace")), h("kbd", {}, "Esc")),
      h("label", { class: "oba-field", for: "oba-command-search" }, h("span", { class: "oba-sr" }, "Search commands and content"), input),
      status,
      results,
    );
    dialog.returnFocus = trigger;
    let found = [];
    let activeIndex = 0;
    const close = () => {
      closeCommandDialog(dialog);
    };
    const choose = (index) => {
      const command = found[index];
      if (!command) return;
      close();
      command.run();
    };
    const focusResult = (index) => {
      const buttons = [...results.querySelectorAll("button")];
      if (!buttons.length) return;
      activeIndex = (index + buttons.length) % buttons.length;
      buttons[activeIndex].focus();
    };
    const render = () => {
      found = searchCommands(commands, input.value);
      activeIndex = 0;
      results.replaceChildren(
        ...found.map((command, index) =>
          h(
            "button",
            { class: "oba-command-result", type: "button", onClick: () => choose(index) },
            h("span", {}, command.label),
            h("small", {}, command.category),
          ),
        ),
      );
      status.textContent = found.length ? `${found.length} command${found.length === 1 ? "" : "s"}` : "No matching commands.";
    };
    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        choose(0);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        focusResult(0);
      }
    });
    results.addEventListener("keydown", (e) => {
      const current = [...results.querySelectorAll("button")].indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        focusResult(current + (e.key === "ArrowDown" ? 1 : -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(current);
      }
    });
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close();
    });
    document.body.append(dialog);
    render();
    dialog.showModal();
    input.focus();
  }

  /** Fill the header's publish area: pending changes and a Publish button. */
  async loadPublishStatus(box) {
    let st;
    try {
      st = await this.api.call("GET", "publish");
    } catch {
      return;
    }
    if (!st.repo) {
      box.replaceChildren(h("span", { class: "oba-small", title: "Run `openblog publish setup` to publish with git" }, "Not a git repository"));
      return;
    }
    const pending = st.changed.length;
    const drafts = st.drafts.length;
    const summary = [
      pending ? `${pending} unpublished change${pending === 1 ? "" : "s"}` : st.ahead ? `${st.ahead} commit${st.ahead === 1 ? "" : "s"} to push` : "Everything published",
      drafts ? `${drafts} draft${drafts === 1 ? "" : "s"} kept local` : null,
      st.behind ? `${st.behind} new elsewhere` : null,
    ].filter(Boolean).join(" · ");
    const button = h(
      "button",
      {
        class: `oba-btn ${pending || st.ahead ? "oba-btn-primary" : ""}`,
        type: "button",
        disabled: !(pending || st.ahead),
        title: st.remote ? `Commit and push to ${st.remote}` : "Commit locally (no remote configured)",
        onClick: async () => {
          button.disabled = true;
          button.textContent = "Publishing…";
          try {
            const res = await this.api.call("POST", "publish", { json: { summary: "" } });
            box.replaceChildren(h("span", { class: "oba-ok" }, res.message));
            setTimeout(() => this.loadPublishStatus(box), 4000);
          } catch (err) {
            box.replaceChildren(h("span", { class: "oba-error", role: "alert" }, err.data?.error || err.message), button);
            button.disabled = false;
            button.textContent = "Publish";
          }
        },
      },
      st.auto ? "Publish now" : "Publish",
    );
    box.replaceChildren(h("span", { class: "oba-small" }, summary + (st.auto ? " · auto" : "")), " ", button);
  }

  async confirmLeave() {
    if (!this.dirty) return true;
    return confirm("You have unsaved changes. Leave without saving?");
  }

  async onHash() {
    if (this.skipRoute) {
      this.skipRoute = false;
      this.currentHash = location.hash;
      return;
    }
    const nextHash = location.hash || "#/overview";
    if (shouldGuardNavigation(this.dirty, this.currentHash, nextHash) && !(await this.confirmLeave())) {
      history.replaceState(null, "", this.currentHash);
      return;
    }
    const { head, tail, params } = parseAdminHash(location.hash);
    this.dirty = false;
    try {
      if (head === "edit" && tail) await this.showEditor(decodeURIComponent(tail));
      else if (head === "new" && KINDS[tail]) await this.showEditor(null, tail);
      else if (head === "analytics") await this.showAnalytics(Number(tail) || 30);
      else if (head === "contributors") await this.showContributors();
      else if (head === "overview" || !head) await this.showOverview(params.get("focus"));
      else await this.showList(KINDS[head] ? head : "posts", params.get("status"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) this.showLogin("Your session ended. Sign in again.");
      else this.showFatal(err);
    }
    this.currentHash = location.hash || "#/overview";
  }

  // ---- list

  async showOverview(focus) {
    const kinds = Object.keys(KINDS);
    const responses = await Promise.all([
      ...kinds.map((kind) => this.api.call("GET", `documents?kind=${kind}`)),
      this.api.call("GET", "status"),
    ]);
    const status = responses.pop();
    const inventories = Object.fromEntries(kinds.map((kind, index) => [kind, responses[index].items]));
    const posts = inventories.posts;
    const count = (wanted) => posts.filter((item) => item.status === wanted).length;
    const documentProblems = kinds.flatMap((kind) =>
      inventories[kind]
        .filter((item) => item.status === "error")
        .map((item) => ({ ...item, kind })),
    );
    const problemCount = documentProblems.length + (status.lastError ? 1 : 0);
    const overviewMetric = (label, value, note, href) =>
      h(
        "a",
        { class: "oba-overview-metric", href },
        h("strong", {}, Number(value).toLocaleString()),
        h("span", {}, label),
        h("small", {}, note),
      );
    const recent = [...posts]
      .filter((item) => item.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);
    const quickCreate = (kind, description) =>
      h(
        "a",
        { class: "oba-quick-create", href: `#/new/${kind}` },
        h("span", { class: "oba-quick-icon", "aria-hidden": "true" }, "+"),
        h("span", {}, h("strong", {}, `New ${KINDS[kind].single}`), h("small", {}, description)),
      );
    const recentList = h(
      "ol",
      { class: "oba-recent-list" },
      recent.length
        ? recent.map((item) =>
            h(
              "li",
              {},
              h("a", { href: `#/edit/${encodeURIComponent(item.path)}` }, item.title || item.path),
              h("span", { class: `oba-badge oba-badge-${item.status}` }, item.status),
              h("time", { datetime: item.date }, formatWhen(item.date)),
            ),
          )
        : h("li", { class: "oba-small" }, "No dated posts yet."),
    );
    const buildMessage = status.lastError
      ? h("p", { class: "oba-error", role: "alert" }, `Last build failed: ${status.lastError}`)
      : h("p", { class: "oba-ok" }, status.lastBuilt ? `Last built ${formatWhen(status.lastBuilt)}.` : "Ready for the first build.");
    const scheduleMessage = status.scheduled.length
      ? h(
          "p",
          { class: "oba-notice" },
          `${status.scheduled.length} scheduled ${status.scheduled.length === 1 ? "post" : "posts"}. Next: “${status.scheduled[0].title}” on ${formatWhen(status.scheduled[0].date)}.`,
        )
      : h("p", { class: "oba-small" }, "Nothing is waiting to publish on a schedule.");
    const issues = h(
      "ul",
      { class: "oba-issue-list" },
      ...documentProblems.map((item) =>
        h(
          "li",
          {},
          h("a", { href: `#/edit/${encodeURIComponent(item.path)}` }, item.title || item.path),
          h("span", { class: "oba-small" }, `${KINDS[item.kind].single}: ${item.error || "Invalid front matter"}`),
        ),
      ),
      status.lastError ? h("li", {}, h("strong", {}, "Last build"), h("span", { class: "oba-small" }, status.lastError)) : null,
      problemCount ? null : h("li", { class: "oba-small" }, "No content or build errors."),
    );
    const healthPanel = h(
      "section",
      { class: "oba-overview-panel", id: "oba-overview-issues", tabindex: "-1" },
      h("header", {}, h("p", { class: "oba-eyebrow" }, "System"), h("h2", {}, "Publishing health")),
      buildMessage,
      scheduleMessage,
      h("h3", {}, "Issues"),
      issues,
    );

    this.mount(
      this.shell(
        "overview",
        h(
          "section",
          { class: "oba-overview-metrics", "aria-label": "Publishing pipeline" },
          overviewMetric("Published", count("published"), `${posts.length} posts total`, "#/posts?status=published"),
          overviewMetric("Drafts", count("draft"), "Kept local", "#/posts?status=draft"),
          overviewMetric("Scheduled", count("scheduled"), "Waiting to go live", "#/posts?status=scheduled"),
          overviewMetric("Needs attention", problemCount, problemCount ? "Review errors" : "Everything looks healthy", "#/overview?focus=issues"),
        ),
        h(
          "div",
          { class: "oba-overview-grid" },
          h("section", { class: "oba-overview-panel" }, h("header", {}, h("p", { class: "oba-eyebrow" }, "Start"), h("h2", {}, "Quick create")), h("div", { class: "oba-quick-grid" }, quickCreate("posts", "Write an article or draft"), quickCreate("pages", "Add evergreen site content"), quickCreate("series", "Group posts into a collection"))),
          h("section", { class: "oba-overview-panel" }, h("header", {}, h("p", { class: "oba-eyebrow" }, "Library"), h("h2", {}, "Content inventory")), h("dl", { class: "oba-inventory" }, h("div", {}, h("dt", {}, "Posts"), h("dd", {}, posts.length)), h("div", {}, h("dt", {}, "Pages"), h("dd", {}, inventories.pages.length)), h("div", {}, h("dt", {}, "Series"), h("dd", {}, inventories.series.length)))),
          h("section", { class: "oba-overview-panel oba-overview-recent" }, h("header", {}, h("p", { class: "oba-eyebrow" }, "Continue"), h("h2", {}, "Recent posts"), h("a", { href: "#/posts" }, "View all")), recentList),
          healthPanel,
        ),
      ),
    );
    if (focus === "issues") {
      healthPanel.focus();
      healthPanel.scrollIntoView({ block: "start" });
    }
  }

  async showList(kind, initialStatus) {
    const [list, status] = await Promise.all([
      this.api.call("GET", `documents?kind=${kind}`),
      this.api.call("GET", "status"),
    ]);
    const items = list.items;
    const filter = h("input", { class: "oba-search", type: "search", placeholder: `Filter ${KINDS[kind].label.toLowerCase()}…`, "aria-label": "Filter" });
    const stateSel = h(
      "select",
      { class: "oba-search", "aria-label": "Status", style: null },
      ["all", "published", "scheduled", "draft", "error"].map((s) => h("option", { value: s }, s === "all" ? "All statuses" : s[0].toUpperCase() + s.slice(1))),
    );
    stateSel.value = normalizeStatusFilter(initialStatus);
    const tbody = h("tbody");
    const render = () => {
      const q = filter.value.trim().toLowerCase();
      const wanted = stateSel.value;
      const rows = items.filter(
        (i) => (wanted === "all" || i.status === wanted) && (!q || `${i.title} ${(i.tags || []).join(" ")} ${i.series || ""}`.toLowerCase().includes(q)),
      );
      tbody.replaceChildren(
        ...rows.map((i) =>
          h(
            "tr",
            {},
            h("td", {}, h("span", { class: `oba-badge oba-badge-${i.status}` }, i.status)),
            h("td", {}, h("a", { href: `#/edit/${encodeURIComponent(i.path)}` }, i.title || i.path), i.error ? h("div", { class: "oba-small" }, i.error) : null),
            h("td", { title: i.date || "" }, i.date ? formatWhen(i.date) : ""),
            h(
              "td",
              { class: "oba-small" },
              kind === "posts" && i.creditMode
                ? h("span", { class: `oba-badge oba-credit-mode-badge is-${i.creditMode}` }, i.creditMode === "explicit" ? "Explicit credits" : "Inherited author")
                : null,
              [...(i.series ? [`Series: ${i.series}`] : []), ...(i.tags || [])].join(", "),
            ),
          ),
        ),
      );
      if (!rows.length) tbody.append(h("tr", {}, h("td", { colspan: 4 }, items.length ? "Nothing matches." : `No ${KINDS[kind].label.toLowerCase()} yet.`)));
    };
    filter.addEventListener("input", render);
    stateSel.addEventListener("change", render);
    render();

    const dateHeader = kind === "posts" ? "Date" : "";
    const table = h(
      "table",
      { class: "oba-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Status"), h("th", {}, "Title"), h("th", {}, dateHeader), h("th", {}, "Details"))),
      tbody,
    );
    const rebuild = h(
      "button",
      {
        class: "oba-btn",
        type: "button",
        onClick: async () => {
          rebuild.disabled = true;
          try {
            await this.api.call("POST", "rebuild", { json: {} });
            this.showList(kind);
          } catch (err) {
            alert(err.data?.error || err.message);
            rebuild.disabled = false;
          }
        },
      },
      "Rebuild site",
    );
    const banner = [];
    if (status.lastError) banner.push(h("p", { class: "oba-error", role: "alert" }, `The last site build failed: ${status.lastError}`));
    if (status.scheduled.length) {
      banner.push(
        h(
          "p",
          { class: "oba-notice" },
          `${status.scheduled.length} scheduled ${status.scheduled.length === 1 ? "post" : "posts"} waiting. Next: “${status.scheduled[0].title}” on ${formatWhen(status.scheduled[0].date)}.`,
        ),
      );
    }
    this.mount(
      this.shell(
        kind,
        ...banner,
        h("div", { class: "oba-toolbar" }, h("a", { class: "oba-btn oba-btn-primary", href: `#/new/${kind}`, style: null }, `New ${KINDS[kind].single}`), filter, kind === "posts" ? stateSel : null, h("span", { class: "oba-spacer" }), rebuild),
        table,
      ),
    );
  }

  async showContributors() {
    const registry = await this.api.call("GET", "contributors");
    let drafts = normalizeContributorDraft(registry.contributors);
    let etag = registry.etag;
    let editVersion = 0;
    let mountedView = 0;
    const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const grid = h("div", { class: "oba-contributor-grid" });
    const save = h("button", { class: "oba-btn oba-btn-primary", type: "button" }, "Save contributors");
    const add = h("button", { class: "oba-btn", type: "button" }, "Add contributor");
    const legacy = h("button", { class: "oba-btn", type: "button" }, "Prefill legacy author");

    const uniqueId = (suggestion) => {
      const base = String(suggestion || "contributor")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "contributor";
      const used = new Set(drafts.map((draft) => draft.id));
      if (!used.has(base)) return base;
      let number = 2;
      while (used.has(`${base}-${number}`)) number += 1;
      return `${base}-${number}`;
    };
    const markDirty = () => {
      editVersion += 1;
      this.dirty = true;
      status.className = "oba-small";
      status.textContent = "Unsaved contributor changes.";
    };
    const render = (focusIndex = -1) => {
      grid.replaceChildren(
        ...drafts.map((draft, index) => {
          const id = h("input", {
            id: `oba-contributor-${index}-id`,
            type: "text",
            value: draft.id,
            disabled: Boolean(draft.originalId),
            required: true,
            autocapitalize: "none",
            spellcheck: "false",
          });
          const name = h("input", { id: `oba-contributor-${index}-name`, type: "text", value: draft.name, required: true });
          const url = h("input", { id: `oba-contributor-${index}-url`, type: "text", value: draft.url, inputmode: "url", placeholder: "/about/ or https://…" });
          const sameAs = h("textarea", { id: `oba-contributor-${index}-same-as`, rows: "3", placeholder: "One absolute profile URL per line" }, draft.sameAs);
          const orcid = h("input", {
            id: `oba-contributor-${index}-orcid`,
            type: "text",
            value: draft.orcid,
            autocapitalize: "none",
            spellcheck: "false",
            placeholder: "0000-0000-0000-000X or https://orcid.org/…",
          });
          const bind = (control, key) =>
            control.addEventListener("input", () => {
              draft[key] = control.value;
              markDirty();
            });
          bind(id, "id");
          bind(name, "name");
          bind(url, "url");
          bind(sameAs, "sameAs");
          bind(orcid, "orcid");
          const remove = h(
            "button",
            {
              class: "oba-btn oba-btn-danger",
              type: "button",
              "aria-label": `Remove ${draft.name || draft.id || `contributor ${index + 1}`}`,
              onClick: () => {
                drafts.splice(index, 1);
                markDirty();
                render(Math.min(index, drafts.length - 1));
              },
            },
            "Remove",
          );
          return h(
            "section",
            { class: "oba-contributor-card", "aria-labelledby": `oba-contributor-${index}-heading` },
            h("header", {}, h("div", {}, h("p", { class: "oba-eyebrow" }, draft.originalId ? "Registered identity" : "New identity"), h("h2", { id: `oba-contributor-${index}-heading` }, draft.name || draft.id || `Contributor ${index + 1}`)), remove),
            h("div", { class: "oba-contributor-fields" },
              h("div", { class: "oba-field" }, h("label", { for: id.id }, "Stable ID"), id, h("small", { class: "oba-small" }, draft.originalId ? "IDs stay fixed so existing post credits keep resolving." : "Lowercase letters, numbers, and single hyphens.")),
              h("div", { class: "oba-field" }, h("label", { for: name.id }, "Public name"), name),
              h("div", { class: "oba-field" }, h("label", { for: url.id }, "Profile URL"), url),
              h("div", { class: "oba-field" }, h("label", { for: sameAs.id }, "Same-as profile links"), sameAs),
              h("div", { class: "oba-field" }, h("label", { for: orcid.id }, "Manually entered ORCID iD"), orcid, h("small", { class: "oba-small" }, "Validated for format and checksum only; this does not verify identity or authenticated ownership.")),
            ),
          );
        }),
      );
      if (!drafts.length) grid.append(h("p", { class: "oba-notice" }, "No contributors are registered yet. Add one or prefill the legacy site author."));
      if (focusIndex >= 0) requestAnimationFrame(() => grid.querySelector(`#oba-contributor-${focusIndex}-name`)?.focus());
      else if (!drafts.length) requestAnimationFrame(() => add.focus());
    };

    add.addEventListener("click", () => {
      drafts.push({ id: uniqueId("contributor"), originalId: "", name: "", url: "", sameAs: "", orcid: "" });
      markDirty();
      render(drafts.length - 1);
    });
    legacy.disabled = !registry.author?.name;
    legacy.addEventListener("click", () => {
      const author = registry.author || {};
      drafts.push({
        id: uniqueId(author.name || "site-author"),
        originalId: "",
        name: author.name || "",
        url: author.url || "",
        sameAs: Array.isArray(author.sameAs) ? author.sameAs.join("\n") : "",
        orcid: "",
      });
      markDirty();
      render(drafts.length - 1);
    });
    save.addEventListener("click", async () => {
      const problem = validateContributorDraft(drafts);
      if (problem) {
        status.className = "oba-error";
        status.textContent = problem;
        return;
      }
      save.disabled = true;
      const saveVersion = editVersion;
      status.className = "oba-small";
      status.textContent = "Saving contributors…";
      try {
        const result = await this.api.call("PUT", "contributors", { json: { etag, contributors: contributorDraftPayload(drafts) } });
        this.meta.contributors = result.contributors;
        const responseState = contributorSaveState(saveVersion, editVersion, mountedView, this.viewVersion);
        if (!responseState.active) return;
        etag = result.etag;
        this.dirty = responseState.dirty;
        if (responseState.messageIsCurrent) {
          drafts = normalizeContributorDraft(result.contributors);
          status.className = result.build?.ok === false ? "oba-notice" : "oba-ok";
          status.textContent = result.build?.ok === false ? `Contributors saved, but the preview build failed: ${result.build.error}` : "Contributors saved.";
          render();
        } else {
          status.className = "oba-notice";
          status.textContent = "Earlier changes saved. Newer contributor edits are still unsaved.";
        }
      } catch (error) {
        if (this.viewVersion !== mountedView) return;
        status.className = "oba-error";
        const paths = Array.isArray(error.data?.paths) ? ` ${error.data.paths.join(", ")}` : "";
        status.textContent = `${error.data?.error || error.message}${paths}`;
      } finally {
        save.disabled = false;
      }
    });

    render();
    this.mount(
      this.shell(
        "contributors",
        h("section", { class: "oba-contributor-intro" }, h("p", {}, "Register each person once, then select them in a post’s Settings view and assign publishing or CRediT roles."), h("p", { class: "oba-small" }, "Saving updates only the contributors member of openblog.json. Existing IDs cannot be renamed, and referenced identities cannot be removed until their post credits are updated.")),
        h("div", { class: "oba-toolbar" }, add, legacy, h("span", { class: "oba-spacer" }), save),
        status,
        grid,
      ),
    );
    mountedView = this.viewVersion;
  }

  // ---- analytics

  async showAnalytics(days) {
    let data;
    try {
      data = await this.api.call("GET", `analytics?days=${days}`);
    } catch (err) {
      if (err.status === 404) {
        this.mount(this.shell("analytics", h("p", { class: "oba-notice" }, "The built-in view counter is switched off (analytics.builtin in openblog.json).")));
        return;
      }
      throw err;
    }
    const n = (v) => Number(v || 0).toLocaleString();
    const tile = (label, value, note) =>
      h("div", { class: "oba-tile" }, h("span", { class: "oba-tile-value" }, value), h("span", { class: "oba-tile-label" }, label), note ? h("span", { class: "oba-small" }, note) : null);
    const ranges = h(
      "div",
      { class: "oba-tabs" },
      [7, 30, 90, 365].map((d) => h("a", { class: "oba-tab", "aria-selected": String(d === data.days), href: `#/analytics/${d}` }, `${d} days`)),
    );
    const maxViews = Math.max(1, ...data.series.map((s) => s.views));
    const bars = h(
      "ol",
      { class: "oba-chart", "aria-label": "Views per day" },
      data.series.map((s) =>
        h(
          "li",
          { title: `${s.day}: ${n(s.views)} views, ${n(s.uniques)} visitors` },
          h("span", { class: "oba-chart-bar", style: `height:${Math.round((s.views / maxViews) * 100)}%` }),
          h("span", { class: "oba-sr" }, `${s.day}: ${s.views} views`),
        ),
      ),
    );
    const table = (caption, rows, cols) =>
      h(
        "table",
        { class: "oba-table" },
        h("caption", { class: "oba-legend" }, caption),
        h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, c)))),
        h("tbody", {}, rows.length ? rows : h("tr", {}, h("td", { colspan: cols.length }, "Nothing yet."))),
      );
    const posts = data.topPosts.map((p) =>
      h("tr", {}, h("td", {}, h("a", { href: p.path, target: "_blank", rel: "noopener" }, p.path)), h("td", {}, n(p.views)), h("td", {}, n(p.uniques)), h("td", {}, n(p.allTime))),
    );
    const refs = data.referrers.map((r) => h("tr", {}, h("td", {}, r.host), h("td", {}, n(r.views))));
    const agents = data.agents.map((agent) =>
      h("tr", {}, h("td", {}, agent.name), h("td", {}, agent.category), h("td", {}, n(agent.requests))),
    );
    const agentPages = data.agentPages.map((page) =>
      h("tr", {}, h("td", {}, h("a", { href: page.path, target: "_blank", rel: "noopener" }, page.path)), h("td", {}, n(page.requests)), h("td", {}, page.agents.join(", "))),
    );
    this.mount(
      this.shell(
        "analytics",
        ranges,
        h("div", { class: "oba-tiles" }, tile("Views", n(data.views), `${data.from} to ${data.to}`), tile("Unique visitors", n(data.uniques), "per page, per day"), tile("All-time views", n(data.allTimeViews), data.firstDay ? `since ${data.firstDay}` : ""), tile("AI agent requests", n(data.agentRequests), "server-observed user-agent claims")),
        bars,
        h("div", { class: "oba-columns" }, table("Top pages", posts, ["Page", "Views", "Visitors", "All time"]), table("Referrers", refs, ["Site", "Views"])),
        h("div", { class: "oba-columns" }, table("AI agents", agents, ["Agent", "Kind", "Requests"]), table("Pages requested by AI agents", agentPages, ["Page", "Requests", "Named agents"])),
        h("p", { class: "oba-small" }, "No cookies, addresses, or raw user-agent strings are stored. AI labels are aggregate user-agent claims and may be spoofed. Readers with Do Not Track or Global Privacy Control are not counted."),
      ),
    );
  }

  // ---- editor

  async showEditor(path, newKind) {
    let doc;
    if (path) {
      doc = await this.api.call("GET", `document?path=${encodeURIComponent(path)}`);
      if (doc.raw !== undefined) {
        this.mount(
          this.shell(
            doc.kind,
            h("p", { class: "oba-error", role: "alert" }, `${path} can't be opened in the editor: ${doc.error}. Fix its front matter in a text editor.`),
          ),
        );
        return;
      }
    } else {
      doc = { path: null, kind: newKind, etag: null, fields: {}, body: "" };
    }
    const editor = new Editor(this, doc);
    this.mount(this.shell(doc.kind, editor.render()));
    this.editor = editor;
    editor.afterMount();
  }
}

// ---------------------------------------------------------------- editor

class Editor {
  constructor(app, doc) {
    this.app = app;
    this.doc = doc;
    this.kind = doc.kind;
    this.isNew = !doc.path;
    this.f = { ...doc.fields };
    this.slugTouched = !this.isNew;
    this.previewTimer = 0;
    this.previewRequest = 0;
    this.creditMode = doc.creditError ? "unresolved" : Array.isArray(doc.credits) ? "explicit" : "inherited";
    this.credits = normalizeCreditDraft(doc.credits);
    this.creditEtag = doc.creditEtag ?? null;
    this.creditError = typeof doc.creditError === "string" ? doc.creditError : "";
  }

  get meta() {
    return this.app.meta;
  }

  initialStatus() {
    if (this.kind !== "posts") return "published";
    if (String(this.f.draft || "").toLowerCase() === "true") return "draft";
    if (this.f.date && new Date(this.f.date) > new Date()) return "scheduled";
    return this.isNew ? "draft" : "published";
  }

  field(id, label, control, help) {
    return h("div", { class: "oba-field" }, h("label", { for: id }, label), control, help ? h("p", { class: "oba-help" }, help) : null);
  }

  creditRequestFields(includeEtag = false) {
    if (this.kind !== "posts") return {};
    const credits = creditPayload(this.creditMode, this.credits);
    if (credits === undefined) return {};
    return { credits, ...(includeEtag ? { creditEtag: this.creditEtag } : {}) };
  }

  creditChanged() {
    this.app.dirty = true;
    this.markDirty();
    this.updateSeoAudit();
    this.schedulePreview();
  }

  renderCreditEditor() {
    const ui = this.ui;
    ui.creditStatus = h("p", { class: "oba-help", role: "status", "aria-live": "polite" });
    ui.creditError = h("p", { class: "oba-error", role: "alert", hidden: !this.creditError }, this.creditError);
    ui.creditList = h("div", { class: "oba-credit-list" });
    ui.addCredit = h("button", { class: "oba-btn", type: "button", onClick: () => this.addCredit() }, "Add contributor");
    ui.creditExplicit = h(
      "div",
      { class: "oba-credit-explicit" },
      ui.creditList,
      h("div", { class: "oba-credit-add" }, ui.addCredit, h("span", { class: "oba-help" }, "Order controls the public byline and metadata.")),
    );
    ui.creditModeRadios = [
      ["inherited", "Inherit site author"],
      ["explicit", "Set credits for this post"],
    ].map(([value, label]) => {
      const input = h("input", { type: "radio", name: "oba-credit-mode", value, checked: this.creditMode === value });
      input.addEventListener("change", () => {
        if (!input.checked) return;
        this.creditMode = value;
        this.creditChanged();
        this.syncCreditEditor();
      });
      return h("label", {}, input, " ", label);
    });
    const editor = h(
      "section",
      { class: "oba-credit-editor", "aria-labelledby": "oba-credit-heading" },
      h("div", { class: "oba-credit-heading" }, h("h3", { id: "oba-credit-heading" }, "Contributors"), h("span", { class: "oba-badge" }, "Ordered credits")),
      h("p", { class: "oba-help" }, "Choose who contributed to this post and the controlled roles they performed."),
      ui.creditError,
      h("fieldset", { class: "oba-fieldset" }, h("legend", { class: "oba-legend" }, "Authorship source"), h("div", { class: "oba-radios" }, ui.creditModeRadios)),
      ui.creditStatus,
      ui.creditExplicit,
    );
    this.syncCreditEditor();
    return editor;
  }

  addCredit() {
    const used = new Set(this.credits.map((credit) => credit.contributor));
    const available = Object.keys(this.meta.contributors || {}).find((id) => !used.has(id));
    if (!available) return;
    const roles = this.meta.creditRoles || [];
    const author = roles.find((role) => role.vocabulary === "crossref" && role.role === "author") || roles[0];
    this.credits.push({ contributor: available, roles: author ? [{ vocabulary: author.vocabulary, role: author.role }] : [] });
    this.creditChanged();
    this.syncCreditEditor();
    this.focusCredit(this.credits.length - 1);
  }

  syncCreditEditor() {
    const ui = this.ui;
    if (!ui?.creditList) return;
    for (const label of ui.creditModeRadios) {
      const input = label.querySelector("input");
      input.checked = input.value === this.creditMode;
    }
    ui.creditError.hidden = !this.creditError;
    ui.creditExplicit.hidden = this.creditMode !== "explicit";
    ui.creditStatus.textContent =
      this.creditMode === "unresolved"
        ? "Choose how to repair these credits before saving. Inherit removes the broken sidecar; explicit credits replace it."
        : this.creditMode === "inherited"
          ? "This post uses the site author because it has no credit sidecar."
          : this.credits.length
            ? `${this.credits.length} explicit contributor${this.credits.length === 1 ? "" : "s"}.`
            : "Explicitly anonymous: this post will not inherit the site author.";

    const registry = this.meta.contributors || {};
    const catalog = this.meta.creditRoles || [];
    const used = new Set(this.credits.map((credit) => credit.contributor));
    ui.creditList.replaceChildren(
      ...(this.credits.length
        ? this.credits.map((credit, index) => {
            const contributorId = `oba-credit-${index}-contributor`;
            const select = h(
              "select",
              { id: contributorId, "aria-label": `Contributor ${index + 1}` },
              !credit.contributor ? h("option", { value: "", selected: true, disabled: true }, "Choose contributor") : null,
              credit.contributor && !registry[credit.contributor]
                ? h("option", { value: credit.contributor, selected: true }, `Unknown contributor: ${credit.contributor}`)
                : null,
              Object.entries(registry).map(([id, contributor]) =>
                h("option", { value: id, selected: id === credit.contributor, disabled: id !== credit.contributor && used.has(id) }, contributor.name || id),
              ),
            );
            select.addEventListener("change", () => {
              this.credits[index].contributor = select.value;
              this.creditChanged();
              this.syncCreditEditor();
              this.focusCredit(index);
            });
            const roleSummary = h("summary", {}, `${credit.roles.length} role${credit.roles.length === 1 ? "" : "s"}`);
            const roleGroups = [
              ["crossref", "Publishing roles"],
              ["credit", "CRediT taxonomy"],
            ].map(([vocabulary, label]) =>
              h(
                "fieldset",
                { class: "oba-credit-roles" },
                h("legend", {}, label),
                catalog
                  .filter((role) => role.vocabulary === vocabulary)
                  .map((role) => {
                    const id = `oba-credit-${index}-${role.vocabulary}-${role.role}`;
                    const checked = credit.roles.some((candidate) => candidate.vocabulary === role.vocabulary && candidate.role === role.role);
                    const input = h("input", { id, type: "checkbox", checked });
                    input.addEventListener("change", () => {
                      this.credits[index] = toggleCreditRole(this.credits[index], role, input.checked);
                      roleSummary.textContent = `${this.credits[index].roles.length} role${this.credits[index].roles.length === 1 ? "" : "s"}`;
                      this.creditChanged();
                    });
                    return h("label", { for: id }, input, h("span", {}, role.label || role.role));
                  }),
              ),
            );
            const knownRoles = new Set(catalog.map((role) => `${role.vocabulary}:${role.role}`));
            const unknownRoles = credit.roles.filter((role) => !knownRoles.has(`${role.vocabulary}:${role.role}`));
            if (unknownRoles.length) {
              roleGroups.push(
                h(
                  "fieldset",
                  { class: "oba-credit-roles is-unknown" },
                  h("legend", {}, "Unknown roles — remove to continue"),
                  unknownRoles.map((role) => {
                    const id = `oba-credit-${index}-unknown-${role.vocabulary}-${role.role}`;
                    const input = h("input", { id, type: "checkbox", checked: true });
                    input.addEventListener("change", () => {
                      this.credits[index] = toggleCreditRole(this.credits[index], role, input.checked);
                      roleSummary.textContent = `${this.credits[index].roles.length} role${this.credits[index].roles.length === 1 ? "" : "s"}`;
                      this.creditChanged();
                    });
                    return h("label", { for: id }, input, h("span", {}, `${role.vocabulary}: ${role.role}`));
                  }),
                ),
              );
            }
            const name = registry[credit.contributor]?.name || credit.contributor || `Contributor ${index + 1}`;
            return h(
              "article",
              { class: "oba-credit-card" },
              h(
                "header",
                {},
                h("span", { class: "oba-credit-order", "aria-hidden": "true" }, String(index + 1)),
                h("div", { class: "oba-field" }, h("label", { for: contributorId }, `Contributor ${index + 1}`), select),
                h(
                  "div",
                  { class: "oba-credit-actions" },
                  h("button", { class: "oba-btn", type: "button", disabled: index === 0, "aria-label": `Move ${name} up`, onClick: () => this.moveCreditRow(index, index - 1) }, "↑"),
                  h("button", { class: "oba-btn", type: "button", disabled: index === this.credits.length - 1, "aria-label": `Move ${name} down`, onClick: () => this.moveCreditRow(index, index + 1) }, "↓"),
                  h("button", { class: "oba-btn oba-btn-danger", type: "button", "aria-label": `Remove ${name}`, onClick: () => this.removeCreditRow(index) }, "Remove"),
                ),
              ),
              h("details", { class: "oba-credit-role-picker" }, roleSummary, roleGroups),
            );
          })
        : [h("p", { class: "oba-notice" }, "No contributors selected. This explicit empty list suppresses inherited authorship.")]),
    );
    const available = Object.keys(registry).some((id) => !used.has(id));
    ui.addCredit.disabled = !available;
    ui.addCredit.textContent = Object.keys(registry).length ? "Add contributor" : "Add contributors in openblog.json first";
  }

  moveCreditRow(from, to) {
    this.credits = moveCredit(this.credits, from, to);
    this.creditChanged();
    this.syncCreditEditor();
    this.focusCredit(to);
  }

  removeCreditRow(index) {
    this.credits.splice(index, 1);
    this.creditChanged();
    this.syncCreditEditor();
    this.focusCredit(Math.min(index, this.credits.length - 1));
  }

  focusCredit(index) {
    focusCreditControl(this.ui, index);
  }

  render() {
    const kind = this.kind;
    const titleKey = KINDS[kind].titleKey;
    const f = this.f;
    this.ui = {};
    const ui = this.ui;

    ui.title = h("input", { class: "oba-title-input", id: "oba-title", type: "text", placeholder: kind === "series" ? "Series name" : "Title", value: f[titleKey] || "", "aria-label": "Title" });
    ui.body = h("textarea", { class: "oba-body", id: "oba-body", spellcheck: "true", "aria-label": "Markdown", value: this.doc.body || "" });
    ui.preview = h("iframe", { class: "oba-preview", title: "Preview", sandbox: "allow-scripts" });
    ui.previewTheme = h("span", { class: "oba-small", role: "status", "aria-live": "polite" }, "Rendering site…");
    ui.previewWarnings = h("div", { class: "oba-notice", role: "status", "aria-live": "polite", hidden: true });
    ui.socialStatus = h("span", { class: "oba-small", role: "status", "aria-live": "polite" }, "Open this view to render the current social metadata.");
    ui.socialImage = h("div", { class: "oba-social-image" }, h("span", {}, "No social image"));
    ui.socialSite = h("span", { class: "oba-social-site" }, this.meta.siteTitle);
    ui.socialTitle = h("strong", { class: "oba-social-title" }, "Untitled");
    ui.socialDescription = h("p", { class: "oba-social-description" }, "Add a description to control how this page is introduced when shared.");
    ui.socialUrl = h("span", { class: "oba-social-url" });
    ui.socialType = h("dd", {}, "—");
    ui.socialCardType = h("dd", {}, "—");
    ui.socialImageUrl = h("dd", {}, "—");
    ui.optimizeScore = h("strong", { class: "oba-optimize-score" }, "0");
    ui.optimizeSummary = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    ui.optimizeGroups = h("div", { class: "oba-optimize-groups" });
    ui.accessibilityStatus = h("span", { class: "oba-small", role: "status", "aria-live": "polite" }, "Open this view to check the current source.");
    ui.accessibilityCounts = h("dl", { class: "oba-accessibility-counts", "aria-label": "Accessibility finding counts" });
    ui.accessibilityFindings = h("div", { class: "oba-accessibility-findings" });
    ui.evidenceStatus = h("span", { class: "oba-small", role: "status", "aria-live": "polite" }, "Open this view to inspect research evidence structure.");
    ui.evidenceCounts = h("dl", { class: "oba-accessibility-counts", "aria-label": "Evidence finding counts" });
    ui.evidenceFindings = h("div", { class: "oba-accessibility-findings" });
    ui.evidenceMetadata = h("dl", { class: "oba-social-meta", "aria-label": "Resolved research metadata" });
    ui.status = h("div", { role: "status", "aria-live": "polite" });
    ui.documentStats = h("span", { class: "oba-small" });
    ui.saveState = h("span", { class: "oba-save-state", role: "status", "aria-live": "polite" }, this.isNew ? "Not saved yet" : "Saved");

    const side = [];

    if (kind === "posts") {
      const status = this.initialStatus();
      ui.statusRadios = ["draft", "published", "scheduled"].map((value) =>
        h("label", {}, h("input", { type: "radio", name: "oba-status", value, checked: value === status }), " ", { draft: "Draft", published: "Published", scheduled: "Scheduled" }[value]),
      );
      ui.date = h("input", { id: "oba-date", type: "datetime-local", value: f.date ? toLocalInput(f.date) : "" });
      ui.dateField = this.field("oba-date", "Publish at", ui.date, `Your local time. A scheduled post goes live automatically at this moment, while the server is running.`);
      side.push(
        h("fieldset", { class: "oba-fieldset" }, h("legend", { class: "oba-legend" }, "Status"), h("div", { class: "oba-radios" }, ui.statusRadios)),
        ui.dateField,
      );
    }

    ui.slug = h("input", { id: "oba-slug", type: "text", value: f.slug || (this.isNew ? "" : this.slugFromPath()), autocapitalize: "none", spellcheck: "false" });
    side.push(this.field("oba-slug", "Slug", ui.slug, this.isNew ? "Part of the web address." : "Changing the slug changes the post's address."));

    if (kind === "posts") {
      const profiles = this.meta.profiles || [];
      this.profileFieldDrafts ||= new Map();
      for (const profile of profiles) {
        for (const field of profile.fields || []) {
          if (!this.profileFieldDrafts.has(field.key)) {
            const value = Object.prototype.hasOwnProperty.call(this.f, field.key) ? this.f[field.key] : "";
            this.profileFieldDrafts.set(field.key, value == null ? "" : String(value));
          }
        }
      }
      this.profileSelection = resolveProfileSelection(f, profiles, this.doc.resolvedProfile);
      this.profileTouched = false;
      ui.profile = h(
        "select",
        { id: "oba-profile" },
        profiles.map((profile) =>
          h("option", { value: profile.id, selected: profile.id === this.profileSelection.value }, profile.label || profile.id),
        ),
      );
      if (this.profileSelection.unknown) {
        ui.profile.append(h("option", { value: this.profileSelection.value, selected: true }, `Unknown profile: ${this.profileSelection.value}`));
      }
      ui.profileHelp = h("p", { class: "oba-help", role: "status" });
      ui.profileFields = h("div", { class: "oba-profile-fields" });
      ui.profileFieldControls = new Map();
      const syncProfileFields = () => {
        this.profileFieldDrafts = preserveProfileFieldDrafts(this.profileFieldDrafts, ui.profileFieldControls);
        const selected = profiles.find((profile) => profile.id === ui.profile.value);
        ui.profileFieldControls = new Map();
        ui.profileFields.replaceChildren(
          ...(selected?.fields || []).map((field) => {
            const control = h("input", {
              id: `oba-profile-${field.key}`,
              type: field.kind === "number" ? "number" : "text",
              value: this.profileFieldDrafts.has(field.key) ? this.profileFieldDrafts.get(field.key) : "",
              inputmode: field.kind === "number" ? "numeric" : null,
            });
            control.addEventListener("input", () => {
              this.profileFieldDrafts.set(field.key, control.value);
              this.updateSeoAudit();
              this.schedulePreview();
            });
            ui.profileFieldControls.set(field.key, control);
            return this.field(`oba-profile-${field.key}`, field.label, control, field.help);
          }),
        );
      };
      const syncProfileHelp = () => {
        const selected = profiles.find((profile) => profile.id === ui.profile.value);
        ui.profileHelp.textContent = selected
          ? selected.description || "Choose the authoring and publishing behavior for this post."
          : `Unknown profile: ${ui.profile.value}. It will be preserved and rendered as an article.`;
      };
      ui.profile.addEventListener("change", () => {
        this.profileTouched = true;
        syncProfileHelp();
        syncProfileFields();
      });
      syncProfileHelp();
      syncProfileFields();
      side.push(h("div", { class: "oba-field" }, h("label", { for: "oba-profile" }, "Content profile"), ui.profile, ui.profileHelp), ui.profileFields);
      ui.description = h("textarea", { id: "oba-desc", rows: 3, value: f.description || "" });
      side.push(this.field("oba-desc", "Description", ui.description, "Shown in search results and feeds. Leave empty to use an excerpt."));
      ui.tags = h("input", { id: "oba-tags", type: "text", list: "oba-taglist", value: (Array.isArray(f.tags) ? f.tags : f.tags ? [f.tags] : []).join(", ") });
      side.push(
        this.field("oba-tags", "Tags", ui.tags, "Comma separated."),
        h("datalist", { id: "oba-taglist" }, this.meta.tags.map((t) => h("option", { value: t }))),
      );
      ui.series = h(
        "select",
        { id: "oba-series" },
        h("option", { value: "" }, "None"),
        this.meta.series.map((s) => h("option", { value: s.slug, selected: s.slug === f.series }, s.name)),
      );
      if (f.series && !this.meta.series.some((s) => s.slug === f.series)) ui.series.append(h("option", { value: f.series, selected: true }, f.series));
      ui.order = h("input", { id: "oba-order", type: "number", min: 1, value: f.seriesOrder || "" });
      side.push(this.field("oba-series", "Series", ui.series), this.field("oba-order", "Part number", ui.order, "Optional. Defaults to date order."));
    } else if (kind === "pages") {
      ui.description = h("textarea", { id: "oba-desc", rows: 3, value: f.description || "" });
      ui.nav = h("input", { id: "oba-nav", type: "checkbox", checked: String(f.nav || "").toLowerCase() === "true" });
      side.push(this.field("oba-desc", "Description", ui.description), h("div", { class: "oba-field" }, h("label", { for: "oba-nav" }, ui.nav, " Show in the header navigation")));
    } else {
      ui.order = h("input", { id: "oba-order", type: "number", min: 0, value: f.order || "" });
      side.push(this.field("oba-order", "List order", ui.order, "Lower numbers first."));
    }

    ui.theme = h(
      "select",
      { id: "oba-theme" },
      h("option", { value: "" }, `Inherit (${kind === "posts" ? "series or site theme" : "site theme"})`),
      this.meta.themes.map((t) => h("option", { value: t.name, selected: t.name === f.theme }, t.label || t.name)),
    );
    side.push(this.field("oba-theme", "Theme", ui.theme));

    if (kind !== "pages") {
      ui.cover = h("input", { id: "oba-cover", type: "text", value: f.cover || "", placeholder: "/images/…" });
      ui.coverFile = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/avif", class: "oba-sr", tabindex: "-1", "aria-hidden": "true" });
      ui.coverFile.addEventListener("change", async () => {
        const file = ui.coverFile.files[0];
        if (file) {
          const url = await this.upload(file);
          if (url) {
            ui.cover.value = url;
            this.app.dirty = true;
            this.markDirty();
            this.updateSeoAudit();
            this.schedulePreview();
          }
        }
        ui.coverFile.value = "";
      });
      const coverButton = h("button", { class: "oba-btn", type: "button", onClick: () => ui.coverFile.click() }, "Upload cover");
      side.push(this.field("oba-cover", "Cover image", ui.cover), coverButton, ui.coverFile);
    }
    if (kind === "posts") {
      ui.canonical = h("input", { id: "oba-canonical", type: "text", value: f.canonical || "", placeholder: "https://…" });
      side.push(this.field("oba-canonical", "Canonical URL", ui.canonical, "Only for posts first published elsewhere."));
      ui.coverAlt = h("input", { id: "oba-cover-alt", type: "text", value: f.coverAlt || "", placeholder: "Describe the meaningful image content" });
      side.push(this.field("oba-cover-alt", "Cover alternative text", ui.coverAlt, "Required when the cover conveys information; also helps image discovery."));
      side.push(this.renderCreditEditor());
    }

    ui.saveBtn = h("button", { class: "oba-btn oba-btn-primary", type: "button", onClick: () => this.save() }, this.isNew ? "Create" : "Save");
    ui.deleteBtn = this.isNew ? null : h("button", { class: "oba-btn oba-btn-danger", type: "button", onClick: () => this.remove() }, "Move to trash");
    ui.live = h("span", { class: "oba-small" });

    const imageButton = h("button", { class: "oba-btn", type: "button", onClick: () => ui.imageFile.click() }, "Insert image");
    const quizButton = kind === "posts" ? h("button", { class: "oba-btn oba-btn-feature", type: "button", onClick: () => this.openKnowledgeCheck() }, "✦ Add knowledge check") : null;
    ui.imageFile = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/avif", class: "oba-sr", tabindex: "-1", "aria-hidden": "true" });
    ui.imageFile.addEventListener("change", async () => {
      const file = ui.imageFile.files[0];
      if (file) await this.insertImage(file);
      ui.imageFile.value = "";
    });
    const back = h("a", { class: "oba-btn", href: `#/${kind}` }, "← Back");
    const toolbar = h("div", { class: "oba-toolbar oba-editor-actions" }, back, ui.saveBtn, ui.deleteBtn, imageButton, quizButton, ui.imageFile, ui.live, h("span", { class: "oba-small" }, "Ctrl+S saves"));

    let savedPreviewWidth = "wide";
    try {
      const stored = localStorage.getItem(ADMIN_PREVIEW_WIDTH_KEY);
      if (["wide", "tablet", "mobile"].includes(stored)) savedPreviewWidth = stored;
    } catch {
      // Storage can be blocked; use the wide preview for this session.
    }
    ui.previewWidth = h(
      "select",
      { class: "oba-preview-width", "aria-label": "Preview width" },
      ["wide", "tablet", "mobile"].map((width) => h("option", { value: width, selected: width === savedPreviewWidth }, width[0].toUpperCase() + width.slice(1))),
    );

    const paneHeader = (eyebrow, title, trailing = null) =>
      h(
        "header",
        { class: "oba-pane-header" },
        h("div", {}, h("span", { class: "oba-pane-eyebrow" }, eyebrow), h("h2", {}, title)),
        trailing,
      );
    const formatButtons = [
      ["heading", "H2", "Heading 2"],
      ["bold", "B", "Bold (Ctrl+B)"],
      ["italic", "I", "Italic (Ctrl+I)"],
      ["link", "Link", "Link"],
      ["quote", "Quote", "Block quote"],
      ["list", "List", "Bulleted list"],
      ["code", "Code", "Inline or fenced code"],
    ];
    ui.formatToolbar = h(
      "div",
      { class: "oba-format-toolbar", role: "group", "aria-label": "Markdown formatting" },
      formatButtons.map(([command, label, title]) =>
        h("button", { type: "button", class: `oba-format-button${command === "italic" ? " is-italic" : ""}`, title, "aria-label": title, onClick: () => this.formatMarkdown(command) }, label),
      ),
      kind === "posts"
        ? [
            h("button", { type: "button", class: "oba-format-button", title: "Insert Abstract section", onClick: () => this.addResearchSection("abstract") }, "Abstract"),
            h("button", { type: "button", class: "oba-format-button", title: "Insert References section", onClick: () => this.addResearchSection("references") }, "References"),
          ]
        : null,
    );
    let paneButtons = [];
    const activatePane = (pane, focus = false) => {
      applyPaneSelection(this.root, paneButtons, pane);
      if (["preview", "social", "accessibility", "evidence"].includes(pane)) this.renderPreview();
      else {
        clearTimeout(this.previewTimer);
        this.previewRequest += 1;
      }
      if (focus) {
        const container = this.root.querySelector(`[data-pane="${pane}"]`);
        const target = pane === "write" ? this.ui.body : pane === "preview" ? this.ui.preview : container?.querySelector("input,select,textarea,button,[tabindex]");
        requestAnimationFrame(() => target?.focus());
      }
    };
    this.activatePane = activatePane;
    const paneLabels = { write: "Write", preview: "Site preview", social: "Social", optimize: "Optimize", settings: "Settings", accessibility: "Accessibility", evidence: "Evidence" };
    paneButtons = ["write", "preview", "social", "optimize", "settings", "accessibility", "evidence"].map((pane) =>
      h(
        "button",
        {
          class: "oba-tab",
          type: "button",
          "data-pane-target": pane,
          "aria-pressed": String(pane === "write"),
          onClick: () => activatePane(pane),
        },
        paneLabels[pane],
      ),
    );
    const viewNav = h("nav", { class: "oba-editor-nav", "aria-label": "Editor views" }, paneButtons);
    ui.socialCardPreview = h(
      "article",
      { class: "oba-social-card", tabindex: "-1", "aria-label": "Social card preview" },
      ui.socialImage,
      h("div", { class: "oba-social-copy" }, ui.socialSite, ui.socialTitle, ui.socialDescription, ui.socialUrl),
    );

    this.root = h(
      "div",
      { class: "oba-editor", "data-editor-view": "write", "data-preview-width": savedPreviewWidth },
      h(
        "div",
        { class: "oba-main" },
        toolbar,
        ui.status,
        ui.title,
        viewNav,
        h(
          "div",
          { class: "oba-panes" },
          h("section", { class: "oba-pane oba-markdown-pane", "data-pane": "write", "aria-label": "Markdown editor" }, paneHeader("Write", "Markdown", h("span", { class: "oba-small" }, "Plain text · portable")), ui.formatToolbar, ui.body),
          h(
            "section",
            { class: "oba-pane oba-preview-pane", "data-pane": "preview", "aria-label": "Live preview" },
            paneHeader("Review", "Site preview", h("div", { class: "oba-preview-tools" }, ui.previewTheme, ui.previewWidth)),
            ui.previewWarnings,
            h("div", { class: "oba-preview-canvas" }, ui.preview),
          ),
          h(
            "section",
            { class: "oba-pane oba-social-pane", "data-pane": "social", "aria-label": "OpenGraph and social preview" },
            paneHeader("Review", "Social preview", ui.socialStatus),
            h(
              "div",
              { class: "oba-social-workspace" },
              ui.socialCardPreview,
              h(
                "dl",
                { class: "oba-social-meta" },
                h("div", {}, h("dt", {}, "OpenGraph type"), ui.socialType),
                h("div", {}, h("dt", {}, "X card"), ui.socialCardType),
                h("div", {}, h("dt", {}, "Resolved image"), ui.socialImageUrl),
              ),
            ),
          ),
          h(
            "section",
            { class: "oba-pane oba-optimize-pane", "data-pane": "optimize", "aria-label": "SEO and answer readiness analysis" },
            paneHeader("Improve", "SEO & answer readiness", h("span", { class: "oba-small" }, "Heuristic guidance, not a ranking guarantee")),
            h(
              "div",
              { class: "oba-optimize-workspace" },
              h("aside", { class: "oba-optimize-overview" }, h("span", { class: "oba-pane-eyebrow" }, "Readiness"), h("div", {}, ui.optimizeScore, h("span", {}, "%")), ui.optimizeSummary),
              ui.optimizeGroups,
            ),
          ),
          h("section", { class: "oba-pane oba-settings-pane", "data-pane": "settings", "aria-label": "Document settings" }, paneHeader("Document", "Settings"), h("div", { class: "oba-side-fields" }, side)),
          h(
            "section",
            { class: "oba-pane oba-accessibility-pane", "data-pane": "accessibility", "aria-label": "Accessibility Studio" },
            paneHeader("Review", "Accessibility Studio", ui.accessibilityStatus),
            h(
              "div",
              { class: "oba-accessibility-workspace" },
              h(
                "aside",
                { class: "oba-accessibility-guide", tabindex: "-1" },
                h("h3", {}, "What this checks"),
                h(
                  "p",
                  {},
                  "Accessibility Studio finds selected source issues and guides manual review. It does not test every accessibility requirement or certify WCAG conformance. Verify the rendered site with keyboard and assistive-technology testing and, when conformance matters, a qualified accessibility review.",
                ),
                ui.accessibilityCounts,
                h("h3", {}, "Review the rendered page"),
                h(
                  "ul",
                  { class: "oba-accessibility-manual" },
                  ["Color contrast", "Visible focus", "Keyboard order and operation", "Zoom and reflow", "Reduced motion", "Target size", "Responsive layouts", "Third-party embeds"].map((item) => h("li", {}, item)),
                ),
              ),
              ui.accessibilityFindings,
            ),
          ),
          h(
            "section",
            { class: "oba-pane oba-evidence-pane", "data-pane": "evidence", "aria-label": "Evidence Studio" },
            paneHeader("Review", "Evidence Studio", ui.evidenceStatus),
            h(
              "div",
              { class: "oba-accessibility-workspace" },
              h(
                "aside",
                { class: "oba-accessibility-guide", tabindex: "-1" },
                h("h3", {}, "What this checks"),
                h(
                  "p",
                  {},
                  "Evidence Studio checks portable research structure and metadata. It does not score truth, authority, peer review, or claim support.",
                ),
                ui.evidenceCounts,
                ui.evidenceMetadata,
                h("h3", {}, "Author-controlled signals"),
                h(
                  "ul",
                  { class: "oba-accessibility-manual" },
                  ["Visible Abstract and References sections", "DOI and license syntax", "Resolvable reference links", "Defined Markdown footnotes"].map((item) => h("li", {}, item)),
                ),
              ),
              ui.evidenceFindings,
            ),
          ),
        ),
        h("footer", { class: "oba-editor-status" }, ui.saveState, h("span", { class: "oba-spacer" }), ui.documentStats, h("span", { class: "oba-small" }, "Markdown · UTF-8")),
      ),
    );
    return this.root;
  }

  slugFromPath() {
    const name = (this.doc.path || "").split("/").pop().replace(/\.md$/, "");
    return name.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  }

  afterMount() {
    const ui = this.ui;
    ui.title.addEventListener("input", () => {
      if (!this.slugTouched) ui.slug.value = slugify(ui.title.value);
    });
    ui.slug.addEventListener("input", () => (this.slugTouched = true));
    ui.body.addEventListener("input", () => this.updateDocumentStats());
    ui.body.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const command = event.key.toLowerCase() === "b" ? "bold" : event.key.toLowerCase() === "i" ? "italic" : null;
      if (!command) return;
      event.preventDefault();
      this.formatMarkdown(command);
    });
    ui.previewWidth.addEventListener("input", (e) => e.stopPropagation());
    ui.previewWidth.addEventListener("change", () => {
      this.root.dataset.previewWidth = ui.previewWidth.value;
      try {
        localStorage.setItem(ADMIN_PREVIEW_WIDTH_KEY, ui.previewWidth.value);
      } catch {
        // The preview still changes when storage is blocked.
      }
    });
    for (const r of ui.statusRadios || []) r.querySelector("input").addEventListener("change", () => this.syncDateField());
    for (const control of [ui.title, ui.slug, ui.description, ui.tags, ui.cover, ui.coverAlt, ui.canonical, ui.body].filter(Boolean)) {
      control.addEventListener("input", () => {
        this.updateSeoAudit();
        this.schedulePreview();
      });
    }
    for (const control of [ui.theme, ui.profile, ui.series, ui.order, ui.date, ui.nav].filter(Boolean)) control.addEventListener("change", () => this.schedulePreview());
    for (const radio of ui.statusRadios || []) radio.querySelector("input").addEventListener("change", () => this.schedulePreview());

    // Drag and drop or paste an image into the Markdown.
    ui.body.addEventListener("dragover", (e) => {
      if ([...(e.dataTransfer?.types || [])].includes("Files")) {
        e.preventDefault();
        ui.body.classList.add("oba-dropping");
      }
    });
    ui.body.addEventListener("dragleave", () => ui.body.classList.remove("oba-dropping"));
    ui.body.addEventListener("drop", async (e) => {
      ui.body.classList.remove("oba-dropping");
      const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        await this.insertImage(file);
      }
    });
    ui.body.addEventListener("paste", async (e) => {
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        await this.insertImage(file);
      }
    });

    this.syncDateField();
    this.updateSeoAudit();
    this.updateDocumentStats();
    (this.isNew ? ui.title : ui.body).focus();
  }

  syncDateField() {
    if (!this.ui.dateField) return;
    this.ui.dateField.hidden = this.currentStatus() === "draft";
  }

  currentStatus() {
    if (this.kind !== "posts") return "published";
    return this.ui.statusRadios.map((l) => l.querySelector("input")).find((i) => i.checked)?.value || "draft";
  }

  markDirty() {
    if (!this.ui?.saveState) return;
    this.app.editVersion += 1;
    if (this.ui.saveState.textContent === "Unsaved changes") return;
    this.ui.saveState.textContent = "Unsaved changes";
    this.ui.saveState.classList.add("is-dirty");
  }

  updateDocumentStats() {
    const text = this.ui.body.value;
    const lines = text ? text.split("\n").length : 1;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const characters = text.length;
    this.ui.documentStats.textContent = `${lines} line${lines === 1 ? "" : "s"} · ${words.toLocaleString()} word${words === 1 ? "" : "s"} · ${characters.toLocaleString()} character${characters === 1 ? "" : "s"}`;
  }

  formatMarkdown(command) {
    const body = this.ui.body;
    const previous = body.value;
    const edit = applyMarkdownCommand(previous, body.selectionStart ?? previous.length, body.selectionEnd ?? previous.length, command);
    let prefix = 0;
    while (prefix < previous.length && prefix < edit.value.length && previous[prefix] === edit.value[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < previous.length - prefix && suffix < edit.value.length - prefix && previous[previous.length - suffix - 1] === edit.value[edit.value.length - suffix - 1]) suffix += 1;
    const replacement = edit.value.slice(prefix, edit.value.length - suffix);
    body.focus();
    body.setSelectionRange(prefix, previous.length - suffix);
    let inputFired = false;
    body.addEventListener("input", () => (inputFired = true), { once: true });
    const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, replacement);
    if (!inserted) body.setRangeText(replacement, prefix, previous.length - suffix, "end");
    body.setSelectionRange(edit.start, edit.end);
    if (!inputFired) body.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async addResearchSection(section) {
    const body = this.ui.body;
    const source = body.value;
    const fields = this.collect();
    const action = {
      version: this.app.editVersion,
      path: this.doc.path,
      profile: this.ui.profile?.value || "",
      body: source,
    };
    try {
      const preview = await this.app.api.call("POST", "preview", {
        json: {
          kind: this.kind,
          path: action.path,
          fields,
          body: source,
          ...this.creditRequestFields(),
        },
      });
      const current = {
        version: this.app.editVersion,
        path: this.doc.path,
        profile: this.ui.profile?.value || "",
        body: body.value,
      };
      if (!researchActionIsCurrent(action, current)) {
        this.flash("error", "The document changed while its research structure was checked. Try the section action again.");
        return;
      }
      const present = researchSectionIsPresent(preview.evidence, preview.research, section);
      if (present === null) {
        this.flash("error", "Choose the Research content profile before adding research sections.");
        return;
      }
      const edit = insertResearchSection(source, section, present);
      if (!edit.inserted) {
        body.focus();
        return;
      }
      body.value = edit.value;
      body.focus();
      body.setSelectionRange(edit.start, edit.end);
      body.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (error) {
      this.flash("error", `Could not inspect the current research structure: ${error.message}`);
    }
  }

  updateSeoAudit() {
    const ui = this.ui;
    const body = ui.body.value.trim();
    const bodyExcerpt = markdownOutsideCode(body)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/[*_~`>|-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    const result = analyzeReadiness({
      kind: this.kind,
      title: ui.title.value.trim(),
      description: ui.description?.value.trim() || bodyExcerpt,
      slug: ui.slug.value.trim(),
      canonical: ui.canonical?.value.trim() || "",
      tags: ui.tags?.value.split(",") || [],
      cover: ui.cover?.value.trim() || "",
      coverAlt: ui.coverAlt?.value.trim() || "",
      body,
      authorReady:
        this.kind === "posts" && this.creditMode === "explicit"
          ? creditHasAuthor(this.credits, this.meta.contributors)
          : this.kind === "posts" && this.creditMode === "unresolved"
            ? false
            : this.meta.authorReady,
    });
    ui.optimizeScore.textContent = String(result.score);
    ui.optimizeSummary.textContent = `${result.ready} of ${result.total} checks ready. Review the specific guidance before publishing.`;
    ui.optimizeGroups.replaceChildren(
      ...result.groups.map((group) =>
        h(
          "section",
          { class: "oba-optimize-group" },
          h("header", {}, h("h3", {}, group.name), h("p", {}, group.description)),
          h(
            "ul",
            { class: "oba-seo-checks" },
            group.checks.map((check) =>
              h("li", { class: check.ready ? "is-ready" : "needs-work" }, h("strong", {}, `${check.ready ? "Ready" : "Improve"}: ${check.label}`), h("span", {}, check.detail)),
            ),
          ),
        ),
      ),
    );
  }

  schedulePreview() {
    clearTimeout(this.previewTimer);
    if (!["preview", "social", "accessibility", "evidence"].includes(this.root?.dataset.editorView)) {
      this.previewRequest += 1;
      return;
    }
    this.previewTimer = setTimeout(() => this.renderPreview(), 250);
  }

  async renderPreview() {
    const request = ++this.previewRequest;
    this.ui.previewTheme.textContent = "Rendering site…";
    this.ui.socialStatus.textContent = "Rendering current social metadata…";
    this.ui.accessibilityStatus.textContent = "Checking current source…";
    this.ui.evidenceStatus.textContent = "Checking research structure…";
    this.ui.socialCardPreview.setAttribute("aria-busy", "true");
    try {
      const preview = await this.app.api.call("POST", "preview", {
        json: {
          kind: this.kind,
          path: this.doc.path,
          fields: this.collect(),
          body: this.ui.body.value,
          ...this.creditRequestFields(),
        },
      });
      if (request !== this.previewRequest) return;
      this.ui.preview.removeAttribute("srcdoc");
      this.ui.preview.src = preview.previewUrl;
      this.ui.previewTheme.textContent = `Theme: ${preview.theme}`;
      const warnings = previewWarningsForDisplay(preview.warnings);
      this.ui.previewWarnings.replaceChildren(
        ...(warnings.length
          ? [h("strong", {}, "Publishing warnings"), h("ul", {}, warnings.map((warning) => h("li", {}, warning)))]
          : []),
      );
      this.ui.previewWarnings.hidden = warnings.length === 0;
      this.updateSocialPreview(preview.social);
      this.updateAccessibility(preview.accessibility);
      this.updateEvidence(preview.evidence, preview.research);
    } catch (error) {
      if (request !== this.previewRequest) return;
      this.ui.preview.srcdoc = "<!doctype html><html><body><p>Preview unavailable. Check the editor for validation problems.</p></body></html>";
      this.ui.previewTheme.textContent = "Preview unavailable";
      this.ui.previewWarnings.replaceChildren();
      this.ui.previewWarnings.hidden = true;
      this.updateSocialPreview({ siteName: this.meta.siteTitle, title: "Preview unavailable", description: "Fix the document validation problems, then try again.", url: "", image: null, imageAlt: "", type: "—", card: "—" });
      this.ui.socialStatus.textContent = "Social metadata unavailable";
      this.ui.accessibilityStatus.textContent = "Accessibility checks unavailable";
      this.ui.accessibilityCounts.replaceChildren();
      this.ui.accessibilityFindings.replaceChildren(h("p", { class: "oba-notice" }, "Fix the document validation problems, then run the checks again."));
      this.ui.evidenceStatus.textContent = "Evidence checks unavailable";
      this.ui.evidenceCounts.replaceChildren();
      this.ui.evidenceMetadata.replaceChildren();
      this.ui.evidenceFindings.replaceChildren(h("p", { class: "oba-notice" }, "Fix the document validation problems, then run the checks again."));
    }
  }

  updateAccessibility(findings) {
    const review = accessibilityReview(findings);
    this.ui.accessibilityCounts.replaceChildren(
      ...ACCESSIBILITY_OUTCOMES.map(({ outcome, label }) =>
        h("div", { class: `is-${outcome}` }, h("dt", {}, label), h("dd", {}, review.counts[outcome])),
      ),
    );
    this.ui.accessibilityFindings.replaceChildren(
      ...(review.total === 0
        ? [h("p", { class: "oba-notice" }, "No issues detected by the checks that ran.")]
        : review.groups.map((group) =>
            h(
              "section",
              { class: `oba-accessibility-group is-${group.outcome}` },
              h("h3", {}, `${group.label} (${group.findings.length})`),
              group.findings.map((finding) =>
                h(
                  "article",
                  { class: "oba-accessibility-finding" },
                  h("div", { class: "oba-accessibility-meta" }, h("code", {}, finding.code), h("span", {}, finding.sourceLabel)),
                  h("p", {}, finding.message),
                  h("p", { class: "oba-accessibility-repair" }, h("strong", {}, "Next: "), finding.repair),
                  finding.references.length ? h("p", { class: "oba-small" }, `References: ${finding.references.join(", ")}`) : null,
                ),
              ),
            ),
          )),
    );
    this.ui.accessibilityStatus.textContent = `${review.total} source finding${review.total === 1 ? "" : "s"}`;
  }

  updateEvidence(findings, research) {
    const state = evidenceStudioState(findings, research);
    if (!state.active) {
      this.ui.evidenceCounts.replaceChildren();
      this.ui.evidenceFindings.replaceChildren(
        h("p", { class: "oba-notice" }, "Evidence checks run only for posts using the Research content profile."),
      );
      this.ui.evidenceMetadata.replaceChildren(
        h("div", {}, h("dt", {}, "Profile"), h("dd", {}, "Research metadata is available for Research posts.")),
      );
      this.ui.evidenceStatus.textContent = state.status;
      return;
    }
    const review = state.review;
    this.ui.evidenceCounts.replaceChildren(
      ...ACCESSIBILITY_OUTCOMES.map(({ outcome, label }) =>
        h("div", { class: `is-${outcome}` }, h("dt", {}, label), h("dd", {}, review.counts[outcome])),
      ),
    );
    this.ui.evidenceFindings.replaceChildren(
      ...(review.total === 0
        ? [h("p", { class: "oba-notice" }, "No research evidence issues detected for this source.")]
        : review.groups.map((group) =>
            h(
              "section",
              { class: `oba-accessibility-group is-${group.outcome}` },
              h("h3", {}, `${group.label} (${group.findings.length})`),
              group.findings.map((finding) =>
                h(
                  "article",
                  { class: "oba-accessibility-finding" },
                  h("div", { class: "oba-accessibility-meta" }, h("code", {}, finding.code), h("span", {}, finding.sourceLabel)),
                  h("p", {}, finding.message),
                  h("p", { class: "oba-accessibility-repair" }, h("strong", {}, "Next: "), finding.repair),
                ),
              ),
            ),
          )),
    );
    this.ui.evidenceMetadata.replaceChildren(
      h("div", {}, h("dt", {}, "DOI"), h("dd", {}, research.doiUrl || research.doi || "Not supplied")),
      h("div", {}, h("dt", {}, "License"), h("dd", {}, research.licenseUrl || "Not supplied")),
      h("div", {}, h("dt", {}, "Linked references"), h("dd", {}, String(research.referenceCount || 0))),
    );
    this.ui.evidenceStatus.textContent = state.status;
  }

  updateSocialPreview(social) {
    const ui = this.ui;
    ui.socialSite.textContent = social.siteName;
    ui.socialTitle.textContent = social.title;
    ui.socialDescription.textContent = social.description || "No description will be included in the shared card.";
    ui.socialUrl.textContent = social.url;
    ui.socialType.textContent = social.type;
    ui.socialCardType.textContent = social.card;
    ui.socialImageUrl.textContent = social.image || "No image";
    ui.socialImage.replaceChildren(
      social.image
        ? h("img", { src: social.image, alt: social.imageAlt || "", loading: "lazy", referrerpolicy: "no-referrer" })
        : h("span", {}, "No social image"),
    );
    ui.socialCardPreview.setAttribute("aria-busy", "false");
    ui.socialStatus.textContent = "Matches generated OpenGraph metadata";
  }

  async upload(file) {
    try {
      const res = await this.app.api.call("POST", `upload?name=${encodeURIComponent(file.name)}`, {
        body: file,
        headers: { "Content-Type": "application/octet-stream" },
      });
      this.flash("ok", `Uploaded ${res.url}`);
      return res.url;
    } catch (err) {
      this.flash("error", err.message);
      return null;
    }
  }

  async insertImage(file) {
    const url = await this.upload(file);
    if (!url) return;
    const alt = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    const ta = this.ui.body;
    const snippet = `![${alt}](${url})`;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? start;
    ta.value = ta.value.slice(0, start) + snippet + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + snippet.length;
    this.app.dirty = true;
    this.markDirty();
    this.schedulePreview();
    this.updateSeoAudit();
    this.updateDocumentStats();
    ta.focus();
  }

  openKnowledgeCheck() {
    const trigger = document.activeElement;
    const dialog = h("dialog", { class: "oba-dialog", "aria-labelledby": "oba-quiz-title" });
    const questions = h("div", { class: "oba-quiz-editors" });
    const status = h("p", { class: "oba-error", role: "alert", hidden: true });
    let count = 0;

    const addQuestion = (draft = null) => {
      if (count >= 3) return;
      count += 1;
      const number = count;
      const promptId = `oba-quiz-prompt-${number}`;
      const feedbackId = `oba-quiz-feedback-${number}`;
      const prompt = h("input", { id: promptId, type: "text", required: true, placeholder: "What should the reader remember?", value: draft?.prompt || "" });
      const explanation = h("textarea", { id: feedbackId, rows: 2, placeholder: "Optional explanation shown after answering", value: draft?.explanation || "" });
      const draftChoices = Array.isArray(draft?.choices) && draft.choices.length >= 2 ? draft.choices.slice(0, 4) : ["", "", ""];
      const choices = draftChoices.map((choice, index) => {
        const choiceId = `oba-quiz-${number}-choice-${index + 1}`;
        const correct = h("input", { type: "radio", name: `oba-correct-${number}`, value: index, checked: index === (draft?.correctIndex ?? 0), "aria-label": `Choice ${index + 1} is correct` });
        const text = h("input", { id: choiceId, type: "text", required: true, placeholder: index === 0 ? "Correct answer" : "Other answer", value: choice });
        return h("div", { class: "oba-quiz-choice-edit" }, correct, h("label", { for: choiceId, class: "oba-sr" }, `Answer ${index + 1}`), text);
      });
      const fieldset = h(
        "fieldset",
        { class: "oba-quiz-editor" },
        h("legend", {}, `Question ${number}`),
        h("div", { class: "oba-field" }, h("label", { for: promptId }, "Question"), prompt),
        h("p", { class: "oba-help" }, "Select the radio button beside the correct answer."),
        ...choices,
        h("div", { class: "oba-field" }, h("label", { for: feedbackId }, "Feedback"), explanation),
      );
      fieldset.quizControls = { prompt, choices, explanation };
      questions.append(fieldset);
      add.disabled = count >= 3;
      prompt.focus();
    };

    const add = h("button", { class: "oba-btn", type: "button", onClick: addQuestion }, "Add another question");
    const generation = [];
    if (this.meta.quizGeneration) {
      const amount = h("select", { "aria-label": "Number of generated questions" }, [1, 2, 3].map((n) => h("option", { value: n, selected: n === 1 }, `${n} question${n === 1 ? "" : "s"}`)));
      const generate = h("button", {
        class: "oba-btn oba-btn-primary",
        type: "button",
        onClick: async () => {
          const ta = this.ui.body;
          const selected = ta.value.slice(ta.selectionStart ?? 0, ta.selectionEnd ?? 0).trim();
          let context = selected;
          if (!context) {
            const cursor = ta.selectionStart ?? ta.value.length;
            const before = ta.value.slice(0, cursor);
            const heading = [...before.matchAll(/^#{1,6}\s+.+$/gm)].pop();
            if (heading) {
              const rest = ta.value.slice(cursor);
              const next = rest.match(/^#{1,6}\s+.+$/m);
              const end = next?.index === undefined ? ta.value.length : cursor + next.index;
              context = ta.value.slice(heading.index, end).trim();
            } else {
              context = ta.value.trim();
            }
          }
          generate.disabled = true;
          status.hidden = true;
          try {
            const result = await this.app.api.call("POST", "quiz/generate", { json: { context, count: Number(amount.value) } });
            questions.replaceChildren();
            count = 0;
            result.questions.forEach((question) => addQuestion(question));
            status.textContent = "Draft questions generated. Review every answer before inserting.";
            status.className = "oba-ok";
            status.hidden = false;
          } catch (error) {
            status.textContent = error.message;
            status.className = "oba-error";
            status.hidden = false;
          } finally {
            generate.disabled = false;
          }
        },
      }, "Generate draft");
      generation.push(h("div", { class: "oba-generation" }, h("span", {}, "Use the selected text or current section:"), amount, generate));
    }
    const close = (focusBody = false) => {
      dialog.close();
      dialog.remove();
      if (focusBody) this.ui.body.focus();
      else if (trigger instanceof HTMLElement) trigger.focus();
    };
    const insert = h("button", {
      class: "oba-btn oba-btn-primary",
      type: "button",
      onClick: () => {
        const oneLine = (value) => value.trim().replace(/\s+/g, " ");
        const blocks = [];
        for (const fieldset of questions.children) {
          const { prompt, choices, explanation } = fieldset.quizControls;
          const question = oneLine(prompt.value);
          const answers = choices.map((row) => oneLine(row.querySelector('input[type="text"]').value));
          if (!question || answers.some((answer) => !answer)) {
            status.className = "oba-error";
            status.textContent = "Every question and answer choice is required.";
            status.hidden = false;
            return;
          }
          if ([question, ...answers, explanation.value].some((value) => value.includes("```"))) {
            status.className = "oba-error";
            status.textContent = "Knowledge-check text cannot contain a triple backtick.";
            status.hidden = false;
            return;
          }
          const correct = choices.findIndex((row) => row.querySelector('input[type="radio"]').checked);
          const lines = ["```quiz", question, ...answers.map((answer, index) => `- [${index === correct ? "x" : " "}] ${answer}`)];
          const feedback = oneLine(explanation.value);
          if (feedback) lines.push(`> ${feedback}`);
          lines.push("```");
          blocks.push(lines.join("\n"));
        }
        const ta = this.ui.body;
        const at = ta.selectionEnd ?? ta.value.length;
        const before = ta.value.slice(0, at).replace(/\s*$/, "");
        const after = ta.value.slice(at).replace(/^\s*/, "");
        const snippet = `${before ? "\n\n" : ""}${blocks.join("\n\n")}${after ? "\n\n" : ""}`;
        ta.value = before + snippet + after;
        ta.selectionStart = ta.selectionEnd = (before + snippet).length;
        this.app.dirty = true;
        this.markDirty();
        this.schedulePreview();
        this.updateDocumentStats();
        close(true);
      },
    }, "Insert");
    dialog.append(
      h("h2", { id: "oba-quiz-title" }, "Add a knowledge check"),
      h("p", { class: "oba-help" }, "Add up to three short multiple-choice questions. Readers get feedback immediately."),
      ...generation,
      questions,
      status,
      h("div", { class: "oba-toolbar" }, add, h("span", { class: "oba-spacer" }), h("button", { class: "oba-btn", type: "button", onClick: () => close() }, "Cancel"), insert),
    );
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    document.body.append(dialog);
    addQuestion();
    dialog.showModal();
  }

  flash(kind, message, problems = [], action = null) {
    const box = h("p", { class: kind === "error" ? "oba-error" : "oba-ok", role: kind === "error" ? "alert" : null }, message);
    if (problems.length) box.append(h("ul", {}, problems.map((p) => h("li", {}, p))));
    if (action) box.append(" ", action);
    this.ui.status.replaceChildren(box);
  }

  /** Build the front matter object from the form, keeping fields the form doesn't know about. */
  collect() {
    const ui = this.ui;
    if (this.kind === "posts") {
      this.profileFieldDrafts = preserveProfileFieldDrafts(this.profileFieldDrafts, ui.profileFieldControls);
    }
    let fields = this.kind === "posts" ? applyProfileFieldDrafts(this.f, this.profileFieldDrafts) : { ...this.f };
    const set = (key, value) => {
      const empty = value === "" || value === null || value === undefined || (Array.isArray(value) && !value.length);
      if (empty) delete fields[key];
      else fields[key] = value;
    };
    const titleKey = KINDS[this.kind].titleKey;
    set(titleKey, ui.title.value.trim());
    set("slug", ui.slug.value.trim());
    set("theme", ui.theme.value);
    if (ui.cover) set("cover", ui.cover.value.trim());
    if (this.kind === "posts") {
      if (this.profileTouched) set("profile", ui.profile.value);
      set("description", ui.description.value.trim());
      set("tags", ui.tags.value.split(",").map((t) => t.trim()).filter(Boolean));
      set("series", ui.series.value);
      set("seriesOrder", ui.order.value);
      set("canonical", ui.canonical.value.trim());
      set("coverAlt", ui.coverAlt.value.trim());
      const status = this.currentStatus();
      const picked = fromLocalInput(ui.date.value);
      if (status === "draft") {
        set("draft", "true");
        set("date", picked || fields.date || "");
      } else {
        delete fields.draft;
        if (status === "scheduled") {
          set("date", picked);
        } else {
          // Published: keep an existing past date, otherwise publish now.
          const keep = picked && new Date(picked) <= new Date() ? picked : "";
          set("date", keep || nowIso());
        }
      }
    } else if (this.kind === "pages") {
      set("description", ui.description.value.trim());
      set("nav", ui.nav.checked ? "true" : "");
    } else {
      set("order", ui.order.value);
    }
    return fields;
  }

  validateClient(fields) {
    if (!fields[KINDS[this.kind].titleKey] && !fields.slug) return "Give it a title first.";
    if (this.kind === "posts") {
      const creditProblem = validateCreditDraft(this.creditMode, this.credits);
      if (creditProblem) return creditProblem;
      if (this.creditMode === "explicit" && this.credits.some((credit) => !this.meta.contributors?.[credit.contributor])) {
        return "Replace every unknown contributor with someone from the registry.";
      }
      const knownRoles = new Set((this.meta.creditRoles || []).map((role) => `${role.vocabulary}:${role.role}`));
      if (this.creditMode === "explicit" && this.credits.some((credit) => credit.roles.some((role) => !knownRoles.has(`${role.vocabulary}:${role.role}`)))) {
        return "Remove every unknown contributor role before saving.";
      }
    }
    if (this.kind === "posts" && this.currentStatus() === "scheduled") {
      if (!fields.date) return "Pick the date and time to publish.";
      if (new Date(fields.date) <= new Date()) return "A scheduled post needs a time in the future. Choose “Published” to publish now.";
    }
    return "";
  }

  async save() {
    if (this.saving) return;
    const fields = this.collect();
    const problem = this.validateClient(fields);
    if (problem) {
      this.flash("error", problem);
      return;
    }
    const ui = this.ui;
    this.saving = true;
    ui.saveBtn.disabled = true;
    ui.saveState.textContent = "Saving…";
    const saveVersion = this.app.editVersion;
    const payload = { fields, body: ui.body.value, etag: this.doc.etag, kind: this.kind, ...this.creditRequestFields(true) };
    try {
      const res = this.doc.path
        ? await this.app.api.call("PUT", `document?path=${encodeURIComponent(this.doc.path)}`, { json: payload })
        : await this.app.api.call("POST", "document", { json: payload });
      this.f = fields;
      if (this.kind === "posts") {
        this.profileSelection = resolveProfileSelection(fields, this.meta.profiles || [], this.doc.resolvedProfile);
        this.profileTouched = false;
      }
      this.doc.path = res.path;
      this.doc.etag = res.etag;
      this.doc.creditEtag = res.creditEtag ?? null;
      this.creditEtag = this.doc.creditEtag;
      this.doc.creditError = null;
      this.creditError = "";
      if (ui.creditError) ui.creditError.hidden = true;
      this.isNew = false;
      this.slugTouched = true;
      const savedState = saveStateForVersions(saveVersion, this.app.editVersion);
      this.app.dirty = savedState.dirty;
      ui.saveState.textContent = savedState.label;
      if (savedState.messageIsCurrent) {
        ui.saveState.classList.remove("is-dirty");
      } else {
        ui.saveState.classList.add("is-dirty");
      }
      ui.saveBtn.textContent = "Save";
      // Update the address without re-rendering the editor. Only arm the skip flag
      // when the hash really changes; otherwise no event fires and the flag would
      // swallow the next genuine navigation.
      const target = `#/edit/${encodeURIComponent(res.path)}`;
      if (location.hash !== target) {
        this.app.skipRoute = true;
        location.hash = target;
      }
      this.reportSaved(res, savedState.messageIsCurrent);
    } catch (err) {
      if (err.status === 401) {
        this.app.showLogin("Your session ended. Sign in again; your edits are still in the form only until you reload.");
      } else if (err.status === 409) {
        this.flash("error", err.message, [], h("button", { class: "oba-btn", type: "button", onClick: () => location.reload() }, "Reload"));
      } else {
        this.flash("error", err.message, err.data?.problems || []);
      }
      ui.saveState.textContent = "Save failed";
      ui.saveState.classList.add("is-dirty");
    } finally {
      this.saving = false;
      ui.saveBtn.disabled = false;
    }
  }

  reportSaved(res, current = true) {
    let message = "Saved.";
    const link = res.url ? h("a", { href: res.url, target: "_blank", rel: "noopener" }, "View on the site") : null;
    if (res.status === "scheduled") message = `Scheduled for ${formatWhen(this.f.date)}. It goes live automatically.`;
    else if (res.status === "published" && res.url) message = "Saved and live.";
    else if (res.status === "draft") message = "Draft saved. It is not public.";
    if (!current) message = "Saved the earlier version. Your newer edits are still unsaved.";
    if (res.build && res.build.ok === false) {
      this.flash("error", `Saved, but the site build failed: ${res.build.error}`);
    } else {
      this.flash("ok", message, [], link);
    }
    this.ui.live.textContent = "";
  }

  async remove() {
    if (!confirm("Move this to the trash? It is removed from the site but kept in .openblog/trash.")) return;
    try {
      await this.app.api.call("DELETE", `document?path=${encodeURIComponent(this.doc.path)}`);
      this.app.dirty = false;
      location.hash = `#/${this.kind}`;
    } catch (err) {
      this.flash("error", err.message);
    }
  }
}

if (globalThis.customElements && !customElements.get("ob-admin")) customElements.define("ob-admin", ObAdmin);
