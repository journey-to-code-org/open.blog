// open.blog admin editor: <ob-admin>. A single autonomous custom element that
// renders the sign-in, publishing workspace, and editor with plain DOM calls.
// Nothing user-controlled is ever assigned through innerHTML. Publishing-engine
// previews are served from an authenticated URL into an opaque-origin sandbox.

import { normalizeCodeRunnerLanguage } from "../components/ob-code-runner-language.js";

const ADMIN_SCHEME_KEY = "ob-admin-scheme";
const ADMIN_PREVIEW_WIDTH_KEY = "ob-admin-preview-width";

export const ADMIN_OPTIONAL_MODULES = Object.freeze([
  "social",
  "release",
  "field",
  "optimize",
  "accessibility",
  "evidence",
  "assistant",
  "analytics",
  "contributors",
  "public-site",
]);

export const DEFAULT_ADMIN_PREFERENCES = Object.freeze({
  schemaVersion: 1,
  preset: "simple",
  density: "comfortable",
  editorMode: "visual",
  moduleOrder: ADMIN_OPTIONAL_MODULES,
  hiddenModules: [],
});

export function normalizeAdminPreferences(value) {
  const input = value && typeof value === "object" ? value : {};
  const preset = ["simple", "guided", "advanced", "custom"].includes(input.preset) ? input.preset : "simple";
  const density = ["comfortable", "compact"].includes(input.density) ? input.density : "comfortable";
  const editorMode = ["visual", "markdown"].includes(input.editorMode) ? input.editorMode : "visual";
  const suppliedOrder = Array.isArray(input.moduleOrder) ? input.moduleOrder : [];
  const moduleOrder = [
    ...suppliedOrder.filter((module, index) => ADMIN_OPTIONAL_MODULES.includes(module) && suppliedOrder.indexOf(module) === index),
    ...ADMIN_OPTIONAL_MODULES.filter((module) => !suppliedOrder.includes(module)),
  ];
  const hiddenModules = Array.isArray(input.hiddenModules)
    ? input.hiddenModules.filter((module, index) => ADMIN_OPTIONAL_MODULES.includes(module) && input.hiddenModules.indexOf(module) === index)
    : [];
  return { schemaVersion: 1, preset, density, editorMode, moduleOrder, hiddenModules };
}

export function visibleAdminModules(preferences, available = ADMIN_OPTIONAL_MODULES) {
  const normalized = normalizeAdminPreferences(preferences);
  const candidates = normalized.moduleOrder.filter((module) => available.includes(module));
  if (normalized.preset === "simple") return [];
  if (normalized.preset === "guided") return candidates.filter((module) => ["accessibility", "evidence", "assistant"].includes(module));
  if (normalized.preset === "custom") return candidates.filter((module) => !normalized.hiddenModules.includes(module));
  return candidates;
}

/** Editor views that no preference can hide, move, or reorder. */
export const ADMIN_ESSENTIAL_PANES = Object.freeze(["write", "preview", "settings"]);

export const ADMIN_MODULE_LABELS = Object.freeze({
  social: "Social preview",
  release: "Release kit",
  field: "Field review",
  optimize: "Optimize",
  accessibility: "Accessibility",
  evidence: "Evidence Studio",
  assistant: "Assistant",
  analytics: "Analytics",
  contributors: "Contributors",
  "public-site": "Public site link",
});

export const ADMIN_MODULE_DETAILS = Object.freeze({
  social: "Check how links to this document look when shared",
  release: "Video chapters and a ready-to-copy description",
  field: "Route facts and location privacy for GPX tracks",
  optimize: "Search and sharing readiness checks",
  accessibility: "Findings and repairs for readers using assistive technology",
  evidence: "Research structure, identifiers, and references",
  assistant: "Optional AI review, knowledge checks, and runnable-code proposals",
  analytics: "Reader trends without individual tracking",
  contributors: "Bylines, identities, and contribution credits",
  "public-site": "Open the public site in a new tab",
});

const ADMIN_TOOL_GOALS = Object.freeze([
  { goal: "assist", label: "Get writing help", modules: ["assistant"] },
  { goal: "review", label: "Check quality and research", modules: ["accessibility", "evidence", "optimize", "field"] },
  { goal: "distribute", label: "Share and distribute", modules: ["social", "release", "public-site"] },
  { goal: "collaborate", label: "Collaborate and understand readers", modules: ["contributors", "analytics"] },
]);

/** Optional tools grouped by what the author wants to do, each group in the admin's chosen order. */
export function adminToolGroups(preferences, available = ADMIN_OPTIONAL_MODULES) {
  const { moduleOrder } = normalizeAdminPreferences(preferences);
  return ADMIN_TOOL_GOALS.map(({ goal, label, modules }) => ({
    goal,
    label,
    modules: moduleOrder.filter((module) => modules.includes(module) && available.includes(module)),
  })).filter((group) => group.modules.length);
}

/** Split editor views into the always-visible bar and the More tools menu. */
export function editorPaneLayout(preferences, panes) {
  const normalized = normalizeAdminPreferences(preferences);
  const optional = panes.filter((pane) => !ADMIN_ESSENTIAL_PANES.includes(pane));
  const visible = visibleAdminModules(normalized, optional);
  return {
    primary: [...ADMIN_ESSENTIAL_PANES.filter((pane) => panes.includes(pane)), ...visible],
    more: normalized.moduleOrder.filter((pane) => optional.includes(pane) && !visible.includes(pane)),
  };
}

// Earlier releases remembered the writing mode only in this browser. This
// release never writes the key, so its presence marks an earlier admin. (The
// preview width key is still written today, so it proves nothing.)
const LEGACY_EDITOR_MODE_KEY = "ob-admin-editor-mode";

/**
 * Preferences for an admin who used the workspace before personalization
 * existed: keep every tool where it was and carry over the writing mode.
 * First-time admins (no legacy writing mode in this browser) and admins with
 * stored server-side preferences get null.
 */
export function legacyAdminPreferences(snapshot, storage) {
  if (!snapshot || snapshot.stored !== false || !storage) return null;
  let editorMode;
  try {
    editorMode = storage.getItem(LEGACY_EDITOR_MODE_KEY);
  } catch {
    return null;
  }
  if (editorMode == null) return null;
  return normalizeAdminPreferences({ preset: "advanced", editorMode });
}

/** Drop the legacy trace once one login has migrated, so it cannot migrate another login in this browser. */
export function forgetLegacyAdminPreferences(storage) {
  try {
    storage?.removeItem(LEGACY_EDITOR_MODE_KEY);
  } catch {
    // Blocked storage has nothing left to migrate from on the next sign-in either way.
  }
}

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    // Some browsers throw when site data is blocked.
    return undefined;
  }
}

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

/** Decode one hash segment; a malformed escape is treated as no segment rather than an error. */
export function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return "";
  }
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

// The moderation inbox (ADR 0104): comments and reader feedback in one list, in the participation
// policy's states (ADR 0101). The server decides who the signed-in account is on each item's work
// and sends only what that account may see, with the decisions it may take; these helpers only
// word and shape what it sent.
export const MODERATION_STATES = ["pending", "clarification", "approved", "rejected", "removed", "withdrawn"];
export const MODERATION_STATE_LABELS = { pending: "Pending", clarification: "Waiting for clarification", approved: "Approved", rejected: "Rejected", removed: "Removed", withdrawn: "Withdrawn" };
export const MODERATION_KINDS = [
  ["", "All kinds"],
  ["comment", "Comments"],
  ["question", "Questions"],
  ["source-suggestion", "Suggested sources"],
  ["correction-suggestion", "Suggested corrections"],
  ["alternative-interpretation", "Other interpretations"],
  ["abuse-report", "Abuse reports"],
];
const MODERATION_STATE_NOTES = {
  clarification: "These wait for the reader’s answer through their private receipt. The text asked about can never be approved; you can still reject it.",
  withdrawn: "Readers took these back through their private receipts, and their text was deleted at once. They are never published and cannot be changed.",
};

/** The inbox's address for one state and kind filter. */
export function moderationHash(state, kind = "") {
  const known = MODERATION_STATES.includes(state) ? state : "pending";
  return `#/moderation/${known}${kind && MODERATION_KINDS.some(([id]) => id === kind) ? `?kind=${encodeURIComponent(kind)}` : ""}`;
}

/** The state and kind an inbox address asks for, anything unknown read as the defaults. */
export function parseModerationRoute(tail, params) {
  const state = MODERATION_STATES.includes(tail) ? tail : "pending";
  const kind = params?.get?.("kind") || "";
  return { state, kind: MODERATION_KINDS.some(([id]) => id === kind) ? kind : "" };
}

/** The inbox's status line: how many items are shown, never how many exist unseen. */
export function inboxSummary(state, count, more) {
  const items = `item${count === 1 ? "" : "s"}`;
  const tail = more ? " More are listed after these." : "";
  if (!count) return state === "clarification" ? "Nothing is waiting for clarification." : `No ${MODERATION_STATE_LABELS[state].toLowerCase()} items.`;
  if (state === "clarification") return `${count} ${items} waiting for clarification.${tail}`;
  return `${count} ${MODERATION_STATE_LABELS[state].toLowerCase()} ${items}.${tail}`;
}

/**
 * The body of one decision: the item's source, id, state and version as loaded, a reason when the
 * action takes one, and, to approve feedback whose passage is not current, the passage check the
 * moderator confirmed. Nothing says who is acting: the server knows.
 */
export function moderationRequest(item, action, reason, acknowledged) {
  const request = { source: item.source, id: item.id, action, from: item.status, version: item.version };
  if (reason) request.reason = reason;
  if (action === "approve" && item.passage?.acknowledge && acknowledged) request.acknowledge = item.passage.check;
  return request;
}

/** What the signed-in account can do with an item, from the role the server resolved. */
export function moderationRoleLine(role) {
  if (role === "coordinator") return "You moderate this as a coordinator of its shared publication. Only the site Admin sees a reader’s private name or reopens a decision.";
  if (role === "contributing-author") return "You can read this as a contributing author of the work. A coordinator or the site Admin decides.";
  return "You moderate this as the site Admin.";
}

/**
 * Who sent an item, for moderators only. A comment's name is always shown with it; a reader of
 * feedback chose whether to show theirs, and a private name reaches only the site Admin.
 */
export function moderationReaderLine(reader, source = "feedback") {
  if (source === "report") return "Reports are anonymous: nothing about the reader who sent it is kept.";
  if (source === "comment") return reader?.name ? `From ${reader.name}, shown with the comment.` : "From an unnamed commenter.";
  if (reader?.private) return "The reader gave a name that only the site Admin can see.";
  if (!reader?.name) return "From an anonymous reader.";
  return reader.publishName
    ? `From ${reader.name}, who agreed to show this name if you publish the note.`
    : `From ${reader.name}. The name stays private: the reader did not agree to show it.`;
}

/** What a decision did, for the status line after the list reloads. */
export function moderationOutcome(item, action, result) {
  const where = item.post ? `“${item.post.title}”` : item.work;
  if (action === "approve") {
    if (item.source === "comment") return `Approved. The comment is shown on ${where}.`;
    return result.published ? `Approved and published on ${where}. Rebuild or publish to update the live site.` : `Approved. ${result.publishError || ""}`.trim();
  }
  if (action === "reject") return "Rejected. Nothing was published.";
  if (action === "request-clarification") return "Asked the reader to clarify. Nothing was published or e-mailed.";
  if (action === "reopen") return `Reopened. It is ${result.item?.status === "clarification" ? "waiting for clarification" : "pending"} again.`;
  if (action === "uphold-report") {
    if (!result.removedTarget) return "Report upheld. The reported item was already out of public view, so nothing else changed.";
    if (result.published) return `Report upheld and the item removed, but the note is still on the post. ${result.publishError || ""} Take it off the post from the Removed list.`.trim();
    return `Report upheld. The reported item was removed from ${where}.`;
  }
  if (action === "erase") {
    if (result.published) return `Its text and name were deleted, but the note is still on the post. ${result.publishError || ""}`.trim();
    return "Its text and name were deleted. Only the private record of decisions remains.";
  }
  if (item.source === "comment") return `Removed from ${where}.`;
  if (result.published) return `Removed, but still on the post. ${result.publishError || ""} Take it off the post from the Removed list.`;
  return result.publishError ? `Removed. ${result.publishError}` : `Removed from ${where}.`;
}

/**
 * What a card says when a feedback item's state and the published file disagree, and the fix it
 * offers: an approved note that is not on its post yet, or a removed or rejected one that still is
 * (a removal whose file write failed, or a decision made outside Admin). `published` is null when
 * unknown.
 */
export function feedbackPublicationMismatch(item) {
  if (item.status === "approved" && item.published === false) return { notice: "Approved, but not on the site yet.", action: "publish", label: "Publish on the post" };
  if (item.status === "removed" && item.published === true) return { notice: "Removed, but still on the post.", action: "unpublish", label: "Take it off the post" };
  if (item.status === "rejected" && item.published === true) return { notice: "Rejected, but still on the post.", action: "unpublish", label: "Take it off the post" };
  if (item.status === "withdrawn" && item.published === true) return { notice: "The reader withdrew this note and asked for it to be deleted, but it is still on the post. Take it off now.", action: "unpublish", label: "Take it off the post" };
  return null;
}

/** The retention dry run's summary, in words: what would expire or be purged, by kind. */
export function retentionSummaryLines(report) {
  const lines = (report?.summary || []).map((entry) => {
    const what = entry.step === "expire" ? "expire without a decision" : "have their text, details and names deleted";
    return `${entry.count} ${entry.kindLabel.toLowerCase()} ${entry.count === 1 ? "item" : "items"} would ${what}.`;
  });
  const audit = Object.values(report?.audit || {}).reduce((total, count) => total + (Number(count) || 0), 0);
  if (audit) lines.push(`${audit} private record${audit === 1 ? "" : "s"} of decisions older than ${report.periods.auditDays} days would be deleted.`);
  if (!lines.length) lines.push("Nothing is due: retention would change nothing now.");
  if (!report?.periods?.comments) lines.push("Comments are kept until you act, because participation.retention is not set in openblog.json.");
  if (report?.truncated) lines.push("More items are due than one run takes; run it again afterwards.");
  return lines;
}

/** How the published note would read its passage, in words. */
export function feedbackPreviewText(preview) {
  if (!preview) return "";
  const passage = preview.quote ? `quoting “${preview.quote}”` : preview.stale ? "without a quotation, because the passage has changed" : "without a quotation";
  return `On the post it is shown ${passage}, as from ${preview.name || "a reader"}, received ${preview.received}.`;
}

const FEEDBACK_CHECK_LABELS = { current: "Current", reanchored: "Re-anchored", stale: "Stale", "unknown-work": "Post not found" };

function feedbackPassage(passage) {
  if (!passage) return null;
  return h(
    "div",
    { class: "oba-feedback-passage", "data-check": passage.check },
    h("h4", {}, "Passage check"),
    h("p", {}, h("strong", {}, `${FEEDBACK_CHECK_LABELS[passage.check] || passage.check}. `), passage.explanation),
    passage.quoted ? h("p", {}, "Words the reader quoted, as they saw them:") : null,
    passage.quoted ? h("blockquote", { class: "oba-feedback-body" }, passage.quoted) : null,
    h("p", { class: "oba-small" }, `Seen on passage revision ${passage.revisionSeen}${passage.revisionNow ? `; published now: ${passage.revisionNow}` : ""}.`),
  );
}

/** The item an abuse report names, for moderators: its kind and state, its author if a comment, and its text unless deleted. */
function reportedItem(target) {
  if (!target) return h("p", { class: "oba-notice" }, "The reported item no longer exists, so upholding the report changes only the report.");
  return h(
    "div",
    { class: "oba-feedback-passage" },
    h("h4", {}, "Reported item"),
    h("p", {}, `${target.kindLabel}${target.authorName ? ` by ${target.authorName}` : ""} · ${target.statusLabel}`),
    target.body ? h("blockquote", { class: "oba-feedback-body" }, target.body) : h("p", { class: "oba-small" }, "Its text was deleted."),
  );
}

function feedbackPreview(preview) {
  return preview ? h("p", { class: "oba-small oba-feedback-preview" }, feedbackPreviewText(preview)) : null;
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

// ---------------------------------------------------------------- research source library

export const SOURCE_KINDS = Object.freeze([
  { kind: "work", label: "Work", detail: "An intellectual or creative creation, independent of any copy." },
  { kind: "edition", label: "Edition", detail: "A published form of a work or translation." },
  { kind: "translation", label: "Translation", detail: "A rendering of a work into another language." },
  { kind: "witness", label: "Witness", detail: "A manuscript, recording, or other surviving copy." },
  { kind: "reference", label: "Reference", detail: "A place inside a work, edition, translation, or witness." },
]);

const SOURCE_PARENT_KINDS = Object.freeze({
  edition: ["work", "translation"],
  translation: ["work"],
  witness: ["work", "edition", "translation"],
  reference: ["work", "edition", "translation", "witness"],
});
const SOURCE_BASED_ON_KINDS = Object.freeze(["edition", "witness", "translation"]);
const SOURCE_CREATOR_ROLES = Object.freeze(["author", "editor", "translator", "compiler", "scribe", "other"]);
export const SOURCE_LOCATION_SCHEMES = Object.freeze(["page", "folio", "line", "section", "chapter", "canonical", "timestamp"]);

/** Which type-aware fields a source of this kind shows. */
export function sourceFieldsForKind(kind) {
  return {
    of: kind in SOURCE_PARENT_KINDS,
    basedOn: kind === "translation",
    location: kind === "reference",
    titleRequired: kind !== "reference",
    languageRequired: kind === "translation",
  };
}

/** Records that may be named as the parent (`of`) or `basedOn` of a kind, never the record itself. */
export function sourceRelationOptions(sources, kind, field, selfId = "") {
  const allowed = field === "basedOn" ? SOURCE_BASED_ON_KINDS : SOURCE_PARENT_KINDS[kind] || [];
  return (Array.isArray(sources) ? sources : []).filter((source) => allowed.includes(source.kind) && source.id !== selfId);
}

export function sourceLabel(source) {
  return String(source?.title || "").trim() || `Untitled ${source?.kind || "source"} (${source?.id || "new"})`;
}

/**
 * Filter and search the library in memory. The query matches the id, title,
 * creator names, and identifier values, ignoring case; the archive filter
 * defaults to hiding archived records.
 */
export function filterSources(sources, { query = "", kind = "all", archived = "active" } = {}) {
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return (Array.isArray(sources) ? sources : []).filter((source) => {
    if (kind !== "all" && source.kind !== kind) return false;
    if (archived === "active" && source.archived) return false;
    if (archived === "archived" && !source.archived) return false;
    if (!terms.length) return true;
    const haystack = [
      source.id,
      source.title,
      source.language,
      source.issued,
      ...(Array.isArray(source.creators) ? source.creators.map((creator) => creator?.name) : []),
      ...(Array.isArray(source.identifiers) ? source.identifiers.map((identifier) => identifier?.value) : []),
    ]
      .filter((part) => typeof part === "string")
      .join("\n")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Records that point at this one, so archiving or editing can say what depends on it. */
export function sourceDependents(sources, id) {
  return (Array.isArray(sources) ? sources : []).filter((source) => source.of === id || source.basedOn === id || source.revises === id);
}

export function sourceDraft(record = null, kind = "work") {
  const source = record && typeof record === "object" ? record : {};
  return {
    original: record ? structuredClone(record) : null,
    id: typeof source.id === "string" ? source.id : "",
    kind: typeof source.kind === "string" ? source.kind : kind,
    title: typeof source.title === "string" ? source.title : "",
    of: typeof source.of === "string" ? source.of : "",
    basedOn: typeof source.basedOn === "string" ? source.basedOn : "",
    language: typeof source.language === "string" ? source.language : "",
    issued: typeof source.issued === "string" ? source.issued : "",
    creators: (Array.isArray(source.creators) ? source.creators : [])
      .map((creator) => (creator?.role ? `${creator?.name ?? ""} | ${creator.role}` : String(creator?.name ?? "")))
      .join("\n"),
    identifiers: (Array.isArray(source.identifiers) ? source.identifiers : []).map((entry) => `${entry?.scheme ?? ""}: ${entry?.value ?? ""}`).join("\n"),
    locationScheme: typeof source.location?.scheme === "string" ? source.location.scheme : "",
    locationValue: typeof source.location?.value === "string" ? source.location.value : "",
    locationVolume: typeof source.location?.volume === "string" ? source.location.volume : "",
  };
}

function textLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseSourceCreators(value) {
  return textLines(value).map((line) => {
    const cut = line.lastIndexOf("|");
    const role = cut >= 0 ? line.slice(cut + 1).trim() : "";
    return role && SOURCE_CREATOR_ROLES.includes(role) ? { name: line.slice(0, cut).trim(), role } : { name: line };
  });
}

export function parseSourceIdentifiers(value) {
  return textLines(value).map((line) => {
    const cut = line.indexOf(":");
    return cut < 0 ? { scheme: "", value: line } : { scheme: line.slice(0, cut).trim().toLowerCase(), value: line.slice(cut + 1).trim() };
  });
}

// An entry the author did not change keeps its stored object, so fields this
// release does not understand survive a round trip through the text boxes.
function keepUnchanged(parsed, original, same) {
  return parsed.map((entry, index) => (Array.isArray(original) && original[index] && same(original[index], entry) ? original[index] : entry));
}

// CSL name parts describe the stored display name, so they no longer apply once it changes.
const SOURCE_CREATOR_NAME_PARTS = Object.freeze(["family", "given", "dropping-particle", "non-dropping-particle", "suffix"]);

/**
 * Creators from the text box, each built on the stored creator it edits: the
 * one with the same name, otherwise the one at the same position. The text box
 * edits only the name and role, so attribution, note, and unknown fields carry
 * over; a role removed from the line is removed, and CSL name parts are dropped
 * when the name itself changes.
 */
export function mergeSourceCreators(parsed, original) {
  const stored = Array.isArray(original) ? original.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) : [];
  const claimed = new Set();
  const bases = parsed.map((entry) => {
    const index = stored.findIndex((candidate, at) => !claimed.has(at) && candidate.name === entry.name);
    if (index >= 0) claimed.add(index);
    return index;
  });
  return parsed.map((entry, position) => {
    let index = bases[position];
    if (index < 0 && position < stored.length && !claimed.has(position)) {
      index = position;
      claimed.add(position);
    }
    if (index < 0) return entry;
    const base = stored[index];
    if (base.name === entry.name && (base.role ?? "") === (entry.role ?? "")) return base;
    const merged = { ...base, name: entry.name };
    if (entry.role) merged.role = entry.role;
    else delete merged.role;
    if (base.name !== entry.name) for (const part of SOURCE_CREATOR_NAME_PARTS) delete merged[part];
    return merged;
  });
}

/**
 * The reference location from the form, built on the stored one so its volume
 * and unknown fields survive an edit; a volume the author cleared is removed.
 */
export function mergeSourceLocation(draft, stored) {
  const scheme = draft.locationScheme || "";
  const value = String(draft.locationValue || "").trim();
  const volume = String(draft.locationVolume ?? stored?.volume ?? "").trim();
  if (!scheme && !value) return undefined;
  const base = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  if (base.scheme === scheme && base.value === value && (base.volume ?? "") === volume) return base;
  const location = { ...base, scheme, value };
  if (volume) location.volume = volume;
  else delete location.volume;
  return location;
}

/** The number of volumes the record a reference points at declares, or 0. */
export function sourceTargetVolumes(sources, id) {
  const target = (Array.isArray(sources) ? sources : []).find((source) => source.id === id);
  return Number.isInteger(target?.volumes) ? target.volumes : 0;
}

/** The full record to send. Unknown fields of the stored record are carried over unchanged. */
export function sourceDraftPayload(draft) {
  const original = draft.original || {};
  const record = { ...original };
  for (const field of ["title", "of", "basedOn", "language", "issued", "creators", "identifiers", "location"]) delete record[field];
  record.id = String(draft.id || "").trim();
  record.kind = draft.kind;
  const fields = sourceFieldsForKind(draft.kind);
  const set = (name, value) => {
    const text = String(value || "").trim();
    if (text) record[name] = text;
  };
  set("title", draft.title);
  if (fields.of) set("of", draft.of);
  if (fields.basedOn) set("basedOn", draft.basedOn);
  set("language", draft.language);
  set("issued", draft.issued);
  const creators = mergeSourceCreators(parseSourceCreators(draft.creators), original.creators);
  if (creators.length) record.creators = creators;
  const identifiers = keepUnchanged(parseSourceIdentifiers(draft.identifiers), original.identifiers, (a, b) => a.scheme === b.scheme && a.value === b.value);
  if (identifiers.length) record.identifiers = identifiers;
  if (fields.location) {
    const location = mergeSourceLocation(draft, original.location);
    if (location) record.location = location;
  }
  return record;
}

/** A quick, advisory check; the server's validation stays authoritative. */
export function validateSourceDraft(draft, sources = []) {
  const id = String(draft.id || "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 64) return { field: "id", message: "The ID must be a lowercase ASCII slug of at most 64 characters, such as plato-republic." };
  if (!draft.original && sources.some((source) => source.id === id)) return { field: "id", message: `The ID “${id}” is already used by another source.` };
  const fields = sourceFieldsForKind(draft.kind);
  if (fields.titleRequired && !String(draft.title || "").trim()) return { field: "title", message: "Give this source a title." };
  if (fields.of && !draft.of) return { field: "of", message: `A ${draft.kind} must say which source it belongs to.` };
  if (fields.languageRequired && !String(draft.language || "").trim()) return { field: "language", message: "A translation needs a language tag such as en." };
  if (fields.location && Boolean(draft.locationScheme) !== Boolean(String(draft.locationValue || "").trim())) {
    return { field: "locationValue", message: "Choose a location type and enter its value, or clear both." };
  }
  if (fields.location && !draft.locationScheme && String(draft.locationVolume || "").trim()) {
    return { field: "locationVolume", message: "A volume belongs with a location; choose a location type and value, or clear the volume." };
  }
  return null;
}

/** Map a server diagnostic's field path (`identifiers[0]`) to the form control that edits it. */
export function sourceDiagnosticControl(field) {
  if (String(field || "") === "location.volume") return "locationVolume";
  const name = String(field || "").replace(/\[\d+\].*$/, "").split(".")[0];
  return { creators: "creators", identifiers: "identifiers", location: "locationValue", id: "id", kind: "kind-field", title: "title", of: "of", basedOn: "basedOn", language: "language", issued: "issued" }[name] || "";
}

export function sourceErrorMessage(error) {
  const diagnostics = Array.isArray(error?.data?.diagnostics) ? error.data.diagnostics : [];
  if (!diagnostics.length) return error?.data?.error || error?.message || "The source could not be saved.";
  return diagnostics.map((item) => `${item.field ? `${item.field}: ` : ""}${item.message}`).join(" ");
}

const SOURCE_IMPORT_LABELS = Object.freeze({ create: "New", update: "Update", unchanged: "Unchanged", conflict: "Conflict" });

/** One line saying what an import preview would do. */
export function sourceImportSummary(plan) {
  const counts = plan?.counts || {};
  const parts = [[counts.create, "new"], [counts.update, "updated"], [counts.unchanged, "unchanged"], [counts.conflict, "in conflict"]]
    .filter(([number]) => number > 0)
    .map(([number, label]) => `${number} ${label}`);
  return parts.length ? parts.join(", ") : "Nothing to import";
}

/** Preview rows: what happens to each item, what is kept, and what is not imported. */
export function sourceImportRows(plan) {
  return (Array.isArray(plan?.entries) ? plan.entries : []).map((entry) => {
    const details = [];
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) details.push(`Changes ${change.field}`);
    if (Array.isArray(entry.kept) && entry.kept.length) details.push(`Keeps ${entry.kept.join(", ")} as they are`);
    for (const loss of Array.isArray(entry.unsupported) ? entry.unsupported : []) details.push(`Not imported: ${loss.field} (${loss.reason})`);
    for (const diagnostic of Array.isArray(entry.diagnostics) ? entry.diagnostics : []) details.push(`${diagnostic.field ? `${diagnostic.field}: ` : ""}${diagnostic.message}`);
    const id = entry.sourceId || "";
    const name = id ? (entry.cslId && entry.cslId !== id ? `${id} (from ${entry.cslId})` : id) : `Item ${Number(entry.index) + 1}`;
    return { action: entry.action, label: SOURCE_IMPORT_LABELS[entry.action] || "Item", name, details };
  });
}

/** What an export could not carry, as one note per source. */
export function sourceExportLossNotes(losses) {
  const bySource = new Map();
  for (const loss of Array.isArray(losses) ? losses : []) {
    if (!bySource.has(loss.sourceId)) bySource.set(loss.sourceId, new Set());
    bySource.get(loss.sourceId).add(loss.field);
  }
  return [...bySource].map(([id, fields]) => `${id}: ${[...fields].join(", ")}`);
}

// ---------------------------------------------------------------- research notebook capture

export const QUESTION_STATES = Object.freeze([
  { value: "open", label: "Open: still needs an answer" },
  { value: "resolved", label: "Resolved" },
]);

/** The JSON body for a notebook search: only the filters that are set. It travels in a POST body, never the URL, so access logs cannot record research text. */
export function notebookSearchBody(filters) {
  const body = {};
  for (const [key, name] of [["query", "q"], ["source", "source"], ["locator", "locator"], ["concept", "concept"], ["state", "state"]]) {
    const value = String(filters?.[key] ?? "").trim();
    if (value) body[name] = value;
  }
  if (filters?.archived) body.includeArchived = true;
  return body;
}

/** One line for an import preview of the private notebook. */
export function notebookImportSummary(plan) {
  const counts = plan?.counts || {};
  return `${counts.create || 0} to add, ${counts.unchanged || 0} already here, ${counts.conflict || 0} in conflict`;
}

/** The preview rows worth reading: what would be added and what conflicts, never entry text. */
export function notebookImportRows(plan) {
  return (plan?.entries || [])
    .filter((entry) => entry.action !== "unchanged")
    .map((entry) => ({ action: entry.action, label: entry.action === "create" ? "Add" : "Conflict", name: `${entry.collection === "passages" ? "passage" : "note"} ${entry.id}`, message: entry.message || "" }));
}

export function searchIsActive(filters) {
  return ["query", "source", "locator", "concept", "state"].some((key) => String(filters?.[key] ?? "").trim());
}

/** A one-line description of a search hit's place in the research: source, locators, state. Plain text. */
export function hitContext(hit) {
  const parts = [];
  for (const source of hit.sources || []) parts.push(`${source.label}${source.archived ? " (archived)" : ""}${source.missing ? " (missing)" : ""}`);
  if (hit.entry === "passage" && hit.locators?.length) parts.push(hit.locators[0]);
  if (hit.entry === "note") parts.push(hit.kind === "question" ? (hit.state === "resolved" ? "resolved question" : "open question") : "observation");
  return parts.join(" · ");
}

export const NOTE_KINDS = Object.freeze([
  { kind: "observation", label: "Observation" },
  { kind: "question", label: "Question" },
]);
const MAX_NOTEBOOK_TEXT_CHARS = 20000;
const MAX_PASSAGE_LOCATORS = 8;
const NOTEBOOK_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const codePoints = (value) => [...String(value ?? "")].length;

/** A fresh, readable identifier that no passage or note uses. Passages and notes share one id space. */
export function suggestEntryId(prefix, existingIds = []) {
  const used = new Set(existingIds);
  let number = used.size + 1;
  while (used.has(`${prefix}-${number}`)) number += 1;
  return `${prefix}-${number}`;
}

/** Sources an author may quote or note: not archived, ordered by label. */
export function captureSources(sources) {
  return (Array.isArray(sources) ? sources : [])
    .filter((source) => !source.archived)
    .sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b)));
}

/** One locator per line as `kind: value`, with a range written `kind: value to value`. */
export function parseLocatorLines(value) {
  return textLines(value).map((line) => {
    const cut = line.indexOf(":");
    if (cut < 0) return { kind: "", value: line };
    const kind = line.slice(0, cut).trim().toLowerCase();
    const rest = line.slice(cut + 1).trim();
    const range = rest.indexOf(" to ");
    return range < 0 ? { kind, value: rest } : { kind, value: rest.slice(0, range).trim(), to: rest.slice(range + 4).trim() };
  });
}

export function formatLocatorLines(locators) {
  return (Array.isArray(locators) ? locators : []).map((locator) => `${locator?.kind ?? ""}: ${locator?.value ?? ""}${locator?.to ? ` to ${locator.to}` : ""}`).join("\n");
}

export function parseConceptList(value) {
  return [...new Set(String(value || "").split(/[\s,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

export function passageDraft(record = null, source = "") {
  const passage = record && typeof record === "object" ? record : {};
  return {
    original: record ? structuredClone(record) : null,
    id: typeof passage.id === "string" ? passage.id : "",
    source: typeof passage.source === "string" ? passage.source : source,
    excerpt: typeof passage.excerpt?.text === "string" ? passage.excerpt.text : "",
    language: typeof passage.excerpt?.language === "string" ? passage.excerpt.language : "",
    locators: formatLocatorLines(passage.locators),
  };
}

/** The full passage to send. The excerpt text is sent exactly as typed; unknown stored fields are carried over. */
export function passageDraftPayload(draft) {
  const original = draft.original || {};
  const record = { ...original };
  delete record.locators;
  record.id = String(draft.id || "").trim();
  record.source = draft.source;
  const excerpt = { ...(original.excerpt || {}), text: String(draft.excerpt ?? "") };
  const language = String(draft.language || "").trim();
  if (language) excerpt.language = language;
  else delete excerpt.language;
  record.excerpt = excerpt;
  const locators = keepUnchanged(parseLocatorLines(draft.locators), original.locators, (a, b) => a.kind === b.kind && a.value === b.value && (a.to ?? "") === (b.to ?? ""));
  if (locators.length) record.locators = locators;
  return record;
}

/** A quick, advisory check; the server's validation stays authoritative. */
export function validatePassageDraft(draft, sources = []) {
  if (!draft.source || !sources.some((source) => source.id === draft.source)) return { field: "source", message: "Choose the source this passage comes from." };
  if (!String(draft.excerpt ?? "").trim()) return { field: "excerpt", message: "Enter the quoted text." };
  if (codePoints(draft.excerpt) > MAX_NOTEBOOK_TEXT_CHARS) return { field: "excerpt", message: `A quoted passage is limited to ${MAX_NOTEBOOK_TEXT_CHARS} characters.` };
  const locators = parseLocatorLines(draft.locators);
  if (locators.length > MAX_PASSAGE_LOCATORS) return { field: "locators", message: `A passage may have at most ${MAX_PASSAGE_LOCATORS} locators.` };
  const bad = locators.findIndex((locator) => !locator.kind || !locator.value);
  if (bad >= 0) return { field: "locators", message: `Locator ${bad + 1} must look like page: 514 or canonical: 514a to 520a.` };
  return null;
}

export function noteDraft(record = null) {
  const note = record && typeof record === "object" ? record : {};
  return {
    original: record ? structuredClone(record) : null,
    id: typeof note.id === "string" ? note.id : "",
    kind: typeof note.kind === "string" ? note.kind : "observation",
    text: typeof note.text === "string" ? note.text : "",
    passages: Array.isArray(note.passages) ? [...note.passages] : [],
    sources: Array.isArray(note.sources) ? [...note.sources] : [],
    concepts: (Array.isArray(note.concepts) ? note.concepts : []).join(", "),
    status: note.status === "resolved" ? "resolved" : "open",
  };
}

export function noteDraftPayload(draft) {
  const original = draft.original || {};
  const record = { ...original };
  for (const field of ["passages", "sources", "concepts"]) delete record[field];
  record.id = String(draft.id || "").trim();
  record.kind = draft.kind;
  record.text = String(draft.text ?? "");
  if (draft.passages.length) record.passages = [...draft.passages];
  if (draft.sources.length) record.sources = [...draft.sources];
  const concepts = parseConceptList(draft.concepts);
  if (concepts.length) record.concepts = concepts;
  // Only a question has a state, and a question that never had one stays open without writing it.
  delete record.status;
  if (draft.kind === "question" && (draft.status === "resolved" || (original.status && draft.status))) record.status = draft.status;
  return record;
}

export function validateNoteDraft(draft) {
  if (!String(draft.text ?? "").trim()) return { field: "text", message: "Write the observation or question." };
  if (codePoints(draft.text) > MAX_NOTEBOOK_TEXT_CHARS) return { field: "text", message: `A note is limited to ${MAX_NOTEBOOK_TEXT_CHARS} characters.` };
  if (parseConceptList(draft.concepts).some((concept) => !NOTEBOOK_SLUG.test(concept) || concept.length > 64)) {
    return { field: "concepts", message: "Concepts are lowercase words separated by commas or spaces, such as allegory, the-good." };
  }
  return null;
}

/** Map a server diagnostic's field path to the form control that edits it. */
export function notebookDiagnosticControl(field) {
  const name = String(field || "").replace(/\[\d+\].*$/, "").split(".")[0];
  if (name === "excerpt") return String(field).endsWith("language") ? "language" : "excerpt";
  return { source: "source", locators: "locators", text: "text", kind: "kind", passages: "passages", sources: "sources", concepts: "concepts" }[name] || "";
}

export function notebookErrorMessage(error) {
  const diagnostics = Array.isArray(error?.data?.diagnostics) ? error.data.diagnostics : [];
  if (!diagnostics.length) return error?.data?.error || error?.message || "The research entry could not be saved.";
  return diagnostics.map((item) => `${item.field ? `${item.field}: ` : ""}${item.message}`).join(" ");
}

/** A short plain-text label for a passage or note in lists; never markup. */
export function entryPreview(entry, limit = 90) {
  const text = String(entry?.excerpt?.text ?? entry?.text ?? "").replace(/\s+/g, " ").trim();
  const points = [...text];
  return points.length > limit ? `${points.slice(0, limit - 1).join("")}…` : text;
}

// ---------------------------------------------------------------- citations

export const MAX_CITATION_LOCATORS = 8;
// `[@...]` on one line, not escaped, and not a link (`[@x](url)`, `[@x][ref]`).
// The core scanner (`openblog_core::citations`) is authoritative; this only
// finds the text the editor shows as a citation and reopens for editing.
const CITATION_TEXT = /(?<!\\)\[@[^[\]\n]*\](?![([])/g;
const CITATION_WHOLE = /^\[@[^[\]\n]*\]$/;

function codeSpanRanges(line) {
  const runs = [...line.matchAll(/`+/g)].map((match) => [match.index, match[0].length]);
  const ranges = [];
  for (let index = 0; index < runs.length; index += 1) {
    const [start, length] = runs[index];
    const close = runs.findIndex(([, other], at) => at > index && other === length);
    if (close < 0) continue;
    ranges.push([start, runs[close][0] + length]);
    index = close;
  }
  return ranges;
}

/** Citations written in Markdown, outside fenced code and code spans, with their string offsets. */
export function citationSpans(markdown) {
  const spans = [];
  let offset = 0;
  let fence = null;
  for (const line of String(markdown ?? "").split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = null;
    } else if (marker) fence = marker[1];
    else {
      const code = codeSpanRanges(line);
      for (const match of line.matchAll(CITATION_TEXT)) {
        const start = match.index;
        const end = start + match[0].length;
        if (code.some(([from, to]) => start < to && end > from)) continue;
        if (/^ {0,3}$/.test(line.slice(0, start)) && line[end] === ":") continue; // a reference definition
        spans.push({ start: offset + start, end: offset + end, text: match[0] });
      }
    }
    offset += line.length + 1;
  }
  return spans;
}

/** The citation the selection is inside (or exactly covers), so the dialog edits it instead of adding another. */
export function citationAt(markdown, start, end = start) {
  return citationSpans(markdown).find((span) => (start > span.start && end < span.end) || (start === span.start && end === span.end)) || null;
}

/** How many backslashes come straight before `at`; an odd count escapes the character there. */
function backslashesBefore(line, at) {
  let count = 0;
  while (at - count > 0 && line[at - count - 1] === "\\") count += 1;
  return count;
}

/** Link and image spans on one line of Markdown (`[text](dest)`, `![alt](src)`, `[text][ref]`), with nested brackets, as [start, end] pairs. */
function markdownLinkRanges(line) {
  const ranges = [];
  const escaped = (at) => backslashesBefore(line, at) % 2 === 1;
  const matching = (from, open, close) => {
    let depth = 0;
    for (let index = from; index < line.length; index += 1) {
      if (line[index] === "\\") index += 1;
      else if (line[index] === open) depth += 1;
      else if (line[index] === close && --depth === 0) return index;
    }
    return -1;
  };
  for (let open = line.indexOf("["); open >= 0; open = line.indexOf("[", open + 1)) {
    if (escaped(open)) continue;
    const close = matching(open, "[", "]");
    if (close < 0) continue;
    const end = line[close + 1] === "(" ? matching(close + 1, "(", ")") : line[close + 1] === "[" ? matching(close + 1, "[", "]") : -1;
    if (end >= 0) ranges.push([open > 0 && line[open - 1] === "!" ? open - 1 : open, end + 1]);
  }
  return ranges;
}

/** HTML tag names that start an HTML block (CommonMark type 6), which runs to the next blank line. */
const HTML_BLOCK_TAGS = new Set("address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul".split(" "));
const HTML_ATTRIBUTES = String.raw`(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>\x60]+))?)*`;
const HTML_OPEN_TAG = String.raw`<[A-Za-z][A-Za-z0-9-]*${HTML_ATTRIBUTES}\s*\/?>`;
const HTML_CLOSE_TAG = String.raw`<\/[A-Za-z][A-Za-z0-9-]*\s*>`;
const HTML_TAG_LINE = new RegExp(String.raw`^(?:${HTML_OPEN_TAG}|${HTML_CLOSE_TAG})\s*$`);
const INLINE_HTML = new RegExp(String.raw`<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![A-Za-z][^>]*>|<!\[CDATA\[[\s\S]*?\]\]>|${HTML_OPEN_TAG}|${HTML_CLOSE_TAG}`, "g");
const AUTOLINK = /<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>|<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*>/g;

/** A line without its block quote and list markers, so fences and HTML inside containers are seen too. */
function containerContent(line) {
  return line.replace(/^(?: {0,3}>[ \t]?| {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$))*/, "");
}

/** The width of a line's leading whitespace, with tabs to the next multiple of four. */
function indentWidth(line) {
  let width = 0;
  for (const character of line) {
    if (character === " ") width += 1;
    else if (character === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

/**
 * How an HTML block that starts on this line ends: a test for its closing
 * line, `"blank"` for one that runs to the next blank line, or null when the
 * line starts no HTML block. A lone tag line starts one only after a blank
 * line, since that kind cannot interrupt a paragraph.
 */
function htmlBlockEnd(content, afterBlank) {
  const rest = /^ {0,3}(<.*)$/.exec(content)?.[1];
  if (!rest) return null;
  const raw = /^<(script|pre|style|textarea)(?:\s|>|$)/i.exec(rest);
  if (raw) return (line) => new RegExp(`</${raw[1]}>`, "i").test(line);
  if (rest.startsWith("<!--")) return (line) => line.includes("-->");
  if (rest.startsWith("<?")) return (line) => line.includes("?>");
  if (rest.startsWith("<![CDATA[")) return (line) => line.includes("]]>");
  if (/^<![A-Za-z]/.test(rest)) return (line) => line.includes(">");
  const tag = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s|\/?>|$)/.exec(rest);
  if (tag && HTML_BLOCK_TAGS.has(tag[1].toLowerCase())) return "blank";
  if (afterBlank && HTML_TAG_LINE.test(rest)) return "blank";
  return null;
}

/** Each line of Markdown as `"code"`, `"html"`, `"blank"` or paragraph `"text"`. */
function markdownLineKinds(lines) {
  const kinds = [];
  let fence = null;
  let html = null;
  for (const [index, line] of lines.entries()) {
    const content = containerContent(line);
    const blank = !content.trim();
    const previous = kinds[index - 1];
    const afterBlank = previous !== "text";
    if (fence) {
      const marker = /^\s*(`{3,}|~{3,})\s*$/.exec(content);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      kinds.push("code");
    } else if (html) {
      const closes = html === "blank" ? blank : html(line);
      kinds.push(closes && html === "blank" ? "blank" : "html");
      if (closes) html = null;
    } else if (blank) {
      kinds.push("blank");
    } else {
      const marker = /^\s*(`{3,}|~{3,})/.exec(content);
      const end = htmlBlockEnd(content, afterBlank);
      if (marker && !(marker[1][0] === "`" && content.slice(marker[0].length).includes("`"))) {
        fence = marker[1];
        kinds.push("code");
      } else if (afterBlank && indentWidth(line.replace(/^(?: {0,3}>[ \t]?)*/, "")) >= 4) {
        // Indented code, or a paragraph inside a list item; refusing is the safe side.
        kinds.push("code");
      } else if (end) {
        kinds.push("html");
        if (end === "blank" || !end(line)) html = end;
      } else kinds.push("text");
    }
  }
  return kinds;
}

/**
 * Why a new citation cannot go at `at` in Markdown, where it would not be
 * read as a citation: `"code"` inside fenced or indented code or a code span
 * (also one over several lines), `"html"` inside an HTML block, a comment or
 * a tag, `"link"` inside a link, image, autolink or link reference
 * definition (also over several lines); otherwise `""`. It errs towards
 * refusing: a line it cannot be sure about (such as an indented line after a
 * blank one, which may be code) is refused, and the server checks whatever
 * is inserted.
 */
export function citationInsertionProblem(markdown, at) {
  const lines = String(markdown ?? "").split("\n");
  const kinds = markdownLineKinds(lines);
  let offset = 0;
  for (const [index, line] of lines.entries()) {
    const lineEnd = offset + line.length;
    if (at < offset || at > lineEnd) {
      offset = lineEnd + 1;
      continue;
    }
    const kind = kinds[index];
    if (kind === "code" || kind === "html") return kind;
    if (kind !== "text") return "";
    // The whole paragraph, since code spans, links and HTML cross lines.
    let first = index;
    while (first > 0 && kinds[first - 1] === "text") first -= 1;
    let last = index;
    while (last + 1 < lines.length && kinds[last + 1] === "text") last += 1;
    const start = lines.slice(0, first).reduce((sum, text) => sum + text.length + 1, 0);
    const paragraph = lines.slice(first, last + 1).join("\n");
    const column = at - start;
    const inside = (ranges) => ranges.some(([from, to]) => column > from && column < to);
    const matches = (pattern) => [...paragraph.matchAll(pattern)].map((match) => [match.index, match.index + match[0].length]);
    if (inside(codeSpanRanges(paragraph))) return "code";
    if (inside(matches(INLINE_HTML))) return "html";
    if (inside(matches(AUTOLINK)) || inside(markdownLinkRanges(paragraph))) return "link";
    if (index === first && /^ {0,3}\[(?:[^\]\\]|\\.)+\]:/.test(containerContent(line))) return "link";
    return "";
  }
  return "";
}

/** Read `[@key, kind value to end; ...]` into parts for the dialog. The server re-checks whatever is inserted. */
export function parseCitationText(text) {
  const match = /^\[@([^[\]\n]*)\]$/.exec(String(text ?? ""));
  if (!match) return null;
  const inner = match[1];
  const comma = inner.indexOf(",");
  const key = (comma < 0 ? inner : inner.slice(0, comma)).trim();
  const locators = comma < 0
    ? []
    : inner.slice(comma + 1).split(";").map((part) => {
        const trimmed = part.trim();
        const space = trimmed.search(/\s/);
        const kind = space < 0 ? trimmed : trimmed.slice(0, space);
        const rest = space < 0 ? "" : trimmed.slice(space).trim();
        const range = rest.indexOf(" to ");
        return range < 0 ? { kind, value: rest } : { kind, value: rest.slice(0, range).trim(), to: rest.slice(range + 4).trim() };
      });
  return { key, locators };
}

/** The Markdown a citation is written as; a preview only, since the server returns the text that is inserted. */
export function formatCitationText({ key = "", locators = [] } = {}) {
  return `[@${key}${(locators || []).map((locator, index) => `${index ? "; " : ", "}${locator.kind} ${locator.value}${locator.to ? ` to ${locator.to}` : ""}`).join("")}]`;
}

/** A notebook passage's locators as a citation uses them: kind, value and end only, never other stored fields. */
export function citationLocatorsFromPassage(passage) {
  return (Array.isArray(passage?.locators) ? passage.locators : [])
    .filter((locator) => typeof locator?.kind === "string" && typeof locator?.value === "string")
    .map((locator) => (typeof locator.to === "string" && locator.to ? { kind: locator.kind, value: locator.value, to: locator.to } : { kind: locator.kind, value: locator.value }));
}

export function citationDraftPayload(draft) {
  return {
    key: String(draft.source || ""),
    locators: parseLocatorLines(draft.locators).map((locator) => (locator.to ? { kind: locator.kind, value: locator.value, to: locator.to } : { kind: locator.kind, value: locator.value })),
  };
}

/** A quick, advisory check; the server's core resolver stays authoritative. */
export function validateCitationDraft(draft, sources = []) {
  if (!draft.source) return { field: "source", message: "Choose the source to cite." };
  if (!sources.some((source) => source.id === draft.source)) return { field: "source", message: "That source is not in the library. Choose another." };
  const locators = parseLocatorLines(draft.locators);
  if (locators.length > MAX_CITATION_LOCATORS) return { field: "locators", message: `A citation may have at most ${MAX_CITATION_LOCATORS} locators.` };
  const bad = locators.findIndex((locator) => !locator.kind || !locator.value);
  if (bad >= 0) return { field: "locators", message: `Locator ${bad + 1} must look like page: 514 or canonical: 514a to 520a.` };
  return null;
}

/**
 * Insert citation Markdown into a draft. A `replace` span (a citation being
 * edited) is replaced; otherwise the citation goes at the end of the
 * selection, after a space when it would touch a word, and the selected text
 * stays. The caret lands after the citation. Nothing else in the draft moves.
 */
export function insertCitationText(value, start, end, markdown, replace = null) {
  const text = String(value ?? "");
  if (replace) {
    const next = text.slice(0, replace.start) + markdown + text.slice(replace.end);
    const caret = replace.start + markdown.length;
    return { value: next, start: caret, end: caret };
  }
  const at = Math.max(0, Math.min(text.length, Math.max(start, end)));
  const before = text.slice(0, at);
  const inserted = (before && !/[\s([]$/.test(before) ? " " : "") + markdown;
  const caret = at + inserted.length;
  // A `(` or `[` right after the citation would make it read as a link.
  const after = /^[([]/.test(text.slice(at)) ? " " : "";
  return { value: before + inserted + after + text.slice(at), start: caret, end: caret };
}

/** Sources the picker offers for a search: live sources, plus the one already chosen even if archived. */
export function citationSourceChoices(sources, query = "", keep = "") {
  return filterSources(sources, { query, archived: "all" })
    .filter((source) => !source.archived || source.id === keep)
    .sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b)));
}

/** What a citation check failure means for the author, and which field it belongs to. */
export function citationFailure(error) {
  const diagnostics = Array.isArray(error?.data?.diagnostics) ? error.data.diagnostics : [];
  if (error?.status === 409) return { field: "source", message: error?.data?.error || "The source library changed. Review the refreshed sources and insert again." };
  if (!diagnostics.length) return { field: "", message: `The citation could not be checked. Your draft is unchanged. ${error?.data?.error || error?.message || ""}`.trim() };
  const field = diagnostics.some((item) => ["invalid-key", "unknown-key"].includes(item.code)) ? "source" : "locators";
  return { field, message: diagnostics.map((item) => item.message).join(" ") };
}

/**
 * The citation picker: search the library, choose a source (or start from a
 * notebook passage, which copies only its locators' kind, value and end),
 * add optional locators, and check the result with the server, which runs
 * the core parser and resolver. `state` is { revision, sources, passages,
 * notebookAvailable } and is refreshed in place when the library is stale.
 * Nothing changes the draft until `onInsert` receives the checked citation.
 */
export function createCitationForm({ api, state, initial = null, idPrefix = "oba-citation", onInsert, onCancel, refuse = null }) {
  const editing = Boolean(initial);
  const draft = { source: initial?.key || "", locators: formatLocatorLines(initial?.locators || []), query: "" };
  let busy = false;
  const root = h("form", { class: "oba-capture-form oba-citation-form", novalidate: true });
  const errorBox = h("p", { class: "oba-error", id: `${idPrefix}-error`, role: "alert", hidden: true, tabindex: "-1" });
  const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
  const field = (name, labelText, input, hint) => {
    input.id = `${idPrefix}-${name}`;
    if (hint) {
      input.setAttribute("aria-describedby", `${idPrefix}-${name}-hint`);
      input.setAttribute("data-hint-id", `${idPrefix}-${name}-hint`);
    }
    return h("div", { class: "oba-field", "data-citation-field": name }, h("label", { for: input.id }, labelText), input, hint ? h("p", { class: "oba-small", id: `${idPrefix}-${name}-hint` }, hint) : null);
  };
  const sourceById = (id) => (state.sources || []).find((source) => source.id === id);
  const search = h("input", { type: "search", autocomplete: "off", spellcheck: "false", onInput: (event) => { draft.query = event.target.value; renderSources(); } });
  const sourceList = h("select", { size: 6, onChange: (event) => { draft.source = event.target.value; renderPreview(); } });
  const passageList = h("select", { onChange: (event) => usePassage(event.target.value) });
  const locators = h("textarea", { rows: 3, spellcheck: "false", value: draft.locators, onInput: (event) => { draft.locators = event.target.value; renderPreview(); } });
  const preview = h("output", { class: "oba-citation-preview", id: `${idPrefix}-preview`, "aria-live": "polite" });
  const save = h("button", { class: "oba-btn oba-btn-primary", type: "submit", "data-citation-insert": "true" }, editing ? "Update citation" : "Insert citation");
  const cancel = h("button", { class: "oba-btn", type: "button", "data-citation-cancel": "true", onClick: () => onCancel?.() }, "Cancel");

  const renderSources = () => {
    const choices = citationSourceChoices(state.sources, draft.query, draft.source);
    const chosen = sourceById(draft.source);
    // The chosen source stays listed while a search hides it, so the choice is never lost silently.
    if (chosen && !choices.includes(chosen)) choices.unshift(chosen);
    const label = (source) => `${sourceLabel(source)}${source.archived ? " (archived)" : ""} (${source.kind}, ${source.id})`;
    sourceList.replaceChildren(...choices.map((source) => h("option", { value: source.id, selected: source.id === draft.source }, label(source))));
    status.textContent = `${choices.length} source${choices.length === 1 ? "" : "s"} shown.`;
    renderPreview();
  };
  const renderPassages = () => {
    const passages = Array.isArray(state.passages) ? state.passages : [];
    const label = (passage) => {
      const where = formatLocatorLines(citationLocatorsFromPassage(passage)).split("\n")[0];
      return `${sourceLabel(sourceById(passage.source) || { id: passage.source })} — ${entryPreview({ text: passage.preview }, 60)}${where ? ` (${where})` : ""}`;
    };
    passageList.replaceChildren(h("option", { value: "" }, passages.length ? "Choose a passage" : "No passages yet"), ...passages.map((passage) => h("option", { value: passage.id }, label(passage))));
    passageList.disabled = !passages.length;
  };
  const usePassage = (id) => {
    const passage = (state.passages || []).find((item) => item.id === id);
    if (!passage) return;
    draft.source = passage.source;
    draft.locators = formatLocatorLines(citationLocatorsFromPassage(passage));
    locators.value = draft.locators;
    renderSources();
    status.textContent = "Source and locators copied from the passage. The quotation and any notes stay private.";
  };
  const renderPreview = () => {
    preview.textContent = draft.source ? formatCitationText(citationDraftPayload(draft)) : "Choose a source to preview the citation.";
  };
  const control = (name) => ({ source: sourceList, locators, search })[name] || null;
  const clearInvalid = () => {
    for (const target of [sourceList, locators]) {
      target.removeAttribute("aria-invalid");
      target.setAttribute("aria-describedby", target.getAttribute("data-hint-id") || "");
    }
  };
  const fail = (message, name = "") => {
    errorBox.hidden = false;
    errorBox.textContent = message;
    const target = control(name);
    if (target) {
      target.setAttribute("aria-invalid", "true");
      target.setAttribute("aria-describedby", [target.getAttribute("data-hint-id"), errorBox.id].filter(Boolean).join(" "));
      target.focus();
    } else errorBox.focus();
  };

  root.append(
    field("search", "Search sources", search, "Matches titles, creators, identifiers and keys."),
    field("source", "Source", sourceList, "From your private source library. Only its key is written into the post."),
    state.notebookAvailable === false
      ? h("p", { class: "oba-notice", "data-citation-notebook": "unavailable" }, "The research notebook could not be read, so passages are not offered. You can still cite any source.")
      : field("passage", "Start from a notebook passage (optional)", passageList, "Copies the passage's source and locators. Its quotation and notes are not inserted."),
    field("locators", "Locators (optional)", locators, "One per line as kind: value, such as page: 514, folio: 12r, or canonical: 514a to 520a."),
    h("p", { class: "oba-small" }, "Citation: ", preview),
    errorBox,
    h("div", { class: "oba-toolbar" }, save, cancel),
    status,
  );
  renderPassages();
  renderSources();

  root.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    errorBox.hidden = true;
    clearInvalid();
    const problem = validateCitationDraft(draft, state.sources);
    if (problem) return fail(problem.message, problem.field);
    const refused = refuse?.();
    if (refused) return fail(refused);
    busy = true;
    save.disabled = true;
    status.textContent = "Checking the citation…";
    try {
      const result = await api.call("POST", "citations/check", { json: { revision: state.revision, citation: citationDraftPayload(draft) } });
      busy = false;
      save.disabled = false;
      status.textContent = "";
      // The caller may still refuse (say, the draft cannot take it there); the dialog then stays open with every choice.
      const declined = onInsert?.(result);
      if (typeof declined === "string" && declined) fail(declined);
    } catch (error) {
      busy = false;
      save.disabled = false;
      if (error?.status === 409 && typeof error.data?.revision === "string") {
        state.revision = error.data.revision;
        if (Array.isArray(error.data.sources)) state.sources = error.data.sources;
        renderSources();
      }
      const failure = citationFailure(error);
      status.textContent = "";
      fail(failure.message, failure.field);
    }
  });

  return {
    element: root,
    focus: () => (editing ? sourceList : search).focus(),
  };
}

/** Child indexes from `root` down to `node`, so a caret can be found again in a restored copy of the editor. */
function nodePath(root, node) {
  const path = [];
  for (let current = node; current && current !== root; current = current.parentNode) {
    if (!current.parentNode) return null;
    path.unshift([...current.parentNode.childNodes].indexOf(current));
  }
  return path;
}

function nodeAtPath(root, path) {
  if (!Array.isArray(path)) return null;
  let node = root;
  for (const index of path) node = node?.childNodes?.[index];
  return node || null;
}

/** An atomic, keyboard-reachable chip for a citation in the visual editor. Its Markdown is kept verbatim. */
export function citationChip(text) {
  return h(
    "span",
    {
      class: "oba-citation",
      contenteditable: "false",
      tabindex: "0",
      role: "button",
      "data-citation": text,
      "aria-label": `Citation ${String(text).slice(2, -1)}. Press Enter to edit.`,
      title: "Edit citation",
    },
    text,
  );
}

/**
 * Why a chip cannot go inside a visual-editor element: `"link"` inside a link
 * (its text would hold `[@...]` and stop being a citation), `"code"` inside
 * code, a protected block or another chip; otherwise `""`.
 */
function visualCitationContainerProblem(element) {
  if (!element?.closest) return "code";
  if (element.closest("pre, code, .oba-protected-block, .oba-citation")) return "code";
  if (element.closest("a")) return "link";
  return "";
}

/** Replace `start..end` of a text node with a chip for that text, keeping the text around it. */
function replaceTextWithChip(node, start, end) {
  const text = node.nodeValue;
  const chip = citationChip(text.slice(start, end));
  const parts = [text.slice(0, start), chip, text.slice(end)].filter((part) => part !== "").map((part) => (typeof part === "string" ? document.createTextNode(part) : part));
  node.replaceWith(...parts);
  return chip;
}

/** Put the caret straight after a node and remember it as the editor's visual selection. */
function placeCaretAfter(node, editor) {
  const selection = globalThis.getSelection?.();
  const caret = document.createRange?.();
  if (!selection || !caret) return;
  caret.setStartAfter(node);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  editor.visualSelection = caret.cloneRange();
}

/**
 * The capture form shared by the research notebook view and the editor's
 * capture dialog. It edits one passage (optionally with a first note about it)
 * or one note. `state` is the notebook as last read ({ revision, sources,
 * passages, notes }) and is updated in place after every save or conflict.
 * Nothing is saved until the author submits, and every server message reaches
 * the page as text.
 */
export function createCaptureForm({ api, state, entry = null, entryType = "passage", prefill = {}, idPrefix = "oba-capture", onSaved, onCancel, onRefreshed }) {
  let type = entry ? entryType : prefill.type === "note" ? "note" : "passage";
  const editing = Boolean(entry);
  let passage = type === "passage" ? passageDraft(editing ? entry : null, prefill.source || "") : passageDraft(null, prefill.source || "");
  let note = type === "note" ? noteDraft(editing ? entry : null) : noteDraft();
  if (!editing) passage.excerpt = prefill.excerpt || "";
  let followUp = { text: "", kind: "observation" };
  let busy = false;
  // null, or { current } once a save of an existing entry hit a newer notebook:
  // the author must choose before anything is sent again.
  let conflict = null;
  let touched = false;
  const root = h("form", { class: "oba-capture-form", novalidate: true });
  const errorBox = h("p", { class: "oba-error", id: `${idPrefix}-error`, role: "alert", hidden: true, tabindex: "-1" });
  const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
  const control = (name) => root.querySelector(`#${idPrefix}-${name}`);

  const field = (name, labelText, input, hint) => {
    input.id = `${idPrefix}-${name}`;
    if (hint) {
      input.setAttribute("aria-describedby", `${idPrefix}-${name}-hint`);
      input.setAttribute("data-hint-id", `${idPrefix}-${name}-hint`);
    }
    return h("div", { class: "oba-field", "data-capture-field": name }, h("label", { for: input.id }, labelText), input, hint ? h("p", { class: "oba-small", id: `${idPrefix}-${name}-hint` }, hint) : null);
  };
  const fail = (message, name = "") => {
    errorBox.hidden = false;
    errorBox.textContent = message;
    const target = name ? control(name) : null;
    if (target) {
      target.setAttribute("aria-invalid", "true");
      // The hint stays; the error is added to it, never in its place.
      target.setAttribute("aria-describedby", [target.getAttribute("data-hint-id"), errorBox.id].filter(Boolean).join(" "));
      target.focus();
    } else errorBox.focus();
  };
  const clearInvalid = () => {
    for (const target of root.querySelectorAll("[aria-invalid]")) {
      target.removeAttribute("aria-invalid");
      const hint = target.getAttribute("data-hint-id");
      if (hint) target.setAttribute("aria-describedby", hint);
      else target.removeAttribute("aria-describedby");
    }
  };
  // Archived sources are not offered for new choices, but an entry being
  // edited keeps the source(s) it already has, marked as archived.
  const keptSources = editing ? [entry.source, ...(Array.isArray(entry.sources) ? entry.sources : [])].filter(Boolean) : [];
  const sourceChoices = () => {
    const live = captureSources(state.sources);
    const archived = (state.sources || []).filter((source) => source.archived && keptSources.includes(source.id));
    const label = (source) => `${sourceLabel(source)}${source.archived ? " (archived)" : ""} (${source.kind})`;
    return [...live, ...archived].map((source) => ({ id: source.id, label: label(source) }));
  };
  const sourceSelect = (current, onPick) =>
    h(
      "select",
      { onChange: (event) => onPick(event.target.value) },
      h("option", { value: "", selected: !current }, "Choose a source"),
      sourceChoices().map((source) => h("option", { value: source.id, selected: current === source.id }, source.label)),
    );
  const checkList = (name, legend, options, chosen, onToggle) =>
    h(
      "fieldset",
      { class: "oba-capture-checks", id: `${idPrefix}-${name}`, tabindex: "-1" },
      h("legend", {}, legend),
      options.length
        ? options.map(([value, label]) => {
            const id = `${idPrefix}-${name}-${value}`;
            return h("div", { class: "oba-capture-check" }, h("input", { id, type: "checkbox", value, checked: chosen.includes(value), onChange: (event) => onToggle(value, event.target.checked) }), h("label", { for: id }, label));
          })
        : h("p", { class: "oba-small" }, "None yet."),
    );

  const conflictNotice = () => {
    if (!editing) return h("p", { class: "oba-notice", role: "alert", "data-capture-conflict": "true" }, "The notebook changed after you opened it, so nothing was saved. Your draft is still here; save again to add it to the latest notebook.");
    const removed = !conflict.current;
    return h(
      "div",
      { class: "oba-notice", role: "alert", "data-capture-conflict": "true" },
      h("p", {}, removed ? "This entry was removed from the notebook after you opened it, so nothing was saved. Your draft is still here." : "This entry was changed after you opened it, so nothing was saved. Your draft is still here. Choose which copy to continue with; nothing is overwritten until you save."),
      h(
        "div",
        { class: "oba-toolbar" },
        h("button", { class: "oba-btn", type: "button", "data-capture-conflict-use": "stored", onClick: () => resolveConflict(true) }, removed ? "Discard my draft" : "Use the stored copy"),
        removed ? null : h("button", { class: "oba-btn", type: "button", "data-capture-conflict-use": "draft", onClick: () => resolveConflict(false) }, "Keep my draft"),
      ),
    );
  };

  const resolveConflict = (useStored) => {
    if (!conflict) return;
    const { current } = conflict;
    conflict = null;
    errorBox.hidden = true;
    clearInvalid();
    if (useStored) {
      if (!current) {
        touched = false;
        onCancel?.();
        return;
      }
      if (type === "passage") passage = passageDraft(current);
      else note = noteDraft(current);
      touched = false;
      say("Showing the stored copy.");
    } else {
      // The author has seen the newer copy: the draft now rests on it, and its unknown fields carry over.
      const draft = type === "passage" ? passage : note;
      draft.original = structuredClone(current);
      say("Your draft now rests on the latest copy. Review it, then save.");
    }
    render();
    (root.querySelector(type === "passage" ? `#${idPrefix}-excerpt` : `#${idPrefix}-text`) || root.querySelector("[data-capture-save]"))?.focus();
  };

  const render = () => {
    const fields = [];
    if (!editing) {
      fields.push(
        h(
          "fieldset",
          { class: "oba-capture-type" },
          h("legend", {}, "Capture"),
          [["passage", "A passage from a source"], ["note", "A note"]].map(([value, label]) => {
            const id = `${idPrefix}-type-${value}`;
            return h("span", { class: "oba-capture-check" }, h("input", { id, type: "radio", name: `${idPrefix}-type`, value, checked: type === value, onChange: () => { type = value; render(); control(`type-${value}`)?.focus(); } }), h("label", { for: id }, label));
          }),
        ),
      );
    }
    if (type === "passage") {
      fields.push(
        field("source", "Source", sourceSelect(passage.source, (value) => { passage.source = value; }), editing ? "A passage keeps the source it was quoted from. Record a quotation from another source as a new passage." : "From your private source library."),
        field("excerpt", "Quoted text", h("textarea", { rows: 5, value: passage.excerpt, spellcheck: "false", onInput: (event) => { passage.excerpt = event.target.value; } }), "Stored exactly as written and shown only as text. It is someone else's words, kept apart from your own."),
        field("language", "Language (optional)", h("input", { type: "text", value: passage.language, autocomplete: "off", spellcheck: "false", onInput: (event) => { passage.language = event.target.value; } }), "A language tag such as en or grc."),
        field("locators", "Locators (optional)", h("textarea", { rows: 3, value: passage.locators, spellcheck: "false", onInput: (event) => { passage.locators = event.target.value; } }), "One per line as kind: value, such as page: 514, folio: 12r, or canonical: 514a to 520a."),
      );
      if (!editing) {
        fields.push(
          h(
            "fieldset",
            { class: "oba-capture-follow" },
            h("legend", {}, "Add a note about this passage (optional)"),
            field("follow-kind", "Note type", h("select", { onChange: (event) => { followUp.kind = event.target.value; } }, NOTE_KINDS.map((item) => h("option", { value: item.kind, selected: followUp.kind === item.kind }, item.label)))),
            field("follow-text", "Note", h("textarea", { rows: 3, value: followUp.text, onInput: (event) => { followUp.text = event.target.value; } }), "Your own words. Leave empty to save the passage alone."),
          ),
        );
      }
    } else {
      fields.push(
        field("kind", "Note type", h("select", { onChange: (event) => { note.kind = event.target.value; render(); control("kind")?.focus(); } }, NOTE_KINDS.map((item) => h("option", { value: item.kind, selected: note.kind === item.kind }, item.label)))),
        note.kind === "question"
          ? field("status", "Question state", h("select", { onChange: (event) => { note.status = event.target.value; } }, QUESTION_STATES.map((item) => h("option", { value: item.value, selected: note.status === item.value }, item.label))), "Open questions are listed as unresolved in the notebook. Resolving one is your call; nothing checks the answer.")
          : null,
        field("text", "Note", h("textarea", { rows: 5, value: note.text, onInput: (event) => { note.text = event.target.value; } }), "Your own observation or question. Quoted text belongs in a passage."),
        checkList("passages", "Passages this note is about (optional)", state.passages.map((item) => [item.id, `${entryPreview(item, 60)} (${item.id})`]), note.passages, (value, on) => { note.passages = on ? [...note.passages, value] : note.passages.filter((id) => id !== value); }),
        checkList("sources", "Sources this note is about (optional)", sourceChoices().map((item) => [item.id, item.label]), note.sources, (value, on) => { note.sources = on ? [...note.sources, value] : note.sources.filter((id) => id !== value); }),
        field("concepts", "Concepts (optional)", h("input", { type: "text", value: note.concepts, autocomplete: "off", spellcheck: "false", onInput: (event) => { note.concepts = event.target.value; } }), "Lowercase words separated by commas, such as allegory, the-good."),
      );
    }
    const noSources = type === "passage" && !sourceChoices().length;
    const save = h("button", { class: "oba-btn oba-btn-primary", type: "submit", "data-capture-save": "true", disabled: busy || noSources || Boolean(conflict && editing) }, editing ? "Save changes" : "Save to notebook");
    const cancel = h("button", { class: "oba-btn", type: "button", "data-capture-cancel": "true", onClick: () => onCancel?.() }, "Cancel");
    root.replaceChildren(
      ...fields,
      noSources ? h("p", { class: "oba-notice" }, "Add a source to the library first, then capture passages from it. ", h("a", { href: "#/sources" }, "Open sources")) : null,
      errorBox,
      conflict ? conflictNotice() : null,
      h("div", { class: "oba-toolbar" }, save, cancel),
      status,
    );
  };

  const say = (text, kind = "oba-small") => {
    status.className = kind;
    status.textContent = text;
  };

  const refresh = async () => {
    const latest = await api.call("GET", "research/notebook");
    Object.assign(state, { revision: latest.revision, sources: latest.sources, passages: latest.passages, notes: latest.notes });
  };

  const send = async (method, path, key, payload) => {
    const result = await api.call(method, path, { json: { revision: state.revision, [key]: payload } });
    Object.assign(state, { revision: result.revision, sources: result.sources, passages: result.passages, notes: result.notes });
    return result;
  };

  root.addEventListener("input", () => { touched = true; });
  root.addEventListener("change", () => { touched = true; });
  root.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    if (conflict && editing) {
      fail("Choose the stored copy or keep your draft before saving.");
      return;
    }
    errorBox.hidden = true;
    clearInvalid();
    conflict = null;
    let problem;
    if (type === "passage") {
      problem = validatePassageDraft(passage, state.sources);
      if (!problem && !editing && followUp.text.trim()) problem = validateNoteDraft({ text: followUp.text, concepts: "" });
      if (problem && !["source", "excerpt", "locators"].includes(problem.field)) problem = { ...problem, field: "follow-text" };
    } else problem = validateNoteDraft(note);
    if (problem) return fail(problem.message, problem.field);
    busy = true;
    root.querySelector("[data-capture-save]")?.setAttribute("disabled", "");
    let saved = null;
    try {
      if (type === "passage") {
        if (!editing) passage.id = suggestEntryId("passage", [...state.passages, ...state.notes].map((item) => item.id));
        say("Saving…");
        const result = await send(editing ? "PUT" : "POST", "research/passages", "passage", passageDraftPayload(passage));
        saved = result;
        let savedNote = null;
        if (!editing && followUp.text.trim()) {
          const draft = noteDraft();
          draft.id = suggestEntryId("note", [...state.passages, ...state.notes].map((item) => item.id));
          draft.kind = followUp.kind;
          draft.text = followUp.text;
          draft.passages = [result.passage.id];
          draft.sources = [];
          savedNote = (await send("POST", "research/notes", "note", noteDraftPayload(draft))).note;
        }
        busy = false;
        onSaved?.({ type: "passage", passage: result.passage, note: savedNote, build: result.build });
      } else {
        if (!editing) note.id = suggestEntryId("note", [...state.passages, ...state.notes].map((item) => item.id));
        say("Saving…");
        const result = await send(editing ? "PUT" : "POST", "research/notes", "note", noteDraftPayload(note));
        busy = false;
        onSaved?.({ type: "note", note: result.note });
      }
    } catch (error) {
      busy = false;
      if (saved) {
        // The passage is stored and only the follow-up note failed: carry on
        // as a note about that passage so the author can retry without
        // quoting the passage twice.
        type = "note";
        note = noteDraft();
        note.kind = followUp.kind;
        note.text = followUp.text;
        note.passages = [saved.passage.id];
        say("");
        render();
        fail(`The passage was saved, but the note was not. ${notebookErrorMessage(error)} Fix it and save again, or cancel to keep only the passage.`, notebookDiagnosticControl(error.data?.diagnostics?.[0]?.field));
        onSaved?.({ type: "passage", passage: saved.passage, note: null, partial: true });
        return;
      }
      if (error.status === 409 && error.data?.conflict) {
        try {
          await refresh();
        } catch {
          // The next save reports whatever is wrong.
        }
        conflict = { current: error.data.current ?? null };
        say("Not saved: the notebook changed elsewhere.", "oba-error");
        render();
        onRefreshed?.();
        (editing ? root.querySelector("[data-capture-conflict-use]") : root.querySelector("[data-capture-save]"))?.focus();
        return;
      }
      say("Not saved. The stored notebook is unchanged.", "oba-error");
      render();
      const first = error.data?.diagnostics?.[0];
      fail(notebookErrorMessage(error), first ? notebookDiagnosticControl(first.field) : "");
    }
  });

  render();
  return {
    element: root,
    isDirty: () => touched && !busy,
    focus() {
      (root.querySelector(type === "passage" && !passage.source ? `#${idPrefix}-source` : `#${idPrefix}-${type === "passage" ? "excerpt" : "text"}`) || root.querySelector("input,select,textarea,button"))?.focus();
    },
  };
}

// ---------------------------------------------------------------- knowledge atlas

export const ATLAS_ENTRY_KINDS = Object.freeze([
  { kind: "person", label: "Person" },
  { kind: "work", label: "Work" },
  { kind: "concept", label: "Concept" },
  { kind: "movement", label: "Movement" },
  { kind: "event", label: "Event" },
]);
/** How firmly the asserting party holds a relationship; never how widely it is accepted. */
export const ATLAS_CONFIDENCE = Object.freeze([
  { value: "tentative", label: "Tentative" },
  { value: "plausible", label: "Plausible" },
  { value: "strong", label: "Strong" },
]);
export const ATLAS_ATTRIBUTIONS = Object.freeze([
  { kind: "author", label: "You, the author" },
  { kind: "source", label: "A source in your library" },
  { kind: "named", label: "A named person or group" },
]);
const MAX_ATLAS_SHORT_CHARS = 200;
const MAX_ATLAS_SUMMARY_CHARS = 20000;
const MAX_ATLAS_UNCERTAINTY_CHARS = 2000;
const MAX_ATLAS_ALIASES = 20;
const MAX_ATLAS_EVIDENCE = 20;
const MAX_ATLAS_DISSENTS = 20;
const sameLocator = (a, b) => a.kind === b.kind && a.value === b.value && (a.to ?? "") === (b.to ?? "");
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export const atlasKindLabel = (kind) => ATLAS_ENTRY_KINDS.find((item) => item.kind === kind)?.label || String(kind || "Entry");

/** The atlas identifier rule: a lowercase ASCII slug of at most 64 bytes. */
export function validAtlasId(value) {
  const text = String(value ?? "");
  return text.length <= 64 && NOTEBOOK_SLUG.test(text);
}

/** A readable identifier made from a label that nothing in the atlas uses yet. */
export function suggestAtlasId(text, used = [], fallback = "entry") {
  const taken = new Set(used);
  let base = String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56)
    .replace(/-+$/, "");
  if (!base) base = fallback;
  if (!taken.has(base)) return base;
  let number = 2;
  while (taken.has(`${base}-${number}`)) number += 1;
  return `${base}-${number}`;
}

const foldAtlasText = (value) => String(value ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

/** Entries of one kind (or any) whose id, label or other names contain every word of the query. */
export function atlasFilterEntries(entries, { query = "", kind = "" } = {}) {
  const words = foldAtlasText(query).split(" ").filter(Boolean);
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (kind && entry.kind !== kind) return false;
    if (!words.length) return true;
    const haystack = foldAtlasText([entry.id, entry.label, ...(entry.aliases || [])].join(" "));
    return words.every((word) => haystack.includes(word));
  });
}

export function atlasKindSpec(kinds, kind) {
  return (kinds?.relationships || []).find((item) => item.kind === kind) || null;
}

/**
 * Entries that may stand at one end (`from` or `to`) of a relationship kind,
 * read from the server's table of endpoint kinds. `other` is the entry chosen
 * for the opposite end: it is never offered (no self-relationships) and it
 * narrows a kind that joins two entries of one kind. With no kind chosen,
 * every other entry is offered.
 */
export function atlasEndpointChoices(kinds, kind, end, entries, other = null) {
  const spec = atlasKindSpec(kinds, kind);
  const allowed = spec ? new Set(end === "from" ? spec.from : spec.to) : null;
  return (Array.isArray(entries) ? entries : []).filter(
    (entry) => (!allowed || allowed.has(entry.kind)) && (!spec?.sameKind || !other || entry.kind === other.kind) && (!other || entry.id !== other.id),
  );
}

export function atlasEntryName(entries, id) {
  const entry = (entries || []).find((item) => item.id === id);
  return entry ? entry.label : `${id} (missing)`;
}

/** Who holds a position, as plain text. */
export function atlasAttributionText(attribution, sources = []) {
  if (attribution?.kind === "source") {
    const source = (sources || []).find((item) => item.id === attribution.source);
    return `the source ${source ? sourceLabel(source) : attribution.source}`;
  }
  if (attribution?.kind === "named") return String(attribution.name || "an unnamed party");
  return "you (the author)";
}

/**
 * A relationship's standing as text. It is derived from recorded dissent only:
 * asserted, or contested by named parties. There is no wording for agreement,
 * because nothing in the atlas can establish it.
 */
export function atlasStandingText(relationship, sources = []) {
  const dissents = Array.isArray(relationship?.contestedBy) ? relationship.contestedBy : [];
  if (!dissents.length) return "Asserted; no recorded dissent";
  return `Contested: ${plural(dissents.length, "recorded dissent")} (by ${dissents.map((dissent) => atlasAttributionText(dissent.by, sources)).join("; ")})`;
}

export function atlasConfidenceText(relationship) {
  const confidence = ATLAS_CONFIDENCE.find((item) => item.value === (relationship?.confidence || "tentative")) || ATLAS_CONFIDENCE[0];
  return `${confidence.label} confidence, as held by the asserting party`;
}

export function atlasEvidenceText(relationship) {
  if (relationship?.unsourced) return "Unsourced draft: no evidence cited yet";
  return `Rests on ${plural(relationship?.evidence?.length || 0, "piece")} of evidence`;
}

/** The relationship read in its stored direction, such as "Plato authored Politeia". */
export function atlasRelationshipSentence(relationship, entries = []) {
  return `${atlasEntryName(entries, relationship.from)} ${String(relationship.kind || "").replace(/-/g, " ")} ${atlasEntryName(entries, relationship.to)}`;
}

/** Map a server diagnostic's field path to the atlas form control that edits it. */
export function atlasDiagnosticControl(field, type = "entry") {
  const path = String(field || "");
  const name = path.replace(/\[\d+\].*$/, "").split(".")[0];
  const evidenceControl = (prefix, rest) => {
    const found = rest.match(/^evidence\[(\d+)\]\.?(source|passage|locators)?/);
    return found ? `${prefix}evidence-${found[1]}-${found[2] || "source"}` : "";
  };
  const party = (prefix, rest) => (rest.endsWith("source") ? `${prefix}-source` : rest.endsWith("name") ? `${prefix}-name` : prefix);
  if (name === "dates") {
    const dating = path.match(/^dates\[(\d+)\](?:\.(.*))?$/);
    if (!dating) return "dates";
    const [, index, rest = ""] = dating;
    const prefix = `dating-${index}`;
    if (["id", "aspect", "confidence", "unsourced", "note"].includes(rest)) return `${prefix}-${rest}`;
    if (rest === "visibility") return `${prefix}-approved`;
    if (rest.startsWith("assertedBy")) return party(`${prefix}-asserted`, rest);
    if (rest.startsWith("evidence")) return evidenceControl(`${prefix}-`, rest) || `${prefix}-evidence`;
    const date = rest.match(/^date(?:\.(at|from|to|notBefore|notAfter|unknown|relative)(?:\.(\w+))?)?/);
    if (!date) return prefix;
    const [, slot, key] = date;
    if (!slot || slot === "unknown") return `${prefix}-form`;
    if (slot === "relative") return `${prefix}-relative-${["order", "entry", "aspect"].includes(key) ? key : "entry"}`;
    const base = `${prefix}-${DATE_SLOT_IDS[slot]}`;
    if (["month", "day", "calendar", "circa"].includes(key)) return `${base}-${key}`;
    if (["year", "decade", "century"].includes(key)) return `${base}-value`;
    return `${base}-precision`;
  }
  if (type === "entry") return { id: "id", kind: "kind", label: "label", aliases: "aliases", summary: "summary", source: "source", visibility: "approved" }[name] || "";
  const dissent = path.match(/^contestedBy\[(\d+)\](?:\.(.*))?$/);
  if (dissent) {
    const [, index, rest = ""] = dissent;
    if (rest.startsWith("by")) return party(`dissent-${index}`, rest);
    if (rest === "note") return `dissent-${index}-note`;
    return evidenceControl(`dissent-${index}-`, rest) || `dissent-${index}`;
  }
  if (name === "contestedBy") return "contested";
  if (name === "assertedBy") return party("asserted", path);
  if (name === "evidence") return evidenceControl("", path) || "evidence";
  return { id: "kind", kind: "kind", from: "from", to: "to", confidence: "confidence", unsourced: "unsourced", uncertainty: "uncertainty", visibility: "approved" }[name] || "";
}

/** Server diagnostics as one line of text; a cycle or a blocking relationship names the relationship. */
/** What a save or removal did to the published site, when the site publishes its atlas. */
export function atlasBuildText(build) {
  if (!build || typeof build !== "object") return "";
  if (build.ok) return " The published Knowledge Atlas was rebuilt.";
  return ` The change is saved, but the site could not be rebuilt: ${String(build.error || "unknown error")}`;
}

export function atlasErrorMessage(error) {
  const diagnostics = Array.isArray(error?.data?.diagnostics) ? error.data.diagnostics : [];
  if (!diagnostics.length) return error?.data?.error || error?.message || "The atlas could not be changed.";
  return diagnostics
    .map((item) => `${item.id && ["cycle", "still-linked"].includes(item.code) ? `Relationship ${item.id}: ` : ""}${item.field ? `${item.field}: ` : ""}${item.message}`)
    .join(" ");
}

/** Copy the parts of an atlas response that describe the stored atlas into the view state. */
export function applyAtlasState(state, result) {
  for (const key of ["revision", "file", "entries", "relationships", "sources", "passages", "kinds", "notices", "chronology", "missingConcepts"]) {
    if (result && result[key] !== undefined) state[key] = result[key];
  }
  for (const key of ["entries", "relationships", "sources", "passages", "notices", "missingConcepts"]) if (!Array.isArray(state[key])) state[key] = [];
  if (!state.chronology || typeof state.chronology !== "object") state.chronology = { timeline: [], prompts: [], unlisted: 0 };
  return state;
}

function atlasAttributionDraft(record) {
  const value = record && typeof record === "object" ? record : { kind: "author" };
  return {
    original: structuredClone(value),
    kind: ["author", "source", "named"].includes(value.kind) ? value.kind : "author",
    source: typeof value.source === "string" ? value.source : "",
    name: typeof value.name === "string" ? value.name : "",
  };
}

function atlasAttributionPayload(draft) {
  const record = { ...draft.original };
  delete record.source;
  delete record.name;
  record.kind = draft.kind;
  if (draft.kind === "source") record.source = draft.source;
  if (draft.kind === "named") record.name = String(draft.name ?? "").trim();
  return record;
}

/** `from` is the item's index in the stored list it was read from, or null for a new item. */
export function atlasEvidenceDraft(record = {}, from = null) {
  const value = record && typeof record === "object" ? record : {};
  return { original: structuredClone(value), from: Number.isInteger(from) ? from : null, source: typeof value.source === "string" ? value.source : "", passage: typeof value.passage === "string" ? value.passage : "", locators: formatLocatorLines(value.locators) };
}

function atlasEvidencePayload(draft) {
  const original = draft.original || {};
  const record = { ...original };
  delete record.locators;
  delete record.passage;
  record.source = draft.source;
  const locators = keepUnchanged(parseLocatorLines(draft.locators), original.locators, sameLocator);
  if (locators.length) record.locators = locators;
  if (draft.passage) record.passage = draft.passage;
  return record;
}

export function atlasEntryDraft(record = null, prefill = {}) {
  const entry = record && typeof record === "object" ? record : {};
  return {
    original: record ? structuredClone(record) : null,
    id: typeof entry.id === "string" ? entry.id : String(prefill.id || ""),
    kind: typeof entry.kind === "string" ? entry.kind : ATLAS_ENTRY_KINDS.some((item) => item.kind === prefill.kind) ? prefill.kind : "concept",
    label: typeof entry.label === "string" ? entry.label : String(prefill.label || ""),
    aliases: (Array.isArray(entry.aliases) ? entry.aliases : []).join("\n"),
    summary: typeof entry.summary === "string" ? entry.summary : "",
    source: typeof entry.source === "string" ? entry.source : "",
    datings: (Array.isArray(entry.dates) ? entry.dates : []).map((dating) => atlasDatingDraft(dating)),
    approved: entry.visibility === "approved",
  };
}

/** The full entry to send, carrying unknown fields on the entry and at every level of its datings. */
export function atlasEntryPayload(draft) {
  const original = draft.original || {};
  const record = { ...original };
  for (const field of ["aliases", "summary", "source", "dates"]) delete record[field];
  record.id = String(draft.id || "").trim();
  record.kind = draft.kind;
  record.label = String(draft.label ?? "").trim();
  const aliases = textLines(draft.aliases);
  if (aliases.length) record.aliases = aliases;
  if (String(draft.summary ?? "").trim()) record.summary = draft.summary;
  if (draft.kind === "work" && draft.source) record.source = draft.source;
  const dates = (draft.datings || []).map(atlasDatingPayload);
  if (dates.length) record.dates = dates;
  record.visibility = draft.approved ? "approved" : "private";
  return record;
}

/** A quick, advisory check; the server's validation stays authoritative. */
export function validateAtlasEntryDraft(draft, { sources = [], used = [], creating = false } = {}) {
  if (creating) {
    if (!validAtlasId(draft.id)) return { field: "id", message: "Use an identifier of lowercase letters, digits and single hyphens, such as plato or the-good, at most 64 characters." };
    if (used.includes(draft.id)) return { field: "id", message: "That identifier is already used in the atlas; choose another." };
  }
  const label = String(draft.label ?? "").trim();
  if (!label) return { field: "label", message: "Enter a label." };
  if (codePoints(label) > MAX_ATLAS_SHORT_CHARS) return { field: "label", message: `A label is limited to ${MAX_ATLAS_SHORT_CHARS} characters.` };
  const aliases = textLines(draft.aliases);
  if (aliases.length > MAX_ATLAS_ALIASES) return { field: "aliases", message: `An entry may have at most ${MAX_ATLAS_ALIASES} other names.` };
  if (aliases.some((alias) => codePoints(alias) > MAX_ATLAS_SHORT_CHARS)) return { field: "aliases", message: `Each other name is limited to ${MAX_ATLAS_SHORT_CHARS} characters.` };
  if (new Set(aliases).size !== aliases.length) return { field: "aliases", message: "Each other name may appear only once." };
  if (codePoints(draft.summary) > MAX_ATLAS_SUMMARY_CHARS) return { field: "summary", message: `A summary is limited to ${MAX_ATLAS_SUMMARY_CHARS} characters.` };
  if (draft.kind === "work" && draft.source && !sources.some((source) => source.id === draft.source && source.kind === "work")) return { field: "source", message: "Choose a work from your source library, or none." };
  return null;
}

export function atlasRelationshipDraft(record = null, prefill = {}) {
  const value = record && typeof record === "object" ? record : {};
  return {
    original: record ? structuredClone(record) : null,
    id: typeof value.id === "string" ? value.id : "",
    kind: typeof value.kind === "string" ? value.kind : String(prefill.kind || ""),
    from: typeof value.from === "string" ? value.from : String(prefill.from || ""),
    to: typeof value.to === "string" ? value.to : String(prefill.to || ""),
    assertedBy: atlasAttributionDraft(value.assertedBy),
    confidence: ATLAS_CONFIDENCE.some((item) => item.value === value.confidence) ? value.confidence : "tentative",
    evidence: (Array.isArray(value.evidence) ? value.evidence : []).map((item, index) => atlasEvidenceDraft(item, index)),
    unsourced: Boolean(value.unsourced),
    uncertainty: typeof value.uncertainty === "string" ? value.uncertainty : "",
    contestedBy: (Array.isArray(value.contestedBy) ? value.contestedBy : []).map((item, index) => atlasDissentDraft(item, index)),
    datings: (Array.isArray(value.dates) ? value.dates : []).map((dating) => atlasDatingDraft(dating)),
    approved: value.visibility === "approved",
  };
}

/** `from` is the dissent's index in the stored `contestedBy`, or null for a new dissent. */
export function atlasDissentDraft(record = {}, from = null) {
  const value = record && typeof record === "object" ? record : {};
  return {
    original: structuredClone(value),
    from: Number.isInteger(from) ? from : null,
    by: atlasAttributionDraft(value.by),
    note: typeof value.note === "string" ? value.note : "",
    evidence: (Array.isArray(value.evidence) ? value.evidence : []).map((item, index) => atlasEvidenceDraft(item, index)),
  };
}

/**
 * Rests a relationship draft on a newer stored copy. Every nested item read
 * from the store takes the newer copy of the item it came from, wherever that
 * item still exists, so fields added elsewhere at any level survive the save.
 * A dissent rests on the newer dissent known by its party while that party is
 * unique in the opened and the newer lists; when several share a party, the
 * same opened note or evidence must also match, and if that still leaves
 * several, only the one at the dissent's own index qualifies. Evidence rests on the newer item known by its
 * source and passage (see `rebaseAtlasEvidence`). When an item cannot be told
 * apart from another, the draft keeps its own copy rather than take that
 * item's fields.
 */
export function rebaseAtlasRelationshipDraft(draft, current) {
  const text = (value) => (typeof value === "string" ? value : "");
  const object = (value) => value && typeof value === "object";
  const party = (value) => (object(value) ? value : {});
  const partyKey = (dissent) => {
    const by = party(dissent?.by);
    return JSON.stringify([text(by.kind), text(by.source), text(by.name)]);
  };
  const evidenceKey = (dissent) =>
    JSON.stringify((Array.isArray(dissent?.evidence) ? dissent.evidence : []).map((item) => [text(item?.source), text(item?.passage), JSON.stringify(Array.isArray(item?.locators) ? item.locators : [])]));
  const openedFrom = draft.original?.dates;
  const openedEvidence = draft.original?.evidence;
  const openedDissents = Array.isArray(draft.original?.contestedBy)
    ? draft.original.contestedBy
    : draft.contestedBy.filter((item) => Number.isInteger(item.from)).map((item) => item.original);
  draft.original = structuredClone(current);
  draft.assertedBy.original = structuredClone(current.assertedBy || { kind: "author" });
  rebaseAtlasEvidence(draft.evidence, current.evidence, openedEvidence);
  const newerList = Array.isArray(current.contestedBy) ? current.contestedBy : [];
  for (const dissent of draft.contestedBy) {
    if (!Number.isInteger(dissent.from) || !object(dissent.original)) continue;
    const key = partyKey(dissent.original);
    const sameParty = (list) => list.filter((value) => object(value) && partyKey(value) === key);
    const candidates = sameParty(newerList);
    const openedSame = sameParty(openedDissents);
    let newer = null;
    if (candidates.length === 1 && openedSame.length === 1) newer = candidates[0];
    else {
      // Several dissents share the party: the same opened note or evidence must tell them apart.
      const alike = (value) => (text(dissent.original.note) ? text(value.note) === text(dissent.original.note) : !text(value.note) && evidenceKey(value) === evidenceKey(dissent.original));
      const matching = candidates.filter(alike);
      const openedMatching = openedSame.filter(alike);
      if (matching.length === 1 && openedMatching.length === 1) newer = matching[0];
      else if (matching.length === openedMatching.length && matching.includes(newerList[dissent.from])) newer = newerList[dissent.from];
    }
    if (!newer) continue;
    const opened = dissent.original?.evidence;
    dissent.original = structuredClone(newer);
    dissent.from = newerList.indexOf(newer);
    dissent.by.original = structuredClone(newer.by || { kind: "author" });
    rebaseAtlasEvidence(dissent.evidence, newer.evidence, opened);
  }
  // Datings carry ids, so they rest on the newer copy by identity, never by position.
  rebaseAtlasDatings(draft.datings || [], current.dates, openedFrom);
  return draft;
}

/** The full relationship to send, carrying unknown fields at every level the form edits. */
export function atlasRelationshipPayload(draft) {
  const record = { ...(draft.original || {}) };
  for (const field of ["evidence", "unsourced", "uncertainty", "contestedBy", "dates"]) delete record[field];
  record.id = String(draft.id || "").trim();
  record.kind = draft.kind;
  record.from = draft.from;
  record.to = draft.to;
  record.assertedBy = atlasAttributionPayload(draft.assertedBy);
  record.confidence = draft.confidence;
  const evidence = draft.evidence.map(atlasEvidencePayload);
  if (evidence.length) record.evidence = evidence;
  else if (draft.unsourced) record.unsourced = true;
  if (String(draft.uncertainty ?? "").trim()) record.uncertainty = draft.uncertainty;
  const dissents = draft.contestedBy.map((dissent) => {
    const item = { ...dissent.original };
    delete item.note;
    delete item.evidence;
    item.by = atlasAttributionPayload(dissent.by);
    const cited = dissent.evidence.map(atlasEvidencePayload);
    if (cited.length) item.evidence = cited;
    if (String(dissent.note ?? "").trim()) item.note = dissent.note;
    return item;
  });
  if (dissents.length) record.contestedBy = dissents;
  const dates = (draft.datings || []).map(atlasDatingPayload);
  if (dates.length) record.dates = dates;
  record.visibility = draft.approved ? "approved" : "private";
  return record;
}

function atlasPartyProblem(party, sources, prefix) {
  if (party.kind === "source" && !sources.some((source) => source.id === party.source)) return { field: `${prefix}-source`, message: "Choose the source that holds this position." };
  if (party.kind === "named") {
    const name = String(party.name ?? "").trim();
    if (!name) return { field: `${prefix}-name`, message: "Enter who holds this position." };
    if (codePoints(name) > MAX_ATLAS_SHORT_CHARS) return { field: `${prefix}-name`, message: `A name is limited to ${MAX_ATLAS_SHORT_CHARS} characters.` };
  }
  return null;
}

function atlasEvidenceProblem(list, sources, passages, prefix, noun) {
  for (const [index, item] of list.entries()) {
    const base = `${prefix}evidence-${index}`;
    if (!sources.some((source) => source.id === item.source)) return { field: `${base}-source`, message: `Choose the source ${noun} ${index + 1} rests on.` };
    const locators = parseLocatorLines(item.locators);
    if (locators.length > MAX_PASSAGE_LOCATORS) return { field: `${base}-locators`, message: `Each piece of evidence may have at most ${MAX_PASSAGE_LOCATORS} locators.` };
    const bad = locators.findIndex((locator) => !locator.kind || !locator.value);
    if (bad >= 0) return { field: `${base}-locators`, message: `Locator ${bad + 1} of ${noun} ${index + 1} must look like page: 514 or canonical: 514a to 520a.` };
    if (item.passage) {
      const passage = passages.find((candidate) => candidate.id === item.passage);
      if (!passage) return { field: `${base}-passage`, message: `The notebook passage of ${noun} ${index + 1} no longer exists.` };
      if (passage.source !== item.source) return { field: `${base}-passage`, message: `The passage of ${noun} ${index + 1} must be quoted from the same source.` };
    }
  }
  return null;
}

/** A quick, advisory check of a relationship; the server's validation stays authoritative. */
export function validateAtlasRelationshipDraft(draft, { entries = [], kinds = null, sources = [], passages = [] } = {}) {
  const spec = atlasKindSpec(kinds, draft.kind);
  if (!spec) return { field: "kind", message: "Choose what kind of relationship this is." };
  const from = entries.find((entry) => entry.id === draft.from);
  const to = entries.find((entry) => entry.id === draft.to);
  if (!from) return { field: "from", message: "Choose the entry the relationship starts from." };
  if (!spec.from.includes(from.kind)) return { field: "from", message: `A ${spec.kind} relationship cannot start from a ${from.kind}.` };
  if (!to) return { field: "to", message: "Choose the entry the relationship points to." };
  if (to.id === from.id) return { field: "to", message: "An entry cannot be related to itself." };
  if (!spec.to.includes(to.kind)) return { field: "to", message: `A ${spec.kind} relationship cannot point to a ${to.kind}.` };
  if (spec.sameKind && to.kind !== from.kind) return { field: "to", message: `A ${spec.kind} relationship joins two entries of the same kind.` };
  const party = atlasPartyProblem(draft.assertedBy, sources, "asserted");
  if (party) return party;
  if (draft.evidence.length > MAX_ATLAS_EVIDENCE) return { field: "evidence", message: `A relationship may cite at most ${MAX_ATLAS_EVIDENCE} pieces of evidence.` };
  const evidence = atlasEvidenceProblem(draft.evidence, sources, passages, "", "evidence");
  if (evidence) return evidence;
  if (!draft.evidence.length && !draft.unsourced) return { field: "evidence", message: "Add evidence, or mark this relationship as an unsourced draft." };
  if (!draft.evidence.length && draft.confidence === "strong") return { field: "confidence", message: "An unsourced draft cannot be strong; cite evidence first." };
  if (codePoints(draft.uncertainty) > MAX_ATLAS_UNCERTAINTY_CHARS) return { field: "uncertainty", message: `The uncertainty note is limited to ${MAX_ATLAS_UNCERTAINTY_CHARS} characters.` };
  if (draft.contestedBy.length > MAX_ATLAS_DISSENTS) return { field: "contested", message: `A relationship may record at most ${MAX_ATLAS_DISSENTS} dissents.` };
  for (const [index, dissent] of draft.contestedBy.entries()) {
    const prefix = `dissent-${index}`;
    const problem = atlasPartyProblem(dissent.by, sources, prefix) || atlasEvidenceProblem(dissent.evidence, sources, passages, `${prefix}-`, `dissent ${index + 1} evidence`);
    if (problem) return problem;
    if (!dissent.evidence.length && !String(dissent.note ?? "").trim()) return { field: `${prefix}-note`, message: `Dissent ${index + 1} needs evidence or a note saying why.` };
    if (codePoints(dissent.note) > MAX_ATLAS_UNCERTAINTY_CHARS) return { field: `${prefix}-note`, message: `A dissent note is limited to ${MAX_ATLAS_UNCERTAINTY_CHARS} characters.` };
  }
  if (draft.approved) {
    if (!draft.evidence.length) return { field: "approved", message: "An unsourced draft cannot be approved; cite evidence first." };
    const notebookPointer = [...draft.evidence, ...draft.contestedBy.flatMap((dissent) => dissent.evidence)].some((item) => item.passage);
    if (notebookPointer) return { field: "approved", message: "An approved relationship cannot point into your private notebook; clear the passage and keep the source and locators." };
  }
  return null;
}

// ---- chronology: datings authored in the editors, and the explorer (ADR 0093 to 0097, 0098)

/** The five date forms, exactly one per dating. A competing date is its own dating. */
export const ATLAS_DATE_FORMS = Object.freeze([
  { form: "at", label: "At one point" },
  { form: "range", label: "Lasting from one point to another" },
  { form: "window", label: "At some time within a window" },
  { form: "unknown", label: "Unknown: the party says it is not known" },
  { form: "relative", label: "Before, after or during another entry's dated aspect" },
]);
export const ATLAS_PRECISIONS = Object.freeze([
  { value: "year", label: "Year" },
  { value: "month", label: "Month" },
  { value: "day", label: "Day" },
  { value: "decade", label: "Decade" },
  { value: "century", label: "Century" },
]);
const ATLAS_ASPECT_LABELS = Object.freeze({
  span: "Span (a lifetime, a duration, or when it held)",
  birth: "Birth",
  death: "Death",
  active: "Activity (floruit)",
  composition: "Composition",
  publication: "Publication",
  emergence: "Emergence",
});
const ATLAS_ASPECT_NOUNS = Object.freeze({ span: "span", birth: "birth", death: "death", active: "activity", composition: "composition", publication: "publication", emergence: "emergence" });
const ATLAS_ORDER_LABELS = Object.freeze({ before: "Before", after: "After", during: "During (within an aspect that lasts)" });
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DATE_SLOTS = ["at", "from", "to", "notBefore", "notAfter"];
const DATE_SLOT_IDS = Object.freeze({ at: "at", from: "from", to: "to", notBefore: "not-before", notAfter: "not-after" });
const FORM_SLOTS = Object.freeze({ at: ["at"], range: ["from", "to"], window: ["notBefore", "notAfter"], unknown: [], relative: [] });
const DATE_FORM_KEYS = ["at", "from", "to", "notBefore", "notAfter", "unknown", "relative"];
const POINT_KEYS = ["year", "month", "day", "decade", "century", "circa", "calendar"];
const RELATIVE_KEYS = ["order", "entry", "aspect"];
const DATING_KEYS = ["id", "aspect", "date", "assertedBy", "confidence", "evidence", "unsourced", "note", "visibility"];
const DEFAULT_MAX_DATINGS = 20;
const DEFAULT_MAX_YEAR = 100000;

export const atlasAspectLabel = (aspect) => ATLAS_ASPECT_LABELS[aspect] || String(aspect || "");
const aspectNoun = (aspect) => ATLAS_ASPECT_NOUNS[aspect] || String(aspect || "");
const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const extrasOf = (value, known) => {
  const extras = {};
  if (value && typeof value === "object" && !Array.isArray(value)) for (const [key, item] of Object.entries(value)) if (!known.includes(key)) extras[key] = structuredClone(item);
  return extras;
};
/** A whole number typed as digits only, or NaN. */
const wholeNumber = (text) => (/^\d+$/.test(String(text ?? "").trim()) ? Number(String(text).trim()) : NaN);
const daysInMonth = (month) => (month === 2 ? 29 : [4, 6, 9, 11].includes(month) ? 30 : 31);

/** The aspects an owner may be dated by, read from the server's table: an entry kind, or "relationship". */
export function atlasAspects(kinds, owner) {
  return (kinds?.aspects || []).filter((spec) => (owner === "relationship" ? spec.relationship : (spec.entries || []).includes(owner)));
}

/** A historical year as text: negative is BCE, and there is no year 0. */
export function atlasYearText(year) {
  return year < 0 ? `${-year} BCE` : `${year} CE`;
}

const ordinal = (n) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${suffix}`;
};

/** A point read back at its own precision, exactly as the core writes it: "c. 428 BCE", "the 380s BCE". */
export function atlasPointText(point) {
  if (!point || typeof point !== "object") return "";
  let text = point.circa ? "c. " : "";
  if (Number.isInteger(point.year) && point.year !== 0) {
    if (Number.isInteger(point.month) && Number.isInteger(point.day)) text += `${point.day} `;
    if (Number.isInteger(point.month)) text += `${SHORT_MONTHS[point.month - 1] || "?"} `;
    text += atlasYearText(point.year);
  } else if (Number.isInteger(point.decade) && point.decade !== 0) {
    text += `${point.circa ? "" : "the "}${Math.abs(point.decade)}s ${point.decade < 0 ? "BCE" : "CE"}`;
  } else if (Number.isInteger(point.century) && point.century !== 0) {
    text += `${ordinal(Math.abs(point.century))} century ${point.century < 0 ? "BCE" : "CE"}`;
  } else return "";
  if (point.calendar === "gregorian" || point.calendar === "julian") text += ` (${point.calendar})`;
  return text;
}

/** A date expression as stated, mirroring the core's text; a relative dating names the other entry by label when `entries` are given. */
export function atlasDateText(date, entries = null) {
  const value = date && typeof date === "object" ? date : {};
  const ends = (a, b, both, and, first, last) => {
    if (a && b) return `${both}${atlasPointText(a)} ${and} ${atlasPointText(b)}`;
    if (a) return `${first} ${atlasPointText(a)}`;
    if (b) return `${last} ${atlasPointText(b)}`;
    return "open";
  };
  if (value.at) return atlasPointText(value.at);
  if (value.from || value.to) return ends(value.from, value.to, "from ", "to", "from", "until");
  if (value.notBefore || value.notAfter) return ends(value.notBefore, value.notAfter, "between ", "and", "not before", "not after");
  if (value.unknown === true) return "unknown";
  const relative = value.relative;
  if (relative && typeof relative === "object") {
    if (!entries) return `${relative.order} \`${relative.entry}\` ${relative.aspect}`;
    return `${relative.order} the ${aspectNoun(relative.aspect)} of ${atlasEntryName(entries, relative.entry)}`;
  }
  return "";
}

/** `fallback` is the precision of a point the record does not state: "open" (an omitted end) or a precision for a new point. */
export function atlasPointDraft(point = null, fallback = "open") {
  const value = point && typeof point === "object" && !Array.isArray(point) ? point : null;
  const draft = { extras: extrasOf(value, POINT_KEYS), precision: value ? "year" : fallback, magnitude: "", era: "ce", month: "", day: "", circa: Boolean(value?.circa), calendar: ["gregorian", "julian"].includes(value?.calendar) ? value.calendar : "" };
  const signed = (n) => {
    draft.magnitude = String(Math.abs(n));
    draft.era = n < 0 ? "bce" : "ce";
  };
  if (Number.isInteger(value?.year)) {
    signed(value.year);
    if (Number.isInteger(value.month)) {
      draft.month = String(value.month);
      draft.precision = "month";
      if (Number.isInteger(value.day)) {
        draft.day = String(value.day);
        draft.precision = "day";
      }
    }
  } else if (Number.isInteger(value?.decade)) {
    signed(value.decade);
    draft.precision = "decade";
  } else if (Number.isInteger(value?.century)) {
    signed(value.century);
    draft.precision = "century";
  }
  return draft;
}

/** The point to send, or undefined for an open end. Unknown fields the point carried are kept. */
export function atlasPointPayload(draft) {
  if (!draft || draft.precision === "open") return undefined;
  const sign = draft.era === "bce" ? -1 : 1;
  const record = {};
  if (draft.precision === "decade") record.decade = sign * wholeNumber(draft.magnitude);
  else if (draft.precision === "century") record.century = sign * wholeNumber(draft.magnitude);
  else {
    record.year = sign * wholeNumber(draft.magnitude);
    if (draft.precision === "month" || draft.precision === "day") {
      record.month = wholeNumber(draft.month);
      if (draft.precision === "day") record.day = wholeNumber(draft.day);
    }
  }
  if (draft.circa) record.circa = true;
  if (draft.calendar && (draft.precision === "month" || draft.precision === "day")) record.calendar = draft.calendar;
  for (const [key, value] of Object.entries(draft.extras || {})) if (!(key in record)) record[key] = structuredClone(value);
  return record;
}

/**
 * One dating as the editor holds it. `storedId` is the identity of the stored
 * dating it was read from (null for a new one): a draft rests on a newer
 * stored copy by that identity, never by its position in the list.
 */
export function atlasDatingDraft(record = null, defaults = {}) {
  const value = record && typeof record === "object" ? record : {};
  const date = value.date && typeof value.date === "object" ? value.date : {};
  const form = date.at ? "at" : date.from || date.to ? "range" : date.notBefore || date.notAfter ? "window" : date.unknown === true ? "unknown" : date.relative ? "relative" : "at";
  const relative = date.relative && typeof date.relative === "object" ? date.relative : {};
  const points = {};
  for (const slot of DATE_SLOTS) {
    // A slot of the stored form that is absent is an open end; other slots wait, blank, in case the form changes.
    const stated = Boolean(record) && FORM_SLOTS[form].includes(slot);
    points[slot] = atlasPointDraft(date[slot], slot === "at" || (!stated && (slot === "from" || slot === "notBefore")) ? "year" : "open");
  }
  return {
    storedId: record && typeof value.id === "string" ? value.id : null,
    original: record ? structuredClone(record) : {},
    id: typeof value.id === "string" ? value.id : String(defaults.id || ""),
    idTouched: Boolean(record),
    aspect: typeof value.aspect === "string" ? value.aspect : String(defaults.aspect || ""),
    form,
    points,
    dateExtras: extrasOf(date, DATE_FORM_KEYS),
    relative: {
      extras: extrasOf(relative, RELATIVE_KEYS),
      order: ["before", "after", "during"].includes(relative.order) ? relative.order : "after",
      entry: typeof relative.entry === "string" ? relative.entry : "",
      aspect: typeof relative.aspect === "string" ? relative.aspect : "",
    },
    assertedBy: atlasAttributionDraft(value.assertedBy),
    confidence: ATLAS_CONFIDENCE.some((item) => item.value === value.confidence) ? value.confidence : "tentative",
    evidence: (Array.isArray(value.evidence) ? value.evidence : []).map((item, index) => atlasEvidenceDraft(item, index)),
    unsourced: Boolean(value.unsourced),
    note: typeof value.note === "string" ? value.note : "",
    approved: value.visibility === "approved",
  };
}

/** The full dating to send, carrying unknown fields on the dating, its date, its points and its relative target. */
export function atlasDatingPayload(draft) {
  const date = {};
  if (draft.form === "unknown") date.unknown = true;
  else if (draft.form === "relative") {
    date.relative = { order: draft.relative.order, entry: draft.relative.entry, aspect: draft.relative.aspect };
    for (const [key, value] of Object.entries(draft.relative.extras || {})) if (!(key in date.relative)) date.relative[key] = structuredClone(value);
  } else {
    for (const slot of FORM_SLOTS[draft.form] || []) {
      const point = atlasPointPayload(draft.points[slot]);
      if (point) date[slot] = point;
    }
  }
  for (const [key, value] of Object.entries(draft.dateExtras || {})) if (!(key in date)) date[key] = structuredClone(value);
  const record = { id: String(draft.id || "").trim(), aspect: draft.aspect, date, assertedBy: atlasAttributionPayload(draft.assertedBy), confidence: draft.confidence };
  const evidence = draft.evidence.map(atlasEvidencePayload);
  if (evidence.length) record.evidence = evidence;
  else if (draft.unsourced) record.unsourced = true;
  if (String(draft.note ?? "").trim()) record.note = draft.note;
  record.visibility = draft.approved ? "approved" : "private";
  for (const [key, value] of Object.entries(draft.original || {})) if (!DATING_KEYS.includes(key) && !(key in record)) record[key] = structuredClone(value);
  return record;
}

/** What a dating draft reads as, for the editor's live text; incomplete points say so rather than guess. */
export function atlasDatingReading(draft, entries = []) {
  if (draft.form === "unknown") return "unknown";
  if (draft.form === "relative") {
    const { order, entry, aspect } = draft.relative;
    if (!entry || !aspect) return "not complete yet: choose the other entry and its aspect";
    return atlasDateText({ relative: { order, entry, aspect } }, entries);
  }
  const date = atlasDatingPayload({ ...draft, original: {}, dateExtras: {}, evidence: [], assertedBy: { original: {}, kind: "author" } }).date;
  const slots = FORM_SLOTS[draft.form] || [];
  if (slots.some((slot) => date[slot] && !atlasPointText(date[slot]))) return "not complete yet";
  if (draft.form === "at" && !date.at) return "not complete yet";
  return atlasDateText(date);
}

function pointKeys(point) {
  const years = Number.isInteger(point.year) ? [point.year, point.year] : Number.isInteger(point.decade) ? (point.decade > 0 ? [point.decade, point.decade + 9] : [point.decade - 9, point.decade]) : point.century > 0 ? [(point.century - 1) * 100 + 1, point.century * 100] : [point.century * 100, point.century * 100 + 99];
  const month = Number.isInteger(point.month) ? point.month : null;
  return {
    years,
    first: month ? [point.year, month, point.day || 1] : [years[0], 1, 1],
    last: month ? [point.year, month, point.day || daysInMonth(month)] : [years[1], 12, 31],
  };
}
const compareKeys = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Whether `start` can begin no later than `end` ends, as the core decides it: months and days only within one calendar. */
function notReversed(start, end) {
  const [a, b] = [pointKeys(start), pointKeys(end)];
  return (start.calendar || "") === (end.calendar || "") ? compareKeys(a.first, b.last) <= 0 : a.years[0] <= b.years[1];
}

function atlasPointProblem(point, base, name, maxYear) {
  if (point.precision === "open") return null;
  const n = wholeNumber(point.magnitude);
  if (point.precision === "decade") {
    if (!(n >= 10 && n % 10 === 0 && n + 9 <= maxYear)) return { field: `${base}-value`, message: `${name}: enter a decade as a multiple of 10, such as 1380 for 1380 to 1389 CE, or 380 with BCE for 389 to 380 BCE.` };
    return null;
  }
  if (point.precision === "century") {
    if (!(n >= 1 && n <= maxYear / 100)) return { field: `${base}-value`, message: `${name}: enter a century as a number from 1 to ${maxYear / 100}, such as 4 for the 4th century.` };
    return null;
  }
  if (!(n >= 1 && n <= maxYear)) return { field: `${base}-value`, message: `${name}: enter a year from 1 to ${maxYear} without a minus sign, and choose BCE or CE. There is no year 0.` };
  if (point.precision === "month" || point.precision === "day") {
    const month = wholeNumber(point.month);
    if (!(month >= 1 && month <= 12)) return { field: `${base}-month`, message: `${name}: choose a month.` };
    if (point.precision === "day") {
      const day = wholeNumber(point.day);
      if (!(day >= 1 && day <= daysInMonth(month))) return { field: `${base}-day`, message: `${name}: enter a day of ${MONTH_NAMES[month - 1]}, from 1 to ${daysInMonth(month)}.` };
    }
  }
  return null;
}

/**
 * A quick, advisory check of an item's datings; the server stays
 * authoritative. Fields name the dating's controls (`dating-1-at-value`).
 * `used` lists every identifier a new dating may not take.
 */
export function validateAtlasDatings(datings, { owner = "", ownerId = "", kinds = null, entries = [], sources = [], passages = [], used = [] } = {}) {
  const max = kinds?.maxDatings || DEFAULT_MAX_DATINGS;
  const maxYear = kinds?.maxYear || DEFAULT_MAX_YEAR;
  if (datings.length > max) return { field: "dates", message: `An entry or relationship may have at most ${max} datings.` };
  const allowed = atlasAspects(kinds, owner);
  const seen = new Set();
  for (const [index, dating] of datings.entries()) {
    const p = `dating-${index}`;
    const name = `Dating ${index + 1}`;
    const id = String(dating.id || "").trim();
    if (!validAtlasId(id)) return { field: `${p}-id`, message: `${name} needs an identifier of lowercase letters, digits and single hyphens, at most 64 characters.` };
    if (used.includes(id) || seen.has(id)) return { field: `${p}-id`, message: `${name}'s identifier is already used in the atlas; choose another.` };
    seen.add(id);
    const spec = allowed.find((item) => item.aspect === dating.aspect);
    if (!spec) return { field: `${p}-aspect`, message: `Choose what ${name.toLowerCase()} dates.` };
    if (dating.form === "range" && !spec.durative) return { field: `${p}-form`, message: `${name}: a ${dating.aspect} happens at one time; give a window instead of a duration.` };
    const slots = FORM_SLOTS[dating.form] || [];
    for (const slot of slots) {
      const problem = atlasPointProblem(dating.points[slot], `${p}-${DATE_SLOT_IDS[slot]}`, name, maxYear);
      if (problem) return problem;
    }
    if (slots.length === 2) {
      const [start, end] = slots.map((slot) => atlasPointPayload(dating.points[slot]));
      if (!start && !end) return { field: `${p}-${DATE_SLOT_IDS[slots[0]]}-precision`, message: `${name} needs at least one end; leave only the other one open.` };
      if (start && end && !notReversed(start, end)) return { field: `${p}-${DATE_SLOT_IDS[slots[1]]}-value`, message: `${name}: the start is later than the end. Check the years and BCE or CE.` };
    }
    if (dating.form === "relative") {
      const target = entries.find((entry) => entry.id === dating.relative.entry);
      if (!target) return { field: `${p}-relative-entry`, message: `${name}: choose the entry it is dated against.` };
      const aspect = atlasAspects(kinds, target.kind).find((item) => item.aspect === dating.relative.aspect);
      if (!aspect) return { field: `${p}-relative-aspect`, message: `${name}: choose an aspect a ${target.kind} has.` };
      if (dating.relative.order === "during" && !aspect.durative) return { field: `${p}-relative-aspect`, message: `${name}: during needs an aspect that lasts: span, activity or composition.` };
      if (target.id === ownerId && aspect.aspect === dating.aspect) return { field: `${p}-relative-aspect`, message: `${name} cannot be dated against the aspect it dates.` };
    }
    const party = atlasPartyProblem(dating.assertedBy, sources, `${p}-asserted`);
    if (party) return party;
    if (dating.evidence.length > MAX_ATLAS_EVIDENCE) return { field: `${p}-evidence`, message: `A dating may cite at most ${MAX_ATLAS_EVIDENCE} pieces of evidence.` };
    const evidence = atlasEvidenceProblem(dating.evidence, sources, passages, `${p}-`, `${name.toLowerCase()} evidence`);
    if (evidence) return evidence;
    if (!dating.evidence.length && !dating.unsourced) return { field: `${p}-evidence`, message: `Add evidence to ${name.toLowerCase()}, or mark it as an unsourced draft.` };
    if (!dating.evidence.length && dating.confidence === "strong") return { field: `${p}-confidence`, message: `${name}: an unsourced dating cannot be strong; cite evidence first.` };
    if (codePoints(dating.note) > MAX_ATLAS_UNCERTAINTY_CHARS) return { field: `${p}-note`, message: `A dating's note is limited to ${MAX_ATLAS_UNCERTAINTY_CHARS} characters.` };
    if (dating.approved) {
      if (!dating.evidence.length) return { field: `${p}-approved`, message: `${name}: an unsourced dating cannot be approved; cite evidence first.` };
      if (dating.evidence.some((item) => item.passage)) return { field: `${p}-approved`, message: `${name}: an approved dating cannot point into your private notebook; clear the passage and keep the source and locators.` };
    }
  }
  return null;
}

/**
 * Rests nested evidence drafts on a newer stored list. Evidence has no id, so
 * an item is known by its source and passage, but only while that pair is
 * unambiguous: exactly one item in the copy the draft was opened from
 * (`opened`) and exactly one in the newer list share it, and the draft rests
 * on that newer item wherever it now sits. When several items share the pair,
 * the newer item must also carry the opened copy's locators; if that still
 * leaves several, only the one at the draft's own index qualifies. Otherwise
 * the draft keeps its own copy rather than borrow another item's fields.
 */
function rebaseAtlasEvidence(drafts, list, opened) {
  const text = (value) => (typeof value === "string" ? value : "");
  const object = (value) => value && typeof value === "object";
  const pair = (value) => (object(value) ? JSON.stringify([text(value.source), text(value.passage)]) : null);
  const locators = (value) => (Array.isArray(value?.locators) ? value.locators : []);
  const sameLocators = (a, b) => {
    const [x, y] = [locators(a), locators(b)];
    return x.length === y.length && x.every((item, index) => object(item) && object(y[index]) && sameLocator(item, y[index]));
  };
  const items = Array.isArray(list) ? list : [];
  const before = Array.isArray(opened) ? opened : drafts.filter((item) => Number.isInteger(item.from)).map((item) => item.original);
  const count = (values, key) => values.filter((value) => pair(value) === key).length;
  for (const item of drafts) {
    if (!Number.isInteger(item.from) || !object(item.original)) continue;
    const key = pair(item.original);
    const candidates = items.filter((value) => pair(value) === key);
    let newer = null;
    if (candidates.length === 1 && count(before, key) === 1) newer = candidates[0];
    else {
      const matching = candidates.filter((value) => sameLocators(value, item.original));
      const openedMatching = before.filter((value) => pair(value) === key && sameLocators(value, item.original));
      // Identical opened items cannot be told apart by content: the position
      // counts only while the group of identical items is the same size.
      if (matching.length === 1 && openedMatching.length === 1) newer = matching[0];
      else if (matching.length === openedMatching.length && matching.includes(items[item.from])) newer = items[item.from];
    }
    if (!newer) continue;
    item.original = structuredClone(newer);
    item.from = items.indexOf(newer);
  }
}

/**
 * Rests an item's dating drafts on the newer stored datings, by identity:
 * each draft read from the store takes the newer copy of the dating with the
 * same id, wherever it now sits, so fields added elsewhere at every level
 * survive. A dating removed elsewhere keeps the draft's copy. A dating added
 * elsewhere (not in the copy the draft was opened from) joins the draft, so
 * keeping the draft never drops it. Returns how many were added.
 */
export function rebaseAtlasDatings(datings, stored, openedFrom = []) {
  const list = (Array.isArray(stored) ? stored : []).filter((item) => item && typeof item === "object" && typeof item.id === "string");
  const byId = new Map(list.map((item) => [item.id, item]));
  for (const dating of datings) {
    const newer = dating.storedId ? byId.get(dating.storedId) : null;
    if (!newer) continue;
    const date = newer.date && typeof newer.date === "object" ? newer.date : {};
    const opened = dating.original?.evidence;
    dating.original = structuredClone(newer);
    dating.dateExtras = extrasOf(date, DATE_FORM_KEYS);
    for (const slot of DATE_SLOTS) if (date[slot] && typeof date[slot] === "object") dating.points[slot].extras = extrasOf(date[slot], POINT_KEYS);
    if (date.relative && typeof date.relative === "object") dating.relative.extras = extrasOf(date.relative, RELATIVE_KEYS);
    dating.assertedBy.original = structuredClone(newer.assertedBy || { kind: "author" });
    rebaseAtlasEvidence(dating.evidence, newer.evidence, opened);
  }
  const known = new Set([...(Array.isArray(openedFrom) ? openedFrom : []).map((item) => item?.id), ...datings.map((dating) => dating.storedId).filter(Boolean)]);
  const added = list.filter((item) => !known.has(item.id)).map((item) => atlasDatingDraft(item));
  datings.push(...added);
  return added.length;
}

/** Rests an entry draft on a newer stored copy: its own unknown fields, and its datings by identity. */
export function rebaseAtlasEntryDraft(draft, current) {
  const openedFrom = draft.original?.dates;
  draft.original = structuredClone(current);
  rebaseAtlasDatings(draft.datings, current?.dates, openedFrom);
  return draft;
}

/** What the editor says about an item's datings. */
export function atlasDatesText(count) {
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  const kept = n ? `${plural(n, "dating")}. ` : "No datings yet. ";
  return `${kept}Each dating records who dates what, on which evidence, at the precision they state. Competing datings stay side by side; nothing picks one, averages them or converts calendars.`;
}

/** A dating's standing for publication, in words. Approved datings publish only while the site publishes its atlas. */
export function atlasDatingVisibilityText(record, projected) {
  if (record?.visibility !== "approved") return "Private";
  return projected ? "Approved for the publication projection; published with the atlas while the site publishes it" : "Approved, but stays private while what it dates, or the entry it is dated against, is private";
}

/** The explorer's time window from the filter fields, in historical years (negative is BCE). */
export function atlasChronologyWindow(filters = {}, maxYear = DEFAULT_MAX_YEAR) {
  const read = (text, era) => {
    if (!String(text ?? "").trim()) return { year: null };
    const n = wholeNumber(text);
    if (!(n >= 1 && n <= maxYear)) return { problem: true };
    return { year: era === "bce" ? -n : n };
  };
  const from = read(filters.fromYear, filters.fromEra || "bce");
  const to = read(filters.toYear, filters.toEra || "ce");
  if (from.problem || to.problem) return { active: false, from: null, to: null, problem: "Enter whole years from 1 without a minus sign, and choose BCE or CE; there is no year 0. The time window is not applied." };
  if (from.year !== null && to.year !== null && from.year > to.year) return { active: false, from: from.year, to: to.year, problem: "The time window starts after it ends, so it is not applied." };
  return { active: from.year !== null || to.year !== null, from: from.year, to: to.year, problem: "" };
}

/** The heading a dated aspect is listed under at a zoom level: by century, decade or year it begins in. */
export function atlasChronologyGroupLabel(year, zoom = "century") {
  if (zoom === "none") return "";
  if (!Number.isInteger(year)) return "No earliest point stated (open start)";
  const era = year < 0 ? "BCE" : "CE";
  const magnitude = Math.abs(year);
  if (zoom === "year") return atlasYearText(year);
  if (zoom === "decade") {
    const decade = Math.floor(magnitude / 10) * 10;
    return decade ? `the ${decade}s ${era}` : `1 to 9 ${era}`;
  }
  return `${ordinal(Math.ceil(magnitude / 100))} century ${era}`;
}

/** The name of a dated item: an entry's label, or a relationship read in its stored direction. */
function atlasOwnerName(state, collection, id) {
  if (collection === "entries") return atlasEntryName(state.entries, id);
  const relationship = (state.relationships || []).find((item) => item.id === id);
  return relationship ? atlasRelationshipSentence(relationship, state.entries) : `${id} (missing)`;
}

/**
 * The chronology explorer's model, from the server's chronology index. A
 * dated aspect (one item's datings of one aspect) keeps all its competing
 * datings together, in the index's one display order. Filters show or hide a
 * whole dated aspect and never one of its competing datings: a dating outside
 * the time window is kept and marked when a competitor falls inside it. A
 * dated aspect with no absolute dating is listed apart, never placed in time.
 */
export function atlasChronologyModel(state, filters = {}) {
  const chronology = state.chronology || {};
  const timeline = Array.isArray(chronology.timeline) ? chronology.timeline : [];
  const prompts = Array.isArray(chronology.prompts) ? chronology.prompts : [];
  const promptCount = new Map();
  for (const prompt of prompts) for (const id of prompt.datings || []) promptCount.set(id, (promptCount.get(id) || 0) + 1);
  const records = new Map();
  for (const item of [...(state.entries || []), ...(state.relationships || [])]) for (const dating of item.dates || []) records.set(dating.id, dating);
  const rows = [];
  const byKey = new Map();
  for (const item of timeline) {
    const key = `${item.collection}:${item.owner}:${item.aspect}`;
    let row = byKey.get(key);
    if (!row) {
      row = { key, owner: item.owner, collection: item.collection, aspect: item.aspect, name: atlasOwnerName(state, item.collection, item.owner), datings: [] };
      byKey.set(key, row);
      rows.push(row);
    }
    row.datings.push({ ...item, record: records.get(item.id) || null, prompts: promptCount.get(item.id) || 0, inWindow: null });
  }
  const window = atlasChronologyWindow(filters, state.kinds?.maxYear);
  const overlaps = (dating) => (dating.endYear ?? Infinity) >= (window.from ?? -Infinity) && (dating.startYear ?? -Infinity) <= (window.to ?? Infinity);
  for (const row of rows) {
    row.placed = row.datings.find((dating) => dating.placement === "dated") || null;
    row.startYear = row.placed ? row.placed.startYear : null;
    for (const dating of row.datings) dating.inWindow = window.active && dating.placement === "dated" ? overlaps(dating) : null;
  }
  const words = foldAtlasText(filters.query).split(" ").filter(Boolean);
  const matches = (row) => {
    if (filters.aspect && row.aspect !== filters.aspect) return false;
    if (filters.competing && row.datings.length < 2) return false;
    if (filters.prompted && !row.datings.some((dating) => dating.prompts)) return false;
    if (words.length) {
      const haystack = foldAtlasText(`${row.owner} ${row.name}`);
      if (!words.every((word) => haystack.includes(word))) return false;
    }
    if (window.active && row.placed) return row.datings.some((dating) => dating.inWindow);
    return true;
  };
  const shown = rows.filter(matches);
  const zoom = ["century", "decade", "year", "none"].includes(filters.zoom) ? filters.zoom : "century";
  const groups = [];
  for (const row of shown.filter((item) => item.placed)) {
    const label = atlasChronologyGroupLabel(row.startYear, zoom);
    if (groups.length && groups[groups.length - 1].label === label) groups[groups.length - 1].rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  const relative = shown.flatMap((row) => row.datings.filter((dating) => dating.placement === "relative").map((dating) => ({ row, dating })));
  return {
    rows,
    groups,
    unplaced: shown.filter((row) => !row.placed),
    relative,
    prompts,
    unlisted: Number.isInteger(chronology.unlisted) ? chronology.unlisted : 0,
    window,
    zoom,
    total: { rows: rows.length, datings: timeline.length },
    shown: { rows: shown.length, datings: shown.reduce((sum, row) => sum + row.datings.length, 0) },
  };
}

/** The explorer's visible state in words: what is shown, and every filter and the zoom level in force. */
export function atlasChronologyStatus(model, filters = {}) {
  const parts = [`Showing ${model.shown.rows} of ${plural(model.total.rows, "dated aspect")} (${model.shown.datings} of ${plural(model.total.datings, "dating")})`];
  if (filters.aspect) parts.push(`${aspectNoun(filters.aspect)} only`);
  if (String(filters.query ?? "").trim()) parts.push(`matching “${String(filters.query).trim()}”`);
  if (model.window.active) {
    if (model.window.from !== null) parts.push(`from ${atlasYearText(model.window.from)}`);
    if (model.window.to !== null) parts.push(`to ${atlasYearText(model.window.to)}`);
  }
  if (filters.competing) parts.push("only aspects with competing datings");
  if (filters.prompted) parts.push("only datings with a check prompt");
  parts.push(model.zoom === "none" ? "not grouped" : `grouped by the ${model.zoom} each begins in`);
  return `${parts.join("; ")}.${model.window.problem ? ` ${model.window.problem}` : ""}`;
}

/** A dating as read in the explorer: the index's text, a relative dating with the other entry's label, or unknown said plainly. */
export function atlasChronologyReading(dating, entries = []) {
  if (dating.placement === "relative" && dating.record?.date?.relative) return atlasDateText(dating.record.date, entries);
  if (dating.placement === "unknown") return "Unknown, as the party states";
  return String(dating.text || "");
}

/** "Composition of Laws: after the activity of Plato". */
export function atlasRelativeSentence(rowName, aspect, dating, entries = []) {
  return `${capitalize(aspectNoun(aspect))} of ${rowName}: ${atlasChronologyReading(dating, entries)}`;
}

/**
 * The editor for one atlas entry or relationship. `state` is the atlas as last
 * read and is updated in place after every save or conflict. Nothing is saved
 * until the author submits; every server message reaches the page as text,
 * and a save that meets a newer atlas keeps the draft until the author
 * chooses the stored copy or keeps the draft on top of it.
 */
export function createAtlasForm({ api, state, type = "entry", item = null, prefill = {}, idPrefix = "oba-atlas-form", onSaved, onCancel, onRefreshed }) {
  const isEntry = type === "entry";
  const editing = Boolean(item);
  let draft = isEntry ? atlasEntryDraft(item, prefill) : atlasRelationshipDraft(item, prefill);
  let idTouched = Boolean(prefill.id);
  let busy = false;
  // null, or { current } once a save met a newer atlas: the author chooses before anything is sent again.
  let conflict = null;
  let touched = false;
  const root = h("form", { class: "oba-capture-form oba-atlas-form", novalidate: true, "data-atlas-form": type });
  const errorBox = h("p", { class: "oba-error", id: `${idPrefix}-error`, role: "alert", hidden: true, tabindex: "-1" });
  const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
  const control = (name) => root.querySelector(`#${idPrefix}-${name}`);
  const used = () => [...(state.entries || []), ...(state.relationships || [])].map((record) => record.id);
  const passageById = (id) => (state.passages || []).find((passage) => passage.id === id) || null;
  const say = (text, kind = "oba-small") => {
    status.className = kind;
    status.textContent = text;
  };

  const field = (name, labelText, input, hint) => {
    input.id = `${idPrefix}-${name}`;
    if (hint) {
      input.setAttribute("aria-describedby", `${idPrefix}-${name}-hint`);
      input.setAttribute("data-hint-id", `${idPrefix}-${name}-hint`);
    }
    return h("div", { class: "oba-field", "data-atlas-field": name }, h("label", { for: input.id }, labelText), input, hint ? h("p", { class: "oba-small", id: `${idPrefix}-${name}-hint` }, hint) : null);
  };
  const check = (name, labelText, checked, onToggle, hint, disabled = false) => {
    const id = `${idPrefix}-${name}`;
    const input = h("input", { id, type: "checkbox", checked, disabled, onChange: (event) => onToggle(event.target.checked) });
    if (hint) {
      input.setAttribute("aria-describedby", `${id}-hint`);
      input.setAttribute("data-hint-id", `${id}-hint`);
    }
    return h("div", { "data-atlas-field": name }, h("div", { class: "oba-capture-check" }, input, h("label", { for: id }, labelText)), hint ? h("p", { class: "oba-small", id: `${id}-hint` }, hint) : null);
  };
  const fail = (message, name = "") => {
    errorBox.hidden = false;
    errorBox.textContent = message;
    const target = name ? control(name) : null;
    if (target) {
      target.setAttribute("aria-invalid", "true");
      // The hint stays; the error is added to it, never in its place.
      target.setAttribute("aria-describedby", [target.getAttribute("data-hint-id"), errorBox.id].filter(Boolean).join(" "));
      target.focus();
    } else errorBox.focus();
  };
  const clearInvalid = () => {
    for (const target of root.querySelectorAll("[aria-invalid]")) {
      target.removeAttribute("aria-invalid");
      const hint = target.getAttribute("data-hint-id");
      if (hint) target.setAttribute("aria-describedby", hint);
      else target.removeAttribute("aria-describedby");
    }
  };
  /** Library sources to pick from: live ones, plus an archived one this record already uses, labelled. */
  const sourceSelect = (current, onPick, onlyKind = "") => {
    const fits = (source) => !onlyKind || source.kind === onlyKind;
    const live = captureSources(state.sources).filter(fits);
    const kept = (state.sources || []).filter((source) => source.archived && source.id === current && fits(source));
    return h(
      "select",
      { onChange: (event) => onPick(event.target.value) },
      h("option", { value: "", selected: !current }, onlyKind ? "None" : "Choose a source"),
      [...live, ...kept].map((source) => h("option", { value: source.id, selected: current === source.id }, `${sourceLabel(source)}${source.archived ? " (archived)" : ""} (${source.kind})`)),
    );
  };
  const rerender = (focusName) => {
    render();
    control(focusName)?.focus();
  };

  // ---- relationship parts
  const partyEditor = (prefix, legend, party, hint) =>
    h(
      "fieldset",
      { class: "oba-atlas-party", id: `${idPrefix}-${prefix}`, tabindex: "-1" },
      h("legend", {}, legend),
      hint ? h("p", { class: "oba-small" }, hint) : null,
      ATLAS_ATTRIBUTIONS.map(({ kind, label }) => {
        const id = `${idPrefix}-${prefix}-is-${kind}`;
        return h("div", { class: "oba-capture-check" }, h("input", { id, type: "radio", name: `${idPrefix}-${prefix}-kind`, value: kind, checked: party.kind === kind, onChange: () => { party.kind = kind; rerender(`${prefix}-is-${kind}`); } }), h("label", { for: id }, label));
      }),
      party.kind === "source" ? field(`${prefix}-source`, "Source that holds this position", sourceSelect(party.source, (value) => { party.source = value; })) : null,
      party.kind === "named" ? field(`${prefix}-name`, "Who holds this position", h("input", { type: "text", value: party.name, autocomplete: "off", onInput: (event) => { party.name = event.target.value; } }), "A person or group outside your library. Stored as text.") : null,
    );

  const pickPassage = (evidence, id, base) => {
    evidence.passage = id;
    const passage = passageById(id);
    if (passage) {
      if (!evidence.source) evidence.source = passage.source;
      if (!String(evidence.locators).trim() && passage.locators?.length) evidence.locators = formatLocatorLines(passage.locators);
    }
    rerender(`${base}-passage`);
  };

  /** One list of evidence: library source, optional notebook passage, locators. */
  const evidenceEditor = (list, prefix, names, onAdd = null) => {
    const items = list.map((evidence, index) => {
      const base = `${prefix}evidence-${index}`;
      const passages = (state.passages || []).filter((passage) => (!evidence.source || passage.source === evidence.source) && (!passage.archived || passage.id === evidence.passage));
      return h(
        "fieldset",
        { class: "oba-atlas-evidence", id: `${idPrefix}-${base}`, tabindex: "-1" },
        h("legend", {}, names.item(index + 1)),
        field(`${base}-source`, "Source", sourceSelect(evidence.source, (value) => {
          evidence.source = value;
          if (evidence.passage && passageById(evidence.passage)?.source !== value) evidence.passage = "";
          rerender(`${base}-source`);
        })),
        field(
          `${base}-passage`,
          "Notebook passage (optional)",
          h(
            "select",
            { onChange: (event) => pickPassage(evidence, event.target.value, base) },
            h("option", { value: "", selected: !evidence.passage }, passages.length ? "No passage" : "No passages from this source"),
            passages.map((passage) => h("option", { value: passage.id, selected: evidence.passage === passage.id }, `${passage.preview} (${passage.id})`)),
          ),
          "Choosing one fills in its source and locators. It points into your private notebook, so an approved relationship cannot keep it.",
        ),
        field(`${base}-locators`, "Locators (optional)", h("textarea", { rows: 2, value: evidence.locators, spellcheck: "false", onInput: (event) => { evidence.locators = event.target.value; } }), "One per line, such as page: 514 or canonical: 514a to 520a."),
        h("button", { class: "oba-btn", type: "button", "data-atlas-remove-evidence": base, onClick: () => { list.splice(index, 1); rerender(`add-${prefix}evidence`); say(`${names.item(index + 1)} removed.`); } }, names.remove(index + 1)),
      );
    });
    return [
      ...items,
      h("button", {
        class: "oba-btn",
        type: "button",
        id: `${idPrefix}-add-${prefix}evidence`,
        "data-atlas-add-evidence": prefix || "relationship",
        disabled: list.length >= MAX_ATLAS_EVIDENCE,
        onClick: () => {
          list.push(atlasEvidenceDraft());
          if (list === draft.evidence) draft.unsourced = false;
          onAdd?.();
          rerender(`${prefix}evidence-${list.length - 1}-source`);
        },
      }, names.add),
    ];
  };

  const dissentEditor = (dissent, index) => {
    const prefix = `dissent-${index}`;
    return h(
      "fieldset",
      { class: "oba-atlas-dissent", id: `${idPrefix}-${prefix}-item`, tabindex: "-1" },
      h("legend", {}, `Dissent ${index + 1}`),
      partyEditor(`${prefix}`, "Disputed by", dissent.by),
      field(`${prefix}-note`, "Why it is disputed (optional if evidence is cited)", h("textarea", { rows: 2, value: dissent.note, onInput: (event) => { dissent.note = event.target.value; } })),
      evidenceEditor(dissent.evidence, `${prefix}-`, {
        item: (number) => `Dissent ${index + 1} evidence ${number}`,
        add: `Add evidence to dissent ${index + 1}`,
        remove: (number) => `Remove evidence ${number} from dissent ${index + 1}`,
      }),
      h("button", { class: "oba-btn oba-btn-danger", type: "button", "data-atlas-remove-dissent": String(index), onClick: () => { draft.contestedBy.splice(index, 1); rerender("add-dissent"); say(`Dissent ${index + 1} removed.`); } }, `Remove dissent ${index + 1}`),
    );
  };


  // ---- dating parts (ADR 0093, ADR 0098)
  const datingOwner = () => (isEntry ? draft.kind : "relationship");
  const datingAspects = () => atlasAspects(state.kinds, datingOwner());
  /** Every identifier a new dating may not take: the atlas's entries, relationships and other items' datings. */
  const datingIdsInUse = () => {
    const own = new Set((draft.original?.dates || []).map((dating) => dating?.id));
    const others = [...(state.entries || []), ...(state.relationships || [])].flatMap((record) => (Array.isArray(record.dates) ? record.dates : []).map((dating) => dating.id)).filter((id) => !own.has(id));
    return [...used(), ...others, ...(!editing && draft.id ? [draft.id] : [])];
  };
  const suggestDatingId = (dating) => {
    const others = draft.datings.filter((item) => item !== dating).map((item) => item.id);
    const owner = String(draft.id || "").trim() || (isEntry ? "entry" : "relationship");
    return suggestAtlasId(`${owner}-${dating.aspect || "date"}`, [...datingIdsInUse(), ...others], "dating");
  };
  const refreshReading = (index) => {
    const target = control(`dating-${index}-reads`);
    if (target) target.textContent = `Reads: ${atlasDatingReading(draft.datings[index], state.entries || [])}`;
  };

  /** One point at its own precision: a year (with month and day), a decade or a century, BCE or CE, optionally circa. */
  const pointEditor = (dating, index, slot, legend, openLabel = "") => {
    const point = dating.points[slot];
    const base = `dating-${index}-${DATE_SLOT_IDS[slot]}`;
    const parts = [
      field(
        `${base}-precision`,
        "Precision",
        h(
          "select",
          { onChange: (event) => { point.precision = event.target.value; rerender(`${base}-precision`); } },
          openLabel ? h("option", { value: "open", selected: point.precision === "open" }, openLabel) : null,
          ATLAS_PRECISIONS.map((item) => h("option", { value: item.value, selected: point.precision === item.value }, item.label)),
        ),
        openLabel ? "Open leaves this end unstated. Nothing widens, narrows or rounds what you state." : "State it as finely as the party does, and no finer.",
      ),
    ];
    if (point.precision !== "open") {
      const valueLabel = { decade: "Decade", century: "Century" }[point.precision] || "Year";
      const valueHint = {
        decade: "Named as decades are: 1380 with CE is 1380 to 1389 CE; 380 with BCE is 389 to 380 BCE.",
        century: "An ordinal number: 4 is the 4th century, 301 to 400 CE or 400 to 301 BCE.",
      }[point.precision] || "Digits only, with no minus sign; choose BCE or CE below. There is no year 0: 1 BCE is followed by 1 CE.";
      parts.push(
        field(`${base}-value`, valueLabel, h("input", { type: "text", inputmode: "numeric", autocomplete: "off", spellcheck: "false", value: point.magnitude, onInput: (event) => { point.magnitude = event.target.value.trim(); refreshReading(index); } }), valueHint),
        field(`${base}-era`, "Era", h("select", { onChange: (event) => { point.era = event.target.value; refreshReading(index); } }, h("option", { value: "bce", selected: point.era === "bce" }, "BCE (before the Common Era)"), h("option", { value: "ce", selected: point.era === "ce" }, "CE (the Common Era)"))),
      );
      if (point.precision === "month" || point.precision === "day") {
        parts.push(field(`${base}-month`, "Month", h("select", { onChange: (event) => { point.month = event.target.value; refreshReading(index); } }, h("option", { value: "", selected: !point.month }, "Choose a month"), MONTH_NAMES.map((name, position) => h("option", { value: String(position + 1), selected: point.month === String(position + 1) }, name)))));
        if (point.precision === "day") parts.push(field(`${base}-day`, "Day", h("input", { type: "text", inputmode: "numeric", autocomplete: "off", value: point.day, onInput: (event) => { point.day = event.target.value.trim(); refreshReading(index); } })));
        parts.push(field(`${base}-calendar`, "Calendar of the month and day", h("select", { onChange: (event) => { point.calendar = event.target.value; refreshReading(index); } }, h("option", { value: "", selected: !point.calendar }, "As the cited party gives it (unspecified)"), h("option", { value: "gregorian", selected: point.calendar === "gregorian" }, "Gregorian"), h("option", { value: "julian", selected: point.calendar === "julian" }, "Julian")), "Nothing converts calendars. Points stated in different calendars are compared by year only; record any other reckoning in the note."));
      }
      parts.push(check(`${base}-circa`, "Circa: the party gives it as approximate", point.circa, (on) => { point.circa = on; refreshReading(index); }));
    }
    return h("fieldset", { class: "oba-atlas-point", id: `${idPrefix}-${base}`, tabindex: "-1" }, h("legend", {}, legend), parts);
  };

  /** A relative dating: before, after or during another entry's dated aspect, only as asserted. */
  const relativeEditor = (dating, index) => {
    const base = `dating-${index}-relative`;
    const relative = dating.relative;
    const entries = state.entries || [];
    const target = entries.find((entry) => entry.id === relative.entry) || null;
    const fits = (spec) => relative.order !== "during" || spec.durative;
    const aspects = target ? atlasAspects(state.kinds, target.kind).filter(fits) : [];
    const keepAspect = () => {
      const now = entries.find((entry) => entry.id === relative.entry) || null;
      if (relative.aspect && !(now && atlasAspects(state.kinds, now.kind).filter(fits).some((spec) => spec.aspect === relative.aspect))) {
        relative.aspect = "";
        return true;
      }
      return false;
    };
    return h(
      "fieldset",
      { class: "oba-atlas-point", id: `${idPrefix}-${base}`, tabindex: "-1" },
      h("legend", {}, "Dated against"),
      field(`${base}-order`, "Order", h("select", { onChange: (event) => { relative.order = event.target.value; const cleared = keepAspect(); rerender(`${base}-order`); if (cleared) say("The other entry's aspect does not last, so it was cleared; during needs one that lasts."); } }, (state.kinds?.orders || ["before", "after", "during"]).map((order) => h("option", { value: order, selected: relative.order === order }, ATLAS_ORDER_LABELS[order] || order))), "Asserted and cited like any dating. Nothing infers an order from absolute dates, and it never makes a relationship."),
      field(`${base}-entry`, "Other entry", h("select", { onChange: (event) => { relative.entry = event.target.value; const cleared = keepAspect(); rerender(`${base}-entry`); if (cleared) say("That entry does not have the chosen aspect, so it was cleared."); } }, h("option", { value: "", selected: !relative.entry }, "Choose an entry"), entries.map((entry) => h("option", { value: entry.id, selected: relative.entry === entry.id }, `${entry.label} (${atlasKindLabel(entry.kind).toLowerCase()}, ${entry.id})`)))),
      field(`${base}-aspect`, "Its dated aspect", h("select", { onChange: (event) => { relative.aspect = event.target.value; refreshReading(index); } }, h("option", { value: "", selected: !relative.aspect }, target ? "Choose an aspect" : "Choose the entry first"), aspects.map((spec) => h("option", { value: spec.aspect, selected: relative.aspect === spec.aspect }, atlasAspectLabel(spec.aspect)))), "Only aspects that entry's kind has are offered; during offers only aspects that last."),
    );
  };

  const datingEditor = (dating, index) => {
    const p = `dating-${index}`;
    const number = index + 1;
    const aspects = datingAspects();
    const spec = aspects.find((item) => item.aspect === dating.aspect) || null;
    const forms = {
      at: () => [pointEditor(dating, index, "at", "The point")],
      range: () => [pointEditor(dating, index, "from", "From", "Open: no stated start"), pointEditor(dating, index, "to", "To", "Open: no stated end")],
      window: () => [pointEditor(dating, index, "notBefore", "Not before (the earliest it can be)", "Open: no earliest point, so before the latest"), pointEditor(dating, index, "notAfter", "Not after (the latest it can be)", "Open: no latest point, so after the earliest")],
      unknown: () => [h("p", { class: "oba-small" }, "Recorded as the party's statement that the date is unknown: never a missing value or a placeholder year.")],
      relative: () => [relativeEditor(dating, index)],
    };
    return h(
      "fieldset",
      { class: "oba-atlas-dating", id: `${idPrefix}-${p}`, tabindex: "-1", "data-atlas-dating": String(index) },
      h("legend", {}, `Dating ${number}`),
      dating.storedId
        ? h("p", { class: "oba-small" }, `Identifier: ${dating.id}. It cannot change; prompts and pages name the dating by it.`)
        : field(`${p}-id`, "Identifier", h("input", { type: "text", value: dating.id, autocomplete: "off", spellcheck: "false", onInput: (event) => { dating.idTouched = true; dating.id = event.target.value.trim(); } }), "Lowercase letters, digits and hyphens, unique across the atlas. It cannot change once saved."),
      field(
        `${p}-aspect`,
        "What it dates",
        h(
          "select",
          { onChange: (event) => {
            dating.aspect = event.target.value;
            if (!dating.storedId && !dating.idTouched) dating.id = suggestDatingId(dating);
            const lasts = datingAspects().find((item) => item.aspect === dating.aspect)?.durative;
            if (dating.form === "range" && !lasts) {
              dating.form = "window";
              dating.points.notBefore = dating.points.from;
              dating.points.notAfter = dating.points.to;
              rerender(`${p}-aspect`);
              say(`A ${dating.aspect} happens at one time, so the duration became a window with the same ends.`);
              return;
            }
            rerender(`${p}-aspect`);
          } },
          spec ? null : h("option", { value: "", selected: true }, "Choose an aspect"),
          aspects.map((item) => h("option", { value: item.aspect, selected: dating.aspect === item.aspect }, atlasAspectLabel(item.aspect))),
        ),
        isEntry ? `Only aspects a ${draft.kind} can have are offered. Several datings may date the same aspect.` : "A relationship is dated only by its span: when it held. It dates the relationship and is not evidence for it.",
      ),
      h(
        "fieldset",
        { class: "oba-atlas-date-form", id: `${idPrefix}-${p}-form`, tabindex: "-1" },
        h("legend", {}, "When"),
        ATLAS_DATE_FORMS.map(({ form, label }) => {
          const id = `${idPrefix}-${p}-form-${form}`;
          const blocked = form === "range" && spec && !spec.durative;
          return h("div", { class: "oba-capture-check" }, h("input", { id, type: "radio", name: `${idPrefix}-${p}-form`, value: form, checked: dating.form === form, disabled: Boolean(blocked) && dating.form !== form, onChange: () => { dating.form = form; rerender(`${p}-form-${form}`); } }), h("label", { for: id }, label));
        }),
        spec && !spec.durative ? h("p", { class: "oba-small" }, `A ${dating.aspect} happens at one time, so its uncertainty is a window, not a duration.`) : null,
      ),
      forms[dating.form] ? forms[dating.form]() : null,
      h("p", { class: "oba-atlas-reads", id: `${idPrefix}-${p}-reads`, "data-atlas-reads": String(index) }, `Reads: ${atlasDatingReading(dating, state.entries || [])}`),
      partyEditor(`${p}-asserted`, "Dated by", dating.assertedBy, "Who gives this date. It is attribution, not a contributor credit."),
      field(`${p}-confidence`, "Confidence", h("select", { onChange: (event) => { dating.confidence = event.target.value; } }, ATLAS_CONFIDENCE.map((item) => h("option", { value: item.value, selected: dating.confidence === item.value }, item.label))), "How firmly that party holds this date, never how widely it is accepted. An unsourced draft cannot be strong."),
      h(
        "fieldset",
        { class: "oba-atlas-evidence-list", id: `${idPrefix}-${p}-evidence`, tabindex: "-1" },
        h("legend", {}, `Evidence for dating ${number}`),
        evidenceEditor(dating.evidence, `${p}-`, { item: (n) => `Dating ${number} evidence ${n}`, add: `Add evidence to dating ${number}`, remove: (n) => `Remove evidence ${n} from dating ${number}` }, () => { dating.unsourced = false; }),
        check(`${p}-unsourced`, "Unsourced draft: no evidence yet", dating.unsourced && !dating.evidence.length, (on) => { dating.unsourced = on; }, dating.evidence.length ? "Remove all evidence to mark this dating as an unsourced draft." : "The explicit draft state for a dating that cites nothing yet. It can be neither strong nor approved.", dating.evidence.length > 0),
      ),
      field(`${p}-note`, "Note (optional)", h("textarea", { rows: 2, value: dating.note, onInput: (event) => { dating.note = event.target.value; } }), "What is doubtful, or how the party reckons the date (a regnal year, an Olympiad). Stored as text."),
      check(`${p}-approved`, "Approved for the publication projection", dating.approved, (on) => { dating.approved = on; }, "Your consent for this dating alone. It needs cited evidence and no notebook passage, and it stays private while what it dates, or the entry it is dated against, is private. While the site publishes its atlas, an approved dating appears on the entry's page, the timeline and atlas.json with who dates it, the evidence and the note."),
      h("button", { class: "oba-btn oba-btn-danger", type: "button", "data-atlas-remove-dating": String(index), onClick: () => { draft.datings.splice(index, 1); rerender("add-dating"); say(`Dating ${number} removed. Nothing is stored until you save.`); } }, `Remove dating ${number}`),
    );
  };

  const datingsEditor = () => {
    const aspects = datingAspects();
    const max = state.kinds?.maxDatings || DEFAULT_MAX_DATINGS;
    return h(
      "fieldset",
      { class: "oba-atlas-dates", id: `${idPrefix}-dates`, tabindex: "-1" },
      h("legend", {}, "Dates"),
      h("p", { class: "oba-small", "data-atlas-dates-summary": "true" }, atlasDatesText(draft.datings.length)),
      draft.datings.map(datingEditor),
      h("button", {
        class: "oba-btn",
        type: "button",
        id: `${idPrefix}-add-dating`,
        "data-atlas-add-dating": "true",
        disabled: draft.datings.length >= max || !aspects.length,
        onClick: () => {
          const dating = atlasDatingDraft(null, { aspect: aspects[0]?.aspect || "" });
          draft.datings.push(dating);
          dating.id = suggestDatingId(dating);
          rerender(`dating-${draft.datings.length - 1}-aspect`);
        },
      }, "Add a dating"),
    );
  };

  const entryFields = () => {
    const fields = [];
    if (editing) fields.push(h("p", { class: "oba-small" }, `Kind: ${atlasKindLabel(draft.kind)}. An entry keeps its kind; record a different kind of thing as a new entry. Identifier: ${draft.id}.`));
    else {
      fields.push(field("kind", "Kind", h("select", { onChange: (event) => {
        draft.kind = event.target.value;
        if (draft.kind !== "work") draft.source = "";
        const allowed = datingAspects();
        const moved = draft.datings.filter((dating) => dating.aspect && !allowed.some((item) => item.aspect === dating.aspect));
        for (const dating of moved) dating.aspect = "";
        rerender("kind");
        if (moved.length) say(`${plural(moved.length, "dating")} dated an aspect a ${draft.kind} does not have, so ${moved.length === 1 ? "its aspect was" : "their aspects were"} cleared.`);
      } }, ATLAS_ENTRY_KINDS.map((kind) => h("option", { value: kind.kind, selected: draft.kind === kind.kind }, kind.label))), "It decides which relationships the entry may join, and it cannot change later."));
    }
    fields.push(field("label", "Label", h("input", { type: "text", value: draft.label, autocomplete: "off", onInput: (event) => {
      draft.label = event.target.value;
      if (!editing && !idTouched) {
        draft.id = suggestAtlasId(draft.label, used(), draft.kind);
        const idInput = control("id");
        if (idInput) idInput.value = draft.id;
      }
    } }), "Your name for it, shown in lists. Stored as text."));
    if (!editing) fields.push(field("id", "Identifier", h("input", { type: "text", value: draft.id, autocomplete: "off", spellcheck: "false", onInput: (event) => { idTouched = true; draft.id = event.target.value.trim(); } }), "Lowercase letters, digits and hyphens. It cannot change later; a concept's identifier is what notebook concept links use."));
    fields.push(
      field("aliases", "Other names (optional)", h("textarea", { rows: 2, value: draft.aliases, onInput: (event) => { draft.aliases = event.target.value; } }), "One per line. Search finds an entry by any of them."),
      field("summary", "Summary (optional)", h("textarea", { rows: 4, value: draft.summary, onInput: (event) => { draft.summary = event.target.value; } }), "Your own words. Quotations belong in notebook passages."),
    );
    if (draft.kind === "work") fields.push(field("source", "Source-library work (optional)", sourceSelect(draft.source, (value) => { draft.source = value; }, "work"), "Editions, translations and witnesses are cited as evidence, never made entries."));
    fields.push(
      datingsEditor(),
      check("approved", "Approved for the publication projection", draft.approved, (on) => { draft.approved = on; }, "Your consent to publish this entry on the site's Knowledge Atlas pages and atlas.json, once the site turns on knowledgeAtlas.publish. Only its label, other names, summary and work source are published, with the datings you approve one by one. Clearing it removes the entry and its datings from the next build."),
    );
    return fields;
  };

  const relationshipFields = () => {
    const spec = atlasKindSpec(state.kinds, draft.kind);
    const entries = state.entries || [];
    const fromEntry = entries.find((entry) => entry.id === draft.from) || null;
    const toEntry = entries.find((entry) => entry.id === draft.to) || null;
    const entryOption = (entry, current) => h("option", { value: entry.id, selected: current === entry.id }, `${entry.label} (${atlasKindLabel(entry.kind).toLowerCase()}, ${entry.id})`);
    const endpointSelect = (end, current, choices, placeholder) =>
      h(
        "select",
        { onChange: (event) => {
          draft[end] = event.target.value;
          const otherEnd = end === "from" ? "to" : "from";
          const chosen = entries.find((entry) => entry.id === draft[end]) || null;
          if (draft[otherEnd] && !atlasEndpointChoices(state.kinds, draft.kind, otherEnd, entries, chosen).some((entry) => entry.id === draft[otherEnd])) {
            draft[otherEnd] = "";
            rerender(end);
            say(`The ${otherEnd === "from" ? "starting" : "target"} entry did not fit, so it was cleared.`);
            return;
          }
          rerender(end);
        } },
        h("option", { value: "", selected: !current }, placeholder),
        choices.map((entry) => entryOption(entry, current)),
      );
    const kindHint = spec
      ? `Reads “${fromEntry ? fromEntry.label : "A"} ${spec.kind.replace(/-/g, " ")} ${toEntry ? toEntry.label : "B"}”; from the other end it reads “${spec.inverse}”. Only this direction is asserted. Joins ${spec.from.join(", ")} to ${spec.to.join(", ")}${spec.sameKind ? ", both of one kind" : ""}${spec.acyclic ? "; it cannot form a cycle" : ""}.`
      : "The kind decides which entries may stand at each end.";
    const fields = [
      field("kind", "Kind of relationship", h(
        "select",
        { onChange: (event) => {
          draft.kind = event.target.value;
          const cleared = [];
          const from = entries.find((entry) => entry.id === draft.from) || null;
          if (draft.from && !atlasEndpointChoices(state.kinds, draft.kind, "from", entries, null).some((entry) => entry.id === draft.from)) {
            draft.from = "";
            cleared.push("starting");
          }
          if (draft.to && !atlasEndpointChoices(state.kinds, draft.kind, "to", entries, draft.from ? from : null).some((entry) => entry.id === draft.to)) {
            draft.to = "";
            cleared.push("target");
          }
          rerender("kind");
          if (cleared.length) say(`The ${cleared.join(" and ")} ${cleared.length === 1 ? "entry does" : "entries do"} not fit a ${draft.kind} relationship, so ${cleared.length === 1 ? "it was" : "they were"} cleared.`);
        } },
        h("option", { value: "", selected: !draft.kind }, "Choose a kind"),
        (state.kinds?.relationships || []).map((kind) => h("option", { value: kind.kind, selected: draft.kind === kind.kind }, `${kind.kind} (${kind.from.length === 5 ? "any" : kind.from.join(", ")} to ${kind.to.length === 5 ? "any" : kind.to.join(", ")})`)),
      ), kindHint),
      field("from", "From", endpointSelect("from", draft.from, atlasEndpointChoices(state.kinds, draft.kind, "from", entries, toEntry), "Choose the starting entry"), "Only entries this kind may start from are offered."),
      field("to", "To", endpointSelect("to", draft.to, atlasEndpointChoices(state.kinds, draft.kind, "to", entries, fromEntry), "Choose the target entry"), "Only entries this kind may point to are offered."),
      partyEditor("asserted", "Asserted by", draft.assertedBy, "Who makes this claim. It is attribution, not a contributor credit."),
      field("confidence", "Confidence", h("select", { onChange: (event) => { draft.confidence = event.target.value; } }, ATLAS_CONFIDENCE.map((item) => h("option", { value: item.value, selected: draft.confidence === item.value }, item.label))), "How firmly the asserting party holds it, never how widely it is accepted. An unsourced draft cannot be strong."),
      h(
        "fieldset",
        { class: "oba-atlas-evidence-list", id: `${idPrefix}-evidence`, tabindex: "-1" },
        h("legend", {}, "Evidence"),
        h("p", { class: "oba-small" }, "Sources from your library, with optional notebook passages and locators. Evidence is cited, never copied."),
        evidenceEditor(draft.evidence, "", { item: (number) => `Evidence ${number}`, add: "Add evidence", remove: (number) => `Remove evidence ${number}` }),
        check("unsourced", "Unsourced draft: no evidence yet", draft.unsourced && !draft.evidence.length, (on) => { draft.unsourced = on; }, draft.evidence.length ? "Remove all evidence to mark this relationship as an unsourced draft." : "The explicit draft state for a relationship that cites nothing yet. It can be neither strong nor approved.", draft.evidence.length > 0),
      ),
      field("uncertainty", "What is uncertain (optional)", h("textarea", { rows: 2, value: draft.uncertainty, onInput: (event) => { draft.uncertainty = event.target.value; } }), "Your note on what is doubtful or unsettled. It is shown wherever the relationship is listed."),
      h(
        "fieldset",
        { class: "oba-atlas-contested", id: `${idPrefix}-contested`, tabindex: "-1" },
        h("legend", {}, "Disagreements (optional)"),
        h("p", { class: "oba-small" }, "Each recorded dissent makes the relationship contested. Nothing here can mark a relationship as agreed."),
        draft.contestedBy.map(dissentEditor),
        h("button", { class: "oba-btn", type: "button", id: `${idPrefix}-add-dissent`, "data-atlas-add-dissent": "true", disabled: draft.contestedBy.length >= MAX_ATLAS_DISSENTS, onClick: () => { draft.contestedBy.push(atlasDissentDraft({ by: { kind: "named" } })); rerender(`dissent-${draft.contestedBy.length - 1}-name`); } }, "Add a dissent"),
      ),
      datingsEditor(),
      check("approved", "Approved for the publication projection", draft.approved, (on) => { draft.approved = on; }, "Your consent to publish it with the Knowledge Atlas, only while both entries are approved too, with who asserts it, its evidence, confidence, doubt and dissents. An unsourced draft or evidence pointing into the private notebook cannot be approved. Clearing it removes it from the next build."),
    ];
    return fields;
  };

  const conflictNotice = () => {
    if (!editing) return h("p", { class: "oba-notice", role: "alert", "data-atlas-conflict": "true" }, "The atlas changed after you opened it, so nothing was saved. Your draft is still here; save again to add it to the latest atlas.");
    const removed = !conflict.current;
    return h(
      "div",
      { class: "oba-notice", role: "alert", "data-atlas-conflict": "true" },
      h("p", {}, removed ? `This ${type} was removed from the atlas after you opened it, so nothing was saved. Your draft is still here.` : `This ${type} was changed after you opened it, so nothing was saved. Your draft is still here. Choose which copy to continue with; nothing is overwritten until you save.`),
      h(
        "div",
        { class: "oba-toolbar" },
        h("button", { class: "oba-btn", type: "button", "data-atlas-conflict-use": "stored", onClick: () => resolveConflict(true) }, removed ? "Discard my draft" : "Use the stored copy"),
        removed ? null : h("button", { class: "oba-btn", type: "button", "data-atlas-conflict-use": "draft", onClick: () => resolveConflict(false) }, "Keep my draft"),
      ),
    );
  };

  const resolveConflict = (useStored) => {
    if (!conflict) return;
    const { current } = conflict;
    conflict = null;
    errorBox.hidden = true;
    clearInvalid();
    if (useStored) {
      if (!current) {
        touched = false;
        onCancel?.();
        return;
      }
      draft = isEntry ? atlasEntryDraft(current) : atlasRelationshipDraft(current);
      touched = false;
      say("Showing the stored copy.");
    } else {
      // The author has seen the newer copy: the draft now rests on it, and its unknown fields carry over.
      const before = draft.datings.length;
      if (isEntry) rebaseAtlasEntryDraft(draft, current);
      else rebaseAtlasRelationshipDraft(draft, current);
      const added = draft.datings.length - before;
      say(`Your draft now rests on the latest copy.${added ? ` ${plural(added, "dating")} added elsewhere ${added === 1 ? "was" : "were"} added to your draft.` : ""} Review it, then save.`);
    }
    rerender(isEntry ? "label" : "kind");
  };

  const render = () => {
    const save = h("button", { class: "oba-btn oba-btn-primary", type: "submit", "data-atlas-save": "true", disabled: busy || Boolean(conflict && editing) }, editing ? "Save changes" : isEntry ? "Add entry" : "Add relationship");
    const cancel = h("button", { class: "oba-btn", type: "button", "data-atlas-cancel": "true", onClick: () => onCancel?.() }, "Cancel");
    root.replaceChildren(...(isEntry ? entryFields() : relationshipFields()), errorBox, conflict ? conflictNotice() : null, h("div", { class: "oba-toolbar" }, save, cancel), status);
  };

  const refresh = async () => {
    applyAtlasState(state, await api.call("GET", "research/atlas"));
  };

  root.addEventListener("input", () => { touched = true; });
  root.addEventListener("change", () => { touched = true; });
  root.addEventListener("click", (event) => {
    if (event.target?.tagName === "BUTTON" && event.target.type === "button" && !event.target.dataset?.atlasCancel && !event.target.dataset?.atlasConflictUse) touched = true;
  });
  root.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    if (conflict && editing) {
      fail("Choose the stored copy or keep your draft before saving.");
      return;
    }
    errorBox.hidden = true;
    clearInvalid();
    conflict = null;
    const problem = isEntry
      ? validateAtlasEntryDraft(draft, { sources: state.sources || [], used: used(), creating: !editing })
      : validateAtlasRelationshipDraft(draft, { entries: state.entries || [], kinds: state.kinds, sources: state.sources || [], passages: state.passages || [] });
    if (problem) return fail(problem.message, problem.field);
    const datingProblem = validateAtlasDatings(draft.datings, { owner: datingOwner(), ownerId: isEntry ? draft.id : "", kinds: state.kinds, entries: state.entries || [], sources: state.sources || [], passages: state.passages || [], used: datingIdsInUse() });
    if (datingProblem) return fail(datingProblem.message, datingProblem.field);
    if (!isEntry && !editing) draft.id = suggestAtlasId(`${draft.from}-${draft.kind}-${draft.to}`, used(), "relationship");
    busy = true;
    root.querySelector("[data-atlas-save]")?.setAttribute("disabled", "");
    say("Saving…");
    const key = isEntry ? "entry" : "relationship";
    try {
      const result = await api.call(editing ? "PUT" : "POST", `research/atlas/${isEntry ? "entries" : "relationships"}`, { json: { revision: state.revision, [key]: isEntry ? atlasEntryPayload(draft) : atlasRelationshipPayload(draft) } });
      applyAtlasState(state, result);
      busy = false;
      touched = false;
      say("");
      onSaved?.({ type, item: result[key] || null, build: result.build });
    } catch (error) {
      busy = false;
      if (error.status === 409 && error.data?.conflict) {
        try {
          await refresh();
        } catch {
          // The next save reports whatever is wrong.
        }
        conflict = { current: error.data.current ?? null };
        say("Not saved: the atlas changed elsewhere.", "oba-error");
        render();
        onRefreshed?.();
        (editing ? root.querySelector("[data-atlas-conflict-use]") : root.querySelector("[data-atlas-save]"))?.focus();
        return;
      }
      say("Not saved. The stored atlas is unchanged.", "oba-error");
      render();
      const first = error.data?.diagnostics?.[0];
      fail(atlasErrorMessage(error), first ? atlasDiagnosticControl(first.field, type) : "");
    }
  });

  render();
  return {
    element: root,
    isDirty: () => touched && !busy,
    /** Moves focus to one dating's fieldset, as a check prompt's link does. */
    focusDating(index) {
      const target = control(`dating-${index}`);
      target?.focus();
      return Boolean(target);
    },
    focus() {
      (control(isEntry ? (editing ? "label" : "kind") : "kind") || root.querySelector("input,select,textarea,button"))?.focus();
    },
  };
}

// ---------------------------------------------------------------- comparison workspace

/** How aligned places correspond, in the author's reading. The server's labels replace these when it sends them. */
export const ALIGNMENT_CORRESPONDENCES = Object.freeze([
  { value: "corresponding", label: "The author reads these places as corresponding" },
  { value: "partial", label: "The author reads these places as corresponding in part" },
  { value: "divergent", label: "The author reads these places as corresponding but differing" },
]);
const ALIGNMENT_NOTICE_TEXT = "An alignment records where its author reads these places as corresponding. It does not say they mean the same thing, and no version is treated as authoritative.";
const MAX_ALIGNMENT_MEMBERS = 32;
const MAX_ALIGNMENT_RATIONALE_CHARS = 4000;
const MAX_ALIGNMENT_NORMALIZED_CHARS = 20000;
/**
 * Rights statuses that ask the author to confirm before copying: nobody has
 * checked yet, or the author states the text is under copyright. No status
 * ever means a use is allowed; the others only skip the extra confirmation.
 */
export const RIGHTS_NEEDING_CONFIRMATION = Object.freeze(["unknown", "rightsReserved"]);
const UNKNOWN_RIGHTS = Object.freeze({ status: "unknown", label: "Rights not checked yet", declared: false });
const RTL_LANGUAGES = new Set([
  "acm", "aeb", "ajp", "apc", "ar", "arc", "ary", "arz", "azb", "bal", "ckb", "dv", "fa", "glk", "hbo", "he", "iw", "ji", "jpr", "jrb",
  "ks", "lrc", "mzn", "nqo", "ota", "phn", "pnb", "prs", "ps", "sam", "sd", "syc", "syr", "ug", "ur", "yi",
]);
const RTL_SCRIPTS = new Set([
  "adlm", "arab", "aran", "armi", "avst", "chrs", "cprt", "elym", "hatr", "hebr", "hung", "khar", "lydi", "mand", "mani", "mend", "merc",
  "mero", "narb", "nbat", "nkoo", "ougr", "palm", "phli", "phlp", "phnx", "prti", "rohg", "samr", "sarb", "sogd", "sogo", "syrc", "thaa", "yezi",
]);
/** Script subtags known to run left to right. Any other script subtag leaves the direction to the browser. */
const LTR_SCRIPTS = new Set([
  "ahom", "armn", "bali", "bamu", "batk", "beng", "bopo", "brah", "brai", "bugi", "buhd", "cakm", "cans", "cari", "cham", "cher", "copt",
  "cyrl", "cyrs", "deva", "dogr", "dsrt", "dupl", "egyp", "ethi", "geok", "geor", "glag", "gong", "gonm", "goth", "gran", "grek", "gujr",
  "guru", "hang", "hani", "hano", "hans", "hant", "hira", "hmng", "hrkt", "ital", "java", "jpan", "kali", "kana", "kawi", "khmr", "khoj",
  "knda", "kore", "kthi", "lana", "laoo", "latf", "latg", "latn", "lepc", "limb", "lina", "linb", "lisu", "lyci", "mahj", "maka", "marc",
  "medf", "mlym", "modi", "mong", "mroo", "mtei", "mult", "mymr", "nagm", "nand", "newa", "nshu", "ogam", "olck", "orkh", "orya", "osge",
  "osma", "perm", "phag", "plrd", "runr", "saur", "sgnw", "shaw", "shrd", "sidd", "sind", "sinh", "sora", "soyo", "sund", "sylo", "tagb",
  "takr", "tale", "talu", "taml", "tang", "tavt", "telu", "tfng", "tglg", "thai", "tibt", "tirh", "toto", "ugar", "vaii", "vith", "wara",
  "wcho", "xpeo", "xsux", "yiii", "zanb",
]);
const VERSION_MAKERS = Object.freeze({
  edition: { role: "editor", one: "Editor", many: "Editors" },
  translation: { role: "translator", one: "Translator", many: "Translators" },
  witness: { role: "scribe", one: "Scribe", many: "Scribes" },
});
const VERSION_KIND_LABELS = Object.freeze({ work: "Work", edition: "Edition", translation: "Translation", witness: "Witness", reference: "Reference" });

/** A language tag safe to put in a `lang` attribute, or "" for anything else. */
export function languageTag(value) {
  const tag = String(value ?? "").trim();
  return /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,7}$/.test(tag) ? tag : "";
}

/**
 * The base direction for text in a language: a script subtag decides first,
 * then the language. Text with no usable tag, or a script subtag this list
 * does not know, gets `auto`, so the browser decides from its first strong
 * character instead of guessing left to right.
 */
export function textDirection(language) {
  const tag = languageTag(language).toLowerCase();
  if (!tag) return "auto";
  const [base, ...subtags] = tag.split("-");
  const script = subtags.find((part) => /^[a-z]{4}$/.test(part));
  if (script) return RTL_SCRIPTS.has(script) ? "rtl" : LTR_SCRIPTS.has(script) ? "ltr" : "auto";
  return RTL_LANGUAGES.has(base) ? "rtl" : "ltr";
}

/** Locators as a reader says them: `canonical 514a, volume 2`. */
export function locatorText(locators) {
  return (Array.isArray(locators) ? locators : [])
    .map((locator) => `${String(locator?.kind ?? "").replace(/^x-csl-/, "").replace(/^x-/, "")} ${locator?.value ?? ""}${locator?.to ? ` to ${locator.to}` : ""}`.trim())
    .filter(Boolean)
    .join(", ");
}

const certaintyText = (name, certainty, note) => `${name}${certainty || note ? ` (${[certainty, note].filter(Boolean).join(": ")})` : ""}`;

/** Who made a version, in its maker role, saying so when the source names nobody or nothing is recorded. */
export function versionMakerText(source) {
  const maker = VERSION_MAKERS[source?.kind];
  if (!maker) return "";
  const creators = (Array.isArray(source.creators) ? source.creators : []).filter((creator) => creator && creator.role === maker.role && typeof creator.name === "string");
  if (creators.length) return `${creators.length === 1 ? maker.one : maker.many}: ${creators.map((creator) => certaintyText(creator.name, creator.attribution, creator.note)).join("; ")}`;
  if (source.anonymous) return `${maker.one}: anonymous; the source names nobody`;
  return `${maker.one}: not recorded`;
}

/** Who made an interpretation, with each name's attribution certainty. */
export function interpretersText(interpretation) {
  const interpreters = Array.isArray(interpretation?.interpreters) ? interpretation.interpreters : [];
  if (!interpreters.length) return interpretation?.anonymous ? "Interpreted by: anonymous; nobody is named" : "Interpreted by: not recorded";
  const names = interpreters.map((person) => certaintyText(String(person?.display || person?.name || person?.contributor || "Unnamed"), person?.attribution));
  return `Interpreted by: ${names.join("; ")}${interpretation.anonymous ? " (recorded as anonymous)" : ""}`;
}

const rightsOf = (value) => (value && typeof value === "object" && typeof value.status === "string" ? value : UNKNOWN_RIGHTS);

/** One line for a rights declaration: the author's statement, a licence name, and the note, never a permission. */
export function rightsText(rights) {
  const value = rightsOf(rights);
  return `${value.label || UNKNOWN_RIGHTS.label}${value.license ? ` (${value.license})` : ""}${value.note ? `. ${value.note}` : ""}`;
}

const kindLanguage = (kind, language) => `${VERSION_KIND_LABELS[kind] || "Source"}${languageTag(language) ? `, language ${languageTag(language)}` : ""}`;

/**
 * The comparison of one alignment: one column per version or interpretation,
 * in the order the author first placed them, each holding that version's
 * places in member order. Every place carries what identifies it on its own
 * (version, maker, locator) so it can be read, or copied, out of its column.
 * Text is passed through exactly; nothing here normalizes or rewrites it.
 */
export function comparisonColumns(alignment, context = {}) {
  const list = (value) => (Array.isArray(value) ? value : []);
  const sources = list(context.sources);
  const passages = list(context.passages);
  const interpretations = list(context.interpretations);
  const notices = list(context.notices).filter((notice) => notice?.id === alignment?.id);
  const sourceById = (id) => sources.find((source) => source.id === id) || null;
  const named = (id) => {
    const source = sourceById(id);
    return source ? `${sourceLabel(source)} (${String(source.kind || "").toLowerCase()})` : `${id} (missing)`;
  };
  const columns = [];
  const sourceColumn = (id) => {
    const source = sourceById(id);
    const facts = [];
    if (source) {
      const chain = list(source.chain);
      if (chain.length) facts.push({ label: "Realizes", parts: chain.flatMap((link, index) => [index ? ", which realizes " : "", { text: `${String(link.title || link.id)}` }, ` (${link.kind})`]).filter(Boolean) });
      if (source.basedOn) facts.push({ label: "Made from", parts: [{ text: named(source.basedOn) }] });
      if (source.revises) facts.push({ label: "Revises", parts: [{ text: named(source.revises) }] });
      if (source.repository || source.shelfmark) facts.push({ label: "Held at", parts: [{ text: [source.repository, source.shelfmark].filter(Boolean).join(", ") }] });
      if (Number.isInteger(source.volumes)) facts.push({ label: "Volumes", parts: [String(source.volumes)] });
      if (source.issued) facts.push({ label: "Issued", parts: [{ text: String(source.issued) }] });
      if (source.archived) facts.push({ label: "Library", parts: ["Archived"] });
    }
    return {
      key: `source:${id}`,
      type: "source",
      id,
      missing: !source,
      title: source ? sourceLabel(source) : `Missing source ${id}`,
      kindText: source ? kindLanguage(source.kind, source.language) : "Not in the library",
      maker: source ? versionMakerText(source) : "",
      facts,
      rights: rightsOf(source?.rightsStatus),
      places: [],
    };
  };
  const interpretationColumn = (id) => {
    const interpretation = interpretations.find((item) => item.id === id) || null;
    const facts = [];
    if (interpretation) {
      facts.push({ label: "Interprets", parts: [{ text: named(interpretation.source) }] });
      if (interpretation.uncertainty) facts.push({ label: "Uncertain", parts: [{ text: interpretation.uncertainty }] });
    }
    const kind = interpretation?.kind === "rendering" ? "Rendering" : "Reading";
    return {
      key: `interpretation:${id}`,
      type: "interpretation",
      id,
      missing: !interpretation,
      title: interpretation ? `${kind} ${id}` : `Missing interpretation ${id}`,
      kindText: interpretation ? `Interpretation (${kind.toLowerCase()})${languageTag(interpretation.language) ? `, language ${languageTag(interpretation.language)}` : ""}` : "Not in the library",
      maker: interpretation ? interpretersText(interpretation) : "",
      facts,
      rights: rightsOf(interpretation?.rightsStatus),
      places: [],
      interpretation,
    };
  };
  list(alignment?.members).forEach((member, index) => {
    const isInterpretation = typeof member?.interpretation === "string";
    const key = isInterpretation ? `interpretation:${member.interpretation}` : `source:${member?.source}`;
    let column = columns.find((item) => item.key === key);
    if (!column) {
      column = isInterpretation ? interpretationColumn(member.interpretation) : sourceColumn(member?.source);
      columns.push(column);
    }
    const passage = typeof member?.passage === "string" ? passages.find((item) => item.id === member.passage) || null : null;
    let original = null;
    if (passage && typeof passage.excerpt?.text === "string") original = { text: passage.excerpt.text, language: languageTag(passage.excerpt.language), from: `notebook passage ${passage.id}` };
    else if (isInterpretation && column.interpretation) original = { text: String(column.interpretation.text ?? ""), language: languageTag(column.interpretation.language), from: `interpretation ${column.id}` };
    const locators = list(member?.locators).length ? member.locators : passage ? passage.locators : isInterpretation ? column.interpretation?.locators : [];
    const normalized = member?.normalized && typeof member.normalized.text === "string" ? { text: member.normalized.text, note: typeof member.normalized.note === "string" ? member.normalized.note : "", language: original?.language || "" } : null;
    column.places.push({
      index,
      absent: Boolean(member?.absent),
      locator: locatorText(locators),
      original,
      missingPassage: typeof member?.passage === "string" && !passage,
      normalized,
      note: typeof member?.note === "string" ? member.note : "",
      notices: notices.filter((notice) => String(notice.field || "").startsWith(`members[${index}]`)).map((notice) => String(notice.message || "")),
    });
  });
  return columns;
}

/** Columns whose selected places quote text under a status that asks for confirmation before copying. */
export function rightsToConfirm(columns, selected) {
  return (Array.isArray(columns) ? columns : []).filter(
    (column) => RIGHTS_NEEDING_CONFIRMATION.includes(rightsOf(column.rights).status) && column.places.some((place) => selected.has(place.index) && place.original),
  );
}

/**
 * Plain text for the places the author selected, each identified by version,
 * maker, locator and rights statement, with the original wording exactly as
 * stored. A normalization is included only when asked for, and labelled; the
 * author's private notes on places only when `notes` is set.
 */
export function comparisonExportText(alignment, columns, selected, { normalized = false, notes = false, correspondence = "", notice = ALIGNMENT_NOTICE_TEXT } = {}) {
  const lines = [`Alignment: ${alignment?.label || alignment?.id || ""}`];
  if (correspondence) lines.push(correspondence);
  lines.push(notice, "");
  for (const column of Array.isArray(columns) ? columns : []) {
    for (const place of column.places.filter((item) => selected.has(item.index))) {
      lines.push(`${column.title} (${column.kindText})`);
      if (column.maker) lines.push(column.maker);
      lines.push(`Locator: ${place.locator || "none recorded"}`);
      lines.push(`Rights: ${rightsText(column.rights)}`);
      if (place.absent) lines.push("Absent: this version lacks the passage.");
      else if (place.original) lines.push(`Original wording, from ${place.original.from}:`, place.original.text);
      else lines.push("No wording quoted for this place.");
      if (normalized && place.normalized) {
        lines.push("The author's normalization, not the source text:", place.normalized.text);
        if (place.normalized.note) lines.push(`Normalized: ${place.normalized.note}`);
      }
      if (notes && place.note) lines.push(`Author's note: ${place.note}`);
      lines.push("");
    }
  }
  lines.push("Private research copied from open.blog Admin. Rights statements are the author's own; open.blog does not decide what is permitted.");
  return `${lines.join("\n")}\n`;
}

/** Copy the parts of an alignments response that describe the stored file into the view state. */
export function applyAlignmentState(state, result) {
  for (const key of ["revision", "file", "stored", "alignments", "sources", "passages", "interpretations", "notices", "notice", "correspondences", "publication"]) {
    if (result && result[key] !== undefined) state[key] = result[key];
  }
  for (const key of ["alignments", "sources", "passages", "interpretations", "notices"]) if (!Array.isArray(state[key])) state[key] = [];
  if (!Array.isArray(state.correspondences) || !state.correspondences.length) state.correspondences = ALIGNMENT_CORRESPONDENCES.map((item) => ({ ...item }));
  if (typeof state.notice !== "string" || !state.notice) state.notice = ALIGNMENT_NOTICE_TEXT;
  if (!state.publication || typeof state.publication !== "object") state.publication = {};
  if (!state.publication.places || typeof state.publication.places !== "object") state.publication.places = {};
  state.publication.publish = state.publication.publish === true;
  if (typeof state.publication.url !== "string") state.publication.url = "/comparisons/";
  if (!Number.isInteger(state.publication.maxExcerptChars)) state.publication.maxExcerptChars = 1000;
  return state;
}

export function correspondenceLabel(state, value) {
  const list = Array.isArray(state?.correspondences) && state.correspondences.length ? state.correspondences : ALIGNMENT_CORRESPONDENCES;
  return (list.find((item) => item.value === (value || "corresponding")) || list[0]).label;
}

/** Sources a member may name: editions, translations and witnesses, never a work or reference. */
export function alignableSources(sources) {
  return (Array.isArray(sources) ? sources : []).filter((source) => ["edition", "translation", "witness"].includes(source?.kind));
}

/**
 * A member's draft. `from` is the index of the stored member it edits, or
 * null for a new place, so a later rebase can find that member again.
 */
export function alignmentMemberDraft(record = null, from = null) {
  const member = record && typeof record === "object" ? record : {};
  return {
    original: record ? structuredClone(record) : {},
    from: record && Number.isInteger(from) ? from : null,
    type: typeof member.interpretation === "string" ? "interpretation" : "source",
    source: typeof member.source === "string" ? member.source : "",
    interpretation: typeof member.interpretation === "string" ? member.interpretation : "",
    passage: typeof member.passage === "string" ? member.passage : "",
    locators: formatLocatorLines(member.locators),
    absent: Boolean(member.absent),
    normalized: typeof member.normalized?.text === "string" ? member.normalized.text : "",
    normalizedNote: typeof member.normalized?.note === "string" ? member.normalized.note : "",
    note: typeof member.note === "string" ? member.note : "",
  };
}

export function alignmentDraft(record = null) {
  const alignment = record && typeof record === "object" ? record : {};
  const members = Array.isArray(alignment.members) ? alignment.members.map((member, index) => alignmentMemberDraft(member, index)) : [alignmentMemberDraft(), alignmentMemberDraft()];
  return {
    original: record ? structuredClone(record) : null,
    id: typeof alignment.id === "string" ? alignment.id : "",
    label: typeof alignment.label === "string" ? alignment.label : "",
    correspondence: ALIGNMENT_CORRESPONDENCES.some((item) => item.value === alignment.correspondence) ? alignment.correspondence : "corresponding",
    members,
    rationale: typeof alignment.rationale === "string" ? alignment.rationale : "",
    confidence: ATLAS_CONFIDENCE.some((item) => item.value === alignment.confidence) ? alignment.confidence : "tentative",
    uncertainty: typeof alignment.uncertainty === "string" ? alignment.uncertainty : "",
    recordedBy: atlasAttributionDraft(alignment.recordedBy),
    approved: alignment.visibility === "approved",
    publishNormalized: alignment.publishNormalized === true,
  };
}

/** One member to send, built on the stored member it edits so unknown fields carry over. Text is sent exactly as typed. */
export function alignmentMemberPayload(draft) {
  const original = draft.original || {};
  const record = { ...original };
  for (const field of ["source", "interpretation", "passage", "locators", "absent", "normalized", "note"]) delete record[field];
  if (draft.type === "interpretation") record.interpretation = draft.interpretation;
  else {
    record.source = draft.source;
    if (draft.absent) record.absent = true;
    else {
      if (draft.passage) record.passage = draft.passage;
      const locators = keepUnchanged(parseLocatorLines(draft.locators), original.locators, sameLocator);
      if (locators.length) record.locators = locators;
    }
  }
  const wording = draft.type === "interpretation" || (!draft.absent && draft.passage);
  if (wording && String(draft.normalized ?? "").length && String(draft.normalized).trim()) {
    const normalized = { ...(original.normalized || {}), text: String(draft.normalized) };
    delete normalized.note;
    if (String(draft.normalizedNote ?? "").trim()) normalized.note = String(draft.normalizedNote);
    record.normalized = normalized;
  }
  if (String(draft.note ?? "").trim()) record.note = String(draft.note);
  return record;
}

/**
 * What a public comparison page would show for each place, as the server
 * previews it (ADR 0092). The statuses follow the author's rights statement
 * and the excerpt limit; none of them is a judgement of what is permitted.
 */
export function publicPlaceText(status, maxChars = 1000) {
  switch (status) {
    case "shown":
      return "On a public page: its wording is shown, with the version's rights statement.";
    case "withheld-rights":
      return "On a public page: identified and located only, because the version's rights are unknown or reserved.";
    case "withheld-length":
      return `On a public page: identified and located only, because its wording is longer than the ${maxChars}-character excerpt limit.`;
    case "unquoted":
      return "On a public page: located only; no wording is quoted for it.";
    case "absent":
      return "On a public page: recorded as absent from this version.";
    default:
      return "";
  }
}

/** What a save or removal did to the published site, when the site publishes comparisons. */
export function comparisonBuildText(build) {
  if (!build || typeof build !== "object") return "";
  if (build.ok) return " The published comparisons were rebuilt.";
  return ` The change is saved, but the site could not be rebuilt: ${String(build.error || "unknown error")}`;
}

/** The full alignment to send. Evidence and unknown stored fields, which this form does not edit, are carried over. */
export function alignmentPayload(draft) {
  const record = { ...(draft.original || {}) };
  for (const field of ["label", "rationale", "uncertainty"]) delete record[field];
  record.id = String(draft.id || "").trim();
  if (String(draft.label ?? "").trim()) record.label = String(draft.label).trim();
  record.correspondence = draft.correspondence;
  record.members = draft.members.map(alignmentMemberPayload);
  if (String(draft.rationale ?? "").trim()) record.rationale = draft.rationale;
  record.confidence = draft.confidence;
  if (String(draft.uncertainty ?? "").trim()) record.uncertainty = draft.uncertainty;
  record.recordedBy = atlasAttributionPayload(draft.recordedBy);
  record.visibility = draft.approved ? "approved" : "private";
  delete record.publishNormalized;
  if (draft.publishNormalized) record.publishNormalized = true;
  return record;
}

/** The draft now rests on the newer stored copy: fields it does not edit come from that copy. */
export function rebaseAlignmentDraft(draft, current) {
  draft.original = structuredClone(current);
  draft.recordedBy.original = structuredClone(current.recordedBy || { kind: "author" });
  const stored = Array.isArray(current.members) ? current.members : [];
  const claimed = new Set();
  const twins = new Map();
  // A member rests on the stored member it was read from while that member is
  // still the same place; otherwise on the first unclaimed member with the same
  // identity. Each stored member is claimed once, and a member matches only by
  // what it was read as, never by what the author has since typed.
  for (const member of draft.members) {
    const identity = alignmentMemberIdentity(member.original);
    if (identity && Number.isInteger(member.from) && member.from < stored.length && alignmentMemberIdentity(stored[member.from]) === identity) {
      claimed.add(member.from);
      twins.set(member, member.from);
    }
  }
  for (const member of draft.members) {
    if (twins.has(member)) continue;
    const identity = alignmentMemberIdentity(member.original);
    const index = identity ? stored.findIndex((item, at) => !claimed.has(at) && alignmentMemberIdentity(item) === identity) : -1;
    if (index >= 0) {
      claimed.add(index);
      twins.set(member, index);
    }
  }
  for (const member of draft.members) {
    const index = twins.get(member);
    if (index === undefined) member.from = null;
    else {
      member.original = structuredClone(stored[index]);
      member.from = index;
    }
  }
  return draft;
}

/** What place a stored member is: its version or interpretation, passage and locators. "" for a new member. */
export function alignmentMemberIdentity(member) {
  if (!member || typeof member !== "object" || (typeof member.source !== "string" && typeof member.interpretation !== "string")) return "";
  const locators = (Array.isArray(member.locators) ? member.locators : []).map((locator) => [locator?.kind ?? "", locator?.value ?? "", locator?.to ?? ""]);
  return JSON.stringify([typeof member.interpretation === "string" ? `i:${member.interpretation}` : `s:${member.source}`, member.passage ?? "", locators]);
}

/** A quick, advisory check; the server's validation stays authoritative. */
export function validateAlignmentDraft(draft, { used = [], creating = false, sources = [], passages = [], interpretations = [] } = {}) {
  if (creating) {
    if (!validAtlasId(draft.id)) return { field: "id", message: "Use an identifier of lowercase letters, digits and single hyphens, such as cave-opening, at most 64 characters." };
    if (used.includes(draft.id)) return { field: "id", message: "That identifier is already used by another alignment; choose another." };
  }
  if (codePoints(draft.label) > MAX_ATLAS_SHORT_CHARS) return { field: "label", message: `A label is limited to ${MAX_ATLAS_SHORT_CHARS} characters.` };
  if (draft.members.length > MAX_ALIGNMENT_MEMBERS) return { field: "members", message: `An alignment may have at most ${MAX_ALIGNMENT_MEMBERS} places.` };
  for (const [index, member] of draft.members.entries()) {
    const at = `Place ${index + 1}`;
    if (member.type === "interpretation") {
      if (!member.interpretation) return { field: `member-${index}-interpretation`, message: `${at}: choose the interpretation.` };
      if (!interpretations.some((item) => item.id === member.interpretation)) return { field: `member-${index}-interpretation`, message: `${at}: that interpretation is no longer in the library.` };
    } else {
      if (!member.source) return { field: `member-${index}-source`, message: `${at}: choose the version this place is in.` };
      if (!alignableSources(sources).some((source) => source.id === member.source)) return { field: `member-${index}-source`, message: `${at}: choose an edition, translation or witness; a work has no text of its own.` };
      const locators = member.absent ? [] : parseLocatorLines(member.locators);
      if (locators.length > MAX_PASSAGE_LOCATORS) return { field: `member-${index}-locators`, message: `${at}: give at most ${MAX_PASSAGE_LOCATORS} locators.` };
      const bad = locators.findIndex((locator) => !locator.kind || !locator.value);
      if (bad >= 0) return { field: `member-${index}-locators`, message: `${at}: locator ${bad + 1} must look like page: 514 or canonical: 514a to 520a.` };
      if (!member.absent && !member.passage && !textLines(member.locators).length) return { field: `member-${index}-locators`, message: `${at}: say where the passage is in this version with locators or a notebook passage, or mark it absent.` };
      if (!member.absent && member.passage && !passages.some((passage) => passage.id === member.passage && passage.source === member.source)) return { field: `member-${index}-passage`, message: `${at}: that passage was not quoted from this version.` };
    }
    if (codePoints(member.normalized) > MAX_ALIGNMENT_NORMALIZED_CHARS) return { field: `member-${index}-normalized`, message: `${at}: a normalization is limited to ${MAX_ALIGNMENT_NORMALIZED_CHARS} characters.` };
    if (codePoints(member.note) > MAX_ATLAS_SHORT_CHARS) return { field: `member-${index}-note`, message: `${at}: a note is limited to ${MAX_ATLAS_SHORT_CHARS} characters.` };
  }
  const versions = new Set(draft.members.map((member) => (member.type === "interpretation" ? `i:${member.interpretation}` : `s:${member.source}`)));
  const present = draft.members.some((member) => member.type === "interpretation" || !member.absent);
  if (versions.size < 2 || !present) return { field: "members", message: "An alignment relates places in at least two versions or interpretations, and at least one must have the passage." };
  if (codePoints(draft.rationale) > MAX_ALIGNMENT_RATIONALE_CHARS) return { field: "rationale", message: `The rationale is limited to ${MAX_ALIGNMENT_RATIONALE_CHARS} characters.` };
  if (codePoints(draft.uncertainty) > MAX_ATLAS_UNCERTAINTY_CHARS) return { field: "uncertainty", message: `The uncertainty note is limited to ${MAX_ATLAS_UNCERTAINTY_CHARS} characters.` };
  const party = atlasPartyProblem(draft.recordedBy, sources, "recorded");
  if (party) return party;
  return null;
}

/** Map a server diagnostic's field path to the alignment form control that edits it. */
export function alignmentDiagnosticControl(field) {
  const path = String(field || "");
  const member = path.match(/^members\[(\d+)\](?:\.([A-Za-z]+))?/);
  if (member) {
    const [, index, key = ""] = member;
    if (key === "normalized") return path.endsWith(".note") ? `member-${index}-normalized-note` : `member-${index}-normalized`;
    return ["source", "interpretation", "passage", "locators", "absent", "note"].includes(key) ? `member-${index}-${key}` : `member-${index}`;
  }
  const name = path.replace(/\[\d+\].*$/, "").split(".")[0];
  if (name === "recordedBy") return path.endsWith("source") ? "recorded-source" : path.endsWith("name") ? "recorded-name" : "recorded";
  return { id: "id", label: "label", correspondence: "correspondence", members: "members", rationale: "rationale", confidence: "confidence", uncertainty: "uncertainty" }[name] || "";
}

export function alignmentErrorMessage(error) {
  const diagnostics = Array.isArray(error?.data?.diagnostics) ? error.data.diagnostics : [];
  if (!diagnostics.length) return error?.data?.error || error?.message || "The alignment could not be changed.";
  return diagnostics.map((item) => `${item.field ? `${item.field}: ` : ""}${item.message}`).join(" ");
}

/**
 * The editor for one alignment. `state` is the alignments file as last read
 * and is updated in place after every save or conflict. Nothing is saved
 * until the author submits; a save that meets a newer file keeps the draft
 * until the author chooses the stored copy or keeps the draft on top of it.
 */
export function createAlignmentForm({ api, state, item = null, idPrefix = "oba-alignment-form", onSaved, onCancel, onRefreshed }) {
  const editing = Boolean(item);
  let draft = alignmentDraft(item);
  let idTouched = false;
  let busy = false;
  // null, or { current } once a save met a newer file: the author chooses before anything is sent again.
  let conflict = null;
  let touched = false;
  const root = h("form", { class: "oba-capture-form oba-atlas-form oba-alignment-form", novalidate: true, "data-alignment-form": editing ? "edit" : "new" });
  const errorBox = h("p", { class: "oba-error", id: `${idPrefix}-error`, role: "alert", hidden: true, tabindex: "-1" });
  const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
  const control = (name) => root.querySelector(`#${idPrefix}-${name}`);
  const used = () => (state.alignments || []).map((alignment) => alignment.id);
  const say = (text, kind = "oba-small") => {
    status.className = kind;
    status.textContent = text;
  };
  const field = (name, labelText, input, hint) => {
    input.id = `${idPrefix}-${name}`;
    if (hint) {
      input.setAttribute("aria-describedby", `${idPrefix}-${name}-hint`);
      input.setAttribute("data-hint-id", `${idPrefix}-${name}-hint`);
    }
    return h("div", { class: "oba-field", "data-alignment-field": name }, h("label", { for: input.id }, labelText), input, hint ? h("p", { class: "oba-small", id: `${idPrefix}-${name}-hint` }, hint) : null);
  };
  const fail = (message, name = "") => {
    errorBox.hidden = false;
    errorBox.textContent = message;
    const target = name ? control(name) : null;
    if (target) {
      target.setAttribute("aria-invalid", "true");
      target.setAttribute("aria-describedby", [target.getAttribute("data-hint-id"), errorBox.id].filter(Boolean).join(" "));
      target.focus();
    } else errorBox.focus();
  };
  const clearInvalid = () => {
    for (const target of root.querySelectorAll("[aria-invalid]")) {
      target.removeAttribute("aria-invalid");
      const hint = target.getAttribute("data-hint-id");
      if (hint) target.setAttribute("aria-describedby", hint);
      else target.removeAttribute("aria-describedby");
    }
  };
  const rerender = (focusName) => {
    render();
    control(focusName)?.focus();
  };
  const sourceById = (id) => (state.sources || []).find((source) => source.id === id) || null;

  const partyEditor = () => {
    const party = draft.recordedBy;
    const sourceChoices = [...captureSources(state.sources), ...(state.sources || []).filter((source) => source.archived && source.id === party.source)];
    return h(
      "fieldset",
      { class: "oba-atlas-party", id: `${idPrefix}-recorded`, tabindex: "-1" },
      h("legend", {}, "Recorded by"),
      h("p", { class: "oba-small" }, "Who reads these places as corresponding: you, a concordance or apparatus in your library, or a named person. It is attribution, not a contributor credit."),
      ATLAS_ATTRIBUTIONS.map(({ kind, label }) => {
        const id = `${idPrefix}-recorded-is-${kind}`;
        return h("div", { class: "oba-capture-check" }, h("input", { id, type: "radio", name: `${idPrefix}-recorded-kind`, value: kind, checked: party.kind === kind, onChange: () => { party.kind = kind; rerender(`recorded-is-${kind}`); } }), h("label", { for: id }, label));
      }),
      party.kind === "source"
        ? field("recorded-source", "Source that records the alignment", h("select", { onChange: (event) => { party.source = event.target.value; } }, h("option", { value: "", selected: !party.source }, "Choose a source"), sourceChoices.map((source) => h("option", { value: source.id, selected: party.source === source.id }, `${sourceLabel(source)} (${source.kind})`))))
        : null,
      party.kind === "named" ? field("recorded-name", "Who records it", h("input", { type: "text", value: party.name, autocomplete: "off", dir: "auto", onInput: (event) => { party.name = event.target.value; } }), "A person or group outside your library. Stored as text.") : null,
    );
  };

  const publicationEditor = () => {
    const publication = state.publication || {};
    const where = `${publication.url || "/comparisons/"}${draft.id || "<identifier>"}/`;
    const check = (name, labelText, checked, onChange, hint) =>
      h(
        "div",
        { "data-alignment-field": name },
        h("div", { class: "oba-capture-check" }, h("input", { id: `${idPrefix}-${name}`, type: "checkbox", checked, "aria-describedby": `${idPrefix}-${name}-hint`, "data-hint-id": `${idPrefix}-${name}-hint`, onChange: (event) => onChange(event.target.checked) }), h("label", { for: `${idPrefix}-${name}` }, labelText)),
        h("p", { class: "oba-small", id: `${idPrefix}-${name}-hint` }, hint),
      );
    return h(
      "fieldset",
      { class: "oba-alignment-publication", id: `${idPrefix}-publication`, tabindex: "-1" },
      h("legend", {}, "Publication"),
      check(
        "approved",
        "Approve this comparison for publication",
        draft.approved,
        (on) => { draft.approved = on; },
        `Your consent to publish it at ${where} and in comparisons.json once the site turns on comparisons.publish: its label, how the places correspond, who aligned them, confidence, rationale, uncertainty and evidence, and each place's version, makers, locators and rights statement. Wording is shown only where you state a version's rights allow it, and only up to ${publication.maxExcerptChars || 1000} characters a place. Your notes on places are never published. Clearing it removes the comparison from the next build.`,
      ),
      check(
        "publish-normalized",
        "Also publish my normalizations, labelled",
        draft.publishNormalized,
        (on) => { draft.publishNormalized = on; },
        "Each normalization appears beside the original wording, labelled as yours and not the source text, only where that wording is itself shown.",
      ),
    );
  };

  const memberEditor = (member, index) => {
    const base = `member-${index}`;
    const number = index + 1;
    const versions = alignableSources(state.sources).filter((source) => !source.archived || source.id === member.source);
    const passages = (state.passages || []).filter((passage) => passage.source === member.source && (!passage.archived || passage.id === member.passage));
    const interpretations = state.interpretations || [];
    const typeRadio = (type, label) => {
      const id = `${idPrefix}-${base}-is-${type}`;
      return h("div", { class: "oba-capture-check" }, h("input", { id, type: "radio", name: `${idPrefix}-${base}-type`, value: type, checked: member.type === type, onChange: () => { member.type = type; rerender(`${base}-is-${type}`); } }), h("label", { for: id }, label));
    };
    const wording = member.type === "interpretation" || (!member.absent && member.passage);
    const move = (offset) => {
      const target = index + offset;
      draft.members.splice(target, 0, ...draft.members.splice(index, 1));
      render();
      const same = control(`member-${target}-${offset < 0 ? "up" : "down"}`);
      (same && !same.disabled ? same : control(`member-${target}-${offset < 0 ? "down" : "up"}`) || control(`member-${target}`))?.focus();
      say(`Place ${number} moved to position ${target + 1}.`);
    };
    return h(
      "fieldset",
      { class: "oba-alignment-member", id: `${idPrefix}-${base}`, tabindex: "-1", "data-alignment-member": String(index) },
      h("legend", {}, `Place ${number}`),
      h("fieldset", { class: "oba-alignment-member-type" }, h("legend", {}, `Place ${number} is in`), typeRadio("source", "A version: an edition, translation or witness"), typeRadio("interpretation", "An interpretation in your library")),
      member.type === "source"
        ? [
            field(`${base}-source`, "Version", h(
              "select",
              { onChange: (event) => {
                member.source = event.target.value;
                if (member.passage && !(state.passages || []).some((passage) => passage.id === member.passage && passage.source === member.source)) member.passage = "";
                rerender(`${base}-source`);
              } },
              h("option", { value: "", selected: !member.source }, "Choose a version"),
              versions.map((source) => h("option", { value: source.id, selected: member.source === source.id }, `${sourceLabel(source)} (${source.kind}${source.language ? `, ${source.language}` : ""}${source.archived ? ", archived" : ""})`)),
            ), "Only editions, translations and witnesses have a text of their own."),
            h("div", { "data-alignment-field": `${base}-absent` }, h("div", { class: "oba-capture-check" }, h("input", { id: `${idPrefix}-${base}-absent`, type: "checkbox", checked: member.absent, "aria-describedby": `${idPrefix}-${base}-absent-hint`, "data-hint-id": `${idPrefix}-${base}-absent-hint`, onChange: (event) => { member.absent = event.target.checked; rerender(`${base}-absent`); } }), h("label", { for: `${idPrefix}-${base}-absent` }, "This version lacks the passage (absent)")), h("p", { class: "oba-small", id: `${idPrefix}-${base}-absent-hint` }, "An omission, a lost leaf, or a gap. An absent place has no locator or wording.")),
            member.absent
              ? null
              : [
                  field(`${base}-passage`, "Notebook passage quoting it (optional)", h(
                    "select",
                    { onChange: (event) => {
                      member.passage = event.target.value;
                      const passage = (state.passages || []).find((candidate) => candidate.id === member.passage);
                      if (passage && !String(member.locators).trim() && passage.locators?.length) member.locators = formatLocatorLines(passage.locators);
                      rerender(`${base}-passage`);
                    } },
                    h("option", { value: "", selected: !member.passage }, passages.length ? "No passage" : member.source ? "No passages from this version" : "Choose a version first"),
                    passages.map((passage) => h("option", { value: passage.id, selected: member.passage === passage.id }, `${[...String(passage.excerpt?.text ?? "")].slice(0, 60).join("")} (${passage.id})`)),
                  ), "Its excerpt is the original wording, shown exactly as quoted. Choosing one fills in its locators."),
                  field(`${base}-locators`, "Locators", h("textarea", { rows: 2, value: member.locators, spellcheck: "false", onInput: (event) => { member.locators = event.target.value; } }), "Where the place is in this version, one per line, such as canonical: 514a or page: 12. Each version keeps its own."),
                ],
          ].flat()
        : field(`${base}-interpretation`, "Interpretation", h(
            "select",
            { onChange: (event) => { member.interpretation = event.target.value; rerender(`${base}-interpretation`); } },
            h("option", { value: "", selected: !member.interpretation }, interpretations.length ? "Choose an interpretation" : "No interpretations in the library"),
            interpretations.map((interpretation) => h("option", { value: interpretation.id, selected: member.interpretation === interpretation.id }, `${interpretation.kind === "rendering" ? "Rendering" : "Reading"} of ${sourceById(interpretation.source) ? sourceLabel(sourceById(interpretation.source)) : interpretation.source}, ${interpretersText(interpretation).replace(/^Interpreted by: /, "by ")} (${interpretation.id})`)),
          ), "Aligned as it is: it already names its source, place and interpreters."),
      wording
        ? [
            field(`${base}-normalized`, "Your normalization (optional)", h("textarea", { rows: 2, value: member.normalized, dir: "auto", onInput: (event) => { member.normalized = event.target.value; } }), "For example composed accents, expanded abbreviations or removed vowel points. Stored exactly as typed and always shown apart from the original."),
            field(`${base}-normalized-note`, "What you normalized (optional)", h("input", { type: "text", value: member.normalizedNote, autocomplete: "off", dir: "auto", onInput: (event) => { member.normalizedNote = event.target.value; } })),
          ]
        : null,
      field(`${base}-note`, "Note on this place (optional)", h("input", { type: "text", value: member.note, autocomplete: "off", dir: "auto", onInput: (event) => { member.note = event.target.value; } })),
      h(
        "div",
        { class: "oba-toolbar" },
        h("button", { class: "oba-btn", type: "button", id: `${idPrefix}-${base}-up`, "aria-label": `Move place ${number} up`, disabled: index === 0, onClick: () => move(-1) }, "Move up"),
        h("button", { class: "oba-btn", type: "button", id: `${idPrefix}-${base}-down`, "aria-label": `Move place ${number} down`, disabled: index === draft.members.length - 1, onClick: () => move(1) }, "Move down"),
        h("button", { class: "oba-btn oba-btn-danger", type: "button", "data-alignment-remove-member": String(index), onClick: () => { draft.members.splice(index, 1); rerender("add-member"); say(`Place ${number} removed.`); } }, `Remove place ${number}`),
      ),
    );
  };

  const fields = () => [
    editing ? h("p", { class: "oba-small" }, `Identifier: ${draft.id}. It cannot change.`) : null,
    field("label", "Label (optional)", h("input", { type: "text", value: draft.label, autocomplete: "off", dir: "auto", onInput: (event) => {
      draft.label = event.target.value;
      if (!editing && !idTouched) {
        draft.id = suggestAtlasId(draft.label, used(), "alignment");
        const idInput = control("id");
        if (idInput) idInput.value = draft.id;
      }
    } }), "Your name for it, such as The cave: opening image. It becomes the public title only if you approve the comparison for publication."),
    editing ? null : field("id", "Identifier", h("input", { type: "text", value: draft.id, autocomplete: "off", spellcheck: "false", onInput: (event) => { idTouched = true; draft.id = event.target.value.trim(); } }), "Lowercase letters, digits and hyphens. It cannot change later."),
    field("correspondence", "How the places correspond", h("select", { onChange: (event) => { draft.correspondence = event.target.value; } }, (state.correspondences || ALIGNMENT_CORRESPONDENCES).map((item) => h("option", { value: item.value, selected: draft.correspondence === item.value }, item.label))), "Your reading. There is no choice for “the same”: aligning places never says they mean the same thing."),
    h(
      "fieldset",
      { class: "oba-alignment-members", id: `${idPrefix}-members`, tabindex: "-1" },
      h("legend", {}, "Places"),
      h("p", { class: "oba-small" }, "Two or more versions or interpretations, at least one with the passage. Several places may come from one version (a split), and the order is yours."),
      draft.members.map(memberEditor),
      h("button", { class: "oba-btn", type: "button", id: `${idPrefix}-add-member`, "data-alignment-add-member": "true", disabled: draft.members.length >= MAX_ALIGNMENT_MEMBERS, onClick: () => { draft.members.push(alignmentMemberDraft()); rerender(`member-${draft.members.length - 1}-source`); } }, "Add a place"),
    ),
    field("rationale", "Why you align them (optional)", h("textarea", { rows: 3, value: draft.rationale, dir: "auto", onInput: (event) => { draft.rationale = event.target.value; } })),
    field("confidence", "Confidence", h("select", { onChange: (event) => { draft.confidence = event.target.value; } }, ATLAS_CONFIDENCE.map((item) => h("option", { value: item.value, selected: draft.confidence === item.value }, item.label))), "How firmly the recorder holds this reading, never how widely it is accepted."),
    field("uncertainty", "What is uncertain (optional)", h("textarea", { rows: 2, value: draft.uncertainty, dir: "auto", onInput: (event) => { draft.uncertainty = event.target.value; } })),
    partyEditor(),
    publicationEditor(),
  ];

  const conflictNotice = () => {
    if (!editing) return h("p", { class: "oba-notice", role: "alert", "data-alignment-conflict": "true" }, "The alignments changed after you opened them, so nothing was saved. Your draft is still here; save again to add it to the latest file.");
    const removed = !conflict.current;
    return h(
      "div",
      { class: "oba-notice", role: "alert", "data-alignment-conflict": "true" },
      h("p", {}, removed ? "This alignment was removed after you opened it, so nothing was saved. Your draft is still here." : "This alignment was changed after you opened it, so nothing was saved. Your draft is still here. Choose which copy to continue with; nothing is overwritten until you save."),
      h(
        "div",
        { class: "oba-toolbar" },
        h("button", { class: "oba-btn", type: "button", "data-alignment-conflict-use": "stored", onClick: () => resolveConflict(true) }, removed ? "Discard my draft" : "Use the stored copy"),
        removed ? null : h("button", { class: "oba-btn", type: "button", "data-alignment-conflict-use": "draft", onClick: () => resolveConflict(false) }, "Keep my draft"),
      ),
    );
  };

  const resolveConflict = (useStored) => {
    if (!conflict) return;
    const { current } = conflict;
    conflict = null;
    errorBox.hidden = true;
    clearInvalid();
    if (useStored) {
      if (!current) {
        touched = false;
        onCancel?.();
        return;
      }
      draft = alignmentDraft(current);
      touched = false;
      say("Showing the stored copy.");
    } else {
      rebaseAlignmentDraft(draft, current);
      say("Your draft now rests on the latest copy. Review it, then save.");
    }
    rerender("label");
  };

  const render = () => {
    const save = h("button", { class: "oba-btn oba-btn-primary", type: "submit", "data-alignment-save": "true", disabled: busy || Boolean(conflict && editing) }, editing ? "Save changes" : "Add alignment");
    const cancel = h("button", { class: "oba-btn", type: "button", "data-alignment-cancel": "true", onClick: () => onCancel?.() }, "Cancel");
    root.replaceChildren(...fields(), errorBox, conflict ? conflictNotice() : null, h("div", { class: "oba-toolbar" }, save, cancel), status);
  };

  const refresh = async () => {
    applyAlignmentState(state, await api.call("GET", "research/alignments"));
  };

  root.addEventListener("input", () => { touched = true; });
  root.addEventListener("change", () => { touched = true; });
  root.addEventListener("click", (event) => {
    if (event.target?.tagName === "BUTTON" && event.target.type === "button" && !event.target.dataset?.alignmentCancel && !event.target.dataset?.alignmentConflictUse) touched = true;
  });
  root.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    if (conflict && editing) {
      fail("Choose the stored copy or keep your draft before saving.");
      return;
    }
    errorBox.hidden = true;
    clearInvalid();
    conflict = null;
    const problem = validateAlignmentDraft(draft, { used: used(), creating: !editing, sources: state.sources || [], passages: state.passages || [], interpretations: state.interpretations || [] });
    if (problem) return fail(problem.message, problem.field);
    busy = true;
    root.querySelector("[data-alignment-save]")?.setAttribute("disabled", "");
    say("Saving…");
    try {
      const result = await api.call(editing ? "PUT" : "POST", "research/alignments", { json: { revision: state.revision, alignment: alignmentPayload(draft) } });
      applyAlignmentState(state, result);
      busy = false;
      touched = false;
      say("");
      onSaved?.({ item: result.alignment || null, build: result.build });
    } catch (error) {
      busy = false;
      if (error.status === 409 && error.data?.conflict) {
        try {
          await refresh();
        } catch {
          // The next save reports whatever is wrong.
        }
        conflict = { current: error.data.current ?? null };
        say("Not saved: the alignments changed elsewhere.", "oba-error");
        render();
        onRefreshed?.();
        (editing ? root.querySelector("[data-alignment-conflict-use]") : root.querySelector("[data-alignment-save]"))?.focus();
        return;
      }
      say("Not saved. The stored alignments are unchanged.", "oba-error");
      render();
      const first = error.data?.diagnostics?.[0];
      fail(alignmentErrorMessage(error), first ? alignmentDiagnosticControl(first.field) : "");
    }
  });

  render();
  return {
    element: root,
    isDirty: () => touched && !busy,
    focus() {
      (control("label") || root.querySelector("input,select,textarea,button"))?.focus();
    },
  };
}

// ---------------------------------------------------------------- claims and evidence links

/** How a source bears on a claim, as the author reads it. Never defaulted: a citation alone asserts none. */
export const CLAIM_RELATIONS = Object.freeze([
  { value: "supports", label: "Supports", heading: "Supporting" },
  { value: "contradicts", label: "Contradicts", heading: "Contradicting" },
  { value: "contextualizes", label: "Contextualizes", heading: "Contextualizing" },
]);
/** What a person, never the software, has done to check a link. */
export const CLAIM_REVIEW_STATES = Object.freeze([
  { value: "unreviewed", label: "Not compared with the source yet" },
  { value: "location-checked", label: "Location checked against the source" },
  { value: "reviewed", label: "Read, and I stand behind this relation" },
]);
const MAX_CLAIM_STATEMENT_CHARS = 2000;
const MAX_CLAIM_RATIONALE_CHARS = 4000;
const CLAIM_UNSAFE_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const claimEncoder = typeof TextEncoder === "function" ? new TextEncoder() : null;

/** The UTF-8 length of a string, which is how claim anchors count. */
export function utf8Length(text) {
  const value = String(text ?? "");
  if (claimEncoder) return claimEncoder.encode(value).length;
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * The anchor for a selection in the Markdown body, in the server's terms: UTF-8 byte offsets into
 * the saved draft's anchor text (CRLF folded to LF, leading newlines dropped as a save drops them),
 * with surrounding spaces trimmed. Returns `{ anchor }` or `{ error }`; the server checks it again.
 */
export function claimSelectionAnchor(body, start, end) {
  const raw = String(body ?? "");
  let from = Math.max(0, Math.min(Number(start) || 0, raw.length));
  let to = Math.max(from, Math.min(Number(end) || 0, raw.length));
  while (from < to && /\s/.test(raw[from])) from += 1;
  while (to > from && /\s/.test(raw[to - 1])) to -= 1;
  if (from === to) return { error: "Select the words of the claim in the draft first." };
  const lead = raw.match(/^[\r\n]*/)[0].length;
  if (from < lead) return { error: "Select the words of the claim in the draft first." };
  const fold = (text) => text.replace(/\r\n/g, "\n");
  const text = fold(raw.slice(from, to));
  if (CLAIM_UNSAFE_TEXT.test(text) || text.includes("\r")) return { error: "The selection contains control or direction-override characters; select plain words." };
  if ([...text].length > MAX_CLAIM_STATEMENT_CHARS) return { error: `Select at most ${MAX_CLAIM_STATEMENT_CHARS} characters for one claim.` };
  const offset = utf8Length(fold(raw.slice(lead, from)));
  return { anchor: { start: offset, end: offset + utf8Length(text), text } };
}

/**
 * The source span of each block the visual editor shows, in display order (blank runs skipped),
 * as `{ type, start, end }` offsets into `body`. The visual editor renders one element per block,
 * so the nth `[data-visual-block]` or protected card is the nth span here.
 */
export function visualBlockSpans(body) {
  const spans = [];
  let offset = 0;
  for (const block of parseVisualMarkdown(String(body ?? ""))) {
    const end = offset + block.source.length;
    if (block.type !== "space") spans.push({ type: block.type, start: offset, end });
    offset = end;
  }
  return spans;
}

/**
 * The anchor for words selected in the visual editor, which shows formatted text rather than the
 * Markdown. `block` names the visual block holding the whole selection (`{ index, type }`, its
 * position among the draft's blocks, with `markdown` or `count` to check the editor lines up with
 * the draft, and `text`, what the block shows); the words are looked for only in that block's Markdown,
 * spaces matching any run of whitespace, and accepted only when they occur there exactly once, so
 * formatting elsewhere in the draft can never move the anchor to other words.
 */
export function visualSelectionAnchor(body, selected, block) {
  const words = String(selected ?? "").replace(/\s+/g, " ").trim();
  if (!words) return { error: "Select the words of the claim in the draft first." };
  const markdownMode = "Switch to Markdown and select the words there.";
  const raw = String(body ?? "");
  // The visual editor reads CRLF and lone CR as LF; only CRLF folds the same way on both sides.
  if (raw.replace(/\r\n/g, "\n").includes("\r")) return { error: `The draft has line endings the visual editor cannot map back. ${markdownMode}` };
  const text = raw.replace(/\r\n/g, "\n");
  const index = Number.isInteger(block?.index) ? block.index : -1;
  const spans = visualBlockSpans(text);
  const span = spans[index];
  if (!span || (block?.type && block.type !== span.type)) return { error: `Select words inside one paragraph, heading, list or quote. ${markdownMode}` };
  const source = text.slice(span.start, span.end);
  // The editor's blocks must line up with the draft's: either the draft was written from the editor
  // (`markdown`, the block's own Markdown, is that span exactly), or the editor was drawn from the
  // draft (`count`, one editor block per span). Anything else could name the wrong block.
  const mismatch = (typeof block?.markdown === "string" && block.markdown !== source.replace(/\n+$/, "")) || (Number.isInteger(block?.count) && block.count !== spans.length);
  if (mismatch) return { error: `The editor and the draft no longer line up block for block. ${markdownMode}` };
  // The words must also read once in the block as shown, so formatting cannot hide another
  // occurrence (a selected "*big* cave" next to a plain "big cave").
  if (typeof block?.text === "string" && visualOccurrences(block.text.replace(/\s+/g, " "), words) > 1) return { error: `Those words occur more than once in that block. ${markdownMode}` };
  const pattern = new RegExp(words.split(" ").map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "gu");
  const found = [];
  for (let match = pattern.exec(source); match && found.length < 2; match = pattern.exec(source)) {
    found.push(match);
    // Resume one character after this hit, so an overlapping occurrence is still found.
    pattern.lastIndex = match.index + String.fromCodePoint(source.codePointAt(match.index)).length;
  }
  if (found.length === 0) return { error: `Those words are formatted differently in the Markdown. ${markdownMode}` };
  if (found.length > 1) return { error: `Those words occur more than once in that block. ${markdownMode}` };
  const start = span.start + found[0].index;
  return claimSelectionAnchor(text, start, start + found[0][0].length);
}

/** How many times `words` occur in `text`, overlapping occurrences counted, stopping at two. */
function visualOccurrences(text, words) {
  let count = 0;
  for (let at = text.indexOf(words); at >= 0 && count < 2; at = text.indexOf(words, at + 1)) count += 1;
  return count;
}

/** The text a visual-editor block shows, a line break read as a space, as a selection reads it. */
function visualBlockText(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  if (node.tagName.toLowerCase() === "br") return " ";
  return [...node.childNodes].map(visualBlockText).join("");
}

export function claimAnchorStatusText(status) {
  switch (status?.status) {
    case "verified":
      return "In place: the words are still where you selected them in the saved draft. This compares text positions only, not whether the claim is true.";
    case "moved":
      return "Moved: the words now appear once, elsewhere in the saved draft. Re-anchor to keep evidence on them.";
    case "stale":
      return status.missingPost ? "Stale: no saved post has this claim's slug." : "Stale: the words are no longer in the saved draft. Select them again to re-anchor; evidence cannot be added until then.";
    case "ambiguous":
      return "Ambiguous: the words occur more than once in the saved draft. Select the ones you mean to re-anchor; evidence cannot be added until then.";
    default:
      return "No anchor: a statement about the post, not tied to particular words.";
  }
}

/** Links of one claim grouped by relation, each in file order. Nothing is netted, ranked or hidden. */
export function claimLinkColumns(links, claimId) {
  const columns = { supports: [], contradicts: [], contextualizes: [] };
  for (const link of Array.isArray(links) ? links : []) if (link.claim === claimId && columns[link.relation]) columns[link.relation].push(link);
  return columns;
}

/**
 * The evidence gaps and review prompts (ADR 0074) about one claim and its links, in the order the
 * server reviewed them, which is the order `openblog check` prints. Only well-formed findings are kept.
 */
export function claimFindings(findings, claimId) {
  return (Array.isArray(findings) ? findings : []).filter(
    (finding) => finding && finding.object?.claim === claimId && typeof finding.code === "string" && typeof finding.message === "string" && typeof finding.repair === "string",
  );
}

const CLAIM_FINDING_OUTCOMES = [
  { outcome: "detected", label: "detected" },
  { outcome: "potential", label: "potential" },
  { outcome: "needs-review", label: "needing review" },
];

/** A post's findings as words: one total with each outcome counted apart, framed as gaps, never as a verdict. */
export function claimFindingsSummary(findings) {
  const list = Array.isArray(findings) ? findings : [];
  if (!list.length) return "No evidence gaps or review prompts for this post's claims from the checks that ran.";
  const parts = CLAIM_FINDING_OUTCOMES.map(({ outcome, label }) => `${list.filter((finding) => finding.outcome === outcome).length} ${label}`);
  return `${plural(list.length, "evidence gap or review prompt", "evidence gaps and review prompts")} for this post's claims: ${parts.join(", ")}. They show what the record lacks or what only you can check, never whether a claim is true.`;
}

/** Counts per relation as words, deliberately three figures that are never combined. */
export function claimCountsText(counts = {}) {
  return `${plural(counts.supports || 0, "supporting link")}, ${plural(counts.contradicts || 0, "contradicting link")}, ${plural(counts.contextualizes || 0, "contextualizing link")}`;
}

export function claimDraft(record = null, prefill = {}) {
  const value = record && typeof record === "object" ? record : {};
  return {
    original: record ? structuredClone(record) : null,
    id: typeof value.id === "string" ? value.id : prefill.id || "",
    post: typeof value.post === "string" ? value.post : prefill.post || "",
    statement: typeof value.statement === "string" ? value.statement : prefill.statement || "",
    anchor: value.anchor && typeof value.anchor === "object" ? structuredClone(value.anchor) : prefill.anchor || null,
    uncertainty: typeof value.uncertainty === "string" ? value.uncertainty : "",
    approved: value.visibility === "approved",
  };
}

/** The full claim to send. Unknown fields of the stored record, and its attribution and origin, carry over. */
export function claimPayload(draft) {
  const record = { ...(draft.original || {}) };
  for (const field of ["anchor", "uncertainty"]) delete record[field];
  record.id = draft.id;
  record.post = draft.post;
  record.statement = String(draft.statement ?? "").trim();
  if (draft.anchor) record.anchor = { ...(draft.original?.anchor || {}), ...draft.anchor };
  const uncertainty = String(draft.uncertainty ?? "").trim();
  if (uncertainty) record.uncertainty = uncertainty;
  record.visibility = draft.approved ? "approved" : "private";
  return record;
}

export function validateClaimDraft(draft) {
  const statement = String(draft.statement ?? "").trim();
  if (!statement) return { field: "statement", message: "Write the claim in your own words." };
  if ([...statement].length > MAX_CLAIM_STATEMENT_CHARS) return { field: "statement", message: `A claim is at most ${MAX_CLAIM_STATEMENT_CHARS} characters.` };
  if (CLAIM_UNSAFE_TEXT.test(statement.replace(/[\n\t]/g, " "))) return { field: "statement", message: "Remove control or direction-override characters from the claim." };
  if (CLAIM_UNSAFE_TEXT.test(String(draft.uncertainty ?? "").replace(/[\n\t]/g, " "))) return { field: "uncertainty", message: "Remove control or direction-override characters." };
  if (draft.approved && draft.original?.origin === "suggested") return { field: "approved", message: "A suggested claim cannot be approved; edit it as your own first." };
  return null;
}

export function evidenceLinkDraft(record = null, prefill = {}) {
  const value = record && typeof record === "object" ? record : {};
  return {
    original: record ? structuredClone(record) : null,
    id: typeof value.id === "string" ? value.id : prefill.id || "",
    claim: typeof value.claim === "string" ? value.claim : prefill.claim || "",
    // Never defaulted: the author names how the source bears on the claim.
    relation: CLAIM_RELATIONS.some((item) => item.value === value.relation) ? value.relation : "",
    evidence: atlasEvidenceDraft(value.evidence || {}, record ? 0 : null),
    rationale: typeof value.rationale === "string" ? value.rationale : "",
    confidence: ATLAS_CONFIDENCE.some((item) => item.value === value.confidence) ? value.confidence : "tentative",
    uncertainty: typeof value.uncertainty === "string" ? value.uncertainty : "",
    reviewState: CLAIM_REVIEW_STATES.some((item) => item.value === value.reviewState) ? value.reviewState : "unreviewed",
    approved: value.visibility === "approved",
  };
}

export function evidenceLinkPayload(draft) {
  const record = { ...(draft.original || {}) };
  for (const field of ["rationale", "uncertainty"]) delete record[field];
  record.id = draft.id;
  record.claim = draft.claim;
  record.relation = draft.relation;
  record.evidence = atlasEvidencePayload(draft.evidence);
  const rationale = String(draft.rationale ?? "").trim();
  if (rationale) record.rationale = rationale;
  record.confidence = draft.confidence;
  const uncertainty = String(draft.uncertainty ?? "").trim();
  if (uncertainty) record.uncertainty = uncertainty;
  record.reviewState = draft.reviewState;
  record.visibility = draft.approved ? "approved" : "private";
  return record;
}

export function validateEvidenceLinkDraft(draft, { sources = [], passages = [] } = {}) {
  if (!CLAIM_RELATIONS.some((item) => item.value === draft.relation)) return { field: "relation", message: "Choose whether the source supports, contradicts or contextualizes the claim. A citation alone asserts none of these." };
  const source = draft.evidence.source;
  if (!source) return { field: "source", message: "Choose the source this link rests on." };
  if (!sources.some((item) => item.id === source)) return { field: "source", message: "That source is not in your library." };
  if (draft.evidence.passage) {
    const passage = passages.find((item) => item.id === draft.evidence.passage);
    if (!passage) return { field: "passage", message: "That passage is not in your notebook." };
    if (passage.source !== source) return { field: "passage", message: "A passage must be quoted from the source this link names." };
    if (draft.approved) return { field: "passage", message: "An approved link cites the source and locators, never a private notebook passage. Remove the passage or keep the link private." };
  }
  if (parseLocatorLines(draft.evidence.locators).some((locator) => !locator.kind || !locator.value)) return { field: "locators", message: "Write each location as kind: value, such as page: 514." };
  for (const [field, text, max] of [["rationale", draft.rationale, MAX_CLAIM_RATIONALE_CHARS], ["uncertainty", draft.uncertainty, 2000]]) {
    if ([...String(text ?? "")].length > max) return { field, message: `At most ${max} characters.` };
    if (CLAIM_UNSAFE_TEXT.test(String(text ?? "").replace(/[\n\t]/g, " "))) return { field, message: "Remove control or direction-override characters." };
  }
  if (draft.approved && draft.original?.origin === "suggested" && draft.reviewState !== "reviewed") return { field: "approved", message: "Review a suggested link yourself before approving it." };
  return null;
}

/** A server diagnostic's field, mapped to the claims form control that edits it. */
export function claimDiagnosticControl(field, type = "claim") {
  const path = String(field || "");
  if (type === "claim") return { statement: "statement", uncertainty: "uncertainty", visibility: "approved", post: "statement", anchor: "statement" }[path.split(".")[0]] || "";
  if (path.startsWith("evidence.passage")) return "passage";
  if (path.startsWith("evidence.locators")) return "locators";
  if (path.startsWith("evidence")) return "source";
  return { relation: "relation", rationale: "rationale", confidence: "confidence", uncertainty: "uncertainty", reviewState: "review", visibility: "approved", claim: "relation" }[path.split(".")[0]] || "";
}

export function claimsErrorMessage(error) {
  const diagnostics = Array.isArray(error?.data?.diagnostics) ? error.data.diagnostics : [];
  if (!diagnostics.length) return error?.data?.error || error?.message || "The claims could not be changed.";
  return diagnostics.map((item) => `${item.field ? `${item.field}: ` : ""}${item.message}`).join(" ");
}

export function applyClaimsState(state, result) {
  for (const key of ["revision", "file", "claims", "links", "sources", "passages", "notices", "findings", "anchors", "counts", "projected", "post"]) {
    if (result && result[key] !== undefined) state[key] = result[key];
  }
  for (const key of ["claims", "links", "sources", "passages", "notices", "findings", "projected"]) if (!Array.isArray(state[key])) state[key] = [];
  for (const key of ["anchors", "counts"]) if (!state[key] || typeof state[key] !== "object") state[key] = {};
  return state;
}

/**
 * Claims and evidence links for one saved post, inside Evidence Studio. `post()` gives the post's
 * path and the revision the editor loaded; `selection()` gives `{ anchor }` or `{ error }` for the
 * words selected in the draft. Every save names the claims revision; a conflict keeps the draft
 * until the author uses the stored copy or keeps theirs. Supporting and contradicting links are
 * listed side by side and never combined.
 */
export function createClaimsStudio({ api, post, selection, idPrefix = "oba-claims" }) {
  const state = applyClaimsState({ post: "" }, {});
  let form = null; // null, or { type: "claim" | "link", draft, editing, conflict }
  let busy = false;
  let lastRemoved = null; // { type, record } for undo
  // Claims are stored apart from the post: typing in their forms is not an edit of the post, so it
  // must not mark the post unsaved (which would refuse the next claim until a needless save).
  const root = h("section", { class: "oba-claims", "aria-labelledby": `${idPrefix}-heading`, "data-claims": "true", onInput: (event) => event.stopPropagation() });
  const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite", "data-claims-status": "true" });
  const errorBox = h("p", { class: "oba-error", id: `${idPrefix}-error`, role: "alert", hidden: true, tabindex: "-1" });
  const list = h("div", { class: "oba-claim-list", "data-claims-list": "true" });
  const formRegion = h("div", { class: "oba-claim-form-region" });
  const undoRegion = h("div", { class: "oba-claim-undo", "data-claims-undo": "true" });
  const noticeRegion = h("div", { class: "oba-claim-notices", "data-claims-notices": "true" });
  const findingsSummary = h("p", { class: "oba-small", "data-claims-findings-summary": "true", hidden: true });
  const say = (text, kind = "oba-small") => {
    status.className = kind;
    status.textContent = text;
  };
  const control = (name) => root.querySelector(`#${idPrefix}-${name}`);
  const used = () => [...state.claims, ...state.links].map((record) => record.id);
  const claimById = (id) => state.claims.find((claim) => claim.id === id) || null;
  const linkById = (id) => state.links.find((link) => link.id === id) || null;
  const sourceById = (id) => state.sources.find((source) => source.id === id) || null;
  const passageById = (id) => state.passages.find((passage) => passage.id === id) || null;
  const postClaims = () => state.claims.filter((claim) => claim.post === state.post);

  const fail = (message, name = "") => {
    errorBox.hidden = false;
    errorBox.textContent = message;
    const target = name ? control(name) : null;
    if (target) {
      target.setAttribute("aria-invalid", "true");
      target.setAttribute("aria-describedby", errorBox.id);
      target.focus();
    } else errorBox.focus();
  };
  const clearError = () => {
    errorBox.hidden = true;
    errorBox.textContent = "";
    for (const target of root.querySelectorAll("[aria-invalid]")) {
      target.removeAttribute("aria-invalid");
      target.removeAttribute("aria-describedby");
    }
  };
  const field = (name, labelText, input, hint) => {
    input.id = `${idPrefix}-${name}`;
    if (hint) input.setAttribute("aria-describedby", `${idPrefix}-${name}-hint`);
    return h("div", { class: "oba-field", "data-claims-field": name }, h("label", { for: input.id }, labelText), input, hint ? h("p", { class: "oba-small", id: `${idPrefix}-${name}-hint` }, hint) : null);
  };
  const check = (name, labelText, checked, onToggle, hint) => {
    const id = `${idPrefix}-${name}`;
    return h(
      "div",
      { "data-claims-field": name },
      h("div", { class: "oba-capture-check" }, h("input", { id, type: "checkbox", checked, "aria-describedby": hint ? `${id}-hint` : null, onChange: (event) => onToggle(event.target.checked) }), h("label", { for: id }, labelText)),
      hint ? h("p", { class: "oba-small", id: `${id}-hint` }, hint) : null,
    );
  };

  const refresh = async () => {
    const current = post();
    applyClaimsState(state, await api.call("GET", current?.path ? `research/claims?path=${encodeURIComponent(current.path)}` : "research/claims"));
    if (!state.post && current?.slug) state.post = current.slug;
  };

  /** Ask the server to check a selection against the saved draft it was made in. */
  const checkSelection = async () => {
    const current = post();
    if (!current?.path || !current.etag) return { error: "Save the post first: claims are checked against the saved draft." };
    if (current.dirty) return { error: "Save the post first: claims are checked against the saved draft, not unsaved changes." };
    const picked = selection();
    if (picked.error) return picked;
    try {
      const checked = await api.call("POST", "research/claims/anchor", { json: { path: current.path, etag: current.etag, ...picked.anchor } });
      if (checked.status !== "verified") return { error: `Not anchored. ${claimAnchorStatusText(checked)}` };
      state.post = checked.post;
      return { anchor: checked.anchor, post: checked.post };
    } catch (error) {
      if (error.status === 401) throw error;
      return { error: error.data?.error || error.message || "The selection could not be checked." };
    }
  };

  // ---- forms

  const claimFields = (draft) => [
    field("statement", "Claim, in your words", h("textarea", { rows: 3, value: draft.statement, onInput: (event) => { draft.statement = event.target.value; } }), draft.anchor ? null : "Not tied to particular words of the draft."),
    draft.anchor ? h("p", { class: "oba-small", "data-claims-anchor-text": "true" }, "Anchored to the words: ", h("q", {}, draft.anchor.text)) : null,
    field("uncertainty", "What is doubtful or unsettled about it (optional)", h("textarea", { rows: 2, value: draft.uncertainty, onInput: (event) => { draft.uncertainty = event.target.value; } })),
    check("approved", "Approve this claim for publication with the post", draft.approved, (value) => { draft.approved = value; }, "Your consent to publish this claim's statement and uncertainty in the post's Claims and evidence section and claim-evidence.json, once the site turns on claimEvidence.publish. Its words in the post are quoted only while they are still where you anchored them. Withdrawing approval is always allowed and removes the claim and its evidence from the next build."),
  ];

  const sourceOptions = (current) => {
    const live = captureSources(state.sources);
    const kept = state.sources.filter((source) => source.archived && source.id === current);
    return [h("option", { value: "", selected: !current }, "Choose a source"), ...[...live, ...kept].map((source) => h("option", { value: source.id, selected: current === source.id }, `${sourceLabel(source)}${source.archived ? " (archived)" : ""} (${source.kind})`))];
  };

  const linkFields = (draft) => {
    const evidence = draft.evidence;
    const passages = state.passages.filter((passage) => !passage.archived || passage.id === evidence.passage);
    const sourceSelect = h("select", { onChange: (event) => { evidence.source = event.target.value; if (evidence.passage && passageById(evidence.passage)?.source !== evidence.source) evidence.passage = ""; render(); control("source")?.focus(); } }, sourceOptions(evidence.source));
    const passageSelect = h(
      "select",
      {
        onChange: (event) => {
          evidence.passage = event.target.value;
          const passage = passageById(evidence.passage);
          if (passage) {
            evidence.source = passage.source;
            if (!evidence.locators.trim()) evidence.locators = formatLocatorLines(passage.locators);
          }
          render();
          control("passage")?.focus();
        },
      },
      h("option", { value: "", selected: !evidence.passage }, "None: cite the library source"),
      passages.map((passage) => h("option", { value: passage.id, selected: evidence.passage === passage.id }, `${passage.preview || passage.id} (${sourceById(passage.source) ? sourceLabel(sourceById(passage.source)) : passage.source}${passage.locators?.length ? `, ${formatLocatorLines(passage.locators).replace(/\n/g, "; ")}` : ""})`)),
    );
    return [
      h(
        "fieldset",
        { class: "oba-claims-relation", id: `${idPrefix}-relation`, tabindex: "-1" },
        h("legend", {}, "How does this source bear on the claim?"),
        CLAIM_RELATIONS.map(({ value, label }) => {
          const id = `${idPrefix}-relation-${value}`;
          return h("div", { class: "oba-capture-check" }, h("input", { id, type: "radio", name: `${idPrefix}-relation`, value, checked: draft.relation === value, onChange: () => { draft.relation = value; } }), h("label", { for: id }, label));
        }),
        h("p", { class: "oba-small" }, "Your reading of the source. Nothing here checks whether it is true."),
      ),
      field("passage", "Notebook passage (optional)", passageSelect, "A quoted passage stays private; it is pointed to, never copied."),
      field("source", "Source", sourceSelect),
      field("locators", "Where in the source (optional)", h("textarea", { rows: 2, value: evidence.locators, spellcheck: "false", onInput: (event) => { evidence.locators = event.target.value; } }), "One per line, such as page: 514."),
      field("rationale", "Why you read it this way (optional)", h("textarea", { rows: 3, value: draft.rationale, onInput: (event) => { draft.rationale = event.target.value; } })),
      field("confidence", "How firmly you hold this reading", h("select", { onChange: (event) => { draft.confidence = event.target.value; } }, ATLAS_CONFIDENCE.map((item) => h("option", { value: item.value, selected: draft.confidence === item.value }, item.label)))),
      field("uncertainty", "What is uncertain about it (optional)", h("textarea", { rows: 2, value: draft.uncertainty, onInput: (event) => { draft.uncertainty = event.target.value; } })),
      field("review", "What you have checked", h("select", { onChange: (event) => { draft.reviewState = event.target.value; } }, CLAIM_REVIEW_STATES.map((item) => h("option", { value: item.value, selected: draft.reviewState === item.value }, item.label)))),
      check("approved", "Approve this link for publication with the post", draft.approved, (value) => { draft.approved = value; }, "Your consent to publish its source, locations, relation, rationale, confidence and uncertainty beside the claim, once the claim is approved and the site turns on claimEvidence.publish. Support is never published while a contradicting link on the claim stays private. Clearing it removes the link from the next build."),
    ];
  };

  const conflictNotice = () => {
    const { current, editing } = form.conflict;
    if (!editing) return h("p", { class: "oba-notice", role: "alert", "data-claims-conflict": "true" }, "The claims changed after you opened them, so nothing was saved. Your draft is still here; save again to add it to the latest claims.");
    return h(
      "div",
      { class: "oba-notice", role: "alert", "data-claims-conflict": "true" },
      h("p", {}, current ? "This was changed elsewhere after you opened it, so nothing was saved. Your draft is still here. Choose which copy to continue with." : "This was removed elsewhere after you opened it, so nothing was saved."),
      h(
        "div",
        { class: "oba-toolbar" },
        h("button", { class: "oba-btn", type: "button", "data-claims-conflict-use": "stored", onClick: () => resolveConflict(true) }, current ? "Use the stored copy" : "Discard my draft"),
        current ? h("button", { class: "oba-btn", type: "button", "data-claims-conflict-use": "draft", onClick: () => resolveConflict(false) }, "Keep my draft") : null,
      ),
    );
  };

  const resolveConflict = (useStored) => {
    const { current } = form.conflict;
    const type = form.type;
    form.conflict = null;
    clearError();
    if (useStored) {
      if (!current) {
        form = null;
        render();
        return;
      }
      form.draft = type === "claim" ? claimDraft(current) : evidenceLinkDraft(current);
      say("Showing the stored copy.");
    } else {
      // The draft now rests on the newer copy, so fields added elsewhere carry over.
      form.draft.original = structuredClone(current);
      if (type === "link") form.draft.evidence.original = structuredClone(current.evidence || {});
      say("Your draft now rests on the latest copy. Review it, then save.");
    }
    render();
    control(type === "claim" ? "statement" : "relation-supports")?.focus();
  };

  const openForm = (type, draft, editing) => {
    form = { type, draft, editing, conflict: null };
    clearError();
    render();
    control(type === "claim" ? "statement" : `relation-${draft.relation || "supports"}`)?.focus();
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy || !form) return;
    if (form.conflict?.editing) return fail("Choose the stored copy or keep your draft before saving.");
    clearError();
    const { type, draft, editing } = form;
    const problem = type === "claim" ? validateClaimDraft(draft) : validateEvidenceLinkDraft(draft, state);
    if (problem) return fail(problem.message, problem.field === "relation" ? "relation-supports" : problem.field);
    if (!editing) draft.id = draft.id || suggestAtlasId(type === "claim" ? draft.statement : `${draft.claim}-${draft.relation}`, used(), type);
    busy = true;
    say("Saving…");
    const key = type === "claim" ? "claim" : "link";
    try {
      const result = await api.call(editing ? "PUT" : "POST", `research/claims/${type === "claim" ? "claims" : "links"}`, { json: { revision: state.revision, [key]: type === "claim" ? claimPayload(draft) : evidenceLinkPayload(draft) } });
      applyClaimsState(state, result);
      busy = false;
      form = null;
      render();
      say(type === "claim" ? "Claim saved privately." : "Evidence link saved privately.");
      const saved = type === "claim" ? draft.id : draft.claim;
      root.querySelector(`#${idPrefix}-claim-${saved}`)?.focus();
    } catch (error) {
      busy = false;
      if (error.status === 401) throw error;
      if (error.status === 409 && error.data?.conflict) {
        try {
          await refresh();
        } catch {
          // The next save reports whatever is wrong.
        }
        form.conflict = { current: error.data.current ?? null, editing };
        render();
        say("Not saved: the claims changed elsewhere.", "oba-error");
        (root.querySelector("[data-claims-conflict-use]") || root.querySelector("[data-claims-save]"))?.focus();
        return;
      }
      say("Not saved. The stored claims and the draft are unchanged.", "oba-error");
      render();
      const first = error.data?.diagnostics?.[0];
      const name = first ? claimDiagnosticControl(first.field, type) : "";
      fail(claimsErrorMessage(error), name === "relation" ? "relation-supports" : name);
    }
  };

  const renderForm = () => {
    if (!form) {
      formRegion.replaceChildren();
      return;
    }
    const { type, draft, editing } = form;
    const claim = type === "link" ? claimById(draft.claim) : null;
    const heading = type === "claim" ? (editing ? "Edit claim" : "New claim") : editing ? "Edit evidence link" : "Link evidence";
    formRegion.replaceChildren(
      h(
        "form",
        { class: "oba-capture-form oba-claim-form", novalidate: true, "data-claims-form": type, "aria-labelledby": `${idPrefix}-form-heading`, onSubmit: submit },
        h("h4", { id: `${idPrefix}-form-heading` }, heading),
        claim ? h("p", { class: "oba-small" }, "For the claim: ", h("q", {}, claim.statement)) : null,
        ...(type === "claim" ? claimFields(draft) : linkFields(draft)),
        errorBox,
        form.conflict ? conflictNotice() : null,
        h(
          "div",
          { class: "oba-toolbar" },
          h("button", { class: "oba-btn oba-btn-primary", type: "submit", "data-claims-save": "true", disabled: busy || Boolean(form.conflict?.editing) }, editing ? "Save changes" : type === "claim" ? "Save claim" : "Save link"),
          h("button", { class: "oba-btn", type: "button", "data-claims-cancel": "true", onClick: () => { form = null; clearError(); render(); root.querySelector("[data-claims-new]")?.focus(); } }, "Cancel"),
        ),
      ),
    );
  };

  // ---- actions

  const newClaim = async () => {
    clearError();
    say("Checking the selected words against the saved draft…");
    const checked = await checkSelection();
    if (checked.error) {
      say(checked.error, "oba-error");
      return;
    }
    say("");
    openForm("claim", claimDraft(null, { post: checked.post, statement: checked.anchor.text, anchor: checked.anchor }), false);
  };

  const saveClaimAnchor = async (claim, anchor, message) => {
    busy = true;
    try {
      const result = await api.call("PUT", "research/claims/claims", { json: { revision: state.revision, claim: { ...claim, anchor: { ...(claim.anchor || {}), ...anchor } } } });
      applyClaimsState(state, result);
      busy = false;
      render();
      say(message);
      root.querySelector(`#${idPrefix}-claim-${claim.id}`)?.focus();
    } catch (error) {
      busy = false;
      if (error.status === 401) throw error;
      if (error.status === 409) await refresh().catch(() => {});
      render();
      say(`Not re-anchored. ${error.status === 409 ? "The claims changed elsewhere; try again." : claimsErrorMessage(error)}`, "oba-error");
    }
  };

  const reanchor = async (claim) => {
    const anchorState = state.anchors[claim.id];
    if (anchorState?.status === "moved" && Number.isInteger(anchorState.start)) {
      const start = anchorState.start;
      await saveClaimAnchor(claim, { start, end: start + utf8Length(claim.anchor.text), text: claim.anchor.text }, "Claim re-anchored to where its words now are.");
      return;
    }
    say("Checking the selected words against the saved draft…");
    const checked = await checkSelection();
    if (checked.error) {
      say(checked.error, "oba-error");
      return;
    }
    if (checked.post !== claim.post) {
      say("The selection is in another post; open this claim's post to re-anchor it.", "oba-error");
      return;
    }
    await saveClaimAnchor(claim, checked.anchor, "Claim re-anchored to the selected words.");
  };

  const remove = async (type, record) => {
    const label = type === "claim" ? "claim" : "evidence link";
    if (globalThis.confirm?.(`Remove this ${label}? You can undo right after.`) === false) return;
    busy = true;
    try {
      const result = await api.call("DELETE", `research/claims/${type === "claim" ? "claims" : "links"}`, { json: { revision: state.revision, id: record.id } });
      applyClaimsState(state, result);
      busy = false;
      lastRemoved = { type, record: structuredClone(record) };
      render();
      say(`Removed the ${label}.`);
      undoRegion.querySelector("button")?.focus();
    } catch (error) {
      busy = false;
      if (error.status === 401) throw error;
      if (error.status === 409) await refresh().catch(() => {});
      render();
      say(`Not removed. ${error.status === 409 ? "The claims changed elsewhere; review them and try again." : claimsErrorMessage(error)}`, "oba-error");
    }
  };

  const undo = async () => {
    if (!lastRemoved || busy) return;
    const { type, record } = lastRemoved;
    busy = true;
    try {
      const result = await api.call("POST", `research/claims/${type === "claim" ? "claims" : "links"}`, { json: { revision: state.revision, [type === "claim" ? "claim" : "link"]: record } });
      applyClaimsState(state, result);
      busy = false;
      lastRemoved = null;
      render();
      say(type === "claim" ? "Claim restored." : "Evidence link restored.");
      root.querySelector(`#${idPrefix}-claim-${type === "claim" ? record.id : record.claim}`)?.focus();
    } catch (error) {
      busy = false;
      if (error.status === 401) throw error;
      if (error.status === 409) await refresh().catch(() => {});
      render();
      say(`Not restored. ${error.status === 409 ? "The claims changed elsewhere; try again." : claimsErrorMessage(error)}`, "oba-error");
    }
  };

  // ---- the list

  const linkItem = (link) => {
    const source = sourceById(link.evidence?.source);
    const passage = link.evidence?.passage ? passageById(link.evidence.passage) : null;
    const where = formatLocatorLines(link.evidence?.locators).replace(/\n/g, "; ");
    const confidence = ATLAS_CONFIDENCE.find((item) => item.value === link.confidence)?.label || "Tentative";
    const review = CLAIM_REVIEW_STATES.find((item) => item.value === link.reviewState)?.label || CLAIM_REVIEW_STATES[0].label;
    const name = `${source ? sourceLabel(source) : link.evidence?.source}${where ? `, ${where}` : ""}`;
    return h(
      "li",
      { class: "oba-claim-link", "data-claims-link": link.id, "data-relation": link.relation },
      h("p", {}, h("strong", {}, name)),
      passage ? h("p", { class: "oba-small" }, "Passage: ", h("q", {}, passage.preview || passage.id)) : null,
      link.rationale ? h("p", {}, link.rationale) : null,
      h("p", { class: "oba-small" }, `${confidence} confidence, as you hold it. ${review}.`),
      link.uncertainty ? h("p", { class: "oba-small" }, `Uncertain: ${link.uncertainty}`) : null,
      h("p", { class: "oba-small", "data-claims-visibility": link.visibility }, link.visibility === "approved" ? (state.projected.includes(link.id) ? "Approved; a future publication may include it." : "Approved, but held back until its claim and every contradicting link on it are approved.") : "Private."),
      link.origin === "suggested" ? h("p", { class: "oba-small" }, "Suggested, not yet your own reading.") : null,
      h(
        "div",
        { class: "oba-toolbar" },
        h("button", { class: "oba-btn", type: "button", "aria-label": `Edit link: ${name}`, onClick: () => openForm("link", evidenceLinkDraft(link), true) }, "Edit"),
        h("button", { class: "oba-btn", type: "button", "aria-label": `Remove link: ${name}`, "data-claims-remove-link": link.id, onClick: () => remove("link", link) }, "Remove"),
      ),
    );
  };

  const claimItem = (claim) => {
    const anchorState = state.anchors[claim.id] || null;
    const columns = claimLinkColumns(state.links, claim.id);
    const column = (relation) => {
      const { heading } = CLAIM_RELATIONS.find((item) => item.value === relation);
      const links = columns[relation];
      return h(
        "section",
        { class: "oba-claim-column", "data-claims-column": relation, "aria-label": `${heading} evidence` },
        h("h5", {}, `${heading} (${links.length})`),
        links.length ? h("ul", { class: "oba-claim-links" }, links.map(linkItem)) : h("p", { class: "oba-small" }, `No ${heading.toLowerCase()} evidence recorded.`),
      );
    };
    const blocked = anchorState && ["stale", "ambiguous"].includes(anchorState.status);
    const findings = claimFindings(state.findings, claim.id);
    const prompts = findings.length
      ? h(
          "section",
          { class: "oba-claim-findings", "data-claims-findings": claim.id, "aria-label": `Evidence gaps and prompts for the claim: ${claim.statement}` },
          h("h5", {}, `Gaps and prompts (${findings.length})`),
          h(
            "ul",
            {},
            findings.map((finding) =>
              h(
                "li",
                { class: `oba-claim-finding is-${finding.outcome}`, "data-claims-finding": finding.code },
                h("p", {}, h("code", {}, finding.code), ` (${CLAIM_FINDING_OUTCOMES.find((item) => item.outcome === finding.outcome)?.label || finding.outcome}): `, finding.message),
                h("p", { class: "oba-small" }, h("strong", {}, "Next: "), finding.repair),
              ),
            ),
          ),
        )
      : null;
    return h(
      "article",
      { class: "oba-claim", "data-claims-claim": claim.id, "aria-labelledby": `${idPrefix}-claim-${claim.id}` },
      h("h4", { id: `${idPrefix}-claim-${claim.id}`, tabindex: "-1" }, claim.statement),
      claim.anchor ? h("p", { class: "oba-small" }, "Words: ", h("q", {}, claim.anchor.text)) : null,
      h("p", { class: "oba-small", "data-claims-anchor": anchorState?.status || "none" }, claimAnchorStatusText(anchorState)),
      claim.uncertainty ? h("p", { class: "oba-small" }, `Uncertain: ${claim.uncertainty}`) : null,
      h("p", { class: "oba-small", "data-claims-counts": claim.id }, claimCountsText(state.counts[claim.id])),
      h("div", { class: "oba-claim-columns" }, column("supports"), column("contradicts")),
      column("contextualizes"),
      prompts,
      h(
        "div",
        { class: "oba-toolbar" },
        h("button", { class: "oba-btn", type: "button", disabled: Boolean(blocked), "aria-label": `Link evidence to the claim: ${claim.statement}`, "data-claims-add-link": claim.id, onClick: () => openForm("link", evidenceLinkDraft(null, { claim: claim.id }), false) }, "Link evidence"),
        anchorState && anchorState.status !== "verified" && !anchorState.missingPost
          ? h("button", { class: "oba-btn", type: "button", "data-claims-reanchor": claim.id, "aria-label": `${anchorState.status === "moved" ? "Re-anchor to its new position" : "Re-anchor to the selected words"}: ${claim.statement}`, onClick: () => reanchor(claim) }, anchorState.status === "moved" ? "Re-anchor to its new position" : "Re-anchor to the selected words")
          : null,
        h("button", { class: "oba-btn", type: "button", "aria-label": `Edit claim: ${claim.statement}`, onClick: () => openForm("claim", claimDraft(claim), true) }, "Edit"),
        h("button", { class: "oba-btn", type: "button", "aria-label": `Remove claim: ${claim.statement}`, "data-claims-remove-claim": claim.id, onClick: () => remove("claim", claim) }, "Remove"),
      ),
      blocked ? h("p", { class: "oba-small" }, "Re-anchor the claim before adding evidence, so evidence never attaches to words you did not choose.") : null,
    );
  };

  const render = () => {
    renderForm();
    const claims = postClaims();
    // replaceChildren takes nodes only: an array or a null would be shown as text.
    list.replaceChildren(
      ...(claims.length
        ? claims.map(claimItem)
        : [h("p", { class: "oba-small", "data-claims-empty": "true" }, "No claims about this post yet. Select words in the draft, then make a claim from them.")]),
    );
    undoRegion.replaceChildren(
      ...(lastRemoved ? [h("button", { class: "oba-btn", type: "button", "data-claims-undo-button": "true", onClick: undo }, lastRemoved.type === "claim" ? "Undo removing the claim" : "Undo removing the link")] : []),
    );
    const notices = state.notices.filter((notice) => {
      const link = linkById(notice.id);
      return link && claimById(link.claim)?.post === state.post;
    });
    noticeRegion.replaceChildren(...notices.map((notice) => h("p", { class: "oba-small", "data-claims-notice": notice.code }, `Link ${notice.id}: ${notice.message}`)));
    const ids = new Set(claims.map((claim) => claim.id));
    findingsSummary.hidden = claims.length === 0;
    findingsSummary.textContent = claims.length ? claimFindingsSummary(state.findings.filter((finding) => ids.has(finding.object?.claim))) : "";
  };
  root.append(
    h("h3", { id: `${idPrefix}-heading` }, "Claims and evidence"),
    h("p", { class: "oba-small" }, "Private to you. A claim is your statement about this post; an evidence link records how one source bears on it. Nothing here scores evidence or decides what is true, and a citation alone links nothing."),
    h("div", { class: "oba-toolbar" }, h("button", { class: "oba-btn oba-btn-primary", type: "button", "data-claims-new": "true", onClick: () => newClaim() }, "Make a claim from the selected words")),
    status,
    undoRegion,
    formRegion,
    noticeRegion,
    findingsSummary,
    list,
  );

  return {
    element: root,
    state,
    async load() {
      try {
        await refresh();
        render();
        say(state.file ? `Stored privately in ${state.file}.` : "");
      } catch (error) {
        if (error.status === 401) throw error;
        list.replaceChildren(
          h("p", { class: "oba-error", role: "alert" }, `The claims could not be read. ${claimsErrorMessage(error)}`),
          ...(error.data?.file ? [h("p", { class: "oba-small" }, `Repair ${error.data.file} by hand, then open this view again. Nothing was changed.`)] : []),
        );
      }
    },
    isDirty: () => Boolean(form) && !busy,
    newClaim,
  };
}

export const SHARED_SOURCE_KINDS = Object.freeze([
  { value: "video", label: "Video", example: "e.g. How to Listen, a talk on YouTube" },
  { value: "article", label: "Article", example: "e.g. The Slow Read, an essay in a magazine" },
  { value: "podcast", label: "Podcast", example: "e.g. Episode 12: Paying attention" },
  { value: "book", label: "Book", example: "e.g. Middlemarch" },
  { value: "other", label: "Other", example: "e.g. A conversation at the river" },
]);

/** Matches the record's source limit, so the form never offers a source the server would refuse. */
export const MAX_SHARED_SOURCES = 20;

export function emptySharedSource(kind = "video") {
  return { kind, title: "", url: "", creator: "", publisher: "", published: "", isbn: "" };
}

function validIsbnShape(value) {
  if (!/^[0-9X\- ]+$/i.test(value)) return false;
  const symbols = value.replace(/[- ]/g, "");
  return /^\d{9}[\dX]$/i.test(symbols) || /^\d{13}$/.test(symbols);
}

/**
 * The first problem in a shared reflection draft, in the form's reading order, named by the same
 * field keys the server uses.
 */
export function validateSharedReflectionDraft(draft = {}) {
  const text = (value) => String(value ?? "").trim();
  const sources = Array.isArray(draft.sources) ? draft.sources : [];
  if (!sources.length) return { field: "sources", message: "Add the source you are reflecting on." };
  for (const [index, source] of sources.entries()) {
    const number = index + 1;
    if (!text(source?.title)) return { field: `sources.${index}.title`, message: `Source ${number}: add a title.` };
    const url = text(source.url);
    if (url && !isAbsoluteHttpUrl(url)) {
      return {
        field: `sources.${index}.url`,
        message: `Source ${number}: paste a full web address that starts with https:// or http://, without a username or password.`,
      };
    }
    if (source.kind === "book" && text(source.isbn) && !validIsbnShape(text(source.isbn))) {
      return { field: `sources.${index}.isbn`, message: `Source ${number}: an ISBN has 10 or 13 digits.` };
    }
  }
  if (!text(draft.title) && !text(draft.guidingQuestion)) {
    return { field: "title", message: "Add a working title or a guiding question." };
  }
  if (!text(draft.contributorId)) return { field: "contributorId", message: "Choose the contributor profile you will appear as." };
  return null;
}

/** The request body. Identity beyond the chosen contributor profile comes from the session. */
export function sharedReflectionPayload(draft = {}) {
  const text = (value) => String(value ?? "").trim();
  return {
    title: text(draft.title),
    guidingQuestion: text(draft.guidingQuestion),
    contributorId: text(draft.contributorId),
    sources: (Array.isArray(draft.sources) ? draft.sources : []).map((source) => ({
      kind: SHARED_SOURCE_KINDS.some((kind) => kind.value === source.kind) ? source.kind : "other",
      title: text(source.title),
      url: text(source.url),
      creator: text(source.creator),
      publisher: text(source.publisher),
      published: text(source.published),
      isbn: source.kind === "book" ? text(source.isbn) : "",
    })),
  };
}

/** The post paths or registry keys that blocked a Contributors save, ready to append to its message. */
export function contributorSaveRefusalDetail(data) {
  const named = [data?.paths, data?.contributors].filter(Array.isArray).flat().filter((item) => typeof item === "string" && item);
  return named.length ? ` ${named.join(", ")}` : "";
}

export function sharedReflectionFieldId(field) {
  const fixed = { title: "oba-shared-title", guidingQuestion: "oba-shared-question", contributorId: "oba-shared-contributor", sources: "oba-shared-add-source" };
  if (Object.hasOwn(fixed, field)) return fixed[field];
  const match = /^sources\.(\d{1,2})\.(title|url|creator|publisher|published|isbn)$/.exec(String(field ?? ""));
  return match ? `oba-shared-source-${match[1]}-${match[2]}` : "";
}

/** The field and message to show for a failed creation request; the field may be "". */
export function sharedReflectionProblemFromError(error) {
  const field = typeof error?.data?.field === "string" ? error.data.field : "";
  const message = typeof error?.data?.error === "string" && error.data.error ? error.data.error : error?.message || "The shared reflection could not be saved.";
  return { field, message };
}

/**
 * Show a problem in the form's alert and move focus to the field it names, or to the alert when the
 * field is missing or unknown. Returns the element that received focus.
 */
export function showSharedReflectionProblem(root, status, problem) {
  status.textContent = problem.message;
  status.hidden = false;
  const id = sharedReflectionFieldId(problem.field);
  const control = id ? root.querySelector(`#${id}`) : null;
  if (control) {
    control.setAttribute("aria-invalid", "true");
    control.focus();
    return control;
  }
  status.focus?.();
  return status;
}

/**
 * Send a validated draft. On failure the draft is left as it is so the writer can correct and
 * resend it; `failed` receives the error and the problem to show.
 */
export async function submitSharedReflection(draft, { post, created, failed }) {
  try {
    await post(sharedReflectionPayload(draft));
    await created();
  } catch (error) {
    await failed(error, sharedReflectionProblemFromError(error));
  }
}

export const INVITATION_ROLES = Object.freeze([
  { value: "contributor", label: "Contributor", help: "Writes their own part." },
  { value: "editor", label: "Editor", help: "Edits drafts revealed to them." },
  { value: "reader", label: "Reader", help: "Reads what is revealed to them." },
  { value: "coordinator", label: "Coordinator", help: "Invites people and manages roles below owner." },
  { value: "siteOwner", label: "Site owner", help: "Full control. Only site owners can grant this.", ownerOnly: true },
]);

/** The invitation request body. The inviter always comes from the session, never from here. */
export function invitationPayload(publicationId, draft = {}) {
  const allowed = new Set(INVITATION_ROLES.map((role) => role.value));
  const payload = {
    publicationId,
    adminUser: String(draft.adminUser || "").trim(),
    contributorId: String(draft.contributorId || ""),
    roles: [...new Set(draft.roles || [])].filter((role) => allowed.has(role)),
  };
  const days = Number(draft.lifetimeDays);
  if (Number.isInteger(days) && days > 0) payload.lifetimeDays = days;
  return payload;
}

/** The first problem in an invitation draft, as { field, message }, or null. */
export function validateInvitationDraft(draft = {}) {
  if (!String(draft.adminUser || "").trim()) return { field: "adminUser", message: "Enter the sign-in name of the person to invite." };
  if (!draft.contributorId) return { field: "contributorId", message: "Choose the contributor profile they will appear as." };
  if (!(draft.roles || []).length) return { field: "roles", message: "Choose at least one role." };
  return null;
}

/** An absolute copyable link, only ever for a path inside this Admin. */
export function invitationShareLink(origin, link) {
  return typeof link === "string" && link.startsWith("/admin/#/shared/accept/") ? `${origin}${link}` : "";
}

/** The token in an accept route's hash, or "". It is never read from anywhere else. */
export function invitationTokenFromHash(hash) {
  const { head, tail } = parseAdminHash(hash);
  if (head !== "shared" || !tail.startsWith("accept/")) return "";
  const token = tail.slice("accept/".length);
  return /^[a-z0-9-]{1,128}\.[0-9a-f]{64}$/.test(token) ? token : "";
}

const ROLE_LABELS = Object.fromEntries(INVITATION_ROLES.map((role) => [role.value, role.label]));

/** Roles as plain words, in a stable order. */
export function memberRolesLabel(roles = []) {
  const order = INVITATION_ROLES.map((role) => role.value);
  return [...roles]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((role) => ROLE_LABELS[role] || "Unknown role")
    .join(", ");
}

/** Problems with a member's sign-in binding, as sentences. Empty when there are none. */
export function memberWarnings(member) {
  return member?.bindingCurrent === false
    ? ["This sign-in account or contributor profile no longer exists, so this person cannot sign in to the reflection until someone with access invites them again."]
    : [];
}

/** What ending a member's access does and does not do. Credit and sign-in are separate. */
export function removalImpact(member) {
  const name = member.displayName || member.adminUser;
  return `${name} will no longer be able to sign in to this shared reflection or see it, and any link they hold stops working. ${
    member.hasContributions
      ? `Their name stays credited for what they wrote and approved, and their drafts stay in the record.`
      : `They have not written or approved anything here, so no credit changes.`
  } You can invite them again later.`;
}

/** What a role change does, as sentences. Empty when nothing changes. */
export function roleChangeImpact(member, nextRoles) {
  const current = new Set(member.roles || []);
  const next = new Set(nextRoles || []);
  const added = [...next].filter((role) => !current.has(role));
  const removed = [...current].filter((role) => !next.has(role));
  const lines = [];
  if (added.length) lines.push(`Adds: ${memberRolesLabel(added)}.`);
  if (removed.length) lines.push(`Removes: ${memberRolesLabel(removed)}.`);
  if (removed.includes("siteOwner")) lines.push("They will lose full control of this reflection.");
  if (removed.includes("contributor") && member.hasContributions) lines.push("Their existing drafts and credit stay as they are.");
  return lines;
}

/** An invitation's state in words, so it never depends on color. */
export function invitationStatusText(invitation) {
  const when = invitation.expiresAt ? new Date(invitation.expiresAt * 1000).toLocaleString() : "";
  switch (invitation.state) {
    case "pending":
      return `Waiting for an answer. Expires ${when}.`;
    case "accepted":
      return "Accepted. This person is now a member.";
    case "declined":
      return "Declined by the person invited.";
    case "revoked":
      return "Withdrawn. The link no longer works.";
    case "expired":
      return "Expired. Issue a new link to invite them again.";
    default:
      return "Unknown state.";
  }
}

/** The message to show for a failed member or invitation request, and whether to reload. */
export function sharedManagementError(error) {
  const status = error?.status;
  const message = error?.data?.error || error?.message || "That did not work. Reload and try again.";
  if (status === 409) return { message, reload: true };
  if (status === 404 || status === 403) return { message: `${message} If your access changed, reload this page.`, reload: true };
  return { message, reload: false };
}

// ---------------------------------------------------------------- shared reflection drafts

/** Optional starting points. Nothing requires them: a writer can ignore, edit, or delete any of them. */
export const REFLECTION_PROMPTS = Object.freeze([
  "What stood out to you, and why?",
  "What did you agree or disagree with?",
  "What did it remind you of from your own experience?",
  "What would you ask the others who took part?",
]);

/** The Markdown a prompt adds to a draft: a plain quote the writer owns once it is inserted. */
export function promptInsertion(prompt) {
  return `> ${String(prompt).replace(/\s+/g, " ").trim()}\n\n`;
}

/** Insert text at a selection (or at the end), returning the new text and where the caret goes. */
export function insertAtSelection(text, start, end, insertion) {
  const length = text.length;
  const from = Number.isInteger(start) && start >= 0 && start <= length ? start : length;
  const to = Number.isInteger(end) && end >= from && end <= length ? end : from;
  return { text: text.slice(0, from) + insertion + text.slice(to), caret: from + insertion.length };
}

/** The visible, non-color save state of a draft. */
export function draftStateText({ number = 0, dirty = false, saving = false } = {}) {
  if (saving) return "Saving...";
  if (dirty) return number ? `Unsaved changes. Last saved as revision ${number}.` : "Unsaved changes. Nothing saved yet.";
  return number ? `Saved as revision ${number}. Only you can see it.` : "Nothing saved yet. Only you can see what you write here.";
}

/** Sort a failed draft request into what the writer should be told and whether their text is safe. */
export function draftFailure(error) {
  const status = error?.status;
  const text = error?.data?.error || error?.message || "";
  if (!status) return { kind: "offline", message: "Could not reach the server. You may be offline. Your text is still here and has not been saved; try again when you are back." };
  if (status === 409) return { kind: "conflict", message: text || "Your draft changed elsewhere, perhaps in another tab.", current: error?.data?.current ?? null };
  if (status === 404 || status === 403) return { kind: "denied", message: "You cannot write a draft in this shared reflection, or your access changed. Your text is still here; copy it before reloading." };
  if (status === 422) return { kind: "invalid", message: text || "That draft could not be saved. Your text is still here." };
  return { kind: "other", message: text || "That did not work. Your text is still here; try again." };
}

// ---------------------------------------------------------------- shared synthesis (continuing conversation)

/** The kinds of synthesis item, each with an optional prompt the author may use, edit or ignore. */
export const SYNTHESIS_KINDS = Object.freeze([
  { value: "agreement", label: "Agreement", prompt: "Where did we land in the same place?" },
  { value: "difference", label: "Difference", prompt: "Where do we see it differently, and why?" },
  { value: "question", label: "Question", prompt: "What are we still wondering about?" },
  { value: "application", label: "Application", prompt: "What could a reader try or do with this?" },
  { value: "uncertainty", label: "Uncertainty", prompt: "What are we not sure about?" },
]);

export function synthesisKindLabel(kind) {
  return SYNTHESIS_KINDS.find((item) => item.value === kind)?.label || "Item";
}

const nameList = (people) => (people || []).map((person) => person.displayName || "A participant").join(", ");

/** One item as words: its kind, who it speaks for, who approved it and who is still awaited. */
export function synthesisItemText(item) {
  const speaking = nameList(item?.contributors) || "no one";
  const approved = nameList(item?.approved) || "no one yet";
  const awaiting = (item?.awaiting || []).length ? nameList(item.awaiting) : "no one";
  return `${synthesisKindLabel(item?.kind)}, speaking for ${speaking}. Approved by: ${approved}. Awaiting: ${awaiting}.`;
}

/** The new order of item ids after moving one by `delta` places, or null when it cannot move. */
export function moveSynthesisItem(ids, id, delta) {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Sort a failed synthesis request into what the author should be told. Their text is never lost. */
export function synthesisFailure(error) {
  const status = error?.status;
  const text = error?.data?.error || error?.message || "";
  if (!status) return { kind: "offline", message: "Could not reach the server. You may be offline. Your text is still here and has not been saved." };
  if (status === 409) return { kind: "conflict", message: text || "The continuing conversation changed elsewhere. Reload to see the current items." };
  if (status === 404 || status === 403) return { kind: "denied", message: "You cannot work on this continuing conversation, or your access changed. Your text is still here; copy it before reloading." };
  if (status === 422) return { kind: "invalid", message: text || "That item could not be saved. Your text is still here." };
  return { kind: "other", message: text || "That did not work. Your text is still here; try again." };
}

const PROMPTS_DISMISSED_KEY = "ob-admin-synthesis-prompts-dismissed";

function promptsDismissed() {
  try {
    return globalThis.localStorage?.getItem(PROMPTS_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberPromptsDismissed(dismissed) {
  try {
    if (dismissed) globalThis.localStorage?.setItem(PROMPTS_DISMISSED_KEY, "1");
    else globalThis.localStorage?.removeItem(PROMPTS_DISMISSED_KEY);
  } catch {
    // Remembering is a convenience only.
  }
}

// ---------------------------------------------------------------- media moments (ADR 0062 to 0064)

/** Where in a source a moment can sit. Folios are never offered: a shared source is no manuscript. */
export const MOMENT_LOCATOR_KINDS = Object.freeze([
  { value: "timestamp", label: "Time", hint: "Seconds or h:mm:ss, such as 75 or 1:02:03." },
  { value: "page", label: "Page", hint: "A page number or label, such as 12 or xiv." },
  { value: "chapter", label: "Chapter", hint: "A chapter number or name." },
  { value: "section", label: "Section", hint: "A section number or name." },
  { value: "line", label: "Line", hint: "A line number." },
  { value: "canonical", label: "Canonical reference", hint: "A standard reference, such as Republic 514a." },
]);

/**
 * The participant's statement about republishing a quotation. There is no default on purpose. The
 * labels are statements the participant makes; nothing here grants or judges a use (ADR 0065).
 */
export const QUOTATION_RIGHTS = Object.freeze([
  { value: "unknown", label: "Not checked yet (keeps the moment private)" },
  { value: "briefQuotation", label: "A brief quotation for commentary or review" },
  { value: "permission", label: "The rights holder gave permission" },
  { value: "openLicense", label: "The source is under an open licence" },
  { value: "publicDomain", label: "The source is in the public domain" },
  { value: "ownWords", label: "These are my own words" },
]);

/** Where a quotation's words came from. */
export const QUOTATION_PROVENANCE = Object.freeze([
  { value: "transcribed", label: "I transcribed it from the media" },
  { value: "copied", label: "Copied from published text, captions or a transcript" },
  { value: "supplied", label: "Supplied by the speaker or rights holder" },
]);

const MAX_LOCATOR_CHARS = 64;

/**
 * Read a typed time the way the server does: seconds, m:ss or h:mm:ss, each later part two digits
 * below 60, with an optional decimal fraction. The same text always gives the same answer, and
 * anything else (1h2m, 1:2, 1:60, a sign, a space) is null rather than a guess.
 */
export function parseMomentTimestamp(text) {
  const value = String(text ?? "");
  const match = /^(\d+(?::[0-5]\d){0,2})(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  let seconds = 0;
  for (const part of match[1].split(":")) {
    seconds = seconds * 60 + Number(part);
    if (!Number.isSafeInteger(seconds)) return null;
  }
  return { seconds, fraction: (match[2] || "").replace(/0+$/, "") };
}

/** Whether time `a` is strictly before time `b`, compared exactly as the server compares them. */
function timeBefore(a, b) {
  if (a.seconds !== b.seconds) return a.seconds < b.seconds;
  const width = Math.max(a.fraction.length, b.fraction.length);
  return a.fraction.padEnd(width, "0") < b.fraction.padEnd(width, "0");
}

/** What is wrong with one typed location, or "" when the server would accept its shape. */
export function momentLocationError(kind, value, to) {
  const label = MOMENT_LOCATOR_KINDS.find((entry) => entry.value === kind)?.label || "Location";
  for (const [text, name] of [[value, "start"], [to, "end"]]) {
    if (name === "end" && (text === undefined || text === null || text === "")) continue;
    const typed = String(text ?? "");
    if (!typed) return `Give the ${label.toLowerCase()} where the moment is.`;
    if (typed.trim() !== typed || [...typed].length > MAX_LOCATOR_CHARS || /[\u0000-\u001f\u007f;[\]]/.test(typed) || typed.includes(" to ")) {
      return `Write the ${name} of the location without surrounding spaces, brackets or semicolons, in up to ${MAX_LOCATOR_CHARS} characters.`;
    }
    if (kind === "timestamp" && !parseMomentTimestamp(typed)) return `Write the ${name} time as seconds or h:mm:ss, such as 75 or 1:02:03.`;
  }
  if (kind === "timestamp" && to && !timeBefore(parseMomentTimestamp(value), parseMomentTimestamp(to))) {
    return "The end time must come after the start time.";
  }
  return "";
}

/**
 * The request body for a typed moment, or the field to fix and why. `form` holds the typed
 * values; `keep` carries what the form does not edit (further locators, the quotation language),
 * so editing a moment never drops them.
 */
export function momentPayload(form, keep = {}) {
  if (!form.source) return { error: "Choose the source this moment is in.", field: "source" };
  const locationError = momentLocationError(form.kind, form.value, form.to);
  if (locationError) return { error: locationError, field: form.value && !momentLocationError(form.kind, form.value, "") ? "to" : "value" };
  const locator = { kind: form.kind, value: form.value };
  if (form.to) locator.to = form.to;
  const moment = { source: form.source, locators: [locator, ...(keep.locators || [])], intent: form.publish ? "publication" : "private" };
  if (form.quote) {
    if (!form.rights) return { error: "Say what rights apply to the quotation. Choose “Not checked yet” if nobody has checked.", field: "rights" };
    if (!form.provenance) return { error: "Say where the quoted words came from.", field: "provenance" };
    if (form.publish && form.rights === "unknown") return { error: "A quotation whose rights are not checked yet stays private. Choose a rights status, or do not propose this moment for the piece.", field: "rights" };
    const quotation = { text: form.quote, rights: form.rights, provenance: form.provenance };
    const speaker = String(form.speaker ?? "").trim();
    if (speaker) quotation.speaker = speaker;
    const rightsNote = String(form.rightsNote ?? "").trim();
    if (rightsNote) quotation.rightsNote = rightsNote;
    if (keep.language) quotation.language = keep.language;
    moment.quotation = quotation;
  }
  if (String(form.observation ?? "").trim()) moment.observation = form.observation;
  if (!moment.quotation && !moment.observation) return { error: "Add a quotation, an observation, or both.", field: "quote" };
  return { moment };
}

/**
 * Warnings about a typed quotation, from the server's quotation guide so the panel says exactly what
 * the preview says: no speaker named, and longer than the brief-quotation guide (counted in Unicode
 * characters, newlines included, as the server counts). They never block saving. Without a guide
 * (an older server) there are none rather than a guess.
 */
export function quotationNotices(form, guide) {
  const text = String(form?.quote ?? "");
  if (!text || !guide?.notices) return [];
  const notices = [];
  const note = (code) => guide.notices[code] && notices.push({ code, message: guide.notices[code] });
  if (!String(form.speaker ?? "").trim()) note("noSpeaker");
  if (Number.isSafeInteger(guide.briefQuotationChars) && [...text].length > guide.briefQuotationChars) note(form.rights === "briefQuotation" ? "longForBriefQuotation" : "long");
  return notices;
}

/** The neutral guidance for a rights status, followed by the statement that it is the participant's own word. */
export function rightsGuidanceText(rights, guide) {
  const entry = (guide?.rights || []).find((item) => item.value === rights);
  if (!entry) return guide?.statement || "";
  return [entry.guidance, guide.statement].filter(Boolean).join(" ");
}

/** Moments in reading order: by the source's place in the reflection, then by time, then as made. */
export function sortMoments(moments, sources) {
  const place = (moment) => {
    const index = (sources || []).findIndex((source) => source.id === moment.source);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const start = (moment) => {
    const locator = (moment.locators || []).find((entry) => entry.kind === "timestamp");
    return locator ? parseMomentTimestamp(locator.value) : null;
  };
  const made = (moment) => Number(/^moment-(\d+)$/.exec(moment.id || "")?.[1] ?? Number.MAX_SAFE_INTEGER);
  return (moments || [])
    .map((moment, index) => ({ moment, index }))
    .sort((a, b) => {
      const byPlace = place(a.moment) - place(b.moment);
      if (byPlace) return byPlace;
      const [x, y] = [start(a.moment), start(b.moment)];
      if (x && y && (timeBefore(x, y) || timeBefore(y, x))) return timeBefore(x, y) ? -1 : 1;
      if (x && !y) return -1;
      if (y && !x) return 1;
      return made(a.moment) - made(b.moment) || a.index - b.index;
    })
    .map((entry) => entry.moment);
}

/** One moment as words: which source, where, and who can see it. */
export function momentText(moment, sources) {
  const source = (sources || []).find((entry) => entry.id === moment?.source);
  const name = source ? `${source.title} (${source.kindLabel || "Source"})` : "A source that is no longer listed";
  const intent = moment?.intent === "publication" ? "Proposed for the piece: shared with the revision you offer, and every author must approve it." : "Private: only you can see it.";
  return `${name}, ${moment?.location || "no location"}. ${intent}`;
}

/** The link to follow for a moment, as words that say whether it starts at the moment. */
export function momentLinkText(moment) {
  if (!moment?.link?.href) return "";
  const start = (moment.locators || []).find((entry) => entry.kind === "timestamp")?.value;
  return moment.link.atTime && start ? `Open the source at ${start}` : "Open the source (find the location yourself)";
}

/**
 * What an offer's response says about the writer's proposed moments: nothing when they were shared
 * or the writer has none, the write-once advice when that revision was already sealed with other
 * moments, and the server's note when they could not be stored (they stay private).
 */
export function offeredMomentsText(result) {
  if (result?.momentsShared === false) return " Your moments changed after you first offered this revision, so those changes stay private until you save and offer a newer revision.";
  if (result && "momentsShared" in result && result.momentsShared === null) return ` ${result.momentsNote || "Your moments could not be shared with this revision, so they stay private. Offer this revision again to share them."}`;
  return "";
}

/** Sort a failed moments request into what to tell the person. What they typed is never lost. */
export function momentsFailure(error) {
  const status = error?.status;
  const text = error?.data?.error || error?.message || "";
  if (!status) return { kind: "offline", message: "Could not reach the server. You may be offline. What you typed is still here and has not been saved." };
  if (status === 409) return { kind: "conflict", message: text || "The moments changed elsewhere. What you typed is still here; review the current moments and save again." };
  if (status === 404 || status === 403) return { kind: "denied", message: "You cannot work on moments in this reflection, or your access changed. What you typed is still here; copy it before reloading." };
  if (status === 422) return { kind: "invalid", message: text || "That moment could not be saved. What you typed is still here.", field: error?.data?.field || "" };
  return { kind: "other", message: text || "That did not work. What you typed is still here; try again." };
}

// ---------------------------------------------------------------- shared reflection series

/** The select value for "type a new series title". A series address can never contain brackets. */
export const NEW_SERIES = "(new)";
/** The select value for "not in a series". */
export const NO_SERIES = "";
const MAX_SERIES_ORDER = 4294967295;

/** A placement as words: "Letters, part 2", or the title alone when no position is set. */
export function seriesPlacementText(name, order) {
  if (!name) return "Not part of a series.";
  return order === null || order === undefined ? `${name} (no position: after any numbered parts, by date)` : `${name}, part ${order}`;
}

/** One part of a previewed reading order as words, never colour or position alone. */
export function seriesPartText(part, index) {
  const position = part?.order === null || part?.order === undefined ? "no position" : `position ${part.order}`;
  if (part?.thisPublication) return `${index + 1}. This shared reflection (not published yet, ${position})`;
  return `${index + 1}. ${part?.title || "Untitled part"} (${position})`;
}

/**
 * The request body for the chosen series, or a message saying what to fix. An existing series is
 * referred to by its address, which is what an ordinary post's `series` holds.
 */
export function seriesPlacementRequest(choice, title, order) {
  const text = String(order ?? "").trim();
  if (text && (!/^\d+$/.test(text) || Number(text) > MAX_SERIES_ORDER)) {
    return { error: "Use a whole number of 0 or more for the position, or leave it empty.", field: "order" };
  }
  const position = text ? Number(text) : null;
  if (choice === NO_SERIES) return { placement: null };
  if (choice === NEW_SERIES) {
    const name = String(title ?? "").trim();
    if (!name) return { error: "Type the series title, or choose an existing series.", field: "title" };
    return { placement: { series: name, order: position } };
  }
  return { placement: { series: choice, order: position } };
}

/**
 * The placement to send, keeping the stored reference when nothing really changed. A stored
 * placement may be a typed title (such as "Letters Home") that the select shows as the existing
 * series it resolves to ("letters-home"). Sending that address back would look like a change to
 * the server, which would bump the revision and make every approval stale, so when the chosen
 * series is the one the stored reference resolves to (`storedSlug`, the server's slug for it) and
 * the position is the same, the stored placement is sent exactly as it was.
 */
export function keepStoredSeries(placement, stored, storedSlug) {
  if (!placement || !stored) return placement;
  const slug = storedSlug || slugify(String(stored.series ?? ""));
  const sameOrder = (placement.order ?? null) === (stored.order ?? null);
  return placement.series === slug && sameOrder ? { series: stored.series, order: stored.order ?? null } : placement;
}

/** Sort a failed series request into what to tell the person. What they typed is never lost. */
export function seriesFailure(error) {
  const status = error?.status;
  const text = error?.data?.error || error?.message || "";
  if (!status) return { kind: "offline", message: "Could not reach the server. You may be offline. Your choice is still here and has not been saved." };
  if (status === 409) return { kind: "conflict", message: text || "The series placement changed elsewhere. Your choice is still here; review the current placement and save again." };
  if (status === 404 || status === 403) return { kind: "denied", message: "You cannot arrange this shared reflection's series, or your access changed. Your choice is still here; reload to check." };
  if (status === 422) return { kind: "invalid", message: text || "That series choice could not be saved.", field: error?.data?.field || "" };
  return { kind: "other", message: text || "That did not work. Your choice is still here; try again." };
}

export const REVEAL_POLICIES = Object.freeze([
  { value: "independent", label: "Independent", help: "Nobody sees anyone else's draft." },
  { value: "voluntary", label: "Voluntary", help: "Any two or more writers who offer a revision share those revisions with each other." },
  { value: "allReady", label: "Everyone ready", help: "Nothing is shared until every writer has offered a revision. If a writer cannot or will not offer, a coordinator can switch to Voluntary or change that person's role." },
]);

/** One comparison slot as words: whose it is, and what the reader may know about it. */
export function revealSlotText(slot) {
  const name = slot?.displayName || "A participant";
  if (slot?.kind === "own") return `${name} (you): your latest saved revision.`;
  if (slot?.kind === "revealed") return `${name}: revealed to you, revision ${slot.stamp?.number ?? "?"}.`;
  return slot?.ready ? `${name}: private. They have offered a revision to share.` : `${name}: private. They have not offered a revision.`;
}

/** One author's line in the combined preview: what is shown and where their approval stands. */
export function previewSectionText(section) {
  const name = section?.displayName || "A participant";
  const where = section?.shown ? `revision ${section.revision}` : "not shared with you at its current revision";
  const approval = section?.approval === "approved" ? "approved" : section?.approval === "stale" ? "approval out of date" : "awaiting approval";
  return `${name}: ${where}; ${approval}${section?.required === false ? " (approval not required)" : ""}.`;
}

/** One synthesis item's line in the combined preview: who it speaks for and who has approved it. */
export function previewItemText(item) {
  const names = (list) => ((list || []).length ? list.join(", ") : "no one");
  return `${synthesisKindLabel(item?.kind)}${item?.mine ? " (yours)" : ""}: speaks for ${names(item?.authors)}. Approved by: ${names(item?.approved)}. Awaiting: ${names(item?.awaiting)}.`;
}

/** The one-line state of the whole preview. */
export function previewStateText(preview) {
  if (preview?.ready) return "Every required author has approved this exact piece.";
  if (preview?.complete) return "Not ready to publish: approvals are missing or out of date.";
  return "Incomplete: some sections are not shared with you at their current revision.";
}

/** Whose approval publication needs (ADR 0052). Every writer approves under every rule. */
export const APPROVAL_REQUIREMENTS = Object.freeze([
  { value: "allAuthors", label: "Every author", help: "Everyone taking part as an author approves, whether or not they wrote a section." },
  { value: "contributingAuthors", label: "Everyone who wrote", help: "Only authors who wrote a section, or are named on a conversation item, approve." },
  { value: "namedAuthors", label: "Writers and named people", help: "Everyone who wrote approves, and so do the people you choose below, even if they later leave." },
  { value: "authorsWithRoles", label: "Writers and people with a role", help: "Everyone who wrote approves, and so does every author with a role you choose below." },
]);

/** The roles a role-based rule can list. Readers and editors cannot approve, so they are not offered. */
export const APPROVAL_ROLE_CHOICES = Object.freeze([
  { value: "siteOwner", label: "Site owner" },
  { value: "coordinator", label: "Coordinator" },
  { value: "contributor", label: "Contributor" },
]);

const ROLE_WORDS = { siteOwner: "a site owner", coordinator: "a coordinator", contributor: "a contributor", editor: "an editor", reader: "a reader" };

/** The server's policy as form choices: one kind, the named people, the roles and the scope. */
export function approvalPolicyChoice(policy) {
  const requirement = policy?.requirement ?? "allAuthors";
  const choice = { kind: "allAuthors", named: [], roles: [], scope: policy?.scope === "wholePiece" ? "wholePiece" : "ownSections" };
  if (typeof requirement === "string") choice.kind = APPROVAL_REQUIREMENTS.some((item) => item.value === requirement) ? requirement : "allAuthors";
  else if (Array.isArray(requirement?.namedAuthors)) Object.assign(choice, { kind: "namedAuthors", named: [...requirement.namedAuthors] });
  else if (Array.isArray(requirement?.authorsWithRoles)) Object.assign(choice, { kind: "authorsWithRoles", roles: [...requirement.authorsWithRoles] });
  return choice;
}

/**
 * Everyone a named rule can list: people who can approve now, then anyone the current rule names
 * who no longer can (they left, or lost the approve grant). Those stay chosen, so nothing is kept
 * unseen, and can be cleared like anyone else.
 */
export function approvalPeopleRows(rule) {
  const rows = (rule?.approvers || []).map((person) => ({ participantId: person.participantId, displayName: person.displayName, canApprove: true }));
  for (const person of rule?.formerApprovers || []) {
    if (!rows.some((row) => row.participantId === person.participantId)) rows.push({ participantId: person.participantId, displayName: person.displayName || "Someone no longer in this reflection", canApprove: false });
  }
  return rows;
}

/** The policy the server expects for these choices, or a sentence saying what is missing. */
export function approvalPolicyPayload(choice) {
  const scope = choice?.scope === "wholePiece" ? "wholePiece" : "ownSections";
  if (choice?.kind === "namedAuthors") {
    const named = [...new Set(choice.named || [])];
    if (!named.length) return { error: "Choose at least one person who must approve." };
    return { policy: { requirement: { namedAuthors: named }, scope } };
  }
  if (choice?.kind === "authorsWithRoles") {
    const roles = [...new Set(choice.roles || [])];
    if (!roles.length) return { error: "Choose at least one role whose authors must approve." };
    return { policy: { requirement: { authorsWithRoles: roles }, scope } };
  }
  const kind = choice?.kind === "contributingAuthors" ? "contributingAuthors" : "allAuthors";
  return { policy: { requirement: kind, scope } };
}

/** The rule in words, with anything that keeps it from being met as things stand. */
export function approvalRuleText(rule) {
  const parts = [rule?.summary || "Every author must approve."];
  const problems = [];
  if (rule?.unmetNamed?.length) problems.push(`${rule.unmetNamed.join(", ")} can no longer approve`);
  for (const role of rule?.unmetRoles || []) problems.push(`no author is ${ROLE_WORDS[role] || "in that role"}`);
  if (problems.length) {
    parts.push(`It cannot be met as things stand: ${problems.join("; ")}.`);
    // Only a site owner can take a named person off the rule; a coordinator can change a role.
    if (rule.unmetNamed?.length) parts.push("A site owner can take them off the rule, or restore their access.");
    if (rule.unmetRoles?.length) parts.push("A coordinator can change the rule, or give an author that role.");
  }
  return parts.join(" ");
}

/** A failed rule change as words, and what kind of failure it was. */
export function approvalRuleFailure(error) {
  const status = error?.status;
  const text = error?.data?.error || error?.message || "";
  if (!status) return { kind: "offline", message: "Could not reach the server. The rule did not change; try again when you are back." };
  if (status === 409) return { kind: "conflict", message: text || "The approval rule changed elsewhere. Reload to see it; nothing was changed." };
  if (status === 403 && error?.data?.field === "policy") return { kind: "needsOwner", message: text || "Only a site owner can stop someone from having to approve. Nothing was changed." };
  if (status === 404 || status === 403) return { kind: "denied", message: "You cannot choose the approval rule for this reflection, or your access changed." };
  if (status === 422) return { kind: "invalid", message: text || "That approval rule is not valid. Nothing was changed." };
  return { kind: "other", message: text || "That did not work. Nothing was changed; try again." };
}

/** The line that starts a new part of a draft (ADR 0029). It is invisible in published output. */
export const PART_MARKER_LINE = "<!-- openblog:part -->";

/** What to insert at the caret to start a new part: the marker alone on its own line. */
export function partBreakInsertion() {
  return `\n${PART_MARKER_LINE}\n`;
}

/** The layouts a coordinator can choose (ADR 0031). The server decides which exist. */
export const ARRANGEMENT_LAYOUTS = Object.freeze([
  { value: "sequential", label: "Sequential", help: "One section after another, in reading order." },
  { value: "sideBySide", label: "Side by side", help: "Sections sit in columns on wide screens and read one after another on narrow ones." },
  { value: "pointCounterpoint", label: "Point and counterpoint", help: "Two columns on wide screens when exactly two people take part; with three or more it reads as one column. Optional labels are yours; nothing is implied about who agrees." },
  { value: "alternatingDialogue", label: "Alternating dialogue", help: "Turns alternate like a conversation on wide screens, switching side when the speaker changes, each under its author's name." },
  { value: "roundtable", label: "Roundtable", help: "Turns sit in a grid that fits any number of participants and reads in the same order." },
]);

/** The longest label a turn may carry, in UTF-8 bytes like the server's limit. */
export const TURN_LABEL_MAX_BYTES = 80;

/**
 * An editable copy of the stored arrangement, or a starting one: a single round holding the first
 * part of everyone's draft, in participant order. Nothing here reads a draft.
 */
export function arrangementDraft(stored, participants) {
  if (stored && Array.isArray(stored.rounds)) {
    return {
      revision: Number(stored.revision) || 0,
      layout: stored.layout || "sequential",
      rounds: stored.rounds.map((round) => ({
        id: round.id,
        prompt: round.roundPrompt || "",
        turns: (round.turns || []).map((turn) => ({ draft: turn.draft, part: Number(turn.part) || 0, label: turn.label || "" })),
      })),
    };
  }
  return {
    revision: 0,
    layout: "sequential",
    rounds: [{ id: "round-1", prompt: "", turns: (participants || []).map((person) => ({ draft: person.id, part: 0, label: "" })) }],
  };
}

/** A new list with the item at `index` moved by `delta`; out-of-range moves change nothing. */
export function moveItem(list, index, delta) {
  const target = index + delta;
  if (!Number.isInteger(index) || index < 0 || index >= list.length || target < 0 || target >= list.length) return list.slice();
  const next = list.slice();
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

/** The next round id that no round uses yet. */
export function nextRoundId(rounds) {
  const used = new Set(rounds.map((round) => String(round.id).toLowerCase()));
  for (let n = rounds.length + 1; n < rounds.length + 1000; n += 1) {
    if (!used.has(`round-${n}`)) return `round-${n}`;
  }
  return `round-${Date.now()}`;
}

/** The request body for saving: the edited draft as a structure one revision after the stored one. */
export function arrangementPayload(draft) {
  return {
    version: 1,
    revision: draft.revision + 1,
    layout: draft.layout,
    rounds: draft.rounds.map((round) => {
      const prompt = String(round.prompt || "").trim();
      return { id: round.id, ...(prompt ? { roundPrompt: prompt } : {}), turns: round.turns.map((turn) => {
          const label = String(turn.label || "").trim();
          return { draft: turn.draft, part: Number(turn.part), ...(label ? { label } : {}) };
        }),
      };
    }),
  };
}

/** A mistake in the draft the server would refuse anyway, found first so the words can be specific. */
export function validateArrangement(draft) {
  if (!draft.rounds.length) return "Add at least one round.";
  const seen = new Set();
  for (const [r, round] of draft.rounds.entries()) {
    if (!round.turns.length) return `Round ${r + 1} has no turns. Add a turn or remove the round.`;
    if (String(round.prompt || "").includes("\n")) return `Round ${r + 1}: keep the round prompt on one line.`;
    for (const turn of round.turns) {
      const part = Number(turn.part);
      if (!Number.isInteger(part) || part < 0 || part > 999) return `Round ${r + 1}: a part is a whole number from 1 up.`;
      const label = String(turn.label || "");
      if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(label)) return `Round ${r + 1}: keep a turn label on one line.`;
      if (new TextEncoder().encode(label.trim()).length > TURN_LABEL_MAX_BYTES) return `Round ${r + 1}: a turn label can be at most ${TURN_LABEL_MAX_BYTES} bytes, which is a short phrase.`;
      const key = `${String(turn.draft).toLowerCase()}:${part}`;
      if (seen.has(key)) return `Round ${r + 1}: each part of each draft can appear only once.`;
      seen.add(key);
    }
  }
  return "";
}

/** What went wrong saving an arrangement, in words that say nothing about anyone's draft. */
export function arrangementFailure(error) {
  const status = error?.status;
  const text = error?.data?.error || error?.message || "";
  if (!status) return { kind: "offline", message: "Could not reach the server. Your changes are still here and were not saved; try again when you are back." };
  if (status === 409) return { kind: "conflict", message: text || "The arrangement changed elsewhere. Reload to see it; nothing was changed." };
  if (status === 404 || status === 403) return { kind: "denied", message: "You cannot arrange this reflection, or your access changed." };
  if (status === 422) return { kind: "invalid", message: text || "That arrangement is not valid." };
  return { kind: "other", message: text || "That did not work. Try again." };
}

const SUGGESTED_SOURCE_FIELDS = ["title", "creator", "publisher"];

/**
 * Copy provider suggestions into a source, only into fields the author left empty. Anything the
 * author typed is kept as is, whatever the provider says. Returns the fields that were filled.
 */
export function applySourceSuggestion(source, suggestion) {
  const applied = [];
  if (!source || !suggestion || suggestion.provenance !== "provider") return applied;
  for (const key of SUGGESTED_SOURCE_FIELDS) {
    const value = suggestion[key];
    if (typeof value === "string" && value.trim() && !String(source[key] ?? "").trim()) {
      source[key] = value.trim();
      applied.push(key);
    }
  }
  return applied;
}

/**
 * Ask the server for optional details about a source link. It never throws and never blocks
 * authoring: every failure becomes a plain message and the source stays as the author left it.
 */
export async function lookupSourceDetails(source, call, isCurrent = () => true) {
  const url = String(source?.url ?? "").trim();
  if (!url) return { applied: [], message: "Paste a link first. Details are optional; you can always type them yourself." };
  let result;
  try {
    result = await call({ url });
  } catch {
    return { applied: [], message: "Details could not be looked up. Type them yourself; nothing is lost." };
  }
  // The author may have changed the link or removed the source while we waited: drop the answer.
  if (!isCurrent() || String(source?.url ?? "").trim() !== url) {
    return { applied: [], stale: true, message: "The link or source changed while looking up, so nothing was filled in." };
  }
  if (result?.status === "found" && result.suggestion) {
    const applied = applySourceSuggestion(source, result.suggestion);
    const provider = result.suggestion.publisher || "the provider";
    return {
      applied,
      provider,
      message: applied.length
        ? `Suggested by ${provider} and filled in: ${applied.join(", ")}. Check them; they are yours to edit.`
        : `${provider} had nothing to add to what you already typed.`,
    };
  }
  if (result?.status === "unavailable") {
    return { applied: [], message: `${result.message || "No details came back."} Type them yourself; nothing is lost.` };
  }
  return { applied: [], message: "Details can only be suggested for YouTube and CodePen links. Type them yourself." };
}

export function sharedSourceHref(value) {
  return typeof value === "string" && isAbsoluteHttpUrl(value) ? value : "";
}

export function previewWarningsForDisplay(warnings) {
  return Array.isArray(warnings) ? warnings.filter((warning) => typeof warning === "string" && warning.trim()) : [];
}

export function portableDiagnosticsForDisplay(diagnostics) {
  return Array.isArray(diagnostics)
    ? diagnostics
      .filter((diagnostic) => diagnostic && typeof diagnostic.message === "string" && diagnostic.message.trim())
      .map((diagnostic) => {
        const scope = diagnostic.sourcePath ? `${diagnostic.sourcePath}: ` : "";
        const repair = typeof diagnostic.recommendedAction === "string" && diagnostic.recommendedAction.trim()
          ? ` Action: ${diagnostic.recommendedAction}`
          : "";
        return `${scope}${diagnostic.severity || "warning"}: ${diagnostic.message}${repair}`;
      })
    : [];
}

function previewDestinationPolicy(policies, mode) {
  return Array.isArray(policies)
    ? policies.find((policy) => policy?.version === 1 && `destination:${policy.provider}` === mode)
    : null;
}

export function portablePreviewArtifact(preview, mode) {
  const portable = preview?.portablePreview;
  if (!portable || mode === "site") return null;
  const representation = mode.startsWith("destination:")
    ? previewDestinationPolicy(portable.destinations, mode)?.representation
    : mode;
  const formats = {
    "portable-html": ["html", "text/html"],
    "portable-markdown": ["markdown", "text/markdown"],
    "manual-markdown": ["markdown", "text/markdown"],
    "portable-text": ["text", "text/plain"],
  };
  const format = formats[representation];
  if (!format || typeof portable[format[0]] !== "string") return null;
  return { content: portable[format[0]], extension: { html: "html", markdown: "md", text: "txt" }[format[0]], mime: `${format[1]};charset=utf-8` };
}

export function destinationPolicyForDisplay(policies, mode) {
  if (!String(mode).startsWith("destination:")) return [];
  const policy = previewDestinationPolicy(policies, mode);
  if (!policy) return ["Destination policy is unavailable; do not publish until the policy can be loaded."];
  return [
    `${policy.label}: ${policy.canonicalBehavior}`,
    `${policy.label}: ${policy.workflow}`,
    ...(policy.conversionReview ? [`${policy.label}: ${policy.conversionReview}`] : []),
    ...(policy.maxRequestBodyBytes
      ? [`${policy.label}: CLI validates the complete serialized request against a ${policy.maxRequestBodyBytes}-byte limit; a body preview alone cannot certify request size.`]
      : []),
  ];
}

export function destinationTagsForDisplay(plans, mode) {
  if (!String(mode).startsWith("destination:") || !Array.isArray(plans)) return [];
  const plan = plans.find((plan) => plan?.policy?.version === 1
    && `destination:${plan.policy.provider}` === mode);
  if (!plan) return [];
  return [
    `${plan.policy.label}: selected tags: ${plan.tags.join(", ") || "(none)"}. Omitted tags: ${plan.omittedTags.join(", ") || "(none)"}.`,
    ...portableDiagnosticsForDisplay(plan.diagnostics),
  ];
}

export function destinationContentForDisplay(plans, mode) {
  if (!String(mode).startsWith("destination:") || !Array.isArray(plans)) return [];
  const plan = plans.find((plan) => plan?.policy?.version === 1
    && `destination:${plan.policy.provider}` === mode);
  return plan ? portableDiagnosticsForDisplay(plan.diagnostics) : [];
}

export function portabilityGroups(preview, mode) {
  const portable = preview?.portablePreview;
  const scope = portabilityAcknowledgementScope(portable?.destinations, mode)
    || (mode === "site" ? { representation: "portable-html", destination: "portable-export" } : null);
  if (!scope) return [];
  const representation = scope.representation === "manual-markdown" ? "portable-markdown" : scope.representation;
  const diagnostics = portable?.diagnosticsByRepresentation?.[representation] || portable?.diagnostics || [];
  const groups = new Map();
  for (const diagnostic of diagnostics) {
    const key = diagnostic.capabilityId || "document";
    if (!groups.has(key)) groups.set(key, {
      capabilityId: key, representation: scope.representation, destination: scope.destination,
      level: diagnostic.portabilityLevel || "unclassified", diagnostics: [],
    });
    groups.get(key).diagnostics.push(diagnostic);
  }
  return [...groups.values()];
}

export function portabilitySourceSelection(body, range) {
  if (!range) return null;
  const lines = body.split("\n");
  const offset = (line, column) => {
    if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1 || line > lines.length) return null;
    const characters = Array.from(lines[line - 1]);
    if (column > characters.length + 1) return null;
    return lines.slice(0, line - 1).reduce((length, text) => length + text.length + 1, 0)
      + characters.slice(0, column - 1).join("").length;
  };
  const start = offset(range.startLine, range.startColumn);
  const end = offset(range.endLine, range.endColumn);
  return start !== null && end !== null && end >= start ? { start, end } : null;
}

export function portabilityAcknowledgementScope(policies, mode) {
  if (mode === "portable-html" || mode === "portable-markdown" || mode === "portable-text") {
    return { destination: "portable-export", representation: mode };
  }
  if (!String(mode).startsWith("destination:")) return null;
  const provider = String(mode).slice("destination:".length);
  const policy = previewDestinationPolicy(policies, mode);
  if (!policy) return null;
  return {
    destination: provider,
    representation: policy.representation,
  };
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

export function evidenceStudioState(findings, research, citations = null, citationsOptedIn = false) {
  // A post that opts in to citations (or has any citation finding) keeps the
  // studio even when its citations could not be published, so a draft's broken
  // citation is never discarded.
  const citationFinding = Array.isArray(findings) && findings.some((finding) => String(finding?.code || "").startsWith("citation-"));
  if (!research && !citations && !citationsOptedIn && !citationFinding) {
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

/**
 * The status line after downloading a post's cited references: what was
 * exported and, per source, the details the format cannot carry. Exports hold
 * only the public description the post's notes show.
 */
export function citationExportStatus(exported) {
  if (!exported || typeof exported.content !== "string") return "Preview the post again before exporting its references.";
  const notes = sourceExportLossNotes(exported.losses);
  const count = Number(exported.count) || 0;
  return `Exported ${count} cited reference${count === 1 ? "" : "s"} as ${exported.filename}; nothing was looked up online.${notes.length ? ` This format cannot carry: ${notes.join("; ")}.` : ""}`;
}

/** The citation rows of Evidence Studio's metadata list, as [term, description] pairs. */
export function citationEvidenceRows(citations) {
  if (!citations) return [];
  const count = (value, word) => `${value} ${word}${value === 1 ? "" : "s"}`;
  return [
    ["Citations", `${count(Number(citations.citations) || 0, "citation")} of ${count(Number(citations.references) || 0, "reference")}, published as ${citations.style === "bibliography" ? "a bibliography" : "notes"}`],
    ["Citation checks", "Offline, from your source library; nothing is looked up online"],
  ];
}

export function applyPaneSelection(root, buttons, pane) {
  root.dataset.editorView = pane;
  for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.paneTarget === pane));
}

export const ASSISTANT_PROVIDERS = Object.freeze({
  anthropic: { label: "Anthropic Claude", defaultModel: "claude-sonnet-5-5" },
  "open-ai": { label: "OpenAI", defaultModel: "gpt-6-luna" },
  gemini: { label: "Google Gemini", defaultModel: "gemini-3.8-flash" },
  xai: { label: "xAI Grok", defaultModel: "grok-4.7" },
  "deep-seek": { label: "DeepSeek", defaultModel: "deepseek-flash" },
  mistral: { label: "Mistral AI", defaultModel: "mistral-small-latest" },
  "open-router": { label: "OpenRouter", defaultModel: "" },
  "custom-https": { label: "Custom HTTPS", defaultModel: "" },
});

function assistantProviderLabel(providerType) {
  if (providerType === "generic-https") return ASSISTANT_PROVIDERS["custom-https"].label;
  return ASSISTANT_PROVIDERS[providerType]?.label || providerType || "Unavailable";
}

export function assistantStatusPresentation(status = {}) {
  const labels = {
    review: "Review",
    interactions: "Interactions",
    context: "Context",
    knowledgeChecks: "Knowledge checks",
    autocomplete: "Autocomplete",
  };
  const capabilities = Object.entries(status.capabilities || {})
    .filter(([, supported]) => supported)
    .map(([name]) => labels[name] || name);
  return {
    providerType: assistantProviderLabel(status.providerType),
    model: status.model || "Provider default",
    destination: status.destination || "Not configured",
    configured: status.configured ? "Configured" : "Not configured",
    statusLabel: status.configured ? "Ready" : status.state === "invalid" ? "Check settings" : "Setup needed",
    statusTone: status.configured ? "ready" : status.state === "invalid" ? "invalid" : "missing",
    capabilities: capabilities.length ? capabilities.join(", ") : "No generation capabilities",
    message: status.message || (status.configured ? "Assistant provider is ready." : "Assistant provider is not configured. Non-AI authoring remains available."),
  };
}

export function bindAssistantAutocompleteControls(editor, ui) {
  ui.body.addEventListener("input", () => editor.scheduleAssistantAutocomplete());
  ui.assistantAutocompleteToggle.addEventListener("change", () => editor.setAssistantAutocomplete(ui.assistantAutocompleteToggle.checked));
  const shortcut = (event) => {
    if (ui.assistantCompletion.hidden) return;
    if (event.key === "Tab") {
      event.preventDefault();
      editor.acceptAssistantCompletion();
    } else if (event.key === "Escape") {
      event.preventDefault();
      editor.dismissAssistantCompletion();
    }
  };
  ui.body.addEventListener("keydown", shortcut);
  ui.richBody.addEventListener("keydown", shortcut);
}

export function bindAssistantInteractionControl(editor, button, interaction = "knowledge-check") {
  button.addEventListener("click", () => {
    if (interaction === "code") editor.openCodeInteraction();
    else editor.openKnowledgeCheck();
  });
}

export function codeInteractionMarkdown({ kind, language = "rust", title, instructions, code, expectedOutput = "", hint = "", explanation = "" }) {
  const escapeText = (value) => String(value || "").trim().replace(/([\\`*_[\]{}<>#+\-.!|])/g, "\\$1");
  const safeTitle = String(title || "").trim().replace(/["'\r\n]/g, "").slice(0, 120);
  const safeLanguage = normalizeCodeRunnerLanguage(language) || "rust";
  const label = kind === "challenge" ? "Coding challenge" : "Runnable example";
  const lines = [`**${label}: ${escapeText(title)}**`, "", escapeText(instructions)];
  if (kind === "challenge") lines.push("", `**Expected result:** ${escapeText(expectedOutput)}`);
  lines.push("", `\`\`\`${safeLanguage} runnable title="${safeTitle}"`, String(code || "").trim(), "\`\`\`");
  if (hint.trim()) lines.push("", "> [!TIP]", ...hint.trim().split(/\r?\n/).map((line) => `> ${escapeText(line)}`));
  if (explanation.trim()) lines.push("", escapeText(explanation));
  return lines.join("\n");
}

export function assistantSkillPresentation(skill = {}) {
  const scopes = Array.isArray(skill.scopes) ? skill.scopes.map((scope) => scope[0]?.toUpperCase() + scope.slice(1)) : [];
  const errors = Array.isArray(skill.errors) ? skill.errors.filter((error) => typeof error === "string") : [];
  const valid = skill.valid === true;
  const parts = valid ? [`Version ${skill.version || "unknown"}`, scopes.join(", ") || "No supported scopes"] : ["Invalid skill"];
  if (valid && skill.overrideState === "active") parts.push("Overrides built-in");
  if (valid && skill.overrideState === "overridden") parts.push("Overridden by project skill");
  return {
    title: skill.name || skill.id || "Unnamed skill",
    source: skill.source === "project" ? "Project skill" : "Built-in skill",
    details: parts.join(" · "),
    disabled: !valid || skill.selectable !== true,
    errors,
  };
}

export function selectableAssistantSkillIds(skills = [], requested = []) {
  const available = new Set(skills.filter((skill) => skill.valid === true && skill.selectable === true).map((skill) => skill.id));
  return [...new Set(requested)].filter((id) => available.has(id));
}

export function assistantReviewSummary({ title = "", markdown = "", skills = [], selectedSkillIds = new Set(), context = [], selectedContextIds = new Set(), provider = {} } = {}) {
  const chosenSkills = skills.filter((skill) => selectedSkillIds.has(skill.id));
  const chosenContext = context.filter((document) => selectedContextIds.has(document.id));
  const providerName = assistantProviderLabel(provider.providerType);
  return {
    scope: "Complete document",
    sourceCharacters: `${title}\n${markdown}`.length,
    skills: chosenSkills.map((skill) => `${skill.name || skill.id} · ${skill.version}`),
    context: chosenContext.map((document) => `${document.path || document.name} · ${document.kind === "postSnapshot" ? "Post snapshot" : document.visibility === "private" ? "Private" : "Portable"} · ${document.characters} characters`),
    provider: `${providerName} · ${provider.model || "Provider default"} · ${provider.destination || "Destination not configured"}`,
    research: "Off",
  };
}

export function assistantReviewSourceChanged(submitted = {}, current = {}) {
  return submitted.title !== current.title || submitted.markdown !== current.markdown || JSON.stringify(submitted.metadata) !== JSON.stringify(current.metadata);
}

export function applyAssistantSuggestion(markdown, finding = {}) {
  const source = Array.from(String(markdown ?? ""));
  const evidence = typeof finding.evidence === "string" ? Array.from(finding.evidence) : [];
  const suggestion = typeof finding.suggestion === "string" ? Array.from(finding.suggestion) : null;
  if (!evidence.length || suggestion === null) return { ok: false, error: "This finding does not include an applicable replacement." };
  const matchesAt = (start) => start >= 0 && start + evidence.length <= source.length && evidence.every((character, index) => source[start + index] === character);
  const requestedStart = finding.range?.start;
  const requestedEnd = finding.range?.end;
  let start = Number.isInteger(requestedStart) && Number.isInteger(requestedEnd) && requestedEnd - requestedStart === evidence.length && matchesAt(requestedStart) ? requestedStart : -1;
  if (start < 0) {
    const matches = [];
    for (let index = 0; index <= source.length - evidence.length; index += 1) if (matchesAt(index)) matches.push(index);
    if (matches.length !== 1) return { ok: false, error: matches.length ? "The reviewed text now appears more than once. Nothing was changed." : "The reviewed text has changed. Nothing was changed." };
    [start] = matches;
  }
  const updated = [...source.slice(0, start), ...suggestion, ...source.slice(start + evidence.length)].join("");
  return { ok: true, markdown: updated, start, sourceEnd: start + evidence.length, end: start + suggestion.length };
}

export function assistantReviewGroups(review = {}, skills = []) {
  const findings = Array.isArray(review.findings) ? review.findings : [];
  const order = [...new Set(findings.map((finding) => finding.skillId))];
  return order.map((id) => ({
    id,
    name: skills.find((skill) => skill.id === id)?.name || id,
    label: "AI-generated advice",
    findings: findings.filter((finding) => finding.skillId === id),
  }));
}

export function assistantContextDisclosure(documents = [], selectedIds = new Set()) {
  const selected = documents
    .filter((document) => selectedIds.has(document.id) && document.exists && document.valid)
    .map(({ name, visibility, characters, kind, path }) => ({ name, visibility, characters, ...(kind ? { kind, path } : {}) }));
  return {
    documents: selected,
    totalCharacters: selected.reduce((total, document) => total + document.characters, 0),
  };
}

export function postContextFields(source = "") {
  const headings = {
    Goal: "goal",
    Audience: "audience",
    "Learning outcomes": "learningOutcomes",
    Sources: "sources",
    Constraints: "constraints",
  };
  const fields = { goal: "", audience: "", learningOutcomes: "", sources: "", constraints: "" };
  for (const [heading, key] of Object.entries(headings)) {
    const marker = new RegExp(`<!-- openblog:${key}:start -->\\s*## ${heading}\\s*\\n([\\s\\S]*?)\\n<!-- openblog:${key}:end -->`);
    const match = String(source).match(marker);
    if (match) fields[key] = match[1].trim();
  }
  if (Object.values(fields).some(Boolean)) return fields;
  const sections = String(source).split(/^##\s+(.+)\s*$/m);
  for (let index = 1; index < sections.length; index += 2) {
    const key = headings[sections[index].trim()];
    if (key) fields[key] = (sections[index + 1] || "").trim();
  }
  return fields;
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

function chapterSeconds(timestamp) {
  const parts = timestamp.split(":").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  if (parts.length === 2 && parts[1] < 60) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function videoDurationSeconds(value) {
  const source = String(value || "").trim().toLowerCase();
  if (!source) return null;
  if (source.includes(":")) return chapterSeconds(source);
  const iso = source.match(/^pt(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/u);
  if (iso && iso.slice(1).some(Boolean)) return Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Number(iso[3] || 0);
  const token = /(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/gu;
  const matches = [...source.matchAll(token)];
  if (!matches.length || source.replace(token, "").trim()) return null;
  return matches.reduce((total, match) => {
    const unit = match[2][0];
    return total + Number(match[1]) * (unit === "h" ? 3600 : unit === "m" ? 60 : 1);
  }, 0);
}

/** Build creator-owned release copy while enforcing YouTube's authored chapter rules. */
export function buildVideoReleaseKit({ profile, description = "", body = "", duration = "", aiDisclosure = "", productionStatus = "" }) {
  if (String(profile).toLowerCase() !== "video") return { active: false, chapters: [], issues: [], description: "", workflow: [] };
  const chapters = markdownOutsideCode(String(body)).split("\n").flatMap((line) => {
    const match = line.trim().match(/^(?:[-*+]\s+)?((?:\d{1,2}:)?\d{1,3}:\d{2})\s+(.+)$/u);
    if (!match) return [];
    const seconds = chapterSeconds(match[1]);
    const label = match[2].trim();
    return seconds === null || !label ? [] : [{ timestamp: match[1], seconds, label }];
  });
  const issues = [];
  if (chapters.length && chapters[0].seconds !== 0) issues.push("The first chapter must start at 00:00.");
  if (chapters.length < 3) issues.push("Add at least three chapters.");
  const chronological = !chapters.some((chapter, index) => index > 0 && chapter.seconds <= chapters[index - 1].seconds);
  if (!chronological) {
    issues.push("List chapters in chronological order.");
  }
  const durationSeconds = videoDurationSeconds(duration);
  if (chapters.length && durationSeconds === null) issues.push("Add a valid duration to verify the final chapter.");
  const shortChapter =
    chronological &&
    (chapters.some((chapter, index) => index > 0 && chapter.seconds - chapters[index - 1].seconds < 10) ||
      (durationSeconds !== null && durationSeconds - chapters.at(-1).seconds < 10));
  if (shortChapter) {
    issues.push("Keep every chapter at least 10 seconds long.");
  }
  const sections = [];
  const summary = String(description).trim();
  if (summary) sections.push(summary);
  if (chapters.length) sections.push(`Chapters\n${chapters.map((chapter) => `${chapter.timestamp} ${chapter.label}`).join("\n")}`);
  const disclosure = String(aiDisclosure).trim();
  if (disclosure) sections.push(`AI assistance: ${disclosure}`);
  const status = String(productionStatus || "idea").trim().toLowerCase();
  const stages = ["idea", "scripting", "storyboarding", "generating", "editing", "scheduled", "released"];
  const stageIndex = stages.indexOf(status);
  const workflow = stages.map((stage, index) => ({ stage, complete: stageIndex >= 0 && index <= stageIndex, current: index === stageIndex }));
  return { active: true, chapters, issues, description: sections.join("\n\n"), productionStatus: status, workflow };
}

function trackDistanceMeters(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitude = radians(b.lat - a.lat);
  const longitude = radians(b.lon - a.lon);
  const sinLat = Math.sin(latitude / 2);
  const sinLon = Math.sin(longitude / 2);
  const value = sinLat * sinLat + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * sinLon * sinLon;
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(value)));
}

function normalizedSegments(segments, latitudeKey = "lat", longitudeKey = "lon") {
  const points = segments.flat();
  if (points.length < 2) return "";
  const xs = points.map((point) => point[longitudeKey]);
  const ys = points.map((point) => point[latitudeKey]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  return segments
    .filter((segment) => segment.length >= 2)
    .map((segment) => {
      const sampled = segment.length <= 100 ? segment : segment.filter((_, index) => index % Math.ceil(segment.length / 100) === 0 || index === segment.length - 1);
      return sampled.map((point) => `${Math.round(((point[longitudeKey] - minX) / width) * 1000)},${Math.round(100 - ((point[latitudeKey] - minY) / height) * 100)}`).join(" ");
    })
    .join("|");
}

function fieldChart(points, label) {
  if (!points) return null;
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 1000 100");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  for (const segment of points.split("|")) {
    const line = document.createElementNS(namespace, "polyline");
    line.setAttribute("points", segment.trim());
    svg.append(line);
  }
  return h("figure", { class: "oba-field-chart" }, svg, h("figcaption", {}, label));
}

/** Parse a GPX track locally and return only publish-safe derived values. */
export function analyzeGpx(source, { privacy = "hidden", trimMeters = 200 } = {}) {
  const xml = String(source);
  if (xml.length > 10 * 1024 * 1024) throw new Error("GPX tracks can be at most 10 MB.");
  if (!/<(?:[\w-]+:)?gpx\b/i.test(xml) || /<!DOCTYPE|<!ENTITY|<script\b/i.test(xml)) throw new Error("Choose a valid GPX track without scripts or document entities.");
  const parsePoints = (segment) => [...segment.matchAll(/<(?:[\w-]+:)?trkpt\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?trkpt>/gi)].flatMap((match) => {
    const lat = /\blat\s*=\s*["']([^"']+)["']/i.exec(match[1]);
    const lon = /\blon\s*=\s*["']([^"']+)["']/i.exec(match[1]);
    const ele = /<(?:[\w-]+:)?ele\b[^>]*>\s*([^<]+)</i.exec(match[2]);
    const time = /<(?:[\w-]+:)?time\b[^>]*>\s*([^<]+)</i.exec(match[2]);
    const point = { lat: Number(lat?.[1]), lon: Number(lon?.[1]), ele: ele ? Number(ele[1]) : null, time: time ? Date.parse(time[1]) : null };
    return Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180 ? [point] : [];
  });
  const authoredSegments = [...xml.matchAll(/<(?:[\w-]+:)?trkseg\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?trkseg>/gi)].map((match) => parsePoints(match[1])).filter((segment) => segment.length);
  const segments = authoredSegments.length ? authoredSegments : [parsePoints(xml)];
  const points = segments.flat();
  if (points.length > 100_000) throw new Error("GPX tracks can contain at most 100,000 track points.");
  if (points.length < 2) throw new Error("Choose a valid GPX track with at least two track points.");
  const segmentDistances = segments.map((segment) => segment.slice(1).map((point, index) => trackDistanceMeters(segment[index], point)));
  const distanceMeters = segmentDistances.flat().reduce((sum, value) => sum + value, 0);
  const elevationGainM = Math.round(segments.reduce((total, segment) => total + segment.slice(1).reduce((sum, point, index) => sum + (Number.isFinite(point.ele) && Number.isFinite(segment[index].ele) ? Math.max(0, point.ele - segment[index].ele) : 0), 0), 0));
  const times = points.map((point) => point.time).filter(Number.isFinite);
  const durationSeconds = times.length > 1 ? Math.max(0, Math.round((times.at(-1) - times[0]) / 1000)) : null;
  let keptSegments = segments.map((segment) => [...segment]);
  if (privacy === "trimmed") {
    const trim = Math.max(0, Number(trimMeters) || 0);
    keptSegments = keptSegments.map((segment, segmentIndex) => {
      const distances = segmentDistances[segmentIndex];
      let start = 0;
      if (segmentIndex === 0) {
        let walked = 0;
        while (start < distances.length && walked < trim) walked += distances[start++];
      }
      let end = segment.length - 1;
      if (segmentIndex === segments.length - 1) {
        let walked = 0;
        while (end > start && walked < trim) walked += distances[--end];
      }
      return segment.slice(start, end + 1);
    });
  }
  const routeShape = privacy === "hidden" ? "" : normalizedSegments(keptSegments);
  let distanceOffset = 0;
  const elevationSegments = segments.map((segment, segmentIndex) => {
    let localDistance = 0;
    const elevations = segment.flatMap((point, index) => {
      if (index > 0) localDistance += segmentDistances[segmentIndex][index - 1];
      return Number.isFinite(point.ele) ? [{ distance: distanceOffset + localDistance, ele: point.ele }] : [];
    });
    distanceOffset += segmentDistances[segmentIndex].reduce((sum, value) => sum + value, 0);
    return elevations;
  });
  return {
    pointCount: points.length,
    keptPointCount: keptSegments.flat().length,
    distanceKm: Math.round((distanceMeters / 1000) * 100) / 100,
    elevationGainM,
    durationSeconds,
    routeShape,
    elevationProfile: normalizedSegments(elevationSegments, "ele", "distance"),
  };
}

export function fieldJournalReview(fields = {}) {
  const active = String(fields.profile || "").toLowerCase() === "field-journal";
  if (!active) return { active, issues: [], status: "Choose the Field journal content profile to review a track." };
  const privacy = ["exact", "trimmed", "approximate", "hidden"].includes(String(fields.locationPrivacy).toLowerCase()) ? String(fields.locationPrivacy).toLowerCase() : "hidden";
  const issues = [];
  if (!fields.location) issues.push("Add a publishable area name without revealing a sensitive location.");
  if (!fields.conditions) issues.push("Record creator-observed conditions.");
  if (privacy === "exact") issues.push("Confirm the exact track does not expose a home, campsite, sensitive species, or fragile habitat.");
  if (!fields.distanceKm && !fields.routeShape) issues.push("Import a GPX track or add route measurements manually.");
  return { active, privacy, issues, status: issues.length ? `${issues.length} field review item${issues.length === 1 ? "" : "s"}.` : "Field journal is ready for a final human privacy review." };
}

export function analyzeReadiness({ kind, title, subtitle = "", description, slug, canonical, tags = [], cover, coverAlt, body, authorReady }) {
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
    if (subtitle) search.push({ ready: subtitle.length <= 160, label: "Subtitle", detail: `${subtitle.length} characters; keep it to one short line (160 or fewer)` });
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
  const prefix = command === "quote" ? "> " : command === "list" ? "- " : command === "ordered-list" ? "1. " : null;
  let replacement;
  const headingLevel = command === "heading" ? 2 : /^heading-([2-6])$/.exec(command)?.[1];
  if (headingLevel) replacement = block.replace(/^(?:#{1,6}\s+)?/, `${"#".repeat(Number(headingLevel))} `);
  else if (command === "paragraph") replacement = block.replace(/^(?:#{1,6}\s+)?/, "");
  else if (prefix) replacement = block.split("\n").map((line) => (line ? prefix + line : line)).join("\n");
  else return { value, start, end };
  return {
    value: value.slice(0, lineStart) + replacement + value.slice(lineEnd),
    start: lineStart,
    end: lineStart + replacement.length,
  };
}

const visualLineText = (line) => line.endsWith("\n") ? line.slice(0, -1) : line;
const visualFence = (line) => /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(visualLineText(line));
const visualHeading = (line) => /^(#{1,6})\s+(.+)$/.exec(visualLineText(line));
const visualList = (line) => /^\s*(?:(- |\* |\+ )|(\d+)[.)]\s+)/.exec(visualLineText(line));
const visualQuote = (line) => /^ {0,3}>/.test(visualLineText(line));
const visualRawHtml = (line) => /^\s*<(?:!|\/?[a-z][\w:-]*(?:\s|>|\/))/i.test(visualLineText(line));
const visualEmbed = (line) => /^\s*https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?|youtu\.be\/|codepen\.io\/[^/]+\/(?:pen|embed)\/)/i.test(visualLineText(line));
const visualTableDivider = (line) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(visualLineText(line));
const visualSetextDivider = (line) => /^ {0,3}(?:=+|-+)\s*$/.test(visualLineText(line));
const visualThematicBreak = (line) => /^ {0,3}(?:(?:\*\s*){3,}|(?:_\s*){3,}|(?:-\s*){3,})$/.test(visualLineText(line));
const visualIndentedCode = (line) => /^(?: {4}|\t)/.test(visualLineText(line));

function visualProtectedLabel(lines, index) {
  const text = visualLineText(lines[index]);
  const fence = visualFence(lines[index]);
  if (fence && fence[2].trim().toLowerCase() === "quiz") return "Knowledge check";
  if (visualQuote(lines[index]) && /^ {0,3}>\s*\[![A-Z]+\]/.test(text)) return "Callout";
  if (visualRawHtml(lines[index]) || /<\/?[a-z][^>]*>/i.test(text)) return "Raw HTML";
  if (/~~|<(?:https?:|mailto:)[^>]+>|\[[^\]]+\]\[[^\]]*\]|^\s*\[[^\]]+\]:| {2,}$/.test(text)) return "Advanced formatting";
  // The lightweight inline renderer does not implement balanced link destinations.
  // Protect any destination containing an inner opening parenthesis instead of
  // risking a partial parse and source rewrite.
  if (/!?\[[^\]\n]*\]\([^\s)\n]*\(/.test(text)) return "Advanced link";
  if (visualCitationProblem(text)) return CITATION_TEXT_LABEL;
  if (visualEmbed(lines[index])) return "Embedded media";
  if (/^\s*\[\^[^\]]+\]:/.test(text) || /\[\^[^\]]+\]/.test(text)) return "Footnote";
  if (index + 1 < lines.length && text.includes("|") && visualTableDivider(lines[index + 1])) return "Table";
  if (index + 1 < lines.length && text.trim() && visualSetextDivider(lines[index + 1])) return "Setext heading";
  if (visualThematicBreak(lines[index])) return "Thematic break";
  if (visualIndentedCode(lines[index])) return "Indented code block";
  if (visualList(lines[index])) {
    let end = index;
    while (end < lines.length && visualLineText(lines[end]).trim()) {
      const line = visualLineText(lines[end]);
      if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)\[[ xX]\]\s+/.test(line)) return "Task list";
      if (!visualList(lines[end]) || /^\s+/.test(line)) return "Complex list";
      end += 1;
    }
  }
  return "";
}

/** Split Markdown into visual-editor blocks while retaining every authored byte. */
export function parseVisualMarkdown(markdown) {
  const normalized = String(markdown).replace(/\r\n?/g, "\n");
  const lines = (normalized.match(/[^\n]*(?:\n|$)/g) || []).filter(Boolean);
  const blocks = [];
  let index = 0;
  const citationProblemIn = (from, to) => lines.slice(from, to).some((line) => visualCitationProblem(visualLineText(line)));
  const take = (end, type, extra = {}) => {
    blocks.push({ type, source: lines.slice(index, end).join(""), ...extra });
    index = end;
  };
  while (index < lines.length) {
    if (!visualLineText(lines[index]).trim()) {
      let end = index + 1;
      while (end < lines.length && !visualLineText(lines[end]).trim()) end += 1;
      take(end, "space");
      continue;
    }
    const fence = visualFence(lines[index]);
    if (fence) {
      let end = index + 1;
      let closed = false;
      while (end < lines.length) {
        const closing = visualLineText(lines[end]);
        end += 1;
        const closePattern = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*$`);
        if (closePattern.test(closing)) {
          closed = true;
          break;
        }
      }
      const label = visualProtectedLabel(lines, index);
      const protectedLabel = label || (!closed ? "Unclosed code block" : "");
      take(end, protectedLabel ? "protected" : "code", protectedLabel ? { label: protectedLabel } : { language: fence[2].trim() });
      continue;
    }
    const label = visualProtectedLabel(lines, index);
    if (label) {
      let end = index + 1;
      if (label === "Table") {
        end = index + 2;
        while (end < lines.length && visualLineText(lines[end]).trim() && visualLineText(lines[end]).includes("|")) end += 1;
      } else if (label === "Callout") {
        while (end < lines.length && visualQuote(lines[end])) end += 1;
      } else if (label === "Raw HTML") {
        while (end < lines.length && visualLineText(lines[end]).trim()) end += 1;
      } else if (label === "Task list" || label === "Complex list") {
        while (end < lines.length && visualLineText(lines[end]).trim()) end += 1;
      } else if (label === "Advanced formatting" || label === "Footnote" || label === CITATION_TEXT_LABEL) {
        while (end < lines.length && visualLineText(lines[end]).trim()) end += 1;
      } else if (label === "Setext heading") {
        end = Math.min(index + 2, lines.length);
      } else if (label === "Indented code block") {
        while (end < lines.length && (visualIndentedCode(lines[end]) || !visualLineText(lines[end]).trim())) end += 1;
      }
      take(end, "protected", { label });
      continue;
    }
    const heading = visualHeading(lines[index]);
    if (heading) {
      take(index + 1, "heading", { level: heading[1].length, text: heading[2] });
      continue;
    }
    const list = visualList(lines[index]);
    if (list) {
      let end = index + 1;
      while (end < lines.length && visualLineText(lines[end]).trim() && (visualList(lines[end]) || /^\s{2,}\S/.test(visualLineText(lines[end])))) end += 1;
      if (citationProblemIn(index, end)) take(end, "protected", { label: CITATION_TEXT_LABEL });
      else take(end, list[2] ? "ordered-list" : "unordered-list");
      continue;
    }
    if (visualQuote(lines[index])) {
      let end = index + 1;
      while (end < lines.length && visualQuote(lines[end])) end += 1;
      if (citationProblemIn(index, end)) take(end, "protected", { label: CITATION_TEXT_LABEL });
      else take(end, "quote");
      continue;
    }
    let end = index + 1;
    while (end < lines.length && visualLineText(lines[end]).trim()) {
      // Citation text the editor cannot show as chips protects its whole paragraph, so it does not end it.
      const label = visualProtectedLabel(lines, end);
      if (visualFence(lines[end]) || visualHeading(lines[end]) || visualList(lines[end]) || visualQuote(lines[end]) || (label && label !== CITATION_TEXT_LABEL)) break;
      end += 1;
    }
    const paragraphLabel = lines.slice(index, end).map((_, offset) => visualProtectedLabel(lines, index + offset)).find(Boolean);
    take(end, paragraphLabel ? "protected" : "paragraph", paragraphLabel ? { label: paragraphLabel } : {});
  }
  return blocks;
}

export function visualBlocksToMarkdown(blocks) {
  return blocks.map((block) => block.source || "").join("");
}

function safeVisualUrl(value) {
  const url = String(value || "").trim();
  if (/^(?:https?:|mailto:)/i.test(url) || /^(?:\/|#|\.\.?\/)/.test(url)) return url;
  return "";
}

// Inline formatting the visual editor renders, apart from citations.
const VISUAL_FORMATTING = /!?\[[^\]\n]*\]\([^\s)]+(?:\s+"[^"]*")?\)|\*\*[^*\n]+\*\*|__[^_\n]+__|`+[^`\n]+`+|\*[^*\n]+\*|_[^_\n]+_/g;
const CITATION_TEXT_LABEL = "Citation text";
const VISUAL_WORD = /[\p{L}\p{N}]/u;

/** Citations on one line that the visual editor shows as chips (outside code spans), as [start, end] pairs. */
function visualCitationRanges(line) {
  const code = codeSpanRanges(line);
  return [...line.matchAll(CITATION_TEXT)]
    .map((match) => [match.index, match.index + match[0].length])
    .filter(([start, end]) => !code.some(([from, to]) => start < to && end > from));
}

/**
 * Formatting on a line, read with its chips masked out, so a `_` or `*`
 * inside a citation is never taken for emphasis and a chip is never split.
 */
function visualFormattingTokens(line, chips) {
  let masked = line;
  for (const [start, end] of chips) masked = masked.slice(0, start) + "\u0001".repeat(end - start) + masked.slice(end);
  return [...masked.matchAll(VISUAL_FORMATTING)].map((match) => [match.index, match.index + match[0].length]);
}

/** The marker width of an emphasis token that may hold a chip, or 0 when the renderer might not read it as emphasis. */
function emphasisAroundCitation(line, start, end) {
  const token = line.slice(start, end);
  const marker = token[0];
  if (marker !== "*" && marker !== "_") return 0;
  const width = token.length > 4 && token.startsWith(marker + marker) && token.endsWith(marker + marker) ? 2 : 1;
  const inner = token.slice(width, -width);
  if (!inner || /^\s|\s$/.test(inner)) return 0;
  // CommonMark never opens or closes `_` emphasis inside a word.
  if (marker === "_" && (VISUAL_WORD.test(line[start - 1] || "") || VISUAL_WORD.test(line[end] || ""))) return 0;
  return width;
}

/**
 * Whether a line holds `[@` text the visual editor cannot show as chips the
 * way the core scanner reads it: an escaped backslash before it, a link or
 * `(...)` straight after it, a malformed bracket, a citation in link text, or
 * formatting the editor might split differently. Such a block is preserved
 * verbatim, so no visual edit can turn a citation into text or back.
 */
export function visualCitationProblem(line) {
  const text = String(line ?? "");
  if (!text.includes("[@")) return false;
  const code = codeSpanRanges(text);
  const chips = visualCitationRanges(text);
  for (let at = text.indexOf("[@"); at >= 0; at = text.indexOf("[@", at + 1)) {
    if (code.some(([from, to]) => at >= from && at < to)) continue;
    const slashes = backslashesBefore(text, at);
    if (slashes % 2 === 1) continue; // `\[@` is text in both editors
    if (slashes || !chips.some(([start]) => start === at)) return true;
  }
  for (const [start, end] of visualFormattingTokens(text, chips)) {
    const inside = chips.filter(([from, to]) => from < end && to > start);
    if (!inside.length) continue;
    if (!inside.every(([from, to]) => from >= start && to <= end)) return true;
    const width = emphasisAroundCitation(text, start, end);
    if (!width || visualCitationProblem(text.slice(start + width, end - width))) return true;
  }
  return false;
}

function appendVisualInline(parent, markdown) {
  const chips = visualCitationRanges(markdown);
  const formatting = visualFormattingTokens(markdown, chips);
  const tokens = [
    ...formatting.map(([start, end]) => ({ start, end, chip: false })),
    ...chips.filter(([start, end]) => !formatting.some(([from, to]) => start >= from && end <= to)).map(([start, end]) => ({ start, end, chip: true })),
  ].sort((a, b) => a.start - b.start);
  const plain = (text) => document.createTextNode(text.replace(/\\([\\*_`\[\]])/g, "$1"));
  let offset = 0;
  let afterChip = false;
  for (const { start, end, chip } of tokens) {
    if (start < offset) continue;
    if (start > offset) {
      // A `(` escaped after a chip only keeps the citation from reading as a link.
      const between = markdown.slice(offset, start);
      parent.append(plain(afterChip && between.startsWith("\\(") ? between.slice(1) : between));
    }
    const token = markdown.slice(start, end);
    offset = end;
    afterChip = chip;
    if (chip) {
      // A citation, generated or hand-written, is one atomic chip that keeps its exact Markdown.
      parent.append(citationChip(token));
      continue;
    }
    const linked = /^(!?)\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/.exec(token);
    if (linked) {
      const url = safeVisualUrl(linked[3]);
      if (!url) parent.append(document.createTextNode(token));
      else if (linked[1]) parent.append(h("img", { src: url, alt: linked[2], title: linked[4] || null, class: "oba-rich-image" }));
      else {
        const anchor = h("a", { href: url, title: linked[4] || null });
        appendVisualInline(anchor, linked[2]);
        parent.append(anchor);
      }
    } else if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      const strong = h("strong");
      appendVisualInline(strong, token.slice(2, -2));
      parent.append(strong);
    } else if ((token.startsWith("*") && token.endsWith("*")) || (token.startsWith("_") && token.endsWith("_"))) {
      const emphasis = h("em");
      appendVisualInline(emphasis, token.slice(1, -1));
      parent.append(emphasis);
    } else if (token.startsWith("`")) {
      const ticks = /^`+/.exec(token)?.[0].length || 1;
      parent.append(h("code", {}, token.slice(ticks, -ticks)));
    } else parent.append(plain(token));
  }
  if (offset < markdown.length) {
    const rest = markdown.slice(offset);
    parent.append(plain(afterChip && rest.startsWith("\\(") ? rest.slice(1) : rest));
  }
}

function appendVisualLines(parent, markdown) {
  const lines = markdown.split("\n");
  lines.forEach((line, index) => {
    if (index) parent.append(h("br"));
    appendVisualInline(parent, line);
  });
}

function markdownText(value) {
  return String(value || "").replace(/([\\*_`\[\]])/g, "\\$1");
}

/**
 * The Markdown for an element's children. A `(` straight after a citation
 * chip is escaped, so typing `(see ...)` after a citation never turns it
 * into a link.
 */
function visualChildrenMarkdown(node) {
  let out = "";
  let afterChip = false;
  for (const child of node.childNodes) {
    const text = visualInlineMarkdown(child);
    out += afterChip && text.startsWith("(") ? `\\${text}` : text;
    afterChip = Boolean(child.classList?.contains("oba-citation")) && CITATION_WHOLE.test(text);
  }
  return out;
}

/**
 * The Markdown one visual-editor block (a direct child of the rich editor) writes into the draft.
 * An empty string means the block writes nothing, so the draft has no block for it.
 */
function visualBlockMarkdown(element) {
  if (element.classList.contains("oba-protected-block")) return (element.dataset.markdown || "").replace(/\n+$/, "");
  const tag = element.tagName.toLowerCase();
  const inline = () => visualChildrenMarkdown(element).trim();
  if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${inline()}`;
  if (tag === "ul" || tag === "ol") {
    const listStart = tag === "ol" ? Number(element.getAttribute("start") || 1) : 1;
    return [...element.children]
      .filter((item) => item.tagName.toLowerCase() === "li")
      .map((item, index) => `${tag === "ol" ? `${listStart + index}.` : "-"} ${visualChildrenMarkdown(item).trim()}`)
      .join("\n");
  }
  if (tag === "blockquote") return inline().split("\n").map((line) => `> ${line}`).join("\n");
  if (tag === "pre") {
    const text = element.textContent || "";
    const longest = Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
    const fence = "`".repeat(Math.max(3, longest + 1));
    return `${fence}${element.dataset.language || ""}\n${text}\n${fence}`;
  }
  if (tag === "img") return visualInlineMarkdown(element);
  return inline().replace(/^(#{1,6}|>|[-+*]|\d+[.)])\s/, "\\$&");
}

function visualInlineMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return markdownText(node.nodeValue);
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  if (node.classList?.contains("oba-citation")) {
    // Only well-formed citation text is written back verbatim; anything else
    // (a pasted look-alike, say) is ordinary escaped text.
    const citation = node.dataset?.citation;
    return typeof citation === "string" && CITATION_WHOLE.test(citation) ? citation : markdownText(node.textContent);
  }
  const tag = node.tagName.toLowerCase();
  const content = visualChildrenMarkdown(node);
  if (tag === "strong" || tag === "b") return `**${content}**`;
  if (tag === "em" || tag === "i") return `_${content}_`;
  if (tag === "code") {
    const text = node.textContent || "";
    const longest = Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
    const ticks = "`".repeat(longest + 1);
    const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
    return `${ticks}${pad}${text}${pad}${ticks}`;
  }
  if (tag === "a") {
    const url = safeVisualUrl(node.getAttribute("href"));
    const title = node.getAttribute("title");
    return url ? `[${content}](${url}${title ? ` "${title.replace(/"/g, "&quot;")}"` : ""})` : content;
  }
  if (tag === "img") {
    const url = safeVisualUrl(node.getAttribute("src"));
    const title = node.getAttribute("title");
    return url ? `![${markdownText(node.getAttribute("alt") || "")}](${url}${title ? ` "${title.replace(/"/g, "&quot;")}"` : ""})` : "";
  }
  if (tag === "br") return "\n";
  return content;
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

  async call(method, path, { json, body, headers, signal } = {}) {
    const init = {
      method,
      credentials: "same-origin",
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.csrf ? { "X-CSRF-Token": this.csrf } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : body,
      signal,
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
  preferences = normalizeAdminPreferences();
  preferencesSaved = normalizeAdminPreferences();
  preferencesEtag = "";
  preferencesError = "";
  preferencesUnreadable = false;
  preferencesWarning = null;
  activeRoute = "";
  preferencesSaving = Promise.resolve();
  preferencesTicket = 0;

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
      if (this.editor && e.altKey && ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].includes(e.key)) {
        const pane = e.key === "0" ? "assistant" : ["write", "preview", "social", "release", "field", "optimize", "settings", "accessibility", "evidence"][Number(e.key) - 1];
        if (pane === "assistant" && this.editor.kind !== "posts") return;
        e.preventDefault();
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
    try {
      const snapshot = await this.loadWorkspacePreferences();
      const storage = browserStorage();
      const legacy = legacyAdminPreferences(snapshot, storage);
      if (legacy) {
        try {
          await this.saveWorkspacePreferences(legacy);
          forgetLegacyAdminPreferences(storage);
        } catch {
          // Keep the migrated layout for this session; the next sign-in retries.
          this.preferences = legacy;
        }
      }
    } catch (error) {
      this.preferences = normalizeAdminPreferences();
      this.preferencesEtag = "";
      this.preferencesUnreadable = true;
      this.preferencesError = `Workspace personalization is unavailable: ${error.message}`;
    }
    this.applyWorkspacePreferences();
    document.title = `Admin · ${this.meta.siteTitle}`;
    this.onHash();
  }

  /** Read the stored revision; `apply: false` refreshes the revision without changing the visible layout. */
  async loadWorkspacePreferences({ apply = true } = {}) {
    const snapshot = await this.api.call("GET", "preferences");
    this.preferencesSaved = normalizeAdminPreferences(snapshot.preferences);
    this.preferencesEtag = snapshot.etag;
    this.preferencesUnreadable = false;
    if (apply) {
      this.preferences = this.preferencesSaved;
      this.preferencesError = "";
    }
    return snapshot;
  }

  /**
   * Save a preference set, or an update function applied to the latest saved
   * set when the save runs. Saves run one at a time so each sends the revision
   * the previous one produced, and an update queued behind another save builds
   * on that save's result instead of a stale copy. Only the newest response is
   * applied. A stale complete set reloads the latest revision before
   * rejecting; a stale update reloads quietly and retries once on top of it.
   */
  saveWorkspacePreferences(next) {
    const update = typeof next === "function" ? next : null;
    const ticket = ++this.preferencesTicket;
    const put = () => {
      const preferences = normalizeAdminPreferences(update ? update(this.preferencesSaved) : next);
      return this.api.call("PUT", "preferences", { json: { etag: this.preferencesEtag, preferences } });
    };
    const run = async () => {
      let snapshot;
      try {
        snapshot = await put();
      } catch (error) {
        if (error.status !== 409) throw error;
        try {
          await this.loadWorkspacePreferences({ apply: !update });
        } catch {
          // The conflict is still reported; the next save retries the reload.
          throw error;
        }
        if (!update) {
          this.applyWorkspacePreferences();
          throw error;
        }
        snapshot = await put();
      }
      this.preferencesEtag = snapshot.etag;
      this.preferencesSaved = normalizeAdminPreferences(snapshot.preferences);
      this.preferencesError = "";
      this.preferencesUnreadable = false;
      if (ticket === this.preferencesTicket) {
        this.preferences = this.preferencesSaved;
        this.applyWorkspacePreferences();
      } else this.syncPreferencesWarning();
      return snapshot;
    };
    const pending = this.preferencesSaving.then(run, run);
    this.preferencesSaving = pending.catch(() => {});
    return pending;
  }

  /**
   * Shell modules to show: the preset's visible modules plus the module whose
   * route is open, so the navigation always marks where the admin is.
   */
  shownShellModules() {
    const visible = new Set(visibleAdminModules(this.preferences));
    if (["analytics", "contributors"].includes(this.activeRoute)) visible.add(this.activeRoute);
    if (["sources", "research", "atlas", "compare"].includes(this.activeRoute)) visible.add("evidence");
    if (this.activeRoute === "moderation") visible.add("analytics");
    return visible;
  }

  syncPreferencesWarning() {
    if (!this.preferencesWarning) return;
    this.preferencesWarning.textContent = this.preferencesError;
    this.preferencesWarning.hidden = !this.preferencesError;
  }

  applyWorkspacePreferences() {
    document.documentElement.dataset.adminPreset = this.preferences.preset;
    document.documentElement.dataset.adminDensity = this.preferences.density;
    const visible = this.shownShellModules();
    this.querySelectorAll?.("[data-admin-module]").forEach((element) => {
      element.hidden = !visible.has(element.dataset.adminModule);
    });
    this.querySelectorAll?.("[data-admin-module-group]").forEach((element) => {
      const modules = element.dataset.adminModuleGroup.split(" ");
      element.hidden = !modules.some((module) => visible.has(module));
    });
    this.editor?.applyWorkspacePreferences(this.preferences);
    this.syncPreferencesWarning();
  }

  async persistEditorMode(mode) {
    this.preferences = normalizeAdminPreferences({ ...this.preferences, editorMode: mode });
    this.applyWorkspacePreferences();
    const notSaved = () => {
      if (this.editor?.ui?.editorModeStatus) this.editor.ui.editorModeStatus.textContent += " · preference not saved";
    };
    // Stored settings that could not be read are replaced only from Personalize, never by a routine toggle.
    if (this.preferencesUnreadable) return notSaved();
    try {
      // Change only the writing mode, on top of the latest saved choices (from this or another session).
      await this.saveWorkspacePreferences((saved) => ({ ...saved, editorMode: mode }));
    } catch (error) {
      this.preferences = normalizeAdminPreferences({ ...this.preferences, editorMode: mode });
      this.preferencesError = `Writing mode changed for this session but could not be saved: ${error.message}`;
      this.syncPreferencesWarning();
      notSaved();
    }
  }

  // ---- views

  mount(...nodes) {
    this.editor?.dispose();
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
    this.activeRoute = active;
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
    const advancedTrigger = h("button", { class: "oba-btn oba-advanced-trigger", type: "button", onClick: () => this.openAdvancedTools() }, "Advanced tools");
    const personalizeTrigger = h("button", { class: "oba-btn oba-personalize-trigger", type: "button", onClick: () => this.openWorkspacePreferences() }, "Personalize");
    const toolGroup = (label, ...tools) =>
      h("div", { class: "oba-tool-group" }, h("span", { class: "oba-tool-label" }, label), h("div", { class: "oba-tool-actions" }, tools));
    const visibleModules = this.shownShellModules();
    const contentTabs = [
      h("a", { class: "oba-tab", "aria-current": active === "overview" ? "page" : null, href: "#/overview" }, "Overview"),
      ...Object.entries(KINDS).map(([kind, info]) =>
        h("a", { class: "oba-tab", "aria-current": kind === active ? "page" : null, href: `#/${kind}` }, info.label),
      ),
      h("a", { class: "oba-tab", "aria-current": active === "shared" ? "page" : null, href: "#/shared" }, "Shared reflections"),
    ];
    const activeInfo = active === "analytics"
      ? { title: "Analytics", detail: "Understand readership without tracking individual readers." }
      : active === "moderation"
        ? { title: "Moderation inbox", detail: "Decide on comments and reader feedback in one list, respond, and record what changed." }
      : active === "sources"
        ? { title: "Sources", detail: "Keep private research sources, editions, translations, and references in one library." }
      : active === "research"
        ? { title: "Research notebook", detail: "Capture quoted passages and your own notes about them, privately, tied to your sources." }
      : active === "atlas"
        ? { title: "Knowledge Atlas", detail: "Relate people, works, concepts, movements and events privately, with who asserts each link and on what evidence." }
      : active === "compare"
        ? { title: "Compare versions", detail: "Read aligned passages across editions, translations, witnesses and interpretations, side by side or in one column." }
      : active === "contributors"
        ? { title: "Contributors", detail: "Manage reusable public identities for bylines and contribution credits." }
      : active === "shared"
        ? { title: "Shared reflections", detail: "Start a private draft with other writers from a video, article, podcast, book, or other source." }
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
        advancedTrigger,
        personalizeTrigger,
        h("span", { class: "oba-small oba-account-label" }, `Signed in as ${this.user}`),
        themeButton(),
        logout,
      ),
      h(
        "nav",
        { class: "oba-toolbelt", "aria-label": "Admin tools" },
        toolGroup("Content", ...contentTabs),
        h("div", { class: "oba-progressive-tools", "data-admin-module": "analytics", hidden: !visibleModules.has("analytics") }, toolGroup("Observe", h("a", { class: "oba-tab", "aria-current": active === "analytics" ? "page" : null, href: "#/analytics" }, "Analytics"), h("a", { class: "oba-tab", "aria-current": active === "moderation" ? "page" : null, href: "#/moderation" }, "Moderation inbox"))),
        h("div", { class: "oba-progressive-tools", "data-admin-module": "evidence", hidden: !visibleModules.has("evidence") }, toolGroup("Research", h("a", { class: "oba-tab", "aria-current": active === "sources" ? "page" : null, href: "#/sources" }, "Sources"), h("a", { class: "oba-tab", "aria-current": active === "research" ? "page" : null, href: "#/research" }, "Notebook"), h("a", { class: "oba-tab", "aria-current": active === "atlas" ? "page" : null, href: "#/atlas" }, "Atlas"), h("a", { class: "oba-tab", "aria-current": active === "compare" ? "page" : null, href: "#/compare" }, "Compare"))),
        h("div", { class: "oba-progressive-tools", "data-admin-module-group": "contributors public-site", hidden: !visibleModules.has("contributors") && !visibleModules.has("public-site") }, toolGroup(
          "Site",
          h("a", { class: "oba-tab", "data-admin-module": "contributors", hidden: !visibleModules.has("contributors"), "aria-current": active === "contributors" ? "page" : null, href: "#/contributors" }, "Contributors"),
          h("a", { class: "oba-tab", "data-admin-module": "public-site", hidden: !visibleModules.has("public-site"), href: "/", target: "_blank", rel: "noopener" }, "View site ↗"),
        )),
      ),
      h(
        "section",
        { class: "oba-context-bar", "aria-label": "Workspace status" },
        h("div", { class: "oba-context-copy" }, h("span", { class: "oba-eyebrow" }, "Workspace"), h("h1", {}, activeInfo.title), h("p", {}, activeInfo.detail)),
        h("span", { class: "oba-spacer" }),
        publishBox,
      ),
      (this.preferencesWarning = h("p", { class: "oba-preferences-warning", role: "status", hidden: !this.preferencesError }, this.preferencesError)),
      h("main", { class: "oba-workspace-content" }, ...content),
    );
  }

  /** Show a modal workspace dialog that returns focus to its opener unless a chosen action moves it. */
  openWorkspaceDialog(dialog, initialFocus) {
    const trigger = document.activeElement;
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        if (dialog.nextAction) dialog.nextAction();
        else trigger?.focus?.();
      },
      { once: true },
    );
    document.body.append(dialog);
    dialog.showModal();
    initialFocus.focus();
  }

  openAdvancedTools() {
    if (document.querySelector("dialog[open]")) return;
    const panes = this.editor?.optionalPanes || [];
    const choose = (action) => {
      dialog.nextAction = action;
      dialog.close();
    };
    const tools = {
      analytics: ["Analytics", () => (location.hash = "#/analytics")],
      contributors: ["Contributors", () => (location.hash = "#/contributors")],
      "public-site": ["View site", () => open("/", "_blank", "noopener")],
    };
    for (const pane of panes) tools[pane] = [this.editor.paneLabels[pane], () => this.editor.activatePane(pane, true)];
    const tool = (module) => {
      const [label, action] = tools[module];
      return h("li", {}, h("button", { class: "oba-advanced-tool", type: "button", onClick: () => choose(action) }, h("strong", {}, label), h("span", {}, ADMIN_MODULE_DETAILS[module])));
    };
    const groups = adminToolGroups(this.preferences, Object.keys(tools)).map((group) =>
      h(
        "section",
        { class: "oba-advanced-group", "aria-labelledby": `oba-advanced-${group.goal}` },
        h("h3", { id: `oba-advanced-${group.goal}` }, group.label),
        h("ul", { class: "oba-advanced-grid" }, group.modules.map(tool)),
      ),
    );
    const close = h("button", { class: "oba-btn", type: "button", onClick: () => dialog.close() }, "Close");
    const personalize = h("button", { class: "oba-btn", type: "button", onClick: () => choose(() => this.openWorkspacePreferences()) }, "Personalize workspace");
    const dialog = h(
      "dialog",
      { class: "oba-dialog oba-advanced-dialog", "aria-labelledby": "oba-advanced-title" },
      h("p", { class: "oba-eyebrow" }, "On demand"),
      h("h2", { id: "oba-advanced-title" }, "Advanced tools"),
      h("p", {}, "Everything remains reachable even when your everyday workspace is simple. Choose what you want to do next."),
      groups,
      h("div", { class: "oba-dialog-actions" }, personalize, h("span", { class: "oba-spacer" }), close),
    );
    this.openWorkspaceDialog(dialog, close);
  }

  openWorkspacePreferences() {
    if (document.querySelector("dialog[open]")) return;
    let draft = normalizeAdminPreferences(this.preferences);
    const preset = h("select", { id: "oba-workspace-preset" }, [
      ["simple", "Simple — writing essentials"],
      ["guided", "Guided — helpful review tools"],
      ["advanced", "Advanced — everything visible"],
      ["custom", "Custom — choose below"],
    ].map(([value, label]) => h("option", { value, selected: value === draft.preset }, label)));
    const density = h("select", { id: "oba-workspace-density" }, ["comfortable", "compact"].map((value) => h("option", { value, selected: value === draft.density }, value[0].toUpperCase() + value.slice(1))));
    const editorMode = h("select", { id: "oba-workspace-editor" }, [["visual", "Visual editor"], ["markdown", "Markdown source"]].map(([value, label]) => h("option", { value, selected: value === draft.editorMode }, label)));
    const moduleList = h("ul", { class: "oba-module-list" });
    const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const renderModules = (moved) => {
      let focusTarget = null;
      moduleList.replaceChildren(...draft.moduleOrder.map((module, index) => {
        const label = ADMIN_MODULE_LABELS[module];
        const checked = !draft.hiddenModules.includes(module);
        const toggle = h("input", { type: "checkbox", checked, disabled: preset.value !== "custom", "aria-label": `Show ${label}` });
        toggle.addEventListener("change", () => {
          draft.hiddenModules = toggle.checked ? draft.hiddenModules.filter((item) => item !== module) : [...draft.hiddenModules, module];
        });
        const move = (offset) => {
          const destination = index + offset;
          if (destination < 0 || destination >= draft.moduleOrder.length) return;
          [draft.moduleOrder[index], draft.moduleOrder[destination]] = [draft.moduleOrder[destination], draft.moduleOrder[index]];
          renderModules({ module, offset });
          status.textContent = `${label} moved to position ${destination + 1} of ${draft.moduleOrder.length}.`;
        };
        const up = h("button", { class: "oba-btn", type: "button", disabled: index === 0, "aria-label": `Move ${label} up`, onClick: () => move(-1) }, "↑");
        const down = h("button", { class: "oba-btn", type: "button", disabled: index === draft.moduleOrder.length - 1, "aria-label": `Move ${label} down`, onClick: () => move(1) }, "↓");
        if (moved?.module === module) {
          // Keep keyboard focus on the moved tool; at either end, use the button that still works.
          const preferred = moved.offset < 0 ? up : down;
          focusTarget = preferred.disabled ? (preferred === up ? down : up) : preferred;
        }
        return h("li", { class: "oba-module-row" }, h("label", {}, toggle, h("span", {}, label)), h("span", {}, up, down));
      }));
      focusTarget?.focus();
    };
    preset.addEventListener("change", () => { draft.preset = preset.value; renderModules(); });
    density.addEventListener("change", () => { draft.density = density.value; });
    editorMode.addEventListener("change", () => { draft.editorMode = editorMode.value; });
    const save = h("button", { class: "oba-btn oba-btn-primary", type: "button", onClick: async () => {
      draft = normalizeAdminPreferences({ ...draft, preset: preset.value, density: density.value, editorMode: editorMode.value });
      save.disabled = true;
      status.textContent = "Saving…";
      try {
        await this.saveWorkspacePreferences(draft);
        status.textContent = "Workspace saved.";
      } catch (error) {
        status.textContent = error.status === 409
          ? "These settings changed in another session. The latest version is now in use; select Save workspace again to replace it with your choices."
          : `Could not save: ${error.message}`;
      } finally {
        save.disabled = false;
      }
    } }, "Save workspace");
    const restore = h("button", { class: "oba-btn", type: "button", onClick: () => {
      draft = normalizeAdminPreferences();
      preset.value = draft.preset;
      density.value = draft.density;
      editorMode.value = draft.editorMode;
      renderModules();
      status.textContent = "Defaults restored in this form. Save to apply them.";
    } }, "Restore defaults");
    const close = h("button", { class: "oba-btn", type: "button", onClick: () => dialog.close() }, "Close");
    const dialog = h("dialog", { class: "oba-dialog oba-preferences-dialog", "aria-labelledby": "oba-preferences-title" },
      h("p", { class: "oba-eyebrow" }, "Your private view"),
      h("h2", { id: "oba-preferences-title" }, "Personalize your workspace"),
      h("p", {}, "These settings belong only to your admin login. They never change your posts, the site configuration in openblog.json, the public blog, or exported content."),
      this.preferencesError ? h("p", { class: "oba-notice", role: "alert" }, `${this.preferencesError} Saving here replaces any unreadable settings.`) : null,
      h("div", { class: "oba-preferences-grid" },
        h("div", { class: "oba-field" }, h("label", { for: "oba-workspace-preset" }, "Workspace complexity"), preset),
        h("div", { class: "oba-field" }, h("label", { for: "oba-workspace-density" }, "Spacing"), density),
        h("div", { class: "oba-field" }, h("label", { for: "oba-workspace-editor" }, "Default writing mode"), editorMode)),
      h("aside", { class: "oba-essential-note" }, h("strong", {}, "Always available"), h("p", {}, "Write, preview, settings, save, publish status, conflicts, privacy notices, approvals, and blockers cannot be hidden.")),
      h("fieldset", { class: "oba-module-fieldset" }, h("legend", {}, "Optional tools and order"), h("p", { class: "oba-small" }, "Order applies in every workspace. Choose Custom to show or hide individual tools; Advanced tools always provides a way back."), moduleList),
      status,
      h("div", { class: "oba-dialog-actions" }, restore, h("span", { class: "oba-spacer" }), close, save));
    renderModules();
    this.openWorkspaceDialog(dialog, preset);
  }

  openCommandPalette() {
    this.editor?.captureVisualSelection();
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
      { label: "Start a shared reflection", category: "Create", keywords: "shared reflection collaborate source video book", run: () => go("#/shared/new") },
      { label: "Posts", category: "Content", keywords: "articles", run: () => go("#/posts") },
      { label: "Pages", category: "Content", run: () => go("#/pages") },
      { label: "Series", category: "Content", run: () => go("#/series") },
      { label: "Analytics", category: "Observe", keywords: "views visitors", run: () => go("#/analytics") },
      { label: "Moderation inbox", category: "Observe", keywords: "moderation comments reader feedback questions corrections clarification remove responses revision notes", run: () => go("#/moderation") },
      { label: "Sources", category: "Research", keywords: "library bibliography citations editions translations witnesses references", run: () => go("#/sources") },
      { label: "Research notebook", category: "Research", keywords: "passages notes quotations excerpts observations questions capture", run: () => go("#/research") },
      { label: "Knowledge Atlas", category: "Research", keywords: "atlas people works concepts movements events relationships influence explore", run: () => go("#/atlas") },
      { label: "Compare versions", category: "Research", keywords: "compare alignments editions translations witnesses interpretations passages side by side", run: () => go("#/compare") },
      { label: "Contributors", category: "Site", keywords: "authors credits orcid identity", run: () => go("#/contributors") },
      { label: "View site", category: "Site", keywords: "public blog", run: () => open("/", "_blank", "noopener") },
      { label: "Advanced tools", category: "Workspace", keywords: "more optional hidden ai assistant research distribution", run: () => this.openAdvancedTools() },
      { label: "Personalize workspace", category: "Workspace", keywords: "preferences simple guided custom density layout restore defaults", run: () => this.openWorkspacePreferences() },
      { label: "Switch theme", category: "Workspace", keywords: "dark light mode", run: () => document.querySelector(".oba-theme-toggle")?.click() },
      { label: "Sign out", category: "Account", keywords: "logout", run: () => this.querySelector('[data-action="logout"]')?.click() },
    ];
    if (this.editor) {
      commands.unshift({ label: "Save document", category: "Editor", keywords: "publish ctrl s", run: () => this.editor.save() });
      const panes = ["write", "preview", "social", "release", "field", "optimize", "settings", "accessibility", "evidence", ...(this.editor.kind === "posts" ? ["assistant"] : [])];
      for (const pane of panes) {
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
      else if (head === "moderation" || head === "feedback") await this.showModeration(tail, params);
      else if (head === "contributors") await this.showContributors();
      else if (head === "sources") await this.showSources();
      else if (head === "research") await this.showResearch();
      else if (head === "atlas") await this.showAtlas(safeDecodeURIComponent(tail));
      else if (head === "compare") await this.showCompare(safeDecodeURIComponent(tail));
      else if (head === "shared" && tail === "new") await this.showSharedReflectionForm();
      else if (head === "shared" && tail.startsWith("accept/")) await this.showInvitationAccept(invitationTokenFromHash(location.hash));
      else if (head === "shared") await this.showSharedReflections();
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
        status.textContent = `${error.data?.error || error.message}${contributorSaveRefusalDetail(error.data)}`;
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

  // ---- research source library

  async showSources() {
    let library;
    try {
      library = await this.api.call("GET", "sources");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      // A damaged library is reported, never replaced: show where to repair it.
      this.mount(
        this.shell(
          "sources",
          h("p", { class: "oba-error", role: "alert" }, `The source library could not be read. ${sourceErrorMessage(error)}`),
          error.data?.file ? h("p", { class: "oba-small" }, `Repair ${error.data.file} by hand, then reload this view. Nothing was changed.`) : null,
        ),
      );
      return;
    }
    let sources = library.sources;
    let revision = library.revision;
    let selected = null; // null: nothing open, "new": unsaved record, otherwise a source id
    let draft = null;
    let conflict = null;
    let dirty = false;
    let busy = false;
    const filters = { query: "", kind: "all", archived: "active" };
    const mountedView = this.viewVersion + 1;

    const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const say = (text, kind = "oba-small") => {
      status.className = kind;
      status.textContent = text;
    };
    const search = h("input", { id: "oba-source-search", type: "search", autocomplete: "off", "aria-controls": "oba-source-list", placeholder: "Title, creator, ID, or identifier" });
    const kindFilter = h("select", { id: "oba-source-kind" }, h("option", { value: "all" }, "All types"), SOURCE_KINDS.map((item) => h("option", { value: item.kind }, `${item.label}s`)));
    const archivedFilter = h("select", { id: "oba-source-archived" }, [["active", "Active"], ["archived", "Archived"], ["all", "Active and archived"]].map(([value, label]) => h("option", { value }, label)));
    const count = h("p", { class: "oba-small", id: "oba-source-count", role: "status", "aria-live": "polite" });
    const list = h("ul", { class: "oba-source-list", id: "oba-source-list" });
    const panel = h("section", { class: "oba-source-editor", "aria-labelledby": "oba-source-heading" });
    const newButton = h("button", { class: "oba-btn oba-btn-primary", type: "button" }, "New source");

    const confirmDiscard = () => !dirty || globalThis.confirm?.("Discard the unsaved source changes?") !== false;

    const renderList = () => {
      const visible = filterSources(sources, filters);
      const label = (source) => `${sourceLabel(source)}, ${SOURCE_KINDS.find((item) => item.kind === source.kind)?.label.toLowerCase() || source.kind}${source.archived ? ", archived" : ""}`;
      list.replaceChildren(
        ...visible.map((source) =>
          h(
            "li",
            {},
            h(
              "button",
              { class: "oba-source-item", type: "button", "data-source-id": source.id, "aria-current": selected === source.id ? "true" : null, "aria-label": label(source), onClick: () => open(source.id) },
              h("strong", {}, sourceLabel(source)),
              h("span", { class: "oba-small" }, `${source.kind}${source.language ? ` · ${source.language}` : ""}${source.issued ? ` · ${source.issued}` : ""}`),
              source.archived ? h("span", { class: "oba-badge" }, "Archived") : null,
            ),
          ),
        ),
      );
      const filtered = filters.query.trim() || filters.kind !== "all" || filters.archived !== "active";
      count.textContent = sources.length
        ? `${visible.length} of ${sources.length} source${sources.length === 1 ? "" : "s"} shown.`
        : "";
      if (!visible.length) {
        list.replaceChildren(
          h(
            "li",
            { class: "oba-notice", "data-source-empty": "true" },
            sources.length
              ? filtered
                ? "No sources match these filters. Clear the search or choose another type."
                : "Every source is archived. Show archived sources to reopen one."
              : "Your source library is empty. Add a work first, then editions, translations, witnesses, and references that point at it.",
          ),
        );
      }
    };

    const open = (id) => {
      if (!confirmDiscard()) return;
      selected = id;
      conflict = null;
      dirty = false;
      this.dirty = false;
      draft = id === "new" ? sourceDraft(null, "work") : sourceDraft(sources.find((source) => source.id === id));
      say("");
      renderList();
      renderPanel(true);
    };

    const field = (name, labelText, control, hint) => {
      const id = `oba-source-${name}`;
      control.id = id;
      const described = hint ? `${id}-hint` : null;
      if (described) control.setAttribute("aria-describedby", described);
      return h("div", { class: "oba-field", "data-source-field": name }, h("label", { for: id }, labelText), control, hint ? h("p", { class: "oba-small", id: described }, hint) : null);
    };

    const renderPanel = (moveFocus = false) => {
      if (!draft) {
        panel.replaceChildren(
          h("h2", { id: "oba-source-heading", tabindex: "-1" }, "Source details"),
          h("p", { class: "oba-notice" }, sources.length ? "Choose a source to edit it, or add a new one." : "Add your first source to start the library."),
        );
        return;
      }
      const isNew = !draft.original;
      const fields = sourceFieldsForKind(draft.kind);
      const touch = () => {
        dirty = true;
        this.dirty = true;
      };
      const text = (name, props = {}) =>
        h("input", { type: "text", value: draft[name], autocomplete: "off", onInput: (event) => { draft[name] = event.target.value; touch(); }, ...props });
      const area = (name, rows) => h("textarea", { rows, spellcheck: "false", value: draft[name], onInput: (event) => { draft[name] = event.target.value; touch(); } });
      const select = (name, options, emptyLabel, after) =>
        h(
          "select",
          { onChange: (event) => { draft[name] = event.target.value; touch(); after?.(); } },
          emptyLabel ? h("option", { value: "", selected: !draft[name] }, emptyLabel) : null,
          options.map(([value, label]) => h("option", { value, selected: draft[name] === value }, label)),
        );
      const relation = (name) =>
        select(
          name,
          sourceRelationOptions(sources, draft.kind, name, draft.id).map((source) => [source.id, `${sourceLabel(source)} (${source.kind})`]),
          name === "of" ? "Choose a source" : "None",
          // A reference's volume control depends on the record it points at.
          name === "of" && fields.location
            ? () => {
                renderPanel();
                document.getElementById?.("oba-source-of")?.focus?.();
              }
            : undefined,
        );
      const kindControl = h(
        "select",
        {
          disabled: !isNew,
          onChange: (event) => {
            draft.kind = event.target.value;
            draft.of = "";
            draft.basedOn = "";
            touch();
            renderPanel();
            document.getElementById?.("oba-source-kind-field")?.focus?.();
          },
        },
        SOURCE_KINDS.map((item) => h("option", { value: item.kind, selected: draft.kind === item.kind }, item.label)),
      );
      const errorBox = h("p", { class: "oba-error", id: "oba-source-error", role: "alert", hidden: true });
      const fail = (message, control) => {
        errorBox.hidden = false;
        errorBox.textContent = message;
        const target = control && panel.querySelector(`#oba-source-${control}`);
        if (target) {
          target.setAttribute("aria-invalid", "true");
          target.setAttribute("aria-describedby", "oba-source-error");
          target.focus();
        } else errorBox.focus?.();
      };
      const save = h("button", { class: "oba-btn oba-btn-primary", type: "submit" }, isNew ? "Create source" : "Save changes");
      const dependents = isNew ? [] : sourceDependents(sources, draft.id);
      const archive = isNew
        ? null
        : h(
            "button",
            { class: "oba-btn", type: "button", "data-source-archive": "true", onClick: () => toggleArchive() },
            draft.original.archived ? "Restore source" : "Archive source",
          );
      const form = h(
        "form",
        { class: "oba-source-form", novalidate: true },
        h("div", { class: "oba-source-fields" },
          field("id", "ID", text("id", { readonly: !isNew, spellcheck: "false" }), isNew ? "A lowercase slug that stays the same for this source, such as plato-republic." : "The ID cannot change after the source is created."),
          field("kind-field", "Type", kindControl, SOURCE_KINDS.find((item) => item.kind === draft.kind)?.detail),
          field("title", fields.titleRequired ? "Title" : "Title (optional)", text("title", { required: fields.titleRequired })),
          fields.of ? field("of", draft.kind === "reference" ? "Points at" : "Belongs to", relation("of")) : null,
          fields.basedOn ? field("basedOn", "Translated from (optional)", relation("basedOn"), "An edition, witness, or translation this translation was made from.") : null,
          field("language", fields.languageRequired ? "Language" : "Language (optional)", text("language", { spellcheck: "false" }), "A language tag such as en or grc."),
          field("issued", "Issued (optional)", text("issued"), "A date or period, kept as you write it."),
          fields.location
            ? h(
                "div",
                { class: "oba-source-location", "data-source-field": "location" },
                field("locationScheme", "Location type", select("locationScheme", SOURCE_LOCATION_SCHEMES.map((scheme) => [scheme, scheme]), "None")),
                field("locationValue", "Location", text("locationValue", { spellcheck: "false" }), "For example 514a, 12r, or 1:02:30."),
                sourceTargetVolumes(sources, draft.of) > 1 || String(draft.locationVolume || "").trim()
                  ? field("locationVolume", "Volume", text("locationVolume", { spellcheck: "false" }), "Pages and folios restart in each volume, so name the volume, such as 2.")
                  : null,
              )
            : null,
          field("creators", "Creators (optional)", area("creators", 3), "One per line. Add a role after a bar, such as Plato | author. Creators are descriptive only and are not site contributors."),
          field("identifiers", "Identifiers (optional)", area("identifiers", 3), "One per line as scheme: value, such as doi: 10.1000/182 or url: https://example.org/text."),
        ),
        errorBox,
        h("div", { class: "oba-toolbar" }, save, archive, h("span", { class: "oba-spacer" }), h("button", { class: "oba-btn", type: "button", onClick: close }, "Close")),
        dependents.length ? h("p", { class: "oba-small" }, `${dependents.length} other source${dependents.length === 1 ? "" : "s"} point${dependents.length === 1 ? "s" : ""} at this one and keep resolving even when it is archived.`) : null,
        conflict
          ? h(
              "div",
              { class: "oba-notice", role: "alert", "data-source-conflict": "true" },
              h("p", {}, "This library changed after you opened it, so nothing was saved. Your draft is still here."),
              h(
                "div",
                { class: "oba-toolbar" },
                h("button", { class: "oba-btn", type: "button", "data-source-conflict-use": "stored", onClick: () => resolveConflict(true) }, conflict.current ? "Use the stored copy" : "Discard my draft"),
                h("button", { class: "oba-btn", type: "button", "data-source-conflict-use": "draft", onClick: () => resolveConflict(false) }, "Keep my draft on the latest library"),
              ),
            )
          : null,
      );
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (conflict || busy) return;
        const problem = validateSourceDraft(draft, sources);
        if (problem) return fail(problem.message, problem.field === "kind-field" ? "kind-field" : problem.field);
        busy = true;
        save.disabled = true;
        errorBox.hidden = true;
        say(isNew ? "Creating source…" : "Saving source…");
        try {
          const result = await this.api.call(isNew ? "POST" : "PUT", "sources", { json: { revision, source: sourceDraftPayload(draft) } });
          if (this.viewVersion !== mountedView) return;
          sources = isNew ? [...sources, result.source] : sources.map((source) => (source.id === result.source.id ? result.source : source));
          revision = result.revision;
          selected = result.source.id;
          draft = sourceDraft(result.source);
          dirty = false;
          this.dirty = false;
          renderList();
          renderPanel();
          say(`${sourceLabel(result.source)} saved.${comparisonBuildText(result.build)}`, result.build && !result.build.ok ? "oba-error" : "oba-ok");
        } catch (error) {
          if (this.viewVersion !== mountedView) return;
          if (error.status === 409 && error.data?.conflict) {
            conflict = { revision: error.data.revision, current: error.data.current };
            renderPanel();
            panel.querySelector("[data-source-conflict]")?.querySelector("button")?.focus();
            say("Not saved: the library changed elsewhere.", "oba-error");
            return;
          }
          const first = error.data?.diagnostics?.[0];
          fail(sourceErrorMessage(error), first ? sourceDiagnosticControl(first.field) : "");
          say("Not saved. The stored library is unchanged.", "oba-error");
        } finally {
          busy = false;
          save.disabled = false;
        }
      });
      panel.replaceChildren(
        h("h2", { id: "oba-source-heading", tabindex: "-1" }, isNew ? "New source" : sourceLabel(draft.original)),
        draft.original?.archived ? h("p", { class: "oba-badge" }, "Archived") : null,
        form,
      );
      if (moveFocus) panel.querySelector("#oba-source-heading")?.focus();
    };

    const resolveConflict = async (useStored) => {
      if (busy) return;
      busy = true;
      try {
        // Reload the whole library so relationship choices and the revision match what is stored now.
        const latest = await this.api.call("GET", "sources");
        if (this.viewVersion !== mountedView) return;
        sources = latest.sources;
        revision = latest.revision;
        conflict = null;
        const current = sources.find((source) => source.id === draft.id) || null;
        if (useStored) {
          draft = current ? sourceDraft(current) : null;
          selected = current ? current.id : null;
          dirty = false;
          this.dirty = false;
          say(current ? "Showing the stored copy." : "Draft discarded.");
        } else {
          // The author has seen that the library changed; the draft now rests on the latest revision.
          if (current && draft.original) draft.original = structuredClone(current);
          say("Your draft now rests on the latest library. Review it, then save.");
        }
        renderList();
        renderPanel(true);
      } catch (error) {
        if (this.viewVersion !== mountedView) return;
        say(`${sourceErrorMessage(error)} The stored library is unchanged.`, "oba-error");
      } finally {
        busy = false;
      }
    };

    const toggleArchive = async () => {
      if (busy || !draft?.original) return;
      if (dirty && !confirmDiscard()) return;
      busy = true;
      const archived = !draft.original.archived;
      say(archived ? "Archiving source…" : "Restoring source…");
      try {
        const result = await this.api.call("POST", "sources/archive", { json: { revision, id: draft.original.id, archived } });
        if (this.viewVersion !== mountedView) return;
        sources = sources.map((source) => (source.id === result.source.id ? result.source : source));
        revision = result.revision;
        draft = sourceDraft(result.source);
        dirty = false;
        this.dirty = false;
        renderList();
        renderPanel();
        say(`${sourceLabel(result.source)} ${archived ? "archived" : "restored"}.${comparisonBuildText(result.build)}`, result.build && !result.build.ok ? "oba-error" : "oba-ok");
      } catch (error) {
        if (this.viewVersion !== mountedView) return;
        if (error.status === 409 && error.data?.conflict) {
          conflict = { revision: error.data.revision, current: error.data.current };
          renderPanel();
          say("Not changed: the library changed elsewhere.", "oba-error");
        } else say(`${sourceErrorMessage(error)} The stored library is unchanged.`, "oba-error");
      } finally {
        busy = false;
      }
    };

    const close = () => {
      if (!confirmDiscard()) return;
      selected = null;
      draft = null;
      conflict = null;
      dirty = false;
      this.dirty = false;
      renderList();
      renderPanel();
      search.focus();
    };

    search.addEventListener("input", () => {
      filters.query = search.value;
      renderList();
    });
    kindFilter.addEventListener("change", () => {
      filters.kind = kindFilter.value;
      renderList();
    });
    archivedFilter.addEventListener("change", () => {
      filters.archived = archivedFilter.value;
      renderList();
    });
    newButton.addEventListener("click", () => open("new"));

    // ---- import and export (CSL JSON, BibTeX)
    const importText = h("textarea", { id: "oba-source-import-text", rows: "6", spellcheck: "false", autocomplete: "off" });
    const importFile = h("input", { id: "oba-source-import-file", type: "file", accept: ".json,application/json" });
    const previewButton = h("button", { class: "oba-btn", type: "button" }, "Preview import");
    const applyButton = h("button", { class: "oba-btn oba-btn-primary", type: "button", hidden: true }, "Apply import");
    const importResult = h("div", { class: "oba-source-import-result", id: "oba-source-import-result", tabindex: "-1" });
    const interchangeStatus = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    let previewedText = null;
    const showImportPlan = (plan, headline) => {
      const rows = sourceImportRows(plan);
      importResult.replaceChildren(
        h("p", {}, headline || `Preview: ${sourceImportSummary(plan)}. Nothing has been saved.`),
        rows.length
          ? h("ul", { class: "oba-source-import-list" }, rows.map((row) => h("li", { "data-import-action": row.action }, h("strong", {}, `${row.label}: ${row.name}`), row.details.length ? h("ul", {}, row.details.map((detail) => h("li", {}, detail))) : null)))
          : null,
      );
    };
    const runImport = async (apply) => {
      const text = importText.value;
      if (!text.trim()) {
        interchangeStatus.className = "oba-error";
        interchangeStatus.textContent = "Paste CSL JSON or choose a file first.";
        importText.focus();
        return;
      }
      previewButton.disabled = applyButton.disabled = true;
      try {
        const result = await this.api.call("POST", "sources/import", { json: { revision, content: text, apply } });
        revision = result.revision;
        interchangeStatus.className = "oba-small";
        if (apply && result.applied) {
          sources = result.sources;
          previewedText = null;
          applyButton.hidden = true;
          renderList();
          showImportPlan(result.plan, `Imported: ${sourceImportSummary(result.plan)}.`);
          interchangeStatus.textContent = "Import saved.";
        } else {
          const changes = result.plan.counts.create + result.plan.counts.update > 0;
          previewedText = result.applicable && changes ? text : null;
          applyButton.hidden = !previewedText;
          showImportPlan(result.plan);
          interchangeStatus.textContent = !result.applicable ? "Resolve the conflicts before importing; nothing was saved." : changes ? "Review the preview, then apply the import." : "Everything is already up to date.";
        }
        importResult.focus();
      } catch (error) {
        previewedText = null;
        applyButton.hidden = true;
        interchangeStatus.className = "oba-error";
        if (error?.data?.plan) showImportPlan(error.data.plan, "The import was not applied. Nothing was saved.");
        else importResult.replaceChildren();
        interchangeStatus.textContent = error?.status === 409 ? "The library changed since it was read. Reload this view and preview again." : sourceErrorMessage(error);
      } finally {
        previewButton.disabled = applyButton.disabled = false;
      }
    };
    previewButton.addEventListener("click", () => runImport(false));
    applyButton.addEventListener("click", () => {
      // Only the text that was previewed can be applied.
      if (previewedText === null || previewedText !== importText.value) {
        applyButton.hidden = true;
        interchangeStatus.textContent = "The text changed after the preview. Preview it again.";
        return;
      }
      runImport(true);
    });
    importText.addEventListener("input", () => {
      previewedText = null;
      applyButton.hidden = true;
    });
    importFile.addEventListener("change", async () => {
      const file = importFile.files?.[0];
      if (!file) return;
      try {
        importText.value = await file.text();
        previewedText = null;
        applyButton.hidden = true;
        interchangeStatus.className = "oba-small";
        interchangeStatus.textContent = `Loaded ${file.name}. Preview it before importing.`;
      } catch {
        interchangeStatus.className = "oba-error";
        interchangeStatus.textContent = "That file could not be read.";
      }
    });
    const exportAs = async (format) => {
      try {
        const result = await this.api.call("GET", `sources/export?format=${format}`);
        const url = URL.createObjectURL(new Blob([result.content], { type: `${result.mediaType};charset=utf-8` }));
        try {
          const link = h("a", { href: url, download: result.filename });
          document.body.append(link);
          link.click();
          link.remove();
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 0);
        }
        const notes = sourceExportLossNotes(result.losses);
        interchangeStatus.className = "oba-small";
        interchangeStatus.textContent = `Exported ${result.count} sources as ${result.filename}.${notes.length ? ` This format cannot carry: ${notes.join("; ")}.` : ""}`;
      } catch (error) {
        interchangeStatus.className = "oba-error";
        interchangeStatus.textContent = sourceErrorMessage(error);
      }
    };
    const exportCsl = h("button", { class: "oba-btn", type: "button" }, "Export CSL JSON");
    const exportBibtex = h("button", { class: "oba-btn", type: "button" }, "Export BibTeX");
    exportCsl.addEventListener("click", () => exportAs("csl-json"));
    exportBibtex.addEventListener("click", () => exportAs("bibtex"));
    const interchange = h(
      "details",
      { class: "oba-source-interchange" },
      h("summary", {}, "Import and export"),
      h("p", { class: "oba-small" }, "Import CSL JSON (for example from Zotero) after a preview. Importing adds and updates sources but never removes anything, keeps richer details you already recorded, and lists every field it cannot store. Private notes and abstracts are never imported."),
      h("div", { class: "oba-field" }, h("label", { for: "oba-source-import-file" }, "CSL JSON file"), importFile),
      h("div", { class: "oba-field" }, h("label", { for: "oba-source-import-text" }, "Or paste CSL JSON"), importText),
      h("div", { class: "oba-toolbar" }, previewButton, applyButton),
      importResult,
      h("div", { class: "oba-toolbar" }, exportCsl, exportBibtex),
      interchangeStatus,
    );


    renderList();
    renderPanel();
    this.mount(
      this.shell(
        "sources",
        h("section", { class: "oba-contributor-intro" }, h("p", {}, "Keep works, editions, translations, witnesses, and references as separate records, each with a stable ID."), h("p", { class: "oba-small" }, `Private author research stored in ${library.file}. It never reaches the public site, and saving here changes only that file.`)),
        h(
          "div",
          { class: "oba-toolbar oba-source-filters", role: "search" },
          h("div", { class: "oba-field" }, h("label", { for: "oba-source-search" }, "Search sources"), search),
          h("div", { class: "oba-field" }, h("label", { for: "oba-source-kind" }, "Type"), kindFilter),
          h("div", { class: "oba-field" }, h("label", { for: "oba-source-archived" }, "Show"), archivedFilter),
          newButton,
        ),
        count,
        status,
        interchange,
        h("div", { class: "oba-source-layout" }, h("nav", { "aria-label": "Sources" }, list), panel),
      ),
    );
  }

  // ---- research notebook

  async showResearch() {
    let loaded;
    try {
      loaded = await this.api.call("GET", "research/notebook");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      // A damaged notebook (or library) is reported, never replaced: show where to repair it.
      this.mount(
        this.shell(
          "research",
          h("p", { class: "oba-error", role: "alert" }, `The research notebook could not be read. ${notebookErrorMessage(error)}`),
          error.data?.file ? h("p", { class: "oba-small" }, `Repair ${error.data.file} by hand, then reload this view. Nothing was changed.`) : null,
        ),
      );
      return;
    }
    const state = { revision: loaded.revision, sources: loaded.sources, passages: loaded.passages, notes: loaded.notes };
    const mountedView = this.viewVersion + 1;
    let selected = null; // null, "new", or { type, id }
    let form = null;
    let busy = false;
    const filters = { query: "", source: "", locator: "", concept: "", state: "", archived: false };
    let results = null; // the last server search, while any filter is set
    let searchProblem = "";
    let searchSequence = 0;
    let panelSequence = 0;

    const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const say = (text, kind = "oba-small") => {
      status.className = kind;
      status.textContent = text;
    };
    const search = h("input", { id: "oba-research-search", type: "search", autocomplete: "off", "aria-controls": "oba-research-lists", placeholder: "Quoted text, note, source, or ID" });
    const count = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const filterSelect = (id, label, name, options) =>
      h("div", { class: "oba-field" }, h("label", { for: id }, label), h("select", { id, "data-research-filter": name, onChange: (event) => { filters[name] = event.target.value; runSearch(); } }, options.map(([value, text]) => h("option", { value, selected: filters[name] === value }, text))));
    const locatorKinds = [...new Set(["page", "folio", "line", "section", "chapter", "canonical", "timestamp", ...state.passages.flatMap((passage) => (passage.locators || []).map((locator) => locator.kind))])];
    const sourceFilter = filterSelect("oba-research-source-filter", "Source", "source", [["", "Any source"], ...[...state.sources].sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b))).map((source) => [source.id, `${sourceLabel(source)}${source.archived ? " (archived)" : ""}`])]);
    const locatorFilter = filterSelect("oba-research-locator-filter", "Locator kind", "locator", [["", "Any locator"], ...locatorKinds.map((kind) => [kind, kind])]);
    const stateFilter = filterSelect("oba-research-state-filter", "Questions", "state", [["", "All entries"], ["open", "Open questions"], ["resolved", "Resolved questions"]]);
    const concept = h("input", { id: "oba-research-concept-filter", type: "text", autocomplete: "off", spellcheck: "false", "aria-controls": "oba-research-lists", placeholder: "such as allegory" });
    const resultsNav = h("nav", { "aria-label": "Notebook" });
    const passageList = h("ul", { class: "oba-source-list", id: "oba-research-passages" });
    const noteList = h("ul", { class: "oba-source-list", id: "oba-research-notes" });
    const panel = h("section", { class: "oba-source-editor", "aria-labelledby": "oba-research-heading" });
    const newButton = h("button", { class: "oba-btn oba-btn-primary", type: "button", onClick: () => open("new") }, "Capture");
    const sourceById = (id) => state.sources.find((source) => source.id === id);
    const sourceName = (id) => (sourceById(id) ? sourceLabel(sourceById(id)) : id);

    const confirmDiscard = () => !form?.isDirty() || globalThis.confirm?.("Discard the unsaved research entry?") !== false;
    const runSearch = async () => {
      const sequence = ++searchSequence;
      if (!searchIsActive(filters)) {
        results = null;
        searchProblem = "";
        renderLists();
        return;
      }
      try {
        const found = await this.api.call("POST", "research/search", { json: notebookSearchBody(filters) });
        if (sequence !== searchSequence || this.viewVersion !== mountedView) return;
        results = found;
        searchProblem = "";
      } catch (error) {
        if (sequence !== searchSequence || this.viewVersion !== mountedView) return;
        results = null;
        searchProblem = `${notebookErrorMessage(error)} The notebook is unchanged.`;
      }
      renderLists();
    };
    const refreshSearch = () => {
      if (searchIsActive(filters)) runSearch();
      else renderLists();
    };

    const renderLists = () => {
      const live = (entry) => !entry.archived;
      const open_ = state.notes.filter((note) => live(note) && note.kind === "question" && note.status !== "resolved").length;
      const archivedCount = state.passages.filter((entry) => !live(entry)).length + state.notes.filter((entry) => !live(entry)).length;
      const livePassages = state.passages.filter(live).length;
      const liveNotes = state.notes.filter(live).length;
      const summary = `${livePassages} passage${livePassages === 1 ? "" : "s"}, ${liveNotes} note${liveNotes === 1 ? "" : "s"}, ${open_} open question${open_ === 1 ? "" : "s"}${archivedCount ? `, ${archivedCount} archived${filters.archived ? " (shown)" : ""}` : ""}.`;
      if (searchIsActive(filters)) {
        const hits = results?.hits || [];
        const row = (hit) =>
          h(
            "li",
            {},
            h(
              "button",
              { class: "oba-source-item", type: "button", "data-entry-id": hit.id, "data-entry-type": hit.entry, "data-search-hit": "true", "aria-current": selected?.id === hit.id ? "true" : null, onClick: () => open({ type: hit.entry, id: hit.id }) },
              h("strong", {}, hit.snippet),
              h("span", { class: "oba-small" }, `${hitContext(hit)}${hit.archived ? " · archived" : ""}`),
              hit.matched?.length && filters.query.trim() ? h("span", { class: "oba-small" }, `Matched in ${hit.matched.join(", ")}`) : null,
              (hit.passages || []).map((passage) => h("span", { class: "oba-small" }, passage.missing ? `About a missing passage (${passage.id})` : `About: ${entryPreview({ text: passage.preview }, 70)}`)),
              hit.notes?.length ? h("span", { class: "oba-small" }, `${hit.notes.length} linked note${hit.notes.length === 1 ? "" : "s"}`) : null,
            ),
          );
        const broken = results?.broken?.length ? h("p", { class: "oba-notice", role: "alert" }, `${results.broken.length} link${results.broken.length === 1 ? "" : "s"} in the notebook point to missing entries or sources. Repair the notebook file by hand.`) : null;
        resultsNav.replaceChildren(
          h("h2", { class: "oba-small-heading", id: "oba-research-results-heading" }, "Results"),
          searchProblem ? h("p", { class: "oba-error", role: "alert" }, searchProblem) : null,
          broken,
          h("ul", { class: "oba-source-list", id: "oba-research-results", "aria-labelledby": "oba-research-results-heading" }, hits.length ? hits.map(row) : results ? h("li", { class: "oba-notice" }, "No entries match these filters.") : null),
        );
        count.textContent = results ? `${results.total} match${results.total === 1 ? "" : "es"}${results.truncated ? `, showing the first ${hits.length}` : ""}. ${summary}` : "";
        return;
      }
      const passages = state.passages.filter((entry) => filters.archived || live(entry));
      const notes = state.notes.filter((entry) => filters.archived || live(entry));
      const row = (type, entry) =>
        h(
          "li",
          {},
          h(
            "button",
            { class: "oba-source-item", type: "button", "data-entry-id": entry.id, "data-entry-type": type, "aria-current": selected?.id === entry.id ? "true" : null, "aria-label": `${entry.archived ? "Archived " : ""}${type === "passage" ? "Passage" : entry.kind === "question" ? (entry.status === "resolved" ? "Resolved question" : "Open question") : "Observation"}: ${entryPreview(entry, 60)}`, onClick: () => open({ type, id: entry.id }) },
            h("strong", {}, entryPreview(entry)),
            h("span", { class: "oba-small" }, `${type === "passage" ? `${sourceName(entry.source)}${entry.locators?.length ? ` · ${formatLocatorLines(entry.locators).split("\n")[0]}` : ""}` : `${entry.kind === "question" ? (entry.status === "resolved" ? "resolved question" : "open question") : entry.kind}${entry.passages?.length ? ` · ${entry.passages.length} passage${entry.passages.length === 1 ? "" : "s"}` : ""}`}${entry.archived ? " · archived" : ""}`),
          ),
        );
      passageList.replaceChildren(...passages.map((entry) => row("passage", entry)));
      noteList.replaceChildren(...notes.map((entry) => row("note", entry)));
      if (!passages.length) passageList.replaceChildren(h("li", { class: "oba-notice" }, "No passages yet."));
      if (!notes.length) noteList.replaceChildren(h("li", { class: "oba-notice" }, "No notes yet."));
      resultsNav.replaceChildren(h("h2", { class: "oba-small-heading" }, "Passages"), passageList, h("h2", { class: "oba-small-heading" }, "Notes"), noteList);
      count.textContent = summary;
    };

    const entryOf = (target) => (target.type === "passage" ? state.passages : state.notes).find((entry) => entry.id === target.id) || null;

    const renderPanel = (moveFocus = false) => {
      form = null;
      if (!selected) {
        panel.replaceChildren(
          h("h2", { id: "oba-research-heading", tabindex: "-1" }, "Capture"),
          h("p", { class: "oba-notice" }, state.passages.length || state.notes.length ? "Choose a passage or note to edit it, or capture a new one." : "Capture your first passage or note."),
        );
        return;
      }
      const entry = selected === "new" ? null : entryOf(selected);
      if (selected !== "new" && !entry) {
        selected = null;
        renderPanel();
        return;
      }
      form = createCaptureForm({
        api: this.api,
        state,
        entry,
        entryType: selected === "new" ? "passage" : selected.type,
        idPrefix: "oba-research",
        onRefreshed: () => {
          if (this.viewVersion === mountedView) refreshSearch();
        },
        onSaved: (result) => {
          if (this.viewVersion !== mountedView) return;
          const target = result.note && !result.partial && result.type === "note" ? { type: "note", id: result.note.id } : result.passage ? { type: "passage", id: result.passage.id } : selected;
          if (result.partial) {
            refreshSearch();
            return;
          }
          selected = target;
          refreshSearch();
          renderPanel(true);
          say(`Saved to the private notebook.${comparisonBuildText(result.build)}`, result.build && !result.build.ok ? "oba-error" : "oba-ok");
        },
        onCancel: () => close(),
      });
      const linked = entry && selected.type === "passage" ? state.notes.filter((note) => (note.passages || []).includes(entry.id)) : [];
      const backlinks = entry ? h("div", { class: "oba-research-backlinks", "data-research-backlinks": "true" }) : null;
      panel.replaceChildren(
        h("h2", { id: "oba-research-heading", tabindex: "-1" }, entry ? (selected.type === "passage" ? "Passage" : entry.kind === "question" ? "Question" : "Observation") : "Capture"),
        entry ? h("p", { class: "oba-small" }, `ID ${entry.id}. Private; never published.`) : null,
        form.element,
        linked.length ? h("p", { class: "oba-small" }, `${linked.length} note${linked.length === 1 ? "" : "s"} link${linked.length === 1 ? "s" : ""} to this passage, so it cannot be removed until they are.`) : null,
        entry && selected.type === "note" && entry.concepts?.length
          ? h(
              "nav",
              { class: "oba-atlas-concept-links", "aria-label": "Concepts in the Knowledge Atlas", "data-atlas-concepts": "true" },
              h("p", { class: "oba-small" }, "Concepts in the Knowledge Atlas:"),
              h("ul", {}, entry.concepts.map((concept) => h("li", {}, h("a", { href: `#/atlas/${encodeURIComponent(concept)}`, "data-atlas-concept": concept }, concept)))),
            )
          : null,
        backlinks,
        entry
          ? h(
              "div",
              { class: "oba-toolbar" },
              h("button", { class: "oba-btn", type: "button", "data-entry-archive": "true", onClick: () => setArchived(!entry.archived) }, entry.archived ? "Restore from archive" : "Archive"),
              h("button", { class: "oba-btn oba-btn-danger", type: "button", "data-entry-remove": "true", onClick: () => remove() }, selected.type === "passage" ? "Remove passage" : "Remove note"),
            )
          : null,
        entry?.archived ? h("p", { class: "oba-small" }, "Archived: set aside but kept. It stays in the file and in exports, and is hidden from lists and search unless you show archived entries.") : null,
      );
      if (moveFocus) panel.querySelector("#oba-research-heading")?.focus();
      if (backlinks) loadBacklinks(entry, backlinks);
    };

    /** What points at this entry's passage, source, or concepts, read fresh from the stored notebook. */
    const loadBacklinks = async (entry, box) => {
      const sequence = ++panelSequence;
      const isPassage = selected.type === "passage";
      const asks = isPassage
        ? [["passage", entry.id, "Notes about this passage"], ["source", entry.source, `Other research on ${sourceName(entry.source)}`]]
        : (entry.concepts || []).slice(0, 5).map((concept) => ["concept", concept, `Notes tagged ${concept}`]);
      const sections = [];
      for (const [type, id, heading] of asks) {
        try {
          const found = await this.api.call("POST", "research/backlinks", { json: { type, id } });
          if (sequence !== panelSequence || this.viewVersion !== mountedView) return;
          const others = (found.entries || []).filter((item) => item.id !== entry.id);
          const headingId = `oba-research-backlinks-${type}-${sections.length}`;
          sections.push(
            h(
              "section",
              { "aria-labelledby": headingId },
              h("h3", { class: "oba-small-heading", id: headingId }, heading),
              others.length
                ? h(
                    "ul",
                    { class: "oba-source-list" },
                    others.map((item) =>
                      h(
                        "li",
                        {},
                        h(
                          "button",
                          { class: "oba-source-item", type: "button", "data-backlink-id": item.id, onClick: () => open({ type: item.entry, id: item.id }) },
                          h("strong", {}, item.preview),
                          h("span", { class: "oba-small" }, `${item.entry === "passage" ? "Passage" : item.kind === "question" ? (item.state === "resolved" ? "Resolved question" : "Open question") : "Observation"}${item.through ? ` · through ${sourceName(item.through)}` : ""}`),
                        ),
                      ),
                    ),
                  )
                : h("p", { class: "oba-small" }, "Nothing else yet."),
            ),
          );
        } catch {
          if (sequence !== panelSequence || this.viewVersion !== mountedView) return;
          sections.push(h("p", { class: "oba-small" }, `${heading} could not be listed.`));
        }
      }
      box.replaceChildren(...sections);
    };

    const open = async (target) => {
      if (!confirmDiscard()) return;
      if (target !== "new" && !entryOf(target)) {
        // A hit or backlink from the server may be newer than this view: refresh once and retry.
        // The refreshed copy is committed only when the panel is re-rendered from it. An open form
        // was built from the old copy, so keeping the old revision makes its save conflict (409)
        // instead of silently overwriting a concurrent edit.
        let latest = null;
        try {
          latest = await this.api.call("GET", "research/notebook");
        } catch {
          latest = null;
        }
        if (this.viewVersion !== mountedView) return;
        const found = latest && (target.type === "passage" ? latest.passages : latest.notes)?.some((entry) => entry.id === target.id);
        if (!found) {
          // Leave the lists, the open form and its revision as they are.
          say(`That ${target.type} (${target.id}) is no longer in the notebook. The list may be out of date.`, "oba-error");
          return;
        }
        Object.assign(state, { revision: latest.revision, sources: latest.sources, passages: latest.passages, notes: latest.notes });
      }
      selected = target;
      say("");
      renderLists();
      renderPanel(true);
    };
    const close = () => {
      if (!confirmDiscard()) return;
      selected = null;
      renderLists();
      renderPanel();
      newButton.focus();
    };

    /** Set the selected entry aside, or bring it back. Nothing is deleted. */
    const setArchived = async (archived) => {
      if (busy || !selected || selected === "new") return;
      if (!confirmDiscard()) return;
      busy = true;
      try {
        const result = await this.api.call("POST", "research/archive", { json: { revision: state.revision, type: selected.type, id: selected.id, archived } });
        if (this.viewVersion !== mountedView) return;
        Object.assign(state, { revision: result.revision, sources: result.sources, passages: result.passages, notes: result.notes });
        refreshSearch();
        renderPanel(true);
        say(`${archived ? (filters.archived ? "Archived. It stays in the notebook and in exports." : "Archived. It stays in the notebook and in exports; tick Show archived to see it in lists.") : "Restored from the archive."}${comparisonBuildText(result.build)}`, result.build && !result.build.ok ? "oba-error" : "oba-ok");
      } catch (error) {
        if (this.viewVersion !== mountedView) return;
        say(error.status === 409 ? "Not changed: the notebook changed elsewhere. Reload this view and try again." : `${notebookErrorMessage(error)} The stored notebook is unchanged.`, "oba-error");
      } finally {
        busy = false;
      }
    };

    const remove = async () => {
      if (busy || !selected || selected === "new") return;
      if (globalThis.confirm?.(`Remove this ${selected.type}? It is deleted from the private notebook.`) === false) return;
      busy = true;
      try {
        const result = await this.api.call("DELETE", selected.type === "passage" ? "research/passages" : "research/notes", { json: { revision: state.revision, id: selected.id } });
        if (this.viewVersion !== mountedView) return;
        Object.assign(state, { revision: result.revision, sources: result.sources, passages: result.passages, notes: result.notes });
        selected = null;
        refreshSearch();
        renderPanel();
        say("Removed from the private notebook.", "oba-ok");
        newButton.focus();
      } catch (error) {
        if (this.viewVersion !== mountedView) return;
        say(error.status === 409 ? "Not removed: the notebook changed elsewhere. Reload this view and try again." : `${notebookErrorMessage(error)} The stored notebook is unchanged.`, "oba-error");
      } finally {
        busy = false;
      }
    };

    let typing = null;
    const typed = () => {
      // Search as the author pauses, so each keystroke is not a request.
      clearTimeout(typing);
      typing = setTimeout(runSearch, 150);
    };
    search.addEventListener("input", () => {
      filters.query = search.value;
      typed();
    });
    concept.addEventListener("input", () => {
      filters.concept = concept.value.trim().toLowerCase();
      typed();
    });
    const archivedToggle = h("input", { id: "oba-research-archived", type: "checkbox", onChange: (event) => { filters.archived = event.target.checked; refreshSearch(); } });

    // ---- export and import (a private, versioned bundle)
    const bundleStatus = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const bundleResult = h("div", { class: "oba-source-import-result", id: "oba-research-import-result", tabindex: "-1" });
    const bundleFile = h("input", { id: "oba-research-import-file", type: "file", accept: ".json,application/json" });
    const bundlePreview = h("button", { class: "oba-btn", type: "button", "data-research-import-preview": "true", disabled: true }, "Preview import");
    const bundleApply = h("button", { class: "oba-btn oba-btn-primary", type: "button", "data-research-import-apply": "true", hidden: true }, "Apply import");
    let bundle = null; // the raw file text, held only until it is applied or replaced
    let previewed = false;
    const showBundlePlan = (plan, headline) => {
      const rows = notebookImportRows(plan);
      bundleResult.replaceChildren(
        h("p", {}, headline || `Preview: ${notebookImportSummary(plan)}. Nothing has been saved.`),
        rows.length ? h("ul", { class: "oba-source-import-list" }, rows.map((row) => h("li", { "data-import-action": row.action }, h("strong", {}, `${row.label}: ${row.name}`), row.message ? h("span", { class: "oba-small" }, ` ${row.message}`) : null))) : null,
      );
    };
    const importFailure = (error) => {
      previewed = false;
      bundleApply.hidden = true;
      bundleStatus.className = "oba-error";
      if (error?.data?.plan) showBundlePlan(error.data.plan, "The import was not applied. Nothing was saved.");
      else bundleResult.replaceChildren();
      bundleStatus.textContent = error?.status === 409 ? "The notebook changed since it was read. Reload this view and preview again." : `${notebookErrorMessage(error)} The notebook is unchanged.`;
    };
    const runBundleImport = async (apply) => {
      if (!bundle || busy) return;
      busy = true;
      bundlePreview.disabled = bundleApply.disabled = true;
      try {
        const result = await this.api.call("POST", "research/import", { json: { revision: state.revision, content: bundle, apply } });
        if (this.viewVersion !== mountedView) return;
        bundleStatus.className = "oba-small";
        if (apply && result.applied) {
          Object.assign(state, { revision: result.revision, sources: result.sources, passages: result.passages, notes: result.notes });
          bundle = null;
          previewed = false;
          bundleApply.hidden = true;
          renderLists();
          refreshSearch();
          showBundlePlan(result.plan, `Imported: ${notebookImportSummary(result.plan)}.`);
          bundleStatus.textContent = "Import saved.";
        } else {
          state.revision = result.revision;
          const changes = result.plan.counts.create > 0;
          previewed = result.applicable && changes;
          bundleApply.hidden = !previewed;
          showBundlePlan(result.plan);
          bundleStatus.textContent = !result.applicable ? "Resolve the conflicts before importing; nothing was saved." : changes ? "Review the preview, then apply the import." : "Everything is already in the notebook.";
        }
        bundleResult.focus();
      } catch (error) {
        if (this.viewVersion === mountedView) importFailure(error);
      } finally {
        busy = false;
        bundlePreview.disabled = !bundle;
        bundleApply.disabled = false;
      }
    };
    bundlePreview.addEventListener("click", () => runBundleImport(false));
    bundleApply.addEventListener("click", () => {
      if (!previewed) {
        bundleApply.hidden = true;
        bundleStatus.textContent = "Preview the file again before applying it.";
        return;
      }
      runBundleImport(true);
    });
    bundleFile.addEventListener("change", async () => {
      const file = bundleFile.files?.[0];
      bundle = null;
      previewed = false;
      bundleApply.hidden = true;
      bundlePreview.disabled = true;
      bundleResult.replaceChildren();
      if (!file) return;
      try {
        // Keep the text as read: the server parses it, so large integers in unknown fields are not rounded.
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        bundle = text;
        bundlePreview.disabled = false;
        bundleStatus.className = "oba-small";
        bundleStatus.textContent = `Loaded ${file.name}. Preview it before importing.`;
      } catch {
        bundleStatus.className = "oba-error";
        bundleStatus.textContent = "That file is not a research bundle (it is not JSON).";
      }
    });
    const exportBundle = async () => {
      const ok = globalThis.confirm?.("This file will contain all of your private passages and notes, including archived ones. Keep it somewhere private; never place it in content, static or themes. Export it?") !== false;
      if (!ok) return;
      try {
        const result = await this.api.call("POST", "research/export", { json: { includePrivate: true } });
        const url = URL.createObjectURL(new Blob([result.content], { type: `${result.mediaType};charset=utf-8` }));
        try {
          const link = h("a", { href: url, download: result.filename });
          document.body.append(link);
          link.click();
          link.remove();
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 0);
        }
        bundleStatus.className = "oba-small";
        bundleStatus.textContent = `Exported ${result.passages} passage${result.passages === 1 ? "" : "s"} and ${result.notes} note${result.notes === 1 ? "" : "s"} as ${result.filename}. It is private research: keep it out of your public folders.`;
      } catch (error) {
        bundleStatus.className = "oba-error";
        bundleStatus.textContent = notebookErrorMessage(error);
      }
    };
    const exportButton = h("button", { class: "oba-btn", type: "button", "data-research-export": "true", onClick: exportBundle }, "Export notebook");
    const interchange = h(
      "details",
      { class: "oba-source-interchange", "data-research-interchange": "true" },
      h("summary", {}, "Export and import"),
      h("p", { class: "oba-small" }, "Export saves a versioned file with all of your private passages and notes, only when you ask. Import previews first, adds entries the notebook does not have, and never overwrites or removes anything. Neither ever publishes research."),
      h("div", { class: "oba-toolbar" }, exportButton),
      h("div", { class: "oba-field" }, h("label", { for: "oba-research-import-file" }, "Research export file"), bundleFile),
      h("div", { class: "oba-toolbar" }, bundlePreview, bundleApply),
      bundleResult,
      bundleStatus,
    );

    renderLists();
    renderPanel();
    this.mount(
      this.shell(
        "research",
        h("section", { class: "oba-contributor-intro" }, h("p", {}, "Keep quoted passages, with where they sit in a source, apart from your own notes about them."), h("p", { class: "oba-small" }, `Private author research stored in ${loaded.file}. It never reaches the public site, and saving here changes only that file.`)),
        h(
          "div",
          { class: "oba-toolbar oba-source-filters", role: "search", "aria-label": "Search the notebook" },
          h("div", { class: "oba-field" }, h("label", { for: "oba-research-search" }, "Search the notebook"), search),
          sourceFilter,
          locatorFilter,
          h("div", { class: "oba-field" }, h("label", { for: "oba-research-concept-filter" }, "Concept"), concept),
          stateFilter,
          h("div", { class: "oba-capture-check" }, archivedToggle, h("label", { for: "oba-research-archived" }, "Show archived")),
          newButton,
        ),
        count,
        status,
        interchange,
        h(
          "div",
          { class: "oba-source-layout", id: "oba-research-lists" },
          resultsNav,
          panel,
        ),
      ),
    );
  }

  // ---- knowledge atlas

  /**
   * The private Knowledge Atlas: entries listed, searched and filtered as
   * text, an editor for one entry or relationship, and a textual explorer of
   * each entry's relationships read from its side. There is no graph drawing,
   * so the lists are the whole interface. `focus` opens one entry by id, or
   * offers to add a concept with that id when a notebook link names a concept
   * that has no entry yet.
   */
  async showAtlas(focus = "") {
    let loaded;
    try {
      loaded = await this.api.call("GET", "research/atlas");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      // A damaged atlas (or library or notebook) is reported, never replaced.
      this.mount(
        this.shell(
          "atlas",
          h("p", { class: "oba-error", role: "alert" }, `The Knowledge Atlas could not be read. ${atlasErrorMessage(error)}`),
          error.data?.file ? h("p", { class: "oba-small" }, `Repair ${error.data.file} by hand, then reload this view. Nothing was changed.`) : null,
        ),
      );
      return;
    }
    const state = applyAtlasState({}, loaded);
    const mountedView = this.viewVersion + 1;
    const filters = { query: "", kind: "" };
    let selected = null; // null, or { type: "entry" | "relationship", id: string | null, prefill }
    let form = null;
    let busy = false;
    let exploreSequence = 0;

    const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const say = (text, kind = "oba-small") => {
      status.className = kind;
      status.textContent = text;
    };
    const count = h("p", { class: "oba-small", role: "status", "aria-live": "polite", "data-atlas-count": "true" });
    const search = h("input", { id: "oba-atlas-search", type: "search", autocomplete: "off", spellcheck: "false", "aria-controls": "oba-atlas-entries", placeholder: "Label, other name, or ID" });
    const kindFilter = h(
      "select",
      { id: "oba-atlas-kind-filter", "aria-controls": "oba-atlas-entries", onChange: (event) => { filters.kind = event.target.value; renderLists(); } },
      h("option", { value: "" }, "All kinds"),
      ATLAS_ENTRY_KINDS.map((kind) => h("option", { value: kind.kind }, kind.label)),
    );
    const list = h("ul", { class: "oba-source-list", id: "oba-atlas-entries", "aria-labelledby": "oba-atlas-entries-heading" });
    const listNav = h("nav", { "aria-label": "Atlas entries" });
    const notices = h("div", { class: "oba-atlas-notices", "data-atlas-notices": "true" });
    const panel = h("section", { class: "oba-source-editor", "aria-labelledby": "oba-atlas-heading" });
    const newEntryButton = h("button", { class: "oba-btn oba-btn-primary", type: "button", "data-atlas-new": "entry", onClick: () => open({ type: "entry", id: null }) }, "New entry");
    const newRelationshipButton = h("button", { class: "oba-btn", type: "button", "data-atlas-new": "relationship", onClick: () => open({ type: "relationship", id: null }) }, "New relationship");
    const chronologyButton = h("button", { class: "oba-btn", type: "button", "data-atlas-chronology": "true", onClick: () => open({ type: "chronology", id: null }) }, "Chronology");
    const entryById = (id) => state.entries.find((entry) => entry.id === id) || null;
    const relationshipById = (id) => state.relationships.find((relationship) => relationship.id === id) || null;
    const joinCount = (id) => state.relationships.filter((relationship) => relationship.from === id || relationship.to === id).length;
    const confirmDiscard = () => !form?.isDirty() || globalThis.confirm?.("Discard the unsaved atlas change?") !== false;

    const renderNotices = () => {
      const parts = [];
      if (state.notices.length) {
        parts.push(
          h(
            "section",
            { class: "oba-notice", "aria-labelledby": "oba-atlas-notices-heading" },
            h("h2", { class: "oba-small-heading", id: "oba-atlas-notices-heading" }, "Notices"),
            h("ul", {}, state.notices.map((notice) => h("li", { "data-atlas-notice": notice.code }, `${notice.collection === "entries" ? "Entry" : "Relationship"} ${notice.id}, ${notice.field}: ${notice.message}`))),
          ),
        );
      }
      if (state.missingConcepts.length) {
        parts.push(
          h(
            "section",
            { "aria-labelledby": "oba-atlas-missing-heading" },
            h("h2", { class: "oba-small-heading", id: "oba-atlas-missing-heading" }, "Concepts your notes link to without an entry"),
            h("ul", { class: "oba-atlas-chips" }, state.missingConcepts.map((id) => h("li", {}, h("button", { class: "oba-btn", type: "button", "data-atlas-missing-concept": id, onClick: () => open({ type: "entry", id: null, prefill: { id, kind: "concept" } }) }, `Add concept ${id}`)))),
          ),
        );
      }
      notices.replaceChildren(...parts);
    };

    const renderLists = () => {
      const shown = atlasFilterEntries(state.entries, filters);
      const total = state.entries.length;
      const contested = state.relationships.filter((relationship) => relationship.contestedBy?.length).length;
      const drafts = state.relationships.filter((relationship) => relationship.unsourced).length;
      const entriesText = shown.length === total ? plural(total, "entry", "entries") : `${shown.length} of ${plural(total, "entry", "entries")} shown`;
      count.textContent = `${entriesText}, ${plural(state.relationships.length, "relationship")}${contested ? `, ${contested} contested` : ""}${drafts ? `, ${plural(drafts, "unsourced draft")}` : ""}.`;
      const row = (entry) => {
        const joins = joinCount(entry.id);
        return h(
          "li",
          {},
          h(
            "button",
            { class: "oba-source-item", type: "button", "data-atlas-entry": entry.id, "aria-current": selected?.type === "entry" && selected.id === entry.id ? "true" : null, onClick: () => open({ type: "entry", id: entry.id }) },
            h("strong", {}, entry.label),
            h("span", { class: "oba-small" }, `${atlasKindLabel(entry.kind)} · ${plural(joins, "relationship")}${entry.visibility === "approved" ? " · approved" : ""}`),
          ),
        );
      };
      list.replaceChildren(...(shown.length ? shown.map(row) : [h("li", { class: "oba-notice" }, total ? "No entries match the search and kind." : "No entries yet. Add a person, work, concept, movement or event.")]));
      listNav.replaceChildren(h("h2", { class: "oba-small-heading", id: "oba-atlas-entries-heading" }, "Entries"), list);
      newRelationshipButton.disabled = total < 2;
      renderNotices();
    };

    const onSaved = ({ type, item, build }) => {
      if (this.viewVersion !== mountedView) return;
      if (item) selected = { type, id: item.id };
      renderLists();
      renderPanel(true);
      say(`${type === "entry" ? "Entry saved to the private atlas." : "Relationship saved to the private atlas."}${atlasBuildText(build)}`, build && !build.ok ? "oba-error" : "oba-ok");
    };
    const onRefreshed = () => {
      if (this.viewVersion === mountedView) renderLists();
    };
    const heading = (text) => h("h2", { id: "oba-atlas-heading", tabindex: "-1" }, text);

    const incidentItem = (entry, incident) => {
      const relationship = incident.relationship;
      const known = typeof incident.other?.label === "string";
      const otherName = known ? incident.other.label : `${incident.other?.id} (missing)`;
      const reading = `${entry.label} ${incident.label} ${otherName}`;
      return h(
        "li",
        { class: "oba-atlas-incident", "data-atlas-incident": relationship.id, "data-standing": incident.standing },
        h("p", {}, h("strong", {}, reading), known ? h("span", { class: "oba-small" }, ` (${atlasKindLabel(incident.other.kind).toLowerCase()})`) : null),
        h(
          "ul",
          { class: "oba-atlas-facts" },
          h("li", {}, `Asserted by ${atlasAttributionText(relationship.assertedBy, state.sources)}`),
          h("li", {}, atlasConfidenceText(relationship)),
          h("li", { "data-atlas-standing": incident.standing }, atlasStandingText(relationship, state.sources)),
          h("li", {}, atlasEvidenceText(relationship)),
          relationship.uncertainty ? h("li", {}, `Uncertain: ${relationship.uncertainty}`) : null,
          h("li", {}, relationship.visibility !== "approved" ? "Private" : incident.projected ? "Approved; published with the Knowledge Atlas when the site publishes it" : "Approved, but stays private while an entry it joins is private"),
        ),
        h(
          "div",
          { class: "oba-toolbar" },
          h("button", { class: "oba-btn", type: "button", "data-atlas-open-relationship": relationship.id, "aria-label": `Edit relationship: ${reading}`, onClick: () => open({ type: "relationship", id: relationship.id }) }, "Edit relationship"),
          known ? h("button", { class: "oba-btn", type: "button", "data-atlas-go": incident.other.id, onClick: () => open({ type: "entry", id: incident.other.id }) }, `Explore ${otherName}`) : null,
        ),
      );
    };

    /** The entry's relationships read fresh from the stored atlas, outgoing then incoming, as lists. */
    const loadExplorer = async (entry, box) => {
      const sequence = ++exploreSequence;
      const title = () => h("h3", { id: "oba-atlas-explorer-heading" }, `Relationships of ${entry.label}`);
      let found;
      try {
        found = await this.api.call("POST", "research/atlas/explore", { json: { id: entry.id } });
      } catch (error) {
        if (sequence !== exploreSequence || this.viewVersion !== mountedView) return;
        box.replaceChildren(title(), h("p", { class: "oba-error", role: "alert" }, `The relationships could not be listed. ${atlasErrorMessage(error)}`));
        return;
      }
      if (sequence !== exploreSequence || this.viewVersion !== mountedView) return;
      const group = (key, name, items, empty) => {
        const id = `oba-atlas-explorer-${key}`;
        return h(
          "section",
          { "aria-labelledby": id, "data-atlas-direction": key },
          h("h4", { class: "oba-small-heading", id }, `${name} (${items.length})`),
          items.length ? h("ul", { class: "oba-atlas-incidents", "aria-labelledby": id }, items.map((incident) => incidentItem(entry, incident))) : h("p", { class: "oba-small" }, empty),
        );
      };
      const notes = found.notes || [];
      box.replaceChildren(
        title(),
        h("p", { class: "oba-small" }, "Read from this entry's side. Only relationships someone asserted are listed: nothing is inferred from dates or order, and standing records who asserts and who dissents, never how widely a claim is accepted."),
        group("outgoing", "Outgoing", found.outgoing || [], "This entry asserts nothing about another entry yet."),
        group("incoming", "Incoming", found.incoming || [], "No relationship points to this entry yet."),
        entry.kind === "concept"
          ? h(
              "section",
              { "aria-labelledby": "oba-atlas-explorer-notes", "data-atlas-notes": "true" },
              h("h4", { class: "oba-small-heading", id: "oba-atlas-explorer-notes" }, `Notebook notes linking this concept (${notes.length})`),
              notes.length ? h("ul", {}, notes.map((note) => h("li", {}, `${note.preview} (${note.kind === "question" ? "question" : "observation"}, ${note.id})`))) : h("p", { class: "oba-small" }, "No notebook note links this concept yet."),
              notes.length ? h("p", { class: "oba-small" }, h("a", { href: "#/research" }, "Open the research notebook")) : null,
            )
          : null,
      );
    };


    // ---- chronology explorer (ADR 0098): lists only, competing datings side by side, never resolved
    const chronologyFilters = { query: "", aspect: "", fromYear: "", fromEra: "bce", toYear: "", toEra: "ce", zoom: "century", competing: false, prompted: false };
    const openItem = (collection, id, focusDating = null) => open({ type: collection === "entries" ? "entry" : "relationship", id, focusDating });
    const datingPosition = (field) => {
      const found = String(field || "").match(/^dates\[(\d+)\]$/);
      return found ? Number(found[1]) : null;
    };

    const chronologyDatingItem = (dating) => {
      const record = dating.record || {};
      const confidence = ATLAS_CONFIDENCE.find((item) => item.value === (record.confidence || "tentative")) || ATLAS_CONFIDENCE[0];
      const facts = [
        `Dated by ${atlasAttributionText(record.assertedBy, state.sources)}`,
        `${confidence.label} confidence, as held by that party`,
        record.unsourced ? "Unsourced draft: no evidence cited yet" : `Rests on ${plural(Array.isArray(record.evidence) ? record.evidence.length : 0, "piece")} of evidence`,
        record.note ? `Note: ${record.note}` : null,
        atlasDatingVisibilityText(record, dating.projected),
        dating.inWindow === false ? "Outside the time window; listed because a competing dating falls inside it" : null,
        dating.prompts ? `${plural(dating.prompts, "check prompt")}: see Datings to check` : null,
      ];
      return h(
        "li",
        { class: "oba-chronology-dating", "data-chronology-dating": dating.id, "data-placement": dating.placement, "data-in-window": dating.inWindow === false ? "false" : null },
        h("p", {}, h("strong", {}, atlasChronologyReading(dating, state.entries)), h("span", { class: "oba-small" }, ` (dating ${dating.id})`)),
        h("ul", { class: "oba-atlas-facts" }, facts.filter(Boolean).map((fact) => h("li", {}, fact))),
      );
    };

    /** One dated aspect: every dating of it, side by side, with how many compete. */
    const chronologyRow = (row, { withOwner = true } = {}) => {
      const competing = row.datings.length > 1;
      const title = withOwner ? `${row.name}: ${aspectNoun(row.aspect)}` : capitalize(aspectNoun(row.aspect));
      return h(
        "li",
        { class: "oba-chronology-row", "data-chronology-row": row.key },
        h("p", { class: "oba-chronology-title" }, h("strong", {}, title)),
        h(
          "p",
          { class: "oba-small", "data-chronology-competing": String(row.datings.length) },
          competing ? `${row.datings.length} competing datings, side by side. None is preferred, and nothing here resolves them.` : "1 dating; no competing dating is recorded.",
        ),
        h("ul", { class: competing ? "oba-chronology-competing" : "oba-chronology-single", "aria-label": `Datings of the ${aspectNoun(row.aspect)} of ${row.name}` }, row.datings.map(chronologyDatingItem)),
        withOwner
          ? h("div", { class: "oba-toolbar" }, h("button", { class: "oba-btn", type: "button", "data-atlas-open-dated": row.owner, onClick: () => openItem(row.collection, row.owner, datingPosition(row.datings[0]?.field)) }, row.collection === "entries" ? `Open ${row.name}` : `Open relationship: ${row.name}`))
          : null,
      );
    };

    const chronologyPrompt = (prompt) => {
      const name = atlasOwnerName(state, prompt.collection, prompt.id);
      const first = Array.isArray(prompt.datings) ? prompt.datings[0] : "";
      return h(
        "li",
        { class: "oba-chronology-prompt", "data-chronology-prompt": prompt.code },
        h("p", {}, h("strong", {}, "Check: "), String(prompt.message || "")),
        h("button", { class: "oba-btn", type: "button", "data-atlas-check": first, onClick: () => openItem(prompt.collection, prompt.id, datingPosition(prompt.field)) }, `Check dating ${first} of ${name}`),
      );
    };

    const chronologyPrompts = (prompts, unlisted, headingId, scoped = false) =>
      h(
        "section",
        { class: "oba-chronology-prompts", "aria-labelledby": headingId, "data-chronology-prompts": "true" },
        h("h3", { class: "oba-small-heading", id: headingId }, `Datings to check (${prompts.length + unlisted})`),
        h("p", { class: "oba-small" }, "Prompts, never verdicts: each names recorded datings that cannot all hold as stated. None says which is right, and a recorded disagreement can stay side by side as it is. They never block a save."),
        prompts.length ? h("ul", { class: "oba-atlas-incidents" }, prompts.map(chronologyPrompt)) : h("p", { class: "oba-small" }, scoped ? "Nothing to check here." : "Nothing to check: no recorded datings contradict each other as stated."),
        unlisted ? h("p", { class: "oba-small" }, `${plural(unlisted, "more prompt")} not listed.`) : null,
      );

    const relativeList = (items, headingId, empty) =>
      h(
        "section",
        { "aria-labelledby": headingId, "data-chronology-relative": "true" },
        h("h3", { class: "oba-small-heading", id: headingId }, `Relative datings (${items.length})`),
        h("p", { class: "oba-small" }, "Each is one party's assertion, never inferred from absolute dates, and none makes or supports a relationship."),
        items.length
          ? h(
              "ul",
              { class: "oba-atlas-incidents" },
              items.map(({ row, dating }) => {
                const target = dating.record?.date?.relative?.entry;
                return h(
                  "li",
                  { "data-chronology-relative-dating": dating.id },
                  h("p", {}, atlasRelativeSentence(row.name, row.aspect, dating, state.entries)),
                  h("p", { class: "oba-small" }, `Dated by ${atlasAttributionText(dating.record?.assertedBy, state.sources)} (dating ${dating.id}).`),
                  h(
                    "div",
                    { class: "oba-toolbar" },
                    h("button", { class: "oba-btn", type: "button", "aria-label": `Open ${row.name} at dating ${dating.id}`, onClick: () => openItem(row.collection, row.owner, datingPosition(dating.field)) }, `Open ${row.name}`),
                    target && entryById(target) ? h("button", { class: "oba-btn", type: "button", "data-atlas-go": target, onClick: () => open({ type: "entry", id: target }) }, `Explore ${atlasEntryName(state.entries, target)}`) : null,
                  ),
                );
              }),
            )
          : h("p", { class: "oba-small" }, empty),
      );

    /** The datings of one entry or relationship, and the relative datings and prompts that concern it. */
    const ownChronology = (collection, id, name) => {
      const model = atlasChronologyModel(state, { zoom: "none" });
      const rows = model.rows.filter((row) => row.collection === collection && row.owner === id);
      const pointing = collection === "entries" ? model.rows.flatMap((row) => row.datings.filter((dating) => dating.placement === "relative" && dating.record?.date?.relative?.entry === id && row.owner !== id).map((dating) => ({ row, dating }))) : [];
      const prompts = model.prompts.filter((prompt) => prompt.collection === collection && prompt.id === id);
      const headingId = `oba-atlas-chronology-of-${collection}`;
      return h(
        "section",
        { class: "oba-atlas-explorer oba-chronology", "aria-labelledby": headingId, "data-atlas-chronology-of": id },
        h("h3", { id: headingId }, collection === "entries" ? `Chronology of ${name}` : "When this relationship held"),
        rows.length ? h("ul", { class: "oba-chronology-rows" }, rows.map((row) => chronologyRow(row, { withOwner: false }))) : h("p", { class: "oba-small" }, "No datings yet. Add one under Dates in the editor below."),
        collection === "entries" && pointing.length ? relativeList(pointing, `${headingId}-relative`, "") : null,
        prompts.length ? chronologyPrompts(prompts, 0, `${headingId}-prompts`, true) : null,
      );
    };

    const renderChronologyPanel = () => {
      const filters = chronologyFilters;
      const results = h("div", { class: "oba-chronology-results", id: "oba-chronology-results" });
      const status = h("p", { class: "oba-small", id: "oba-chronology-status", role: "status", "aria-live": "polite", "data-chronology-status": "true" });
      const aspects = [...new Set((state.kinds?.aspects || []).map((spec) => spec.aspect))];
      const control = (id, labelText, input, hint) => {
        input.id = id;
        input.setAttribute("aria-controls", "oba-chronology-results");
        if (hint) input.setAttribute("aria-describedby", `${id}-hint`);
        return h("div", { class: "oba-field" }, h("label", { for: id }, labelText), input, hint ? h("p", { class: "oba-small", id: `${id}-hint` }, hint) : null);
      };
      const era = (key) => h("select", { onChange: (event) => { filters[key] = event.target.value; renderResults(); } }, h("option", { value: "bce", selected: filters[key] === "bce" }, "BCE"), h("option", { value: "ce", selected: filters[key] === "ce" }, "CE"));
      const toggle = (id, key, labelText) => {
        const input = h("input", { id, type: "checkbox", checked: filters[key], "aria-controls": "oba-chronology-results", onChange: (event) => { filters[key] = event.target.checked; renderResults(); } });
        return h("div", { class: "oba-capture-check" }, input, h("label", { for: id }, labelText));
      };
      const renderResults = () => {
        const model = atlasChronologyModel(state, filters);
        status.textContent = atlasChronologyStatus(model, filters);
        const parts = [chronologyPrompts(model.prompts, model.unlisted, "oba-chronology-prompts-heading")];
        const rowList = (rows) => h("ol", { class: "oba-chronology-rows" }, rows.map((row) => chronologyRow(row)));
        const empty = model.total.datings ? "No dated aspect matches these filters. Clear them to see every dating." : "No datings yet. Add one under Dates when you edit an entry or relationship.";
        parts.push(
          h(
            "section",
            { "aria-labelledby": "oba-chronology-timeline-heading", "data-chronology-timeline": "true" },
            h("h3", { class: "oba-small-heading", id: "oba-chronology-timeline-heading" }, "Timeline"),
            h("p", { class: "oba-small" }, "In one display order: by the earliest day each states, an open start first. Order is for reading only; it never relates two datings or the things they date, and circa never moves a point."),
            !model.groups.length
              ? h("p", { class: "oba-notice", "data-chronology-empty": "true" }, empty)
              : model.zoom === "none"
                ? rowList(model.groups.flatMap((group) => group.rows))
                : h(
                    "ol",
                    { class: "oba-chronology-groups" },
                    model.groups.map((group, position) => {
                      const id = `oba-chronology-group-${position}`;
                      return h("li", { "aria-labelledby": id, "data-chronology-group": group.label }, h("h4", { class: "oba-small-heading", id }, `${group.label} (${plural(group.rows.length, "dated aspect")})`), rowList(group.rows));
                    }),
                  ),
          ),
        );
        if (model.unplaced.length) {
          parts.push(
            h(
              "section",
              { "aria-labelledby": "oba-chronology-unplaced-heading", "data-chronology-unplaced": "true" },
              h("h3", { class: "oba-small-heading", id: "oba-chronology-unplaced-heading" }, `Not placed in time (${model.unplaced.length})`),
              h("p", { class: "oba-small" }, "Dated only relative to another entry, or stated as unknown, so they have no position on the timeline and the time window does not filter them."),
              rowList(model.unplaced),
            ),
          );
        }
        parts.push(relativeList(model.relative, "oba-chronology-relative-heading", model.total.datings ? "No relative dating among the datings shown." : "No relative datings yet."));
        results.replaceChildren(...parts);
      };
      const query = h("input", { type: "search", autocomplete: "off", spellcheck: "false", value: filters.query, placeholder: "Label or ID", onInput: (event) => { filters.query = event.target.value; renderResults(); } });
      const fromYear = h("input", { type: "text", inputmode: "numeric", autocomplete: "off", value: filters.fromYear, onInput: (event) => { filters.fromYear = event.target.value; renderResults(); } });
      const toYear = h("input", { type: "text", inputmode: "numeric", autocomplete: "off", value: filters.toYear, onInput: (event) => { filters.toYear = event.target.value; renderResults(); } });
      const controls = h(
        "div",
        { class: "oba-chronology-filters", role: "search", "aria-label": "Filter the chronology" },
        control("oba-chronology-query", "Entry or relationship", query),
        control("oba-chronology-aspect", "Aspect", h("select", { onChange: (event) => { filters.aspect = event.target.value; renderResults(); } }, h("option", { value: "", selected: !filters.aspect }, "All aspects"), aspects.map((aspect) => h("option", { value: aspect, selected: filters.aspect === aspect }, atlasAspectLabel(aspect))))),
        h(
          "fieldset",
          { class: "oba-chronology-window" },
          h("legend", {}, "Time window"),
          h("p", { class: "oba-small", id: "oba-chronology-window-hint" }, "Whole years without a minus sign; choose BCE or CE. Leave either end empty to keep it open. A dated aspect is listed when any of its datings overlaps the window, with all its competing datings."),
          h("div", { class: "oba-toolbar" }, control("oba-chronology-from", "From year", fromYear), control("oba-chronology-from-era", "From era", era("fromEra")), control("oba-chronology-to", "To year", toYear), control("oba-chronology-to-era", "To era", era("toEra"))),
        ),
        control("oba-chronology-zoom", "Group by (zoom)", h("select", { onChange: (event) => { filters.zoom = event.target.value; renderResults(); } }, [["century", "Century"], ["decade", "Decade"], ["year", "Year"], ["none", "No grouping"]].map(([value, text]) => h("option", { value, selected: filters.zoom === value }, text))), "Groups each dated aspect under the century, decade or year its earliest dating begins in."),
        toggle("oba-chronology-competing", "competing", "Only aspects with competing datings"),
        toggle("oba-chronology-prompted", "prompted", "Only datings with a check prompt"),
        h("div", { class: "oba-toolbar" }, h("button", { class: "oba-btn", type: "button", "data-chronology-clear": "true", onClick: () => { Object.assign(filters, { query: "", aspect: "", fromYear: "", fromEra: "bce", toYear: "", toEra: "ce", zoom: "century", competing: false, prompted: false }); renderPanel(); panel.querySelector("#oba-chronology-query")?.focus(); say("Chronology filters cleared."); } }, "Clear filters")),
      );
      fromYear.setAttribute("aria-describedby", "oba-chronology-window-hint");
      toYear.setAttribute("aria-describedby", "oba-chronology-window-hint");
      renderResults();
      panel.replaceChildren(
        heading("Chronology"),
        h("p", { class: "oba-small" }, "Every dating in the private atlas, as text. Competing datings stand side by side and nothing is preferred, merged or averaged; relative and unknown datings are kept. Only you see this view."),
        controls,
        status,
        results,
      );
    };

    const renderEntryPanel = () => {
      const entry = selected.id ? entryById(selected.id) : null;
      if (selected.id && !entry) {
        selected = null;
        renderPanel();
        return;
      }
      form = createAtlasForm({ api: this.api, state, type: "entry", item: entry, prefill: selected.prefill || {}, idPrefix: "oba-atlas-entry", onSaved, onRefreshed, onCancel: () => close() });
      if (!entry) {
        const concept = selected.prefill?.kind === "concept" && selected.prefill?.id;
        panel.replaceChildren(
          heading(concept ? `New concept ${selected.prefill.id}` : "New entry"),
          h("p", { class: "oba-small" }, concept ? "Notebook notes that link this concept resolve to it once it is saved." : "Private; never published unless you approve it and the site publishes its Knowledge Atlas."),
          form.element,
        );
        return;
      }
      const joins = joinCount(entry.id);
      const explorer = h("section", { class: "oba-atlas-explorer", "aria-labelledby": "oba-atlas-explorer-heading", "data-atlas-explorer": entry.id }, h("h3", { id: "oba-atlas-explorer-heading" }, `Relationships of ${entry.label}`), h("p", { class: "oba-small" }, "Loading relationships…"));
      const lonely = state.entries.length < 2;
      panel.replaceChildren(
        heading(entry.label),
        h("p", { class: "oba-small" }, `${atlasKindLabel(entry.kind)} · ID ${entry.id} · ${entry.visibility === "approved" ? "approved for the publication projection" : "private"}`),
        entry.aliases?.length ? h("p", { class: "oba-small" }, `Also called: ${entry.aliases.join("; ")}`) : null,
        h(
          "div",
          { class: "oba-toolbar" },
          h("button", { class: "oba-btn", type: "button", "data-atlas-relate": "from", disabled: lonely, onClick: () => open({ type: "relationship", id: null, prefill: { from: entry.id } }) }, "Add a relationship from this entry"),
          h("button", { class: "oba-btn", type: "button", "data-atlas-relate": "to", disabled: lonely, onClick: () => open({ type: "relationship", id: null, prefill: { to: entry.id } }) }, "Add a relationship to this entry"),
        ),
        explorer,
        ownChronology("entries", entry.id, entry.label),
        h("section", { class: "oba-atlas-edit", "aria-labelledby": "oba-atlas-edit-heading" }, h("h3", { id: "oba-atlas-edit-heading" }, "Edit entry"), form.element),
        joins ? h("p", { class: "oba-small" }, `${plural(joins, "relationship")} ${joins === 1 ? "joins" : "join"} this entry, so it cannot be removed until ${joins === 1 ? "it is" : "they are"} removed.`) : null,
        h("div", { class: "oba-toolbar" }, h("button", { class: "oba-btn oba-btn-danger", type: "button", "data-atlas-remove": "entry", onClick: () => remove() }, "Remove entry")),
      );
      loadExplorer(entry, explorer);
    };

    const renderRelationshipPanel = () => {
      const relationship = selected.id ? relationshipById(selected.id) : null;
      if (selected.id && !relationship) {
        selected = null;
        renderPanel();
        return;
      }
      form = createAtlasForm({ api: this.api, state, type: "relationship", item: relationship, prefill: selected.prefill || {}, idPrefix: "oba-atlas-relationship", onSaved, onRefreshed, onCancel: () => close() });
      const ends = relationship ? [...new Set([relationship.from, relationship.to])] : [];
      panel.replaceChildren(
        heading(relationship ? "Relationship" : "New relationship"),
        relationship ? h("p", { "data-atlas-sentence": "true" }, atlasRelationshipSentence(relationship, state.entries)) : null,
        relationship
          ? h("p", { class: "oba-small", "data-atlas-standing": relationship.contestedBy?.length ? "contested" : "asserted" }, `${atlasStandingText(relationship, state.sources)}. ${atlasConfidenceText(relationship)}. ${atlasEvidenceText(relationship)}. ID ${relationship.id}.`)
          : h("p", { class: "oba-small" }, "Choose the kind first: it decides which entries may stand at each end. A relationship is one party's claim on cited evidence."),
        ends.length ? h("div", { class: "oba-toolbar" }, ends.map((id) => (entryById(id) ? h("button", { class: "oba-btn", type: "button", "data-atlas-go": id, onClick: () => open({ type: "entry", id }) }, `Explore ${atlasEntryName(state.entries, id)}`) : null))) : null,
        relationship ? ownChronology("relationships", relationship.id, atlasRelationshipSentence(relationship, state.entries)) : null,
        form.element,
        relationship ? h("div", { class: "oba-toolbar" }, h("button", { class: "oba-btn oba-btn-danger", type: "button", "data-atlas-remove": "relationship", onClick: () => remove() }, "Remove relationship")) : null,
      );
    };

    const renderPanel = (moveFocus = false) => {
      form = null;
      if (!selected) {
        panel.replaceChildren(
          heading("Knowledge Atlas"),
          h("p", { class: "oba-notice" }, state.entries.length ? "Choose an entry to see its relationships and chronology and edit it, or add a new one. Chronology lists every dating as text." : "Add your first entry: a person, work, concept, movement or event."),
        );
      } else if (selected.type === "chronology") renderChronologyPanel();
      else if (selected.type === "entry") renderEntryPanel();
      else renderRelationshipPanel();
      if (moveFocus) {
        // A check prompt's link lands on the dating it names; anything else lands on the heading.
        const dating = Number.isInteger(selected?.focusDating) && form?.focusDating(selected.focusDating);
        if (!dating) panel.querySelector("#oba-atlas-heading")?.focus();
      }
    };

    const open = (target) => {
      if (!confirmDiscard()) return;
      selected = target;
      say("");
      renderLists();
      renderPanel(true);
    };
    const close = () => {
      if (!confirmDiscard()) return;
      selected = null;
      renderLists();
      renderPanel();
      newEntryButton.focus();
    };

    const remove = async () => {
      if (busy || !selected?.id) return;
      const isEntry = selected.type === "entry";
      if (globalThis.confirm?.(`Remove this ${isEntry ? "entry" : "relationship"}? It is deleted from the private atlas.`) === false) return;
      busy = true;
      try {
        const result = await this.api.call("DELETE", isEntry ? "research/atlas/entries" : "research/atlas/relationships", { json: { revision: state.revision, id: selected.id } });
        if (this.viewVersion !== mountedView) return;
        applyAtlasState(state, result);
        selected = null;
        renderLists();
        renderPanel();
        const unresolved = Array.isArray(result.unresolvedNotes) ? result.unresolvedNotes : [];
        say(
          `Removed from the private atlas.${unresolved.length ? ` ${plural(unresolved.length, "notebook note")} now ${unresolved.length === 1 ? "links" : "link"} to a concept with no entry (${unresolved.join(", ")}). Adding the concept again resolves ${unresolved.length === 1 ? "it" : "them"}.` : ""}${atlasBuildText(result.build)}`,
          result.build && !result.build.ok ? "oba-error" : "oba-ok",
        );
        newEntryButton.focus();
      } catch (error) {
        if (this.viewVersion !== mountedView) return;
        say(error.status === 409 ? "Not removed: the atlas changed elsewhere. Reload this view and try again." : `Not removed. ${atlasErrorMessage(error)} The stored atlas is unchanged.`, "oba-error");
      } finally {
        busy = false;
      }
    };

    search.addEventListener("input", () => {
      filters.query = search.value;
      renderLists();
    });

    if (focus) {
      if (entryById(focus)) selected = { type: "entry", id: focus };
      else if (validAtlasId(focus)) {
        selected = { type: "entry", id: null, prefill: { id: focus, kind: "concept" } };
        say(`No entry has the identifier ${focus} yet. Add it as a concept so the notebook notes that link it resolve.`);
      }
    }
    renderLists();
    renderPanel();
    this.mount(
      this.shell(
        "atlas",
        h("section", { class: "oba-contributor-intro" }, h("p", {}, "Map the people, works, concepts, movements and events you research, and who asserts what about them, on which evidence and with what doubt."), h("p", { class: "oba-small" }, `Private author research stored in ${state.file}. It never reaches the public site, and saving here changes only that file.`)),
        h(
          "div",
          { class: "oba-toolbar oba-source-filters", role: "search", "aria-label": "Find atlas entries" },
          h("div", { class: "oba-field" }, h("label", { for: "oba-atlas-search" }, "Search entries"), search),
          h("div", { class: "oba-field" }, h("label", { for: "oba-atlas-kind-filter" }, "Kind"), kindFilter),
          newEntryButton,
          newRelationshipButton,
          chronologyButton,
        ),
        count,
        status,
        notices,
        h("div", { class: "oba-source-layout", id: "oba-atlas-lists" }, listNav, panel),
      ),
    );
    if (selected) panel.querySelector("#oba-atlas-heading")?.focus();
  }

  // ---- comparison workspace

  async showCompare(focus = "") {
    let loaded;
    try {
      loaded = await this.api.call("GET", "research/alignments");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      // A damaged alignments file (or library or notebook) is reported, never replaced.
      this.mount(
        this.shell(
          "compare",
          h("p", { class: "oba-error", role: "alert" }, `The alignments could not be read. ${alignmentErrorMessage(error)}`),
          error.data?.file ? h("p", { class: "oba-small" }, `Repair ${error.data.file} by hand, then reload this view. Nothing was changed.`) : null,
        ),
      );
      return;
    }
    const state = applyAlignmentState({}, loaded);
    const mountedView = this.viewVersion + 1;
    // How the comparison reads; kept for this visit only, so nothing is written to the browser.
    const options = { layout: "columns", normalized: false, notes: false, version: "" };
    let selected = null; // null, or { id: string | null, editing: boolean }
    let form = null;
    let busy = false;
    let chosen = new Set(); // member indexes chosen for copying, never preselected
    let rightsConfirmed = false;

    const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const undoBox = h("div", { class: "oba-toolbar", "data-compare-undo": "true", hidden: true });
    const say = (text, kind = "oba-small") => {
      status.className = kind;
      status.textContent = text;
    };
    const count = h("p", { class: "oba-small", role: "status", "aria-live": "polite", "data-compare-count": "true" });
    const versionFilter = h("select", { id: "oba-compare-version-filter", "aria-controls": "oba-compare-alignments", onChange: (event) => { options.version = event.target.value; renderLists(); } });
    const layoutRadio = (value, label) => {
      const id = `oba-compare-layout-${value}`;
      return h("div", { class: "oba-capture-check" }, h("input", { id, type: "radio", name: "oba-compare-layout", value, checked: options.layout === value, onChange: () => { options.layout = value; renderComparison(); say(value === "columns" ? "Showing versions side by side. On a narrow screen they follow one another in the same order." : "Showing versions in a single column, one after another."); } }), h("label", { for: id }, label));
    };
    const layoutControls = h("fieldset", { class: "oba-compare-layout-choice", "data-compare-layout-choice": "true" }, h("legend", {}, "Layout"), layoutRadio("columns", "Side by side"), layoutRadio("sequence", "Single column"));
    const normalizedToggle = h("div", { class: "oba-capture-check" }, h("input", { id: "oba-compare-normalized", type: "checkbox", "aria-describedby": "oba-compare-normalized-hint", onChange: (event) => { options.normalized = event.target.checked; renderComparison(); } }), h("label", { for: "oba-compare-normalized" }, "Show the author's normalizations"));
    const list = h("ul", { class: "oba-source-list", id: "oba-compare-alignments", "aria-labelledby": "oba-compare-alignments-heading" });
    const listNav = h("nav", { "aria-label": "Alignments" });
    const notices = h("div", { class: "oba-atlas-notices", "data-compare-notices": "true" });
    const panel = h("section", { class: "oba-source-editor oba-compare-panel", "aria-labelledby": "oba-compare-heading" });
    const comparisonBox = h("div", { class: "oba-compare-body" });
    const exportBox = h("section", { class: "oba-compare-export", "aria-labelledby": "oba-compare-export-heading", "data-compare-export": "true" });
    const newButton = h("button", { class: "oba-btn oba-btn-primary", type: "button", "data-compare-new": "true", onClick: () => open({ id: null, editing: true }) }, "New alignment");
    const alignmentById = (id) => state.alignments.find((alignment) => alignment.id === id) || null;
    const sourceById = (id) => state.sources.find((source) => source.id === id) || null;
    const confirmDiscard = () => !form?.isDirty() || globalThis.confirm?.("Discard the unsaved alignment change?") !== false;
    const heading = (text) => h("h2", { id: "oba-compare-heading", tabindex: "-1" }, h("bdi", {}, text));
    const nameOf = (alignment) => alignment.label || `Alignment ${alignment.id}`;
    const versionKey = (member) => (typeof member.interpretation === "string" ? `interpretation:${member.interpretation}` : `source:${member.source}`);
    const parts = (items) => items.map((part) => (typeof part === "string" ? part : h("bdi", {}, part.text)));

    const renderNotices = () => {
      notices.replaceChildren(
        ...(state.notices.length
          ? [
              h(
                "section",
                { class: "oba-notice", "aria-labelledby": "oba-compare-notices-heading" },
                h("h2", { class: "oba-small-heading", id: "oba-compare-notices-heading" }, "Places to check"),
                h("ul", {}, state.notices.map((notice) => h("li", {}, `Alignment ${notice.id}, ${notice.field}: ${notice.message}`))),
              ),
            ]
          : []),
      );
    };

    const renderFilter = () => {
      const keys = [];
      for (const alignment of state.alignments) for (const member of alignment.members || []) if (!keys.includes(versionKey(member))) keys.push(versionKey(member));
      if (options.version && !keys.includes(options.version)) options.version = "";
      const label = (key) => {
        const [type, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
        if (type === "interpretation") return `Interpretation ${id}`;
        const source = sourceById(id);
        return source ? `${sourceLabel(source)} (${source.kind})` : `${id} (missing)`;
      };
      versionFilter.replaceChildren(h("option", { value: "", selected: !options.version }, "All versions"), keys.map((key) => h("option", { value: key, selected: options.version === key }, label(key))));
    };

    const renderLists = () => {
      renderFilter();
      const shown = state.alignments.filter((alignment) => !options.version || (alignment.members || []).some((member) => versionKey(member) === options.version));
      const total = state.alignments.length;
      count.textContent = shown.length === total ? `${plural(total, "alignment")}.` : `${shown.length} of ${plural(total, "alignment")} shown.`;
      const row = (alignment) => {
        const versions = new Set((alignment.members || []).map(versionKey)).size;
        const absent = (alignment.members || []).filter((member) => member.absent).length;
        return h(
          "li",
          {},
          h(
            "button",
            { class: "oba-source-item", type: "button", "data-compare-alignment": alignment.id, "aria-current": selected?.id === alignment.id ? "true" : null, onClick: () => open({ id: alignment.id, editing: false }) },
            h("strong", {}, h("bdi", {}, nameOf(alignment))),
            h("span", { class: "oba-small" }, `${plural(versions, "version")}${absent ? `, ${absent} absent` : ""} · ${correspondenceLabel(state, alignment.correspondence).replace(/^The author reads these places as /, "")}`),
          ),
        );
      };
      list.replaceChildren(...(shown.length ? shown.map(row) : [h("li", { class: "oba-notice" }, total ? "No alignment includes this version." : "No alignments yet. Add one to compare a passage across versions.")]));
      listNav.replaceChildren(h("h2", { class: "oba-small-heading", id: "oba-compare-alignments-heading" }, "Alignments"), list);
      renderNotices();
    };

    const fact = (label, value) => [h("dt", {}, label), h("dd", {}, parts(value))];

    const placeItem = (column, place) => {
      const base = `oba-compare-place-${place.index}`;
      const fromInterpretation = column.type === "interpretation";
      return h(
        "li",
        { class: "oba-compare-place", "data-compare-place": String(place.index), "data-compare-absent": place.absent ? "true" : null },
        h("p", { class: "oba-compare-ident", id: `${base}-ident`, "data-compare-ident": "true" }, h("bdi", {}, column.title), ` · ${column.kindText}`, column.maker ? [" · ", h("bdi", {}, column.maker)] : null, " · Locator: ", h("bdi", {}, place.locator || "none recorded")),
        place.absent
          ? h("p", { class: "oba-compare-absent", "data-compare-absent-text": "true" }, h("strong", {}, "Absent:"), " this version lacks the passage.")
          : place.original
            ? [
                h("p", { class: "oba-compare-label", id: `${base}-original` }, fromInterpretation ? `Wording of ${place.original.from}, exactly as recorded` : `Original wording, quoted exactly from ${place.original.from}`),
                h("blockquote", { class: "oba-compare-original", lang: place.original.language || null, dir: textDirection(place.original.language), "data-compare-original": "true" }, place.original.text),
              ]
            : h("p", { class: "oba-small" }, place.missingPassage ? "The notebook passage this place names is missing." : "No wording quoted for this place; it is located only."),
        place.normalized && options.normalized
          ? [
              h("p", { class: "oba-compare-label", id: `${base}-normalized` }, "The author's normalization, not the source text"),
              h("blockquote", { class: "oba-compare-normalized", lang: place.normalized.language || null, dir: textDirection(place.normalized.language), "data-compare-normalized": "true" }, place.normalized.text),
              place.normalized.note ? h("p", { class: "oba-small" }, "Normalized: ", h("bdi", {}, place.normalized.note)) : null,
            ]
          : place.normalized
            ? h("p", { class: "oba-small" }, "A normalization is recorded. Turn on “Show the author's normalizations” to read it.")
            : null,
        place.note ? h("p", { class: "oba-small" }, "Author's note: ", h("bdi", {}, place.note)) : null,
        (() => {
          const statuses = selected?.id ? state.publication?.places?.[selected.id] : null;
          const line = publicPlaceText(Array.isArray(statuses) ? statuses[place.index] : "", state.publication?.maxExcerptChars);
          return line ? h("p", { class: "oba-small", "data-compare-public": statuses[place.index] }, line) : null;
        })(),
        place.notices.map((message) => h("p", { class: "oba-notice", "data-compare-place-notice": "true" }, `Check this place: ${message}`)),
        h(
          "div",
          { class: "oba-capture-check" },
          h("input", {
            id: `oba-compare-select-${place.index}`,
            type: "checkbox",
            checked: chosen.has(place.index),
            "aria-describedby": `${base}-ident`,
            "data-compare-select": String(place.index),
            onChange: (event) => {
              if (event.target.checked) chosen.add(place.index);
              else chosen.delete(place.index);
              rightsConfirmed = false;
              renderExport();
            },
          }),
          h("label", { for: `oba-compare-select-${place.index}` }, `Select place ${place.index + 1} for copying`),
        ),
      );
    };

    const versionSection = (column, position) => {
      const id = `oba-compare-version-${position}`;
      return h(
        "section",
        { class: "oba-compare-version", "aria-labelledby": id, "data-compare-version": column.key, "data-compare-missing": column.missing ? "true" : null },
        h("h4", { id }, h("bdi", {}, column.title)),
        column.maker ? h("p", { class: "oba-compare-maker", "data-compare-maker": "true" }, h("bdi", {}, column.maker)) : null,
        h(
          "dl",
          { class: "oba-compare-facts" },
          fact("Kind", [column.kindText]),
          column.facts.flatMap((item) => fact(item.label, item.parts)),
          h("dt", {}, "Rights"),
          h("dd", { "data-compare-rights": column.rights.status }, h("bdi", {}, rightsText(column.rights))),
        ),
        h("ol", { class: "oba-compare-places", "aria-label": `Places in ${column.title}` }, column.places.map((place) => placeItem(column, place))),
      );
    };

    const columnsOf = (alignment) => comparisonColumns(alignment, state);

    const renderComparison = () => {
      const alignment = selected?.id && !selected.editing ? alignmentById(selected.id) : null;
      if (!alignment) return;
      const columns = columnsOf(alignment);
      comparisonBox.replaceChildren(
        options.layout === "sequence"
          ? h("ol", { class: "oba-compare-sequence", "data-compare-layout": "sequence" }, columns.map((column, position) => h("li", {}, versionSection(column, position))))
          : h("div", { class: "oba-compare-columns", "data-compare-layout": "columns" }, columns.map(versionSection)),
      );
    };

    const exportError = h("p", { class: "oba-error", id: "oba-compare-export-error", role: "alert", hidden: true, tabindex: "-1" });
    const exportProblem = (message, target) => {
      exportError.hidden = false;
      exportError.textContent = message;
      (target || exportError).focus();
    };

    const renderExport = () => {
      const alignment = selected?.id ? alignmentById(selected.id) : null;
      if (!alignment) return;
      const columns = columnsOf(alignment);
      const places = columns.flatMap((column) => column.places);
      chosen = new Set([...chosen].filter((index) => places.some((place) => place.index === index)));
      const toConfirm = rightsToConfirm(columns, chosen);
      const picked = columns.filter((column) => column.places.some((place) => chosen.has(place.index)));
      exportError.hidden = true;
      const selectAll = h("button", { class: "oba-btn", type: "button", "data-compare-select-all": "true", onClick: () => { chosen = new Set(places.map((place) => place.index)); rightsConfirmed = false; renderComparison(); renderExport(); exportBox.querySelector("[data-compare-select-all]")?.focus(); } }, "Select every place");
      const clear = h("button", { class: "oba-btn", type: "button", "data-compare-clear": "true", onClick: () => { chosen = new Set(); rightsConfirmed = false; renderComparison(); renderExport(); exportBox.querySelector("[data-compare-clear]")?.focus(); } }, "Clear the selection");
      const confirmBox = toConfirm.length
        ? h("input", { id: "oba-compare-confirm-rights", type: "checkbox", checked: rightsConfirmed, "aria-describedby": "oba-compare-rights-heading", onChange: (event) => { rightsConfirmed = event.target.checked; } })
        : null;
      const fallback = h("div", { "data-compare-fallback": "true", hidden: true });
      const textOf = () => comparisonExportText(alignment, columns, chosen, { normalized: options.normalized, notes: options.notes, correspondence: correspondenceLabel(state, alignment.correspondence), notice: state.notice });
      const ready = () => {
        if (!chosen.size) {
          exportProblem("Select at least one place first. Nothing was copied.", selectAll);
          return false;
        }
        if (toConfirm.length && !rightsConfirmed) {
          exportProblem("Confirm that you have read the rights statements first. Nothing was copied.", confirmBox);
          return false;
        }
        exportError.hidden = true;
        return true;
      };
      const copied = `${plural(chosen.size, "place")} with ${chosen.size === 1 ? "its" : "their"} version, maker, locator and rights statement`;
      const copy = async () => {
        if (!ready()) return;
        const text = textOf();
        try {
          if (!globalThis.navigator?.clipboard?.writeText) throw new Error("no clipboard");
          await globalThis.navigator.clipboard.writeText(text);
          say(`Copied ${copied}.`, "oba-ok");
        } catch {
          // The browser refused: show the text to copy by hand instead of losing it.
          const area = h("textarea", { id: "oba-compare-export-text", rows: 8, readonly: true, value: text, dir: "auto" });
          fallback.replaceChildren(h("label", { for: "oba-compare-export-text" }, "Selected places as text"), area);
          fallback.hidden = false;
          say("Your browser did not allow copying. The text is below: select it and copy it yourself.", "oba-error");
          area.focus();
        }
      };
      const download = () => {
        if (!ready()) return;
        let url = "";
        try {
          url = URL.createObjectURL(new Blob([textOf()], { type: "text/plain;charset=utf-8" }));
        } catch {
          exportProblem("This browser could not prepare a download. Use Copy instead. Nothing was saved.");
          return;
        }
        const link = h("a", { href: url, download: `alignment-${alignment.id}.txt`, hidden: true }, "Download");
        exportBox.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        say(`Downloaded ${copied}.`, "oba-ok");
      };
      exportBox.replaceChildren(
        h("h3", { id: "oba-compare-export-heading" }, "Copy or export"),
        h("p", { class: "oba-small" }, "Only the places you select are copied, each with its version, maker, locator and rights statement. The text is your private research; copying publishes nothing."),
        h("p", { class: "oba-small", role: "status", "aria-live": "polite", "data-compare-selection": "true" }, chosen.size ? `${plural(chosen.size, "place")} selected.` : "No places selected."),
        h("div", { class: "oba-toolbar" }, selectAll, clear),
        picked.length
          ? h(
              "section",
              { "aria-labelledby": "oba-compare-rights-heading", "data-compare-rights-summary": "true" },
              h("h4", { id: "oba-compare-rights-heading" }, "Rights statements for the selected places"),
              h("ul", {}, picked.map((column) => h("li", { "data-compare-rights-item": column.rights.status }, h("bdi", {}, column.title), ": ", h("bdi", {}, rightsText(column.rights))))),
              h("p", { class: "oba-small" }, "These are the author's own statements, not permission. open.blog does not decide what you may copy."),
            )
          : null,
        h(
          "div",
          { "data-compare-include-notes": "true" },
          h(
            "div",
            { class: "oba-capture-check" },
            h("input", { id: "oba-compare-include-notes", type: "checkbox", checked: options.notes, "aria-describedby": "oba-compare-include-notes-hint", onChange: (event) => { options.notes = event.target.checked; } }),
            h("label", { for: "oba-compare-include-notes" }, "Include my notes on places"),
          ),
          h("p", { class: "oba-small", id: "oba-compare-include-notes-hint" }, "Your notes on places are private research, so they are left out unless you tick this."),
        ),
        confirmBox
          ? h("div", { class: "oba-capture-check", "data-compare-confirm": "true" }, confirmBox, h("label", { for: "oba-compare-confirm-rights" }, `I have read the rights statements. ${toConfirm.length === 1 ? "One version's rights are" : "Some versions' rights are"} not checked or reserved, and copying is my decision.`))
          : null,
        exportError,
        h(
          "div",
          { class: "oba-toolbar" },
          h("button", { class: "oba-btn oba-btn-primary", type: "button", "data-compare-copy": "true", onClick: copy }, "Copy selected places"),
          h("button", { class: "oba-btn", type: "button", "data-compare-download": "true", onClick: download }, "Download selected places"),
        ),
        fallback,
      );
    };

    const onSaved = ({ item, build }) => {
      if (this.viewVersion !== mountedView) return;
      if (item) selected = { id: item.id, editing: false };
      // Places may have moved or gone, so a selection made before the edit is not carried over.
      chosen = new Set();
      rightsConfirmed = false;
      renderLists();
      renderPanel(true);
      say(`Alignment saved to the private alignments file.${comparisonBuildText(build)}`, build && !build.ok ? "oba-error" : "oba-ok");
    };
    const onRefreshed = () => {
      if (this.viewVersion === mountedView) renderLists();
    };

    const publicationStatus = (alignment) => {
      const publication = state.publication || {};
      const url = `${publication.url || "/comparisons/"}${alignment.id}/`;
      if (alignment.visibility !== "approved") {
        return h("p", { class: "oba-small", "data-compare-publication": "private" }, "Private: not published. Approve it in Edit alignment to publish it; each place below says what a public page would show.");
      }
      if (!publication.publish) {
        return h("p", { class: "oba-small", "data-compare-publication": "approved" }, "Approved for publication, but this site does not publish comparisons: nothing is public until comparisons.publish is turned on in openblog.json.");
      }
      return h("p", { class: "oba-small", "data-compare-publication": "published" }, "Approved and published at ", h("a", { href: url }, url), ". Rights statements are your own declarations.");
    };

    const renderAlignment = (alignment) => {
      const versions = new Set((alignment.members || []).map(versionKey)).size;
      const confidence = ATLAS_CONFIDENCE.find((item) => item.value === alignment.confidence)?.label || "Tentative";
      renderComparison();
      renderExport();
      panel.replaceChildren(
        heading(nameOf(alignment)),
        h("p", { "data-compare-correspondence": alignment.correspondence || "corresponding" }, correspondenceLabel(state, alignment.correspondence), "."),
        h("p", { class: "oba-small" }, `${plural(versions, "version")} · ${confidence} confidence · Recorded by `, h("bdi", {}, atlasAttributionText(alignment.recordedBy, state.sources)), ` · ID ${alignment.id}`),
        alignment.rationale ? h("p", {}, "Why: ", h("bdi", {}, alignment.rationale)) : null,
        alignment.uncertainty ? h("p", {}, "Uncertain: ", h("bdi", {}, alignment.uncertainty)) : null,
        h("p", { class: "oba-notice", "data-compare-notice": "true" }, state.notice),
        publicationStatus(alignment),
        h(
          "div",
          { class: "oba-toolbar" },
          h("button", { class: "oba-btn", type: "button", "data-compare-edit": "true", onClick: () => open({ id: alignment.id, editing: true }) }, "Edit alignment"),
          h("button", { class: "oba-btn oba-btn-danger", type: "button", "data-compare-remove": "true", onClick: () => remove() }, "Remove alignment"),
        ),
        h("section", { class: "oba-compare-comparison", "aria-labelledby": "oba-compare-comparison-heading" }, h("h3", { id: "oba-compare-comparison-heading" }, "Comparison"), comparisonBox),
        exportBox,
      );
    };

    const renderPanel = (moveFocus = false) => {
      form = null;
      const alignment = selected?.id ? alignmentById(selected.id) : null;
      if (selected?.id && !alignment) selected = null;
      if (!selected) {
        panel.replaceChildren(
          heading("Compare versions"),
          h("p", { class: "oba-notice" }, state.alignments.length ? "Choose an alignment to read its places side by side, or add a new one." : "Add your first alignment: the places in two or more versions that you read as corresponding."),
          h("p", { class: "oba-small" }, state.notice),
        );
      } else if (selected.editing) {
        form = createAlignmentForm({ api: this.api, state, item: alignment, idPrefix: "oba-alignment", onSaved, onRefreshed, onCancel: () => (alignment ? open({ id: alignment.id, editing: false }) : close()) });
        panel.replaceChildren(
          heading(alignment ? `Edit ${nameOf(alignment)}` : "New alignment"),
          h("p", { class: "oba-small" }, "Private unless you approve it for publication below. Aligning places records where you read them as corresponding, never that they mean the same thing."),
          form.element,
        );
      } else renderAlignment(alignment);
      if (moveFocus) panel.querySelector("#oba-compare-heading")?.focus();
    };

    const open = (target) => {
      if (!confirmDiscard()) return;
      if (target.id !== selected?.id) {
        chosen = new Set();
        rightsConfirmed = false;
      }
      selected = target;
      say("");
      undoBox.hidden = true;
      renderLists();
      renderPanel(true);
    };
    const close = () => {
      if (!confirmDiscard()) return;
      selected = null;
      renderLists();
      renderPanel();
      newButton.focus();
    };

    const remove = async () => {
      if (busy || !selected?.id) return;
      if (globalThis.confirm?.("Remove this alignment? It is deleted from the private alignments file.") === false) return;
      busy = true;
      try {
        const result = await this.api.call("DELETE", "research/alignments", { json: { revision: state.revision, id: selected.id } });
        if (this.viewVersion !== mountedView) return;
        applyAlignmentState(state, result);
        selected = null;
        chosen = new Set();
        renderLists();
        renderPanel();
        say(`Removed from the private alignments file.${comparisonBuildText(result.build)}`, result.build && !result.build.ok ? "oba-error" : "oba-ok");
        const removed = result.removed;
        if (removed) {
          undoBox.replaceChildren(h("button", { class: "oba-btn", type: "button", "data-compare-undo-remove": removed.id, onClick: () => undo(removed) }, `Undo removing ${nameOf(removed)}`));
          undoBox.hidden = false;
          undoBox.querySelector("button")?.focus();
        } else newButton.focus();
      } catch (error) {
        if (this.viewVersion !== mountedView) return;
        say(error.status === 409 ? "Not removed: the alignments changed elsewhere. Reload this view and try again." : `Not removed. ${alignmentErrorMessage(error)} The stored alignments are unchanged.`, "oba-error");
      } finally {
        busy = false;
      }
    };

    const undo = async (removed) => {
      if (busy) return;
      busy = true;
      try {
        const result = await this.api.call("POST", "research/alignments", { json: { revision: state.revision, alignment: removed } });
        if (this.viewVersion !== mountedView) return;
        applyAlignmentState(state, result);
        undoBox.hidden = true;
        selected = { id: removed.id, editing: false };
        renderLists();
        renderPanel(true);
        say("The alignment is back.", "oba-ok");
      } catch (error) {
        if (this.viewVersion !== mountedView) return;
        say(`Not restored. ${alignmentErrorMessage(error)} The stored alignments are unchanged.`, "oba-error");
      } finally {
        busy = false;
      }
    };

    if (focus && alignmentById(focus)) selected = { id: focus, editing: false };
    renderLists();
    renderPanel();
    this.mount(
      this.shell(
        "compare",
        h("section", { class: "oba-contributor-intro" }, h("p", {}, "Read the places you aligned across editions, translations, witnesses and interpretations, side by side or one after another, with who made each version and what you know of its rights."), h("p", { class: "oba-small" }, `Private author research stored in ${state.file}. It never reaches the public site, and saving here changes only that file.`)),
        h(
          "div",
          { class: "oba-toolbar oba-source-filters oba-compare-controls" },
          h("div", { class: "oba-field" }, h("label", { for: "oba-compare-version-filter" }, "Show alignments with"), versionFilter),
          layoutControls,
          h("div", { class: "oba-field" }, normalizedToggle, h("p", { class: "oba-small", id: "oba-compare-normalized-hint" }, "Shown under the original, labelled. The original wording is always shown.")),
          newButton,
        ),
        count,
        status,
        undoBox,
        notices,
        h("div", { class: "oba-source-layout", id: "oba-compare-lists" }, listNav, panel),
      ),
    );
    if (selected) panel.querySelector("#oba-compare-heading")?.focus();
  }

  // ---- shared reflections

  async showSharedReflections(notice = "") {
    const { publications = [] } = await this.api.call("GET", "collaboration/publications");
    const kindLabel = (value) => SHARED_SOURCE_KINDS.find((kind) => kind.value === value)?.label || "Other";
    const status = h("p", { class: notice ? "oba-ok" : "oba-small", role: "status", "aria-live": "polite" }, notice);
    const cards = publications.map((publication, index) => {
      const heading = `oba-shared-${index}-heading`;
      return h(
        "section",
        { class: "oba-contributor-card oba-shared-card", "aria-labelledby": heading },
        h("p", { class: "oba-eyebrow" }, "Private draft"),
        h("h2", { id: heading }, publication.title || publication.guidingQuestion),
        publication.title && publication.guidingQuestion ? h("p", { class: "oba-shared-question" }, publication.guidingQuestion) : null,
        h(
          "ol",
          { class: "oba-shared-sources", "aria-label": "Sources" },
          (publication.sources || []).map((source) => {
            const href = sharedSourceHref(source.url);
            const details = [source.creator, source.publisher, source.published].filter(Boolean).join(" · ");
            return h(
              "li",
              {},
              h("span", { class: "oba-badge" }, kindLabel(source.kind)),
              " ",
              href ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, source.title) : source.title,
              details ? h("small", { class: "oba-small" }, ` ${details}`) : null,
            );
          }),
        ),
        this.draftPanel(publication, index),
        this.seriesPanel(publication, index),
        this.invitationPanel(publication, index),
      );
    });
    this.mount(
      this.shell(
        "shared",
        h(
          "section",
          { class: "oba-contributor-intro" },
          h("p", {}, "A shared reflection starts from something you watched, read, or heard. Each writer will answer in their own words before anything is combined."),
          h("p", { class: "oba-small" }, "Shared reflections are kept in private server files, never in your posts. Nothing is published from here, and only the people taking part can see each one."),
        ),
        h("div", { class: "oba-toolbar" }, h("a", { class: "oba-btn oba-btn-primary", href: "#/shared/new" }, "Start a shared reflection")),
        status,
        cards.length
          ? h("div", { class: "oba-contributor-grid" }, cards)
          : h("p", { class: "oba-notice" }, "You are not part of any shared reflection yet."),
      ),
    );
  }

  async showSharedReflectionForm() {
    const registry = await this.api.call("GET", "contributors");
    const contributors = Object.entries(registry.contributors || {});
    const sources = [emptySharedSource()];
    const status = h("p", { class: "oba-error", role: "alert", tabindex: "-1", hidden: true });
    const sourceList = h("div", { class: "oba-shared-source-list" });
    const markDirty = () => (this.dirty = true);

    const field = (id, label, control, help = "") => {
      control.id = id;
      if (help) control.setAttribute("aria-describedby", `${id}-help`);
      control.addEventListener("input", () => {
        control.removeAttribute("aria-invalid");
        markDirty();
      });
      return h(
        "div",
        { class: "oba-field" },
        h("label", { for: id }, label),
        control,
        help ? h("small", { class: "oba-small", id: `${id}-help` }, help) : null,
      );
    };
    const text = (value, attrs = {}) => h("input", { type: "text", value, ...attrs });

    const title = text("", { placeholder: "e.g. What we noticed about attention" });
    const question = text("", { placeholder: "e.g. What changed how you see your own work?" });
    title.addEventListener("input", () => question.removeAttribute("aria-invalid"));
    question.addEventListener("input", () => title.removeAttribute("aria-invalid"));
    const contributor = h(
      "select",
      { required: true, disabled: !contributors.length },
      h("option", { value: "" }, contributors.length ? "Choose your profile" : "No contributor profiles yet"),
      contributors.map(([id, entry]) => h("option", { value: id, selected: id === this.user }, `${entry.name || id} (${id})`)),
    );
    const addSource = h("button", { class: "oba-btn", type: "button", id: "oba-shared-add-source" }, "Add another source");
    const sourceLimit = h("small", { class: "oba-small", id: "oba-shared-source-limit", hidden: true }, `You can add up to ${MAX_SHARED_SOURCES} sources.`);
    const updateSourceLimit = () => {
      const full = sources.length >= MAX_SHARED_SOURCES;
      addSource.disabled = full;
      sourceLimit.hidden = !full;
      if (full) addSource.setAttribute("aria-describedby", sourceLimit.id);
      else addSource.removeAttribute("aria-describedby");
    };
    const submit = h("button", { class: "oba-btn oba-btn-primary", type: "submit", disabled: !contributors.length }, "Create shared reflection");

    const renderSources = (focusIndex = -1) => {
      sourceList.replaceChildren(
        ...sources.map((source, index) => {
          const prefix = `oba-shared-source-${index}`;
          const bind = (control, key) => {
            control.addEventListener("input", () => (source[key] = control.value));
            return control;
          };
          const kindOf = () => SHARED_SOURCE_KINDS.find((kind) => kind.value === source.kind) || SHARED_SOURCE_KINDS[0];
          const kind = h(
            "select",
            {},
            SHARED_SOURCE_KINDS.map((option) => h("option", { value: option.value, selected: option.value === source.kind }, option.label)),
          );
          const sourceTitle = bind(text(source.title, { required: true, placeholder: kindOf().example }), "title");
          const creatorInput = bind(text(source.creator), "creator");
          const publisherInput = bind(text(source.publisher), "publisher");
          const suggestedControls = { title: sourceTitle, creator: creatorInput, publisher: publisherInput };
          const isbnField = field(`${prefix}-isbn`, "ISBN (optional)", bind(text(source.isbn, { inputmode: "numeric", autocomplete: "off" }), "isbn"), "10 or 13 digits; hyphens are fine.");
          isbnField.hidden = source.kind !== "book";
          kind.addEventListener("change", () => {
            source.kind = kind.value;
            sourceTitle.placeholder = kindOf().example;
            isbnField.hidden = source.kind !== "book";
            markDirty();
          });
          const lookupStatus = h("small", { class: "oba-small", id: `${prefix}-lookup-status`, role: "status", "aria-live": "polite" });
          const lookup = h(
            "button",
            {
              class: "oba-btn",
              type: "button",
              "aria-describedby": lookupStatus.id,
              onClick: async () => {
                lookup.disabled = true;
                lookupStatus.textContent = "Looking up…";
                const outcome = await lookupSourceDetails(
                  source,
                  (json) => this.api.call("POST", "collaboration/publications/source-metadata", { json }),
                  () => sources.includes(source) && sourceTitle.isConnected,
                );
                if (outcome.stale && !sourceTitle.isConnected) return;
                for (const key of outcome.applied) {
                  const control = suggestedControls[key];
                  if (!control?.isConnected) continue;
                  control.value = source[key];
                  // Show which values came from the provider until the author edits them.
                  const note = h("small", { class: "oba-small oba-suggested-note" }, `Suggested by ${outcome.provider}. Check it, or edit to make it yours.`);
                  control.after(note);
                  control.addEventListener("input", () => note.remove(), { once: true });
                }
                if (outcome.applied.length) markDirty();
                lookupStatus.textContent = outcome.message;
                lookup.disabled = false;
              },
            },
            "Suggest details from link",
          );
          const remove = sources.length > 1
            ? h(
                "button",
                {
                  class: "oba-btn oba-btn-danger",
                  type: "button",
                  "aria-label": `Remove source ${index + 1}`,
                  onClick: () => {
                    sources.splice(index, 1);
                    markDirty();
                    renderSources(Math.min(index, sources.length - 1));
                  },
                },
                "Remove",
              )
            : null;
          return h(
            "fieldset",
            { class: "oba-contributor-card oba-shared-source" },
            h("legend", { class: "oba-legend" }, `Source ${index + 1}`),
            h("div", { class: "oba-contributor-fields" },
              field(`${prefix}-kind`, "Type of source", kind),
              field(`${prefix}-title`, "Source title", sourceTitle, "The name of the video, article, episode, or book."),
              field(`${prefix}-url`, "Original link (optional)", bind(text(source.url, { inputmode: "url", autocomplete: "url", spellcheck: "false", placeholder: "https://…" }), "url"), "Paste the full address. Leave it empty for a book, talk, or anything without a link."),
              field(`${prefix}-creator`, "Made by (optional)", creatorInput, "The author, speaker, channel, or host."),
              field(`${prefix}-publisher`, "Publisher (optional)", publisherInput),
              field(`${prefix}-published`, "Published (optional)", bind(text(source.published, { placeholder: "e.g. 2019" }), "published"), "A year or date, written however you like."),
              isbnField,
            ),
            h("div", { class: "oba-toolbar" }, lookup, lookupStatus),
            remove,
          );
        }),
      );
      updateSourceLimit();
      if (focusIndex >= 0) requestAnimationFrame(() => sourceList.querySelector(`#oba-shared-source-${focusIndex}-title`)?.focus());
    };

    addSource.addEventListener("click", () => {
      if (sources.length >= MAX_SHARED_SOURCES) return;
      sources.push(emptySharedSource(sources.at(-1)?.kind));
      markDirty();
      renderSources(sources.length - 1);
    });

    const showProblem = (problem) => showSharedReflectionProblem(this, status, problem);

    const form = h(
      "form",
      {
        class: "oba-shared-form",
        novalidate: true,
        "aria-labelledby": "oba-shared-form-heading",
        onSubmit: async (event) => {
          event.preventDefault();
          status.hidden = true;
          const draft = { title: title.value, guidingQuestion: question.value, contributorId: contributor.value, sources };
          const problem = validateSharedReflectionDraft(draft);
          if (problem) return showProblem(problem);
          submit.disabled = true;
          try {
            await submitSharedReflection(draft, {
              post: (json) => this.api.call("POST", "collaboration/publications", { json }),
              created: async () => {
                this.dirty = false;
                this.skipRoute = true;
                location.hash = "#/shared";
                await this.showSharedReflections("Shared reflection created. It is private to you until you invite others.");
              },
              failed: (error, problem) =>
                error instanceof ApiError && error.status === 401 ? this.showLogin("Your session ended. Sign in again.") : showProblem(problem),
            });
          } finally {
            submit.disabled = !contributors.length;
          }
        },
      },
      h("h2", { id: "oba-shared-form-heading" }, "Start a shared reflection"),
      h("p", {}, "Describe what you are reflecting on and the question you will each answer. You don’t need Markdown: plain words are fine everywhere."),
      h("p", { class: "oba-small" }, "Nothing is published. The reflection is kept in private server files and does not change your posts."),
      h("h3", {}, "What prompted it"),
      sourceList,
      h("div", { class: "oba-toolbar" }, addSource, sourceLimit),
      h(
        "fieldset",
        { class: "oba-contributor-card" },
        h("legend", { class: "oba-legend" }, "Your reflection"),
        field("oba-shared-title", "Working title", title, "You need a title, a guiding question, or both."),
        field("oba-shared-question", "Guiding question", question, "One question each writer answers in their own words."),
        field(
          "oba-shared-contributor",
          "You will appear as",
          contributor,
          contributors.length ? "The contributor profile your writing is attributed to. It does not change who can sign in." : "",
        ),
        contributors.length ? null : h("p", { class: "oba-notice" }, "Add yourself as a contributor first. ", h("a", { href: "#/contributors" }, "Open Contributors")),
      ),
      status,
      h("div", { class: "oba-toolbar" }, h("a", { class: "oba-btn", href: "#/shared" }, "Cancel"), h("span", { class: "oba-spacer" }), submit),
    );
    renderSources();
    this.mount(this.shell("shared", form));
    requestAnimationFrame(() => sourceList.querySelector("#oba-shared-source-0-title")?.focus());
  }

  // ---- shared reflection invitations

  /** Members and invitations for one reflection. Only site owners and coordinators see it. */
  invitationPanel(publication, index) {
    const roles = publication.roles || [];
    const isOwner = roles.includes("siteOwner");
    if (!isOwner && !roles.includes("coordinator")) return null;
    const prefix = `oba-invite-${index}`;
    const assignable = INVITATION_ROLES.filter((role) => isOwner || !role.ownerOnly);
    const heading = h("h3", { id: `${prefix}-heading`, tabindex: "-1" }, "Members and invitations");
    const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const problem = h("p", { class: "oba-error", role: "alert", tabindex: "-1", hidden: true });
    const result = h("div", { class: "oba-invitation-result", hidden: true });
    const memberList = h("ul", { class: "oba-member-list", "aria-label": "Members" });
    const list = h("ul", { class: "oba-invitation-list", "aria-label": "Invitations" });
    const user = h("input", { id: `${prefix}-user`, type: "text", autocomplete: "off", spellcheck: "false", maxlength: "32" });
    const profile = h("select", { id: `${prefix}-profile` });
    const days = h("input", { id: `${prefix}-days`, type: "number", min: "1", max: "30", value: "7" });
    const roleBoxes = assignable.map((role) =>
      h("label", { class: "oba-check" }, h("input", { type: "checkbox", name: `${prefix}-role`, value: role.value, checked: role.value === "contributor" }), ` ${role.label}`, h("small", { class: "oba-small" }, ` ${role.help}`)),
    );
    let revision = 0;
    let closeConfirm = null;
    const fail = async (error) => {
      const { message, reload } = sharedManagementError(error);
      problem.textContent = message;
      problem.hidden = false;
      if (!reload) return;
      try {
        await load();
      } catch {
        // The message above still explains what happened.
      }
      // The reload rebuilds the lists, which removes a focused confirmation. Keep the person's place.
      problem.focus();
    };
    const showToken = (issued) => {
      const url = invitationShareLink(location.origin, issued.link);
      const field = h("input", { type: "text", readonly: true, value: url, "aria-label": "Invitation link", class: "oba-invitation-link" });
      const copy = h("button", { class: "oba-btn", type: "button" }, "Copy link");
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(url);
          status.textContent = "Link copied.";
        } catch {
          field.focus();
          field.select?.();
          status.textContent = "Copying is not available here. The link is selected; copy it yourself.";
        }
      });
      result.replaceChildren(
        h("p", {}, "Pass this link to ", h("strong", {}, issued.invitation.adminUser), " yourself. It is shown only now, works once, and nothing is emailed from here."),
        field,
        copy,
      );
      result.hidden = false;
    };

    /** An inline, keyboard-reachable confirmation. Escape or Cancel returns focus to the trigger. */
    const confirmIn = (slot, trigger, { title, lines, confirmLabel, run }) => {
      closeConfirm?.();
      const id = `${prefix}-confirm-${slot.dataset.key}`;
      const confirm = h("button", { class: "oba-btn oba-btn-danger", type: "button" }, confirmLabel);
      const cancel = h("button", { class: "oba-btn", type: "button" }, "Cancel");
      const box = h(
        "div",
        { class: "oba-confirm", role: "group", "aria-labelledby": `${id}-title`, "aria-describedby": `${id}-body`, tabindex: "-1" },
        h("p", { id: `${id}-title`, class: "oba-confirm-title" }, title),
        h("div", { id: `${id}-body` }, lines.map((line) => h("p", { class: "oba-small" }, line))),
        h("div", { class: "oba-toolbar" }, confirm, cancel),
      );
      const close = (refocus = true) => {
        box.remove();
        closeConfirm = null;
        if (refocus) trigger.focus();
      };
      closeConfirm = () => close(false);
      cancel.addEventListener("click", () => close());
      box.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
      });
      confirm.addEventListener("click", async () => {
        problem.hidden = true;
        confirm.disabled = true;
        cancel.disabled = true;
        try {
          await run();
          closeConfirm = null;
          await load();
          heading.focus();
        } catch (error) {
          confirm.disabled = false;
          cancel.disabled = false;
          fail(error);
        }
      });
      slot.replaceChildren(box);
      box.focus();
    };

    const rolesEditor = (member, slot, trigger) => {
      closeConfirm?.();
      const id = `${prefix}-roles-${slot.dataset.key}`;
      const boxes = assignable.map((role) =>
        h("label", { class: "oba-check" }, h("input", { type: "checkbox", name: id, value: role.value, checked: member.roles.includes(role.value) }), ` ${role.label}`, h("small", { class: "oba-small" }, ` ${role.help}`)),
      );
      const save = h("button", { class: "oba-btn oba-btn-primary", type: "button" }, "Review change");
      const cancel = h("button", { class: "oba-btn", type: "button" }, "Cancel");
      const editor = h("fieldset", { class: "oba-confirm" }, h("legend", {}, `Roles for ${member.displayName || member.adminUser}`), boxes, h("div", { class: "oba-toolbar" }, save, cancel));
      const close = (refocus = true) => {
        editor.remove();
        closeConfirm = null;
        if (refocus) trigger.focus();
      };
      closeConfirm = () => close(false);
      cancel.addEventListener("click", () => close());
      editor.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
      });
      save.addEventListener("click", () => {
        const next = [...editor.querySelectorAll(`input[name="${id}"]`)].filter((box) => box.checked).map((box) => box.value);
        // Keep roles this person holds that the requester cannot see or change.
        const kept = member.roles.filter((role) => !assignable.some((option) => option.value === role));
        const chosen = [...new Set([...next, ...kept])];
        const lines = roleChangeImpact(member, chosen);
        problem.hidden = true;
        if (!chosen.length) {
          problem.textContent = "Choose at least one role, or remove their access instead.";
          problem.hidden = false;
          return;
        }
        if (!lines.length) {
          close();
          status.textContent = "No roles changed.";
          return;
        }
        editor.remove();
        confirmIn(slot, trigger, {
          title: `Change roles for ${member.displayName || member.adminUser}?`,
          lines: [...lines, "Credit for what they wrote is separate and does not change."],
          confirmLabel: "Change roles",
          run: async () => {
            await this.api.call("POST", "collaboration/members/roles", { json: { publicationId: publication.publicationId, participantId: member.participantId, roles: chosen, expectedRevision: revision } });
            status.textContent = `Roles updated for ${member.displayName || member.adminUser}.`;
          },
        });
      });
      slot.replaceChildren(editor);
      editor.querySelector("input")?.focus();
    };

    const loadMembers = async () => {
      const data = await this.api.call("GET", `collaboration/members?publicationId=${encodeURIComponent(publication.publicationId)}`);
      revision = data.revision;
      closeConfirm = null;
      memberList.replaceChildren(
        ...(data.members || []).map((member) => {
          const name = member.displayName || member.adminUser;
          const slot = h("div", { class: "oba-member-slot", "data-key": member.participantId });
          const change = h("button", { class: "oba-btn", type: "button", "aria-label": `Change roles for ${name}` }, "Change roles");
          const remove = h("button", { class: "oba-btn oba-btn-danger", type: "button", "aria-label": `Remove access for ${name}` }, "Remove access");
          change.addEventListener("click", () => rolesEditor(member, slot, change));
          remove.addEventListener("click", () =>
            confirmIn(slot, remove, {
              title: `Remove ${name}?`,
              lines: [removalImpact(member)],
              confirmLabel: "Remove access",
              run: async () => {
                await this.api.call("POST", "collaboration/members/remove", { json: { publicationId: publication.publicationId, participantId: member.participantId, expectedRevision: revision } });
                status.textContent = `${name} can no longer sign in to this reflection.`;
              },
            }),
          );
          return h(
            "li",
            { class: "oba-member" },
            h("strong", {}, name),
            member.isYou ? h("span", { class: "oba-badge" }, "You") : null,
            h("div", { class: "oba-small" }, `Signs in as ${member.adminUser}. Credited as ${member.contributorId}.`),
            h("div", {}, h("span", { class: "oba-small" }, "Sign-in roles: "), memberRolesLabel(member.roles)),
            ...memberWarnings(member).map((warning) => h("p", { class: "oba-notice" }, h("strong", {}, "Warning: "), warning)),
            member.canChangeRoles || member.canRemove ? h("div", { class: "oba-toolbar" }, member.canChangeRoles ? change : null, member.canRemove ? remove : null) : h("div", { class: "oba-small" }, "You cannot change this member."),
            slot,
          );
        }),
      );
    };

    const loadInvitations = async () => {
      const { invitations = [] } = await this.api.call("GET", `collaboration/invitations?publicationId=${encodeURIComponent(publication.publicationId)}`);
      list.replaceChildren(
        ...invitations.map((invitation) => {
          const pending = invitation.state === "pending";
          const slot = h("div", { class: "oba-member-slot", "data-key": invitation.id });
          const label = `${invitation.adminUser}'s invitation`;
          const reissue = h("button", { class: "oba-btn", type: "button", "aria-label": `Issue a new link for ${label}` }, "Issue a new link");
          reissue.addEventListener("click", async () => {
            problem.hidden = true;
            reissue.disabled = true;
            try {
              const response = await this.api.call("POST", "collaboration/invitations/reissue", { json: { publicationId: publication.publicationId, invitationId: invitation.id } });
              result.hidden = true;
              if (response.token) showToken(response);
              await load();
            } catch (error) {
              reissue.disabled = false;
              fail(error);
            }
          });
          const revoke = h("button", { class: "oba-btn oba-btn-danger", type: "button", "aria-label": `Revoke ${label}` }, "Revoke");
          revoke.addEventListener("click", () =>
            confirmIn(slot, revoke, {
              title: `Revoke the invitation for ${invitation.adminUser}?`,
              lines: [`The link stops working at once. ${invitation.adminUser} will not be added, and you can issue a new link later.`],
              confirmLabel: "Revoke invitation",
              run: async () => {
                await this.api.call("POST", "collaboration/invitations/revoke", { json: { publicationId: publication.publicationId, invitationId: invitation.id } });
                status.textContent = `Invitation for ${invitation.adminUser} revoked.`;
              },
            }),
          );
          return h(
            "li",
            { class: "oba-member" },
            h("strong", {}, invitation.adminUser),
            h("span", { class: "oba-badge" }, invitation.state),
            h("div", { class: "oba-small" }, `Would be credited as ${invitation.contributorId}. Roles: ${memberRolesLabel(invitation.roles)}.`),
            h("div", {}, invitationStatusText(invitation)),
            h("div", { class: "oba-toolbar" }, pending ? revoke : null, invitation.state !== "accepted" ? reissue : null),
            slot,
          );
        }),
      );
      if (!invitations.length) list.replaceChildren(h("li", { class: "oba-small" }, "No invitations yet."));
    };
    const load = async () => {
      await Promise.all([loadMembers(), loadInvitations()]);
    };

    const form = h(
      "form",
      { class: "oba-shared-form", novalidate: true },
      h("h4", {}, "Invite someone"),
      h("p", { class: "oba-small" }, "Invitations make a private link. Nothing is emailed; you pass the link on yourself, and it works once for the account you name."),
      h("div", { class: "oba-field" }, h("label", { for: `${prefix}-user` }, "Their sign-in name"), user),
      h("div", { class: "oba-field" }, h("label", { for: `${prefix}-profile` }, "They will be credited as"), profile),
      h("fieldset", {}, h("legend", {}, "Sign-in roles"), roleBoxes),
      h("div", { class: "oba-field" }, h("label", { for: `${prefix}-days` }, "Valid for (days, 1 to 30)"), days),
      h("button", { class: "oba-btn oba-btn-primary", type: "submit" }, "Create invitation link"),
    );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      problem.hidden = true;
      const draft = {
        adminUser: user.value,
        contributorId: profile.value,
        roles: [...form.querySelectorAll(`input[name="${prefix}-role"]`)].filter((box) => box.checked).map((box) => box.value),
        lifetimeDays: days.value,
      };
      const invalid = validateInvitationDraft(draft);
      if (invalid) {
        problem.textContent = invalid.message;
        problem.hidden = false;
        return;
      }
      try {
        const issued = await this.api.call("POST", "collaboration/invitations", { json: invitationPayload(publication.publicationId, draft) });
        user.value = "";
        showToken(issued);
        await load();
      } catch (error) {
        fail(error);
      }
    });
    const explain = h(
      "div",
      { class: "oba-small" },
      h("p", {}, h("strong", {}, "Sign-in access"), " decides who can open this reflection and what they can do. Removing it ends access."),
      h("p", {}, h("strong", {}, "Credit"), " names the contributor profile shown for what someone wrote. Ending access never removes credit."),
    );
    const details = h(
      "details",
      { class: "oba-invitations" },
      h("summary", {}, "Members and invitations"),
      heading,
      explain,
      status,
      problem,
      h("h4", {}, "Members"),
      memberList,
      h("h4", {}, "Invitations"),
      list,
      form,
      result,
    );
    let loaded = false;
    details.addEventListener("toggle", async () => {
      if (!details.open || loaded) return;
      loaded = true;
      try {
        const registry = await this.api.call("GET", "contributors");
        profile.replaceChildren(...Object.entries(registry.contributors || {}).map(([key, value]) => h("option", { value: key }, value.name || key)));
        await load();
      } catch (error) {
        loaded = false;
        fail(error);
      }
    });
    return details;
  }

  // ---- shared reflection series

  /**
   * Where this reflection sits in one of the site's ordinary series. Every participant sees the
   * placement and the reading order it gives; site owners and coordinators choose it; site
   * owners may also add a new series with its recurring premise. The series list and the order
   * come from the public site only. Loads only when opened.
   */
  seriesPanel(publication, index) {
    const id = publication.publicationId;
    const prefix = `oba-series-${index}`;
    const heading = h("h3", { id: `${prefix}-heading`, tabindex: "-1" }, "Series");
    const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const problem = h("p", { class: "oba-error", role: "alert", tabindex: "-1", hidden: true });
    const current = h("p", { id: `${prefix}-current` });
    const about = h("p", { class: "oba-small", hidden: true });
    const orderHeading = h("h4", { id: `${prefix}-order-heading` }, "Reading order");
    const orderList = h("ol", { class: "oba-series-order", "aria-labelledby": `${prefix}-order-heading` });
    const orderBox = h("div", { class: "oba-series-preview", hidden: true }, orderHeading, about, orderList);

    const choice = h("select", { id: `${prefix}-choice` });
    const title = h("input", { id: `${prefix}-title`, type: "text", maxlength: "120", autocomplete: "off", "aria-describedby": `${prefix}-title-help` });
    const titleField = h("div", { class: "oba-field", hidden: true }, h("label", { for: title.id }, "New series title"), title, h("small", { class: "oba-small", id: `${prefix}-title-help` }, "A series that has no description yet uses this title. A site owner can describe it below or under Series."));
    const order = h("input", { id: `${prefix}-order`, type: "number", min: "0", step: "1", inputmode: "numeric", "aria-describedby": `${prefix}-order-help` });
    const previewButton = h("button", { class: "oba-btn", type: "button" }, "Preview order");
    const save = h("button", { class: "oba-btn oba-btn-primary", type: "submit" }, "Save placement");
    const form = h(
      "form",
      { class: "oba-series-form", novalidate: true, hidden: true, "aria-labelledby": `${prefix}-form-heading` },
      h("h4", { id: `${prefix}-form-heading` }, "Choose the series"),
      h("p", { class: "oba-small", id: `${prefix}-consent` }, "Every author approves the series and position together with the piece, and sees them in the combined preview. Saving a change means each author approves again."),
      h("div", { class: "oba-field" }, h("label", { for: choice.id }, "Series"), choice),
      titleField,
      h("div", { class: "oba-field" }, h("label", { for: order.id }, "Position in the series (optional)"), order, h("small", { class: "oba-small", id: `${prefix}-order-help` }, "Parts with a position come first, lowest first; parts with the same position go by date. Leave it empty to follow any numbered parts, by date.")),
      h("div", { class: "oba-toolbar" }, previewButton, save),
    );
    save.setAttribute("aria-describedby", `${prefix}-consent`);

    const newTitle = h("input", { id: `${prefix}-new-title`, type: "text", maxlength: "120", autocomplete: "off" });
    const premise = h("input", { id: `${prefix}-premise`, type: "text", maxlength: "500", autocomplete: "off", "aria-describedby": `${prefix}-premise-help` });
    const create = h("button", { class: "oba-btn", type: "submit" }, "Create series");
    const createForm = h(
      "form",
      { class: "oba-series-form", novalidate: true, "aria-labelledby": `${prefix}-create-heading` },
      h("h5", { id: `${prefix}-create-heading` }, "Add a new series"),
      h("p", { class: "oba-small" }, "Series belong to the site. This adds a series with a name and its recurring premise; it is not shown to readers until a part is published, and it does not place this reflection in it."),
      h("div", { class: "oba-field" }, h("label", { for: newTitle.id }, "Series name"), newTitle),
      h("div", { class: "oba-field" }, h("label", { for: premise.id }, "Recurring premise (optional)"), premise, h("small", { class: "oba-small", id: `${prefix}-premise-help` }, "One line readers see on the series page, such as what each part answers.")),
      create,
    );
    const createBox = h("details", { class: "oba-series-create", hidden: true }, h("summary", {}, "Add a new series (site owners)"), createForm);

    let view = null;
    const syncTitle = () => {
      titleField.hidden = choice.value !== NEW_SERIES;
    };
    choice.addEventListener("change", syncTitle);

    const fail = (error) => {
      const failure = seriesFailure(error);
      problem.textContent = failure.message;
      problem.hidden = false;
      problem.focus();
      return failure;
    };
    const clearProblem = () => {
      problem.hidden = true;
      problem.textContent = "";
    };

    // Options are rebuilt from the latest list, keeping whatever the person had chosen.
    const renderChoices = (choices, selected) => {
      const known = choices.some((item) => item.slug === selected);
      const value = known || selected === NO_SERIES || selected === NEW_SERIES ? selected : NEW_SERIES;
      choice.replaceChildren(
        h("option", { value: NO_SERIES, selected: value === NO_SERIES }, "Not in a series"),
        ...choices.map((item) => h("option", { value: item.slug, selected: value === item.slug }, `${item.name} (${item.parts} published ${item.parts === 1 ? "part" : "parts"})`)),
        h("option", { value: NEW_SERIES, selected: value === NEW_SERIES }, "A new series title..."),
      );
      choice.value = value;
      syncTitle();
    };

    const renderPreview = (preview) => {
      orderBox.hidden = !preview;
      if (!preview) return;
      orderHeading.textContent = `Reading order: ${preview.name}`;
      about.hidden = false;
      about.textContent = preview.defined
        ? preview.description || "This series has no premise written yet."
        : "This series has no description yet, so the site will use its title until a site owner describes it.";
      orderList.replaceChildren(
        ...(preview.parts || []).map((part, position) =>
          h(
            "li",
            { class: part.thisPublication ? "oba-series-this" : null },
            part.thisPublication
              ? h("strong", {}, seriesPartText(part, position))
              : [seriesPartText(part, position), " ", h("a", { href: part.url, target: "_blank", rel: "noopener noreferrer", "aria-label": `Open ${part.title || "this part"}` }, "Open")],
          ),
        ),
      );
    };

    /** Show a fresh view. `adopt` copies the stored placement into the controls; after a refused
     * save it is false, so the person's own choice stays as they left it. */
    const render = (next, adopt) => {
      view = next;
      const preview = next.preview;
      const name = next.placement ? preview?.name || next.placement.series : "";
      current.textContent = next.placement ? `Series: ${seriesPlacementText(name, next.placement.order)}` : seriesPlacementText("");
      if (next.published) current.textContent += " The reflection is published, so its series is now changed in the post itself.";
      if (adopt) {
        const stored = next.placement ? (next.series || []).find((item) => item.slug === preview?.slug)?.slug ?? NEW_SERIES : NO_SERIES;
        if (stored === NEW_SERIES) title.value = next.placement.series;
        order.value = next.placement?.order ?? "";
        renderChoices(next.series || [], stored);
      } else {
        renderChoices(next.series || [], choice.value);
      }
      form.hidden = !next.canPlace;
      createBox.hidden = !next.canCreate;
      renderPreview(preview);
    };

    const url = (extra = "") => `collaboration/series?publicationId=${encodeURIComponent(id)}${extra}`;
    const load = async (adopt = true) => {
      render(await this.api.call("GET", url()), adopt);
    };

    previewButton.addEventListener("click", async () => {
      clearProblem();
      const request = seriesPlacementRequest(choice.value, title.value, order.value);
      if (request.error) {
        fail({ status: 422, data: { error: request.error } });
        return;
      }
      if (!request.placement) {
        renderPreview(null);
        status.textContent = "Not in a series, so there is no reading order to show.";
        return;
      }
      const query = `&series=${encodeURIComponent(request.placement.series)}&order=${request.placement.order ?? ""}`;
      try {
        const next = await this.api.call("GET", url(query));
        renderPreview(next.preview);
        status.textContent = `Previewing ${next.preview?.name || "the series"}. Nothing has been saved.`;
      } catch (error) {
        fail(error);
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearProblem();
      const request = seriesPlacementRequest(choice.value, title.value, order.value);
      if (request.error) {
        fail({ status: 422, data: { error: request.error } });
        (request.field === "order" ? order : title).focus();
        return;
      }
      save.disabled = true;
      try {
        const placement = keepStoredSeries(request.placement, view?.placement, view?.preview?.slug);
        const next = await this.api.call("PUT", "collaboration/series", { json: { publicationId: id, expectedRevision: view?.revision ?? 0, placement } });
        const changed = next.revision !== view?.revision;
        render(next, true);
        status.textContent = !changed ? "Nothing changed." : next.placement ? "Series placement saved. Each author approves the piece again, with this placement." : "Removed from the series. Each author approves the piece again.";
        save.disabled = false;
        save.focus();
      } catch (error) {
        save.disabled = false;
        const failure = fail(error);
        // A conflict shows the newest placement around what the person chose, so they can
        // compare and save again; nothing they typed is replaced.
        if (failure.kind === "conflict") {
          try {
            await load(false);
          } catch {
            // The message above still explains what happened.
          }
          problem.focus();
        }
      }
    });

    createForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearProblem();
      if (!newTitle.value.trim()) {
        fail({ status: 422, data: { error: "Type the series name." } });
        newTitle.focus();
        return;
      }
      create.disabled = true;
      try {
        const made = await this.api.call("POST", "collaboration/series/create", { json: { publicationId: id, title: newTitle.value, premise: premise.value } });
        newTitle.value = "";
        premise.value = "";
        await load(false);
        renderChoices(view?.series || [], made.slug);
        status.textContent = `Series ${made.name} added. Choose Save placement to put this reflection in it.`;
        create.disabled = false;
        choice.focus();
      } catch (error) {
        create.disabled = false;
        fail(error);
      }
    });

    const details = h(
      "details",
      { class: "oba-invitations oba-series" },
      h("summary", {}, "Series"),
      heading,
      h("p", { class: "oba-small" }, "A shared reflection can join one of the site's series, which supplies the name, description and reading order. Nothing here is public until the piece is published."),
      status,
      problem,
      current,
      form,
      createBox,
      orderBox,
    );
    let loaded = false;
    details.addEventListener("toggle", async () => {
      if (!details.open || loaded) return;
      loaded = true;
      try {
        await load(true);
      } catch (error) {
        loaded = false;
        fail(error);
      }
    });
    return details;
  }

  // ---- shared reflection drafts

  /**
   * The signed-in writer's own private draft, with optional prompts, a save state, conflict
   * recovery, and the sharing controls. It loads only when opened and only ever shows the
   * writer's own text plus what the server has revealed to them.
   */
  draftPanel(publication, index) {
    const roles = publication.roles || [];
    if (!["contributor", "editor", "coordinator", "siteOwner"].some((role) => roles.includes(role))) return null;
    const id = publication.publicationId;
    const prefix = `oba-draft-${index}`;
    const heading = h("h3", { id: `${prefix}-heading`, tabindex: "-1" }, "Your draft");
    const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const problem = h("p", { class: "oba-error", role: "alert", tabindex: "-1", hidden: true });
    const denied = h("p", { class: "oba-notice", hidden: true }, "You cannot write a draft in this shared reflection. Ask a coordinator if you need to.");
    const text = h("textarea", { id: `${prefix}-text`, rows: "12", spellcheck: "true", autocomplete: "off", "aria-describedby": `${prefix}-state` });
    const state = h("p", { id: `${prefix}-state`, class: "oba-small" });
    const save = h("button", { class: "oba-btn oba-btn-primary", type: "submit" }, "Save draft");
    const restore = h("button", { class: "oba-btn", type: "button", hidden: true }, "Restore my earlier text");
    const prompts = h("div", { class: "oba-draft-prompts" });
    const togglePrompts = h("button", { class: "oba-btn", type: "button", "aria-pressed": "false" }, "Hide prompts");
    const partBreak = h("button", { class: "oba-btn", type: "button" }, "Start a new part");
    const conflict = h("div", { class: "oba-draft-conflict", role: "group", "aria-labelledby": `${prefix}-conflict-heading`, hidden: true });
    const sharing = h("div", { class: "oba-draft-sharing", hidden: true });
    const editor = h("div", { class: "oba-draft-editor", hidden: true });
    let saved = { number: 0, markdown: "" };
    let saving = false;
    let stash = null;
    let hidePrompts = false;

    const refreshState = () => {
      const dirty = text.value !== saved.markdown;
      state.textContent = `${draftStateText({ number: saved.number, dirty, saving })} ${text.value.length.toLocaleString()} characters.`;
      save.disabled = saving;
      return dirty;
    };
    const fail = (error, { focus = true } = {}) => {
      const failure = draftFailure(error);
      problem.textContent = failure.message;
      problem.hidden = false;
      if (focus) problem.focus();
      return failure;
    };
    const clearProblem = () => {
      problem.hidden = true;
      problem.textContent = "";
    };

    const renderPrompts = () => {
      togglePrompts.textContent = hidePrompts ? "Show prompts" : "Hide prompts";
      togglePrompts.setAttribute("aria-pressed", String(hidePrompts));
      prompts.hidden = hidePrompts;
      prompts.replaceChildren(
        h("p", { class: "oba-small", id: `${prefix}-prompts-note` }, "Prompts are optional. Add one to your draft, change it, or delete it; write something else entirely if you like."),
        h(
          "ul",
          { class: "oba-draft-prompt-list", "aria-describedby": `${prefix}-prompts-note` },
          REFLECTION_PROMPTS.map((prompt) => {
            const add = h("button", { class: "oba-btn", type: "button", "aria-label": `Add prompt to draft: ${prompt}` }, "Add to draft");
            add.addEventListener("click", () => {
              const result = insertAtSelection(text.value, text.selectionStart, text.selectionEnd, promptInsertion(prompt));
              text.value = result.text;
              text.focus();
              text.setSelectionRange?.(result.caret, result.caret);
              refreshState();
              status.textContent = "Prompt added to your draft. You can edit or delete it.";
            });
            return h("li", {}, h("span", {}, prompt), " ", add);
          }),
        ),
      );
    };
    partBreak.addEventListener("click", () => {
      const result = insertAtSelection(text.value, text.selectionStart, text.selectionEnd, partBreakInsertion());
      text.value = result.text;
      text.focus();
      text.setSelectionRange?.(result.caret, result.caret);
      refreshState();
      status.textContent = "A new part starts here. A coordinator can place each part in the arrangement. The marker line is never published.";
    });
    togglePrompts.addEventListener("click", () => {
      hidePrompts = !hidePrompts;
      renderPrompts();
      status.textContent = hidePrompts ? "Prompts hidden." : "Prompts shown.";
    });

    const adoptDraft = (draft) => {
      saved = { number: draft?.stamp?.number || 0, markdown: draft?.markdown || "" };
    };

    const closeConflict = (focusEditor = true) => {
      conflict.hidden = true;
      conflict.replaceChildren();
      if (focusEditor) text.focus();
    };

    /** Show the writer's untouched text beside the newer copy. Nothing is saved or replaced. */
    const showConflict = (current, message) => {
      const mine = text.value;
      const field = (label, value, key) => {
        const area = h("textarea", { id: `${prefix}-conflict-${key}`, rows: "6", readonly: true });
        area.value = value;
        return h("div", { class: "oba-field" }, h("label", { for: `${prefix}-conflict-${key}` }, label), area);
      };
      const keepMine = h("button", { class: "oba-btn oba-btn-primary", type: "button" }, "Save my text as a new revision");
      const useNewer = h("button", { class: "oba-btn", type: "button" }, "Use the newer copy instead");
      const later = h("button", { class: "oba-btn", type: "button" }, "Decide later");
      keepMine.addEventListener("click", async () => {
        saved = { number: current?.stamp?.number || 0, markdown: current?.markdown || "" };
        loadSharing(); // an open offer box names the old revision
        closeConflict(false);
        await doSave();
        if (conflict.hidden && problem.hidden) text.focus();
      });
      useNewer.addEventListener("click", () => {
        stash = mine;
        text.value = current?.markdown || "";
        adoptDraft(current);
        loadSharing(); // an open offer box names the old revision
        restore.hidden = false;
        closeConflict();
        refreshState();
        status.textContent = "Showing the newer copy. Your own text is kept; use Restore my earlier text to bring it back.";
      });
      later.addEventListener("click", () => {
        closeConflict();
        status.textContent = "Your text is unchanged and not saved.";
      });
      conflict.replaceChildren(
        h("h4", { id: `${prefix}-conflict-heading`, tabindex: "-1" }, "Your draft changed elsewhere"),
        h("p", {}, message),
        current ? field(`Newer saved copy (revision ${current.stamp?.number ?? "?"})`, current.markdown || "", "newer") : h("p", { class: "oba-small" }, "The newer copy could not be shown."),
        field("Your text, not saved", mine, "mine"),
        h("div", { class: "oba-toolbar" }, keepMine, useNewer, later),
      );
      conflict.hidden = false;
      conflict.querySelector(`#${prefix}-conflict-heading`)?.focus();
    };

    const doSave = async () => {
      if (saving) return;
      clearProblem();
      saving = true;
      refreshState();
      const sent = text.value;
      try {
        const result = await this.api.call("PUT", "collaboration/draft", { json: { publicationId: id, expectedRevision: saved.number, markdown: sent } });
        saved = { number: result?.stamp?.number || saved.number + 1, markdown: sent };
        stash = null;
        restore.hidden = true;
        saving = false;
        refreshState();
        status.textContent = `Saved as revision ${saved.number}.`;
        await loadSharing();
      } catch (error) {
        saving = false;
        refreshState();
        const failure = draftFailure(error);
        if (failure.kind === "conflict") {
          let current = failure.current;
          if (!current) {
            try {
              current = (await this.api.call("GET", `collaboration/draft?publicationId=${encodeURIComponent(id)}`))?.draft ?? null;
            } catch {
              current = null;
            }
          }
          showConflict(current, failure.message);
        } else fail(error);
      }
    };

    restore.addEventListener("click", () => {
      if (stash === null) return;
      text.value = stash;
      stash = null;
      restore.hidden = true;
      refreshState();
      text.focus();
      status.textContent = "Your earlier text is back. It is not saved yet.";
    });
    text.addEventListener("input", () => {
      refreshState();
    });

    const form = h(
      "form",
      { class: "oba-draft-form", "aria-labelledby": `${prefix}-heading`, novalidate: true },
      prompts,
      h("div", { class: "oba-field" }, h("label", { for: `${prefix}-text` }, "Your reflection (Markdown)"), text),
      state,
      h("div", { class: "oba-toolbar" }, togglePrompts, partBreak, restore, h("span", { class: "oba-spacer" }), save),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      doSave();
    });
    editor.append(form, conflict);

    // ---- sharing
    const runSharing = async (method, path, json, done) => {
      clearProblem();
      try {
        const result = await this.api.call(method, path, { json });
        status.textContent = done(result);
        await loadSharing();
        // An offer seals the writer's proposed moments and a reveal may share others' moments, so
        // the moments panel reads them again, keeping anything typed there.
        if (path === "collaboration/reveal/ready") await moments?.load(false);
        // The control that was pressed is gone; keep keyboard and screen-reader users in place.
        sharing.querySelector(`#${prefix}-sharing-heading`)?.focus();
        return true;
      } catch (error) {
        const failure = fail(error);
        if (failure.kind === "conflict" || failure.kind === "denied") {
          await loadSharing();
          problem.focus();
        }
        return false;
      }
    };

    const previewStatus = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const previewList = h("ul", { class: "oba-member-list", "aria-label": "Authors in the combined piece", hidden: true });
    const previewHolder = h("div", {});
    const previewButton = h("button", { class: "oba-btn", type: "button" }, "Review the combined piece");
    previewButton.addEventListener("click", async () => {
      previewButton.disabled = true;
      previewStatus.textContent = "Loading the preview…";
      try {
        const { preview } = await this.api.call("GET", `collaboration/preview?publicationId=${encodeURIComponent(id)}`);
        previewList.replaceChildren(
          ...(preview.rule ? [h("li", {}, `Approval rule: ${approvalRuleText(preview.rule)}`)] : []),
          ...(preview.sections || []).map((section) => h("li", {}, previewSectionText(section))),
          ...(preview.items || []).map((item) => h("li", {}, previewItemText(item))),
        );
        previewList.hidden = false;
        // No scripts, forms, popups or same-origin access: the sandbox has no allowances at all.
        previewHolder.replaceChildren(h("iframe", { class: "oba-preview oba-preview-combined", title: "Combined piece preview, not published", sandbox: "", src: preview.previewUrl }));
        previewStatus.textContent = `Preview, not published. ${previewStateText(preview)}`;
      } catch {
        previewList.hidden = true;
        previewHolder.replaceChildren();
        previewStatus.textContent = "The preview could not be loaded, or you cannot preview this reflection. Nothing was changed.";
      } finally {
        previewButton.disabled = false;
      }
    });
    const previewSection = h(
      "div",
      { class: "oba-preview-review" },
      h("h4", {}, "Combined preview"),
      h("p", { class: "oba-small" }, "Shows the sections you may read together, with each author's approval. It is not published and only authors of this piece can open it."),
      previewButton,
      previewStatus,
      previewList,
      previewHolder,
    );

    // ---- layout and arrangement (ADR 0031)
    const arrangementStatus = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const arrangementProblem = h("p", { class: "oba-error", role: "alert", tabindex: "-1", hidden: true });
    const arrangementBody = h("div", {});
    const arrangement = h(
      "div",
      { class: "oba-arrangement", hidden: true },
      h("h4", { id: `${prefix}-arrange-heading`, tabindex: "-1" }, "Layout and arrangement"),
      h("p", { class: "oba-small" }, "The layout and the order of turns decide how readers see the approved piece. Changing either one clears approvals, so every author reads and approves again. Nothing here shows anyone's writing."),
      arrangementStatus,
      arrangementProblem,
      arrangementBody,
    );
    let arranged = null;
    const layoutLabel = (value) => ARRANGEMENT_LAYOUTS.find((item) => item.value === value)?.label || value;
    const personName = (personId) => arranged.participants.find((person) => person.id === personId)?.displayName || "A participant";
    const drawArrangement = (focusId) => {
      const { draft, participants, canArrange } = arranged;
      if (!canArrange) {
        arrangementBody.replaceChildren(
          h("p", { class: "oba-small" }, `Layout: ${layoutLabel(draft.layout)}. Only a coordinator can change it.`),
          draft.revision
            ? h(
                "ol",
                { class: "oba-member-list", "aria-label": "Rounds in reading order" },
                draft.rounds.map((round, r) =>
                  h("li", {}, `Round ${r + 1}${round.prompt ? `: ${round.prompt}` : ""}. `, round.turns.map((turn) => `${personName(turn.draft)}, part ${turn.part + 1}${turn.label ? ` (${turn.label})` : ""}`).join("; ") + "."),
                ),
              )
            : h("p", { class: "oba-small" }, "Nothing is arranged yet. Sections publish one after another in participant order."),
        );
        return;
      }
      const redraw = (next) => {
        drawArrangement(next);
      };
      const layouts = h(
        "fieldset",
        { class: "oba-fieldset" },
        h("legend", {}, "Layout"),
        ARRANGEMENT_LAYOUTS.map((item) => {
          const radio = h("input", { type: "radio", name: `${prefix}-layout`, id: `${prefix}-layout-${item.value}`, value: item.value, checked: draft.layout === item.value, "aria-describedby": `${prefix}-layout-${item.value}-help` });
          radio.addEventListener("change", () => {
            draft.layout = item.value;
          });
          return h("div", { class: "oba-field oba-check" }, radio, " ", h("label", { for: `${prefix}-layout-${item.value}` }, item.label), h("span", { class: "oba-small", id: `${prefix}-layout-${item.value}-help` }, ` ${item.help}`));
        }),
      );
      const rounds = draft.rounds.map((round, r) => {
        const promptId = `${prefix}-round-${r}-prompt`;
        const prompt = h("input", { type: "text", id: promptId, value: round.prompt, maxlength: "1000", autocomplete: "off" });
        prompt.value = round.prompt;
        prompt.addEventListener("input", () => {
          round.prompt = prompt.value;
        });
        const turns = round.turns.map((turn, t) => {
          const base = `${prefix}-round-${r}-turn-${t}`;
          const who = h(
            "select",
            { id: `${base}-who` },
            participants.map((person) => h("option", { value: person.id, selected: person.id === turn.draft }, person.displayName)),
          );
          who.value = turn.draft;
          who.addEventListener("change", () => {
            turn.draft = who.value;
          });
          const labelInput = h("input", { type: "text", id: `${base}-label`, value: turn.label || "", maxlength: String(TURN_LABEL_MAX_BYTES), autocomplete: "off", placeholder: "none" });
          labelInput.value = turn.label || "";
          labelInput.addEventListener("input", () => {
            turn.label = labelInput.value;
          });
          const part = h("input", { type: "number", id: `${base}-part`, min: "1", max: "1000", step: "1", value: String(turn.part + 1), inputmode: "numeric" });
          part.value = String(turn.part + 1);
          part.addEventListener("input", () => {
            turn.part = Number(part.value) - 1;
          });
          const label = `round ${r + 1}, turn ${t + 1}`;
          const up = h("button", { class: "oba-btn", type: "button", "aria-label": `Move ${label} up`, disabled: t === 0 }, "Move up");
          const down = h("button", { class: "oba-btn", type: "button", "aria-label": `Move ${label} down`, disabled: t === round.turns.length - 1 }, "Move down");
          const remove = h("button", { class: "oba-btn", type: "button", "aria-label": `Remove ${label}` }, "Remove");
          up.addEventListener("click", () => {
            round.turns = moveItem(round.turns, t, -1);
            redraw(`${prefix}-round-${r}-turn-${Math.max(0, t - 1)}-who`);
          });
          down.addEventListener("click", () => {
            round.turns = moveItem(round.turns, t, 1);
            redraw(`${prefix}-round-${r}-turn-${Math.min(round.turns.length - 1, t + 1)}-who`);
          });
          remove.addEventListener("click", () => {
            round.turns.splice(t, 1);
            redraw(`${prefix}-round-${r}-add`);
          });
          return h(
            "li",
            { class: "oba-arrangement-turn" },
            h("label", { for: `${base}-who` }, `Turn ${t + 1}: who`),
            " ",
            who,
            " ",
            h("label", { for: `${base}-part` }, `Round ${r + 1}, turn ${t + 1}: part`),
            " ",
            part,
            " ",
            h("label", { for: `${base}-label` }, `Round ${r + 1}, turn ${t + 1}: label (optional)`),
            " ",
            labelInput,
            " ",
            up,
            down,
            remove,
          );
        });
        const add = h("button", { class: "oba-btn", type: "button", id: `${prefix}-round-${r}-add` }, `Add a turn to round ${r + 1}`);
        add.addEventListener("click", () => {
          round.turns.push({ draft: participants[0]?.id || "", part: 0, label: "" });
          redraw(`${prefix}-round-${r}-turn-${round.turns.length - 1}-who`);
        });
        const dropRound = h("button", { class: "oba-btn", type: "button" }, `Remove round ${r + 1}`);
        dropRound.addEventListener("click", () => {
          draft.rounds.splice(r, 1);
          redraw(`${prefix}-add-round`);
        });
        return h(
          "fieldset",
          { class: "oba-fieldset" },
          h("legend", {}, `Round ${r + 1}`),
          h("div", { class: "oba-field" }, h("label", { for: promptId }, "Round prompt (optional, shown once before the answers)"), prompt),
          h("ol", { "aria-label": `Turns in round ${r + 1}, in reading order` }, turns),
          h("div", { class: "oba-toolbar" }, add, dropRound),
        );
      });
      const addRound = h("button", { class: "oba-btn", type: "button", id: `${prefix}-add-round` }, "Add a round");
      addRound.addEventListener("click", () => {
        draft.rounds.push({ id: nextRoundId(draft.rounds), prompt: "", turns: participants.slice(0, 1).map((person) => ({ draft: person.id, part: 0 })) });
        redraw(`${prefix}-round-${draft.rounds.length - 1}-prompt`);
      });
      const saveArrangement = h("button", { class: "oba-btn oba-btn-primary", type: "button" }, "Save layout and arrangement");
      saveArrangement.addEventListener("click", async () => {
        arrangementProblem.hidden = true;
        const mistake = validateArrangement(draft);
        if (mistake) {
          arrangementProblem.textContent = mistake;
          arrangementProblem.hidden = false;
          arrangementProblem.focus();
          return;
        }
        saveArrangement.disabled = true;
        try {
          await this.api.call("PUT", "collaboration/reflection", { json: { publicationId: id, expectedRevision: draft.revision, structure: arrangementPayload(draft) } });
          arrangementStatus.textContent = "Saved. Approvals that no longer matched were cleared; each author reads the combined piece and approves again.";
          await loadArrangement();
          arrangement.querySelector(`#${prefix}-arrange-heading`)?.focus();
        } catch (error) {
          const failure = arrangementFailure(error);
          arrangementProblem.textContent = failure.message;
          arrangementProblem.hidden = false;
          arrangementProblem.focus();
          if (failure.kind === "conflict" || failure.kind === "denied") await loadArrangement();
        } finally {
          saveArrangement.disabled = false;
        }
      });
      arrangementBody.replaceChildren(layouts, ...rounds, h("div", { class: "oba-toolbar" }, addRound, h("span", { class: "oba-spacer" }), saveArrangement));
      if (focusId) arrangementBody.querySelector(`#${focusId}`)?.focus();
    };
    // The arrangement loads once when the panel opens and again after its own save, conflict or
    // denial. Other sharing refreshes (a draft save, an offer) keep the local, unsaved edits.
    let arrangementRequested = false;
    const loadArrangement = async () => {
      arrangementRequested = true;
      try {
        const result = await this.api.call("GET", `collaboration/reflection?publicationId=${encodeURIComponent(id)}`);
        arranged = { draft: arrangementDraft(result.structure, result.participants), participants: result.participants || [], canArrange: result.canArrange === true };
        drawArrangement();
        arrangement.hidden = false;
      } catch {
        arrangement.hidden = true;
        arrangementRequested = false; // try again on the next refresh
      }
    };

    // ---- approval rule (ADR 0052)
    const ruleStatus = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const ruleProblem = h("p", { class: "oba-error", role: "alert", tabindex: "-1", hidden: true });
    const ruleBody = h("div", {});
    const ruleBlock = h(
      "div",
      { class: "oba-approval-rule", hidden: true },
      h("h4", { id: `${prefix}-rule-heading`, tabindex: "-1" }, "Approval rule"),
      h("p", { class: "oba-small" }, "Decides whose approval publication needs. Everyone who wrote always approves their own words, and nobody can approve for someone else. Changing the rule clears every approval."),
      ruleStatus,
      ruleProblem,
      ruleBody,
    );
    let ruleRequested = false;
    const drawRule = (rule) => {
      const choice = approvalPolicyChoice(rule.policy);
      const facts = [
        h("p", { class: "oba-small" }, h("strong", {}, "Current rule. "), approvalRuleText(rule)),
        h("p", { class: "oba-small" }, `Must approve now: ${(rule.required || []).join(", ") || "no one yet"}. Still to approve: ${(rule.missing || []).join(", ") || "no one"}.`),
      ];
      if (rule.published) {
        ruleBody.replaceChildren(...facts, h("p", { class: "oba-small" }, "This reflection is published, so its rule no longer changes."));
        return;
      }
      const kinds = h(
        "fieldset",
        { class: "oba-fieldset" },
        h("legend", {}, "Whose approval publication needs"),
        APPROVAL_REQUIREMENTS.map((item) => {
          const radio = h("input", { type: "radio", name: `${prefix}-rule-kind`, id: `${prefix}-rule-${item.value}`, value: item.value, checked: choice.kind === item.value, "aria-describedby": `${prefix}-rule-${item.value}-help` });
          radio.addEventListener("change", () => {
            choice.kind = item.value;
          });
          return h("div", { class: "oba-field oba-check" }, radio, " ", h("label", { for: `${prefix}-rule-${item.value}` }, item.label), h("span", { class: "oba-small", id: `${prefix}-rule-${item.value}-help` }, ` ${item.help}`));
        }),
      );
      const toggle = (list, value, on) => (on ? [...new Set([...list, value])] : list.filter((entry) => entry !== value));
      const peopleRows = approvalPeopleRows(rule);
      const people = h(
        "fieldset",
        { class: "oba-fieldset" },
        h("legend", {}, "People who must approve (with “Writers and named people”)"),
        peopleRows.length
          ? peopleRows.map((person) => {
              const boxId = `${prefix}-rule-person-${person.participantId}`;
              const helpId = `${boxId}-help`;
              const box = h("input", { type: "checkbox", id: boxId, value: person.participantId, checked: choice.named.includes(person.participantId), "aria-describedby": person.canApprove ? null : helpId });
              box.addEventListener("change", () => {
                choice.named = toggle(choice.named, person.participantId, box.checked);
              });
              if (person.canApprove) return h("div", { class: "oba-field oba-check" }, box, " ", h("label", { for: boxId }, person.displayName));
              const help = rule.mayDropApprovers === false ? " Only a site owner can take them off the rule." : " Clear this to take them off the rule.";
              return h("div", { class: "oba-field oba-check" }, box, " ", h("label", { for: boxId }, `${person.displayName} (can no longer approve)`), h("span", { class: "oba-small", id: helpId }, help));
            })
          : h("p", { class: "oba-small" }, "Nobody can approve yet: only authors with the contributor role can."),
      );
      const roles = h(
        "fieldset",
        { class: "oba-fieldset" },
        h("legend", {}, "Roles whose authors must approve (with “Writers and people with a role”)"),
        APPROVAL_ROLE_CHOICES.map((role) => {
          const box = h("input", { type: "checkbox", id: `${prefix}-rule-role-${role.value}`, value: role.value, checked: choice.roles.includes(role.value) });
          box.addEventListener("change", () => {
            choice.roles = toggle(choice.roles, role.value, box.checked);
          });
          return h("div", { class: "oba-field oba-check" }, box, " ", h("label", { for: `${prefix}-rule-role-${role.value}` }, role.label));
        }),
      );
      const scopes = h(
        "fieldset",
        { class: "oba-fieldset" },
        h("legend", {}, "What an approval covers"),
        [
          { value: "ownSections", label: "The approver's own sections", help: "Another author's edit leaves your approval standing." },
          { value: "wholePiece", label: "The whole piece", help: "Any edit clears every approval." },
        ].map((item) => {
          const radio = h("input", { type: "radio", name: `${prefix}-rule-scope`, id: `${prefix}-rule-scope-${item.value}`, value: item.value, checked: choice.scope === item.value });
          radio.addEventListener("change", () => {
            choice.scope = item.value;
          });
          return h("div", { class: "oba-field oba-check" }, radio, " ", h("label", { for: `${prefix}-rule-scope-${item.value}` }, item.label), h("span", { class: "oba-small" }, ` ${item.help}`));
        }),
      );
      const confirm = h("input", { type: "checkbox", id: `${prefix}-rule-confirm` });
      const change = h("button", { class: "oba-btn oba-btn-primary", type: "button" }, "Change approval rule");
      change.addEventListener("click", async () => {
        ruleProblem.hidden = true;
        const built = approvalPolicyPayload(choice);
        if (built.error) {
          ruleProblem.textContent = built.error;
          ruleProblem.hidden = false;
          ruleProblem.focus();
          return;
        }
        change.disabled = true;
        try {
          const result = await this.api.call("PUT", "collaboration/approval-policy", { json: { publicationId: id, expectedRevision: rule.revision, policy: built.policy, confirmed: confirm.checked } });
          ruleStatus.textContent = result?.changed
            ? `The approval rule changed. ${result.cleared === 1 ? "1 approval was" : `${result?.cleared ?? 0} approvals were`} cleared; every required author reads the piece and approves again.`
            : "That is already the rule. Nothing changed.";
          await loadRule();
          ruleBlock.querySelector(`#${prefix}-rule-heading`)?.focus();
        } catch (error) {
          const failure = approvalRuleFailure(error);
          ruleProblem.textContent = failure.message;
          ruleProblem.hidden = false;
          ruleProblem.focus();
          if (failure.kind === "conflict" || failure.kind === "denied") await loadRule();
        } finally {
          change.disabled = false;
        }
      });
      ruleBody.replaceChildren(
        ...facts,
        kinds,
        people,
        roles,
        scopes,
        h("div", { class: "oba-field oba-check" }, confirm, " ", h("label", { for: `${prefix}-rule-confirm` }, "I understand that changing the rule clears every approval, and every required author approves again.")),
        h("div", { class: "oba-toolbar" }, change),
      );
    };
    const loadRule = async () => {
      ruleRequested = true;
      try {
        drawRule(await this.api.call("GET", `collaboration/approval-policy?publicationId=${encodeURIComponent(id)}`));
        ruleBlock.hidden = false;
      } catch {
        ruleBlock.hidden = true;
        ruleRequested = false; // try again on the next refresh
      }
    };

    const renderSharing = (reveal) => {
      const policy = REVEAL_POLICIES.find((item) => item.value === reveal.policy) || REVEAL_POLICIES[0];
      const slots = h(
        "ul",
        { class: "oba-member-list", "aria-label": "Everyone's drafts" },
        (reveal.slots || []).map((slot) =>
          h(
            "li",
            {},
            h("span", {}, revealSlotText(slot)),
            slot.kind !== "private" ? h("pre", { class: "oba-draft-revealed", tabindex: "0", "aria-label": `Text from ${slot.displayName || "a participant"}` }, slot.markdown || "") : null,
          ),
        ),
      );
      const parts = [
        h("h4", { id: `${prefix}-sharing-heading`, tabindex: "-1" }, "Sharing"),
        h("p", { class: "oba-small" }, h("strong", {}, `${policy.label}. `), policy.help, " Until a revision is shared, only its writer can read it."),
      ];
      if (reveal.slots?.length && saved.number) {
        if (reveal.ready) {
          const takeBack = h("button", { class: "oba-btn", type: "button" }, "Take back my offer");
          takeBack.addEventListener("click", () => runSharing("PUT", "collaboration/reveal/ready", { publicationId: id, revision: null }, () => "Your offer was taken back."));
          parts.push(h("p", { class: "oba-small" }, "You have offered a revision to share."), takeBack);
        } else if (policy.value !== "independent") {
          const offer = h("button", { class: "oba-btn", type: "button" }, `Offer revision ${saved.number} to the group`);
          const holder = h("div", {});
          offer.addEventListener("click", () => {
            const revision = saved.number; // what the writer confirms is exactly what is sent
            const yes = h("button", { class: "oba-btn oba-btn-danger", type: "button" }, `Share revision ${revision}`);
            const no = h("button", { class: "oba-btn", type: "button" }, "Cancel");
            const box = h(
              "div",
              { class: "oba-confirm", role: "group", "aria-labelledby": `${prefix}-offer-title`, tabindex: "-1" },
              h("p", { id: `${prefix}-offer-title`, class: "oba-confirm-title" }, `Share revision ${revision}?`),
              h("p", { class: "oba-small" }, "When the sharing rule is met, everyone who offered will read the revisions offered. A copy that has been read cannot be taken back. Later edits stay private."),
              h("div", { class: "oba-toolbar" }, yes, no),
            );
            holder.replaceChildren(box);
            box.focus();
            const close = () => {
              holder.replaceChildren();
              offer.focus();
            };
            no.addEventListener("click", close);
            box.addEventListener("keydown", (event) => {
              if (event.key === "Escape") close();
            });
            yes.addEventListener("click", () =>
              runSharing("PUT", "collaboration/reveal/ready", { publicationId: id, revision }, (result) =>
                `${result?.revealed ? "Revealed. Everyone who offered can now read the offered revisions." : "Offered. Nothing is shared until the rule is met."}${offeredMomentsText(result)}`,
              ),
            );
          });
          parts.push(offer, holder);
        }
      } else if (policy.value !== "independent" && !saved.number) {
        parts.push(h("p", { class: "oba-small" }, "Save a draft before you can offer it."));
      }
      if (reveal.canSetPolicy) {
        const select = h(
          "select",
          { id: `${prefix}-policy` },
          REVEAL_POLICIES.map((item) => h("option", { value: item.value, selected: item.value === reveal.policy }, `${item.label}: ${item.help}`)),
        );
        const confirm = h("input", { type: "checkbox", id: `${prefix}-policy-confirm` });
        const change = h("button", { class: "oba-btn", type: "button" }, "Change sharing rule");
        // The rule the coordinator read goes with the change, so a change made elsewhere is a
        // conflict, and a real change needs the confirmation because it clears every offer.
        change.addEventListener("click", () =>
          runSharing("PUT", "collaboration/reveal/policy", { publicationId: id, policy: select.value, expectedPolicy: reveal.policy, confirmed: confirm.checked }, (result) =>
            result?.changed === false ? "That is already the sharing rule. Nothing changed." : "The sharing rule changed. Every standing offer was cleared and nothing was shared.",
          ),
        );
        parts.push(
          h("div", { class: "oba-field" }, h("label", { for: `${prefix}-policy` }, "Sharing rule (coordinators)"), select),
          h("div", { class: "oba-field oba-check" }, confirm, " ", h("label", { for: `${prefix}-policy-confirm` }, "I understand that changing the sharing rule clears every standing offer, and nothing is shared by the change.")),
          change,
        );
        parts.push(ruleBlock);
      }
      if (reveal.slots?.length) parts.push(slots);
      if (reveal.slots?.length) parts.push(previewSection);
      parts.push(arrangement);
      const focused = arrangement.contains(document.activeElement) ? document.activeElement : null;
      sharing.replaceChildren(...parts);
      sharing.hidden = false;
      if (focused?.isConnected) focused.focus();
      if (!arrangementRequested) loadArrangement();
      if (reveal.canSetPolicy && !ruleRequested) loadRule();
    };

    const loadSharing = async () => {
      try {
        renderSharing(await this.api.call("GET", `collaboration/reveal?publicationId=${encodeURIComponent(id)}`));
      } catch {
        sharing.hidden = true;
      }
    };

    renderPrompts();
    const synthesis = (publication.roles || []).includes("contributor") ? this.synthesisPanel(publication, index) : null;
    const moments = (publication.roles || []).includes("contributor") ? this.momentsPanel(publication, index) : null;
    const details = h("details", { class: "oba-invitations oba-draft" }, h("summary", {}, "Your draft"), heading, h("p", { class: "oba-small" }, "Only you can read this draft. Nothing here is published."), status, problem, denied, editor, sharing, moments?.element, synthesis?.element);
    let loaded = false;
    details.addEventListener("toggle", async () => {
      if (!details.open || loaded) return;
      loaded = true;
      try {
        const result = await this.api.call("GET", `collaboration/draft?publicationId=${encodeURIComponent(id)}`);
        adoptDraft(result?.draft);
        text.value = saved.markdown;
        editor.hidden = false;
        refreshState();
      } catch (error) {
        const failure = draftFailure(error);
        if (failure.kind === "denied") denied.hidden = false;
        else {
          loaded = false;
          fail(error, { focus: false });
        }
      }
      await loadSharing();
      await synthesis?.load();
      await moments?.load();
    });
    return details;
  }

  /**
   * The continuing conversation: optional items the authors write after comparing their
   * reflections. Items are attributed, each named author approves their own items, and nothing
   * is required. Loads only when asked and only for a contributor of this reflection.
   */
  synthesisPanel(publication, index) {
    const id = publication.publicationId;
    const prefix = `oba-synthesis-${index}`;
    const heading = h("h4", { id: `${prefix}-heading`, tabindex: "-1" }, "Continuing conversation");
    const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const problem = h("p", { class: "oba-error", role: "alert", tabindex: "-1", hidden: true });
    const list = h("ul", { class: "oba-synthesis-list", "aria-label": "Continuing conversation items" });
    const form = h("form", { class: "oba-synthesis-form", novalidate: true, "aria-labelledby": `${prefix}-add-heading` });
    const root = h("div", { class: "oba-synthesis", hidden: true });
    let current = { revision: 0, items: [], authors: [], you: "" };
    let dismissed = promptsDismissed();
    // The item being edited survives a reload after a conflict: its id, kind, text and extra names.
    let editing = null;
    // The re-rendered controls, so focus can return to the one that was just used.
    const controls = new Map();
    // What the author typed survives a reload after a conflict: the form is rebuilt around it.
    const typed = { kind: "agreement", text: "" };
    let submitItem = (event) => event.preventDefault();
    form.addEventListener("submit", (event) => submitItem(event));

    const fail = (error) => {
      const failure = synthesisFailure(error);
      problem.textContent = failure.message;
      problem.hidden = false;
      problem.focus();
      return failure;
    };
    const clearProblem = () => {
      problem.hidden = true;
      problem.textContent = "";
    };
    // Re-rendering drops focus, so after a change it goes to the first enabled control named, else
    // to the panel heading (ADR 0019).
    const focusTo = (keys) => {
      for (const key of [keys].flat()) {
        const control = key ? controls.get(key) : null;
        if (control && !control.disabled) {
          control.focus();
          return;
        }
      }
      heading.focus();
    };
    const send = async (change, done, focusKeys) => {
      clearProblem();
      try {
        current = await this.api.call("POST", "collaboration/synthesis", { json: { publicationId: id, expectedRevision: current.revision, change } });
        if (change.action === "edit") editing = null;
        render();
        status.textContent = done;
        focusTo(focusKeys);
        return true;
      } catch (error) {
        const failure = fail(error);
        // A conflict reloads the current items around what was typed. A denial keeps the notice
        // and the typed text visible, so nothing typed is lost.
        if (failure.kind === "conflict") await load(false);
        return false;
      }
    };

    const kindSelect = (selectId, value) =>
      h("select", { id: selectId }, SYNTHESIS_KINDS.map((kind) => h("option", { value: kind.value, selected: kind.value === value }, kind.label)));

    const itemView = (item, position, total) => {
      const textId = `${prefix}-item-${item.id}`;
      const actions = h("div", { class: "oba-toolbar" });
      const body = h("div", { class: "oba-synthesis-body" }, h("pre", { class: "oba-draft-revealed", tabindex: "0", "aria-label": `${synthesisKindLabel(item.kind)} text` }, item.markdown));
      const ids = current.items.map((entry) => entry.id);
      const move = (label, delta) => {
        const button = h("button", { class: "oba-btn", type: "button", "aria-label": `${label}: ${synthesisKindLabel(item.kind)} item ${position + 1} of ${total}` }, label);
        const next = moveSynthesisItem(ids, item.id, delta);
        button.disabled = !next;
        button.addEventListener("click", () => send({ action: "reorder", order: next }, `Moved to position ${position + 1 + delta}.`, [`${item.id}:${delta < 0 ? "up" : "down"}`, `${item.id}:${delta < 0 ? "down" : "up"}`]));
        controls.set(`${item.id}:${delta < 0 ? "up" : "down"}`, button);
        return button;
      };
      actions.append(move("Move up", -1), move("Move down", 1));
      if (item.mine) {
        const approve = h("button", { class: "oba-btn oba-btn-primary", type: "button" }, item.approvedByYou ? "You approved this" : "Approve this item");
        approve.disabled = item.approvedByYou;
        approve.addEventListener("click", () => send({ action: "approve", id: item.id }, "You approved this item.", [`${item.id}:edit`]));
        const edit = h("button", { class: "oba-btn", type: "button" }, "Edit");
        const openEdit = (focusText) => {
          const area = h("textarea", { id: `${textId}-edit`, rows: "5", "aria-label": "Edit item text" });
          area.value = editing.markdown;
          const kind = kindSelect(`${textId}-kind`, editing.kind);
          const save = h("button", { class: "oba-btn oba-btn-primary", type: "button" }, "Save changes");
          const cancel = h("button", { class: "oba-btn", type: "button" }, "Cancel");
          const others = current.authors.filter((author) => !item.contributors.some((c) => c.id === author.id));
          const picks = others.map((author) => {
            const box = h("input", { type: "checkbox", value: author.id });
            box.checked = editing.added.includes(author.id);
            box.addEventListener("change", () => {
              editing.added = editing.added.filter((value) => value !== author.id);
              if (box.checked) editing.added.push(author.id);
            });
            return h("label", { class: "oba-check" }, box, ` Also name ${author.displayName}`);
          });
          area.addEventListener("input", () => {
            editing.markdown = area.value;
          });
          kind.addEventListener("change", () => {
            editing.kind = kind.value;
          });
          save.addEventListener("click", async () => {
            const added = picks.map((label) => label.querySelector("input")).filter((box) => box.checked).map((box) => box.value);
            await send({ action: "edit", id: item.id, kind: kind.value, markdown: area.value, addContributors: added }, "Item saved. Everyone named must approve it again.", [`${item.id}:edit`]);
          });
          cancel.addEventListener("click", () => {
            editing = null;
            render();
            status.textContent = "Edit cancelled. Nothing was changed.";
            focusTo(`${item.id}:edit`);
          });
          body.replaceChildren(
            h("p", { class: "oba-small" }, "Changing an item clears every approval of it, and everyone named must approve it again."),
            h("div", { class: "oba-field" }, h("label", { for: kind.id }, "Kind"), kind),
            h("div", { class: "oba-field" }, h("label", { for: area.id }, "Text (Markdown)"), area),
            ...picks,
            h("div", { class: "oba-toolbar" }, save, cancel),
          );
          if (focusText) area.focus();
        };
        edit.addEventListener("click", () => {
          editing = { id: item.id, kind: item.kind, markdown: item.markdown, added: [] };
          openEdit(true);
        });
        const withdraw = h("button", { class: "oba-btn", type: "button" }, "Take my name off");
        withdraw.addEventListener("click", () => send({ action: "withdraw", id: item.id }, "Your name was taken off this item."));
        actions.append(approve, edit, withdraw);
        controls.set(`${item.id}:edit`, edit);
        if (editing?.id === item.id) openEdit(false);
      }
      return h(
        "li",
        { class: "oba-synthesis-item" },
        h("p", { class: "oba-small" }, `Item ${position + 1} of ${total}. ${synthesisItemText(item)}`),
        body,
        actions,
      );
    };

    const renderForm = () => {
      const kind = kindSelect(`${prefix}-kind`, typed.kind);
      const area = h("textarea", { id: `${prefix}-text`, rows: "4", autocomplete: "off", "aria-describedby": `${prefix}-hint` });
      area.value = typed.text;
      area.addEventListener("input", () => {
        typed.text = area.value;
      });
      const picks = current.authors
        .filter((author) => author.id !== current.you)
        .map((author) => h("label", { class: "oba-check" }, h("input", { type: "checkbox", value: author.id }), ` Also speaks for ${author.displayName}`));
      const prompt = h("p", { class: "oba-small", id: `${prefix}-prompt` });
      const usePrompt = h("button", { class: "oba-btn", type: "button" }, "Use this prompt");
      const dismiss = h("button", { class: "oba-btn", type: "button" }, "Dismiss prompts");
      const showPrompts = h("button", { class: "oba-btn", type: "button" }, "Show prompts");
      const promptBox = h("div", { class: "oba-synthesis-prompt" }, prompt, usePrompt, " ", dismiss);
      const syncPrompt = () => {
        const kindPrompt = SYNTHESIS_KINDS.find((entry) => entry.value === kind.value)?.prompt || "";
        prompt.textContent = `Optional prompt: ${kindPrompt}`;
        promptBox.hidden = dismissed;
        showPrompts.hidden = !dismissed;
      };
      kind.addEventListener("change", () => {
        typed.kind = kind.value;
        syncPrompt();
      });
      usePrompt.addEventListener("click", () => {
        const kindPrompt = SYNTHESIS_KINDS.find((entry) => entry.value === kind.value)?.prompt || "";
        area.value = area.value ? `${area.value}\n\n${kindPrompt}` : kindPrompt;
        typed.text = area.value;
        area.focus();
        status.textContent = "Prompt added. You can edit or delete it.";
      });
      dismiss.addEventListener("click", () => {
        dismissed = true;
        rememberPromptsDismissed(true);
        syncPrompt();
        showPrompts.focus();
        status.textContent = "Prompts dismissed.";
      });
      showPrompts.addEventListener("click", () => {
        dismissed = false;
        rememberPromptsDismissed(false);
        syncPrompt();
        usePrompt.focus();
        status.textContent = "Prompts shown.";
      });
      const add = h("button", { class: "oba-btn oba-btn-primary", type: "submit" }, "Add item");
      submitItem = async (event) => {
        event.preventDefault();
        const others = picks.map((label) => label.querySelector("input")).filter((box) => box.checked).map((box) => box.value);
        typed.text = area.value;
        if (await send({ action: "add", kind: kind.value, markdown: area.value, others }, "Item added. Everyone named must approve it.")) {
          typed.text = "";
          const fresh = form.querySelector("textarea");
          if (fresh) fresh.value = "";
        }
      };
      form.replaceChildren(...[
        h("h5", { id: `${prefix}-add-heading` }, "Add an item"),
        h("p", { class: "oba-small", id: `${prefix}-hint` }, "Optional, and any length. Name the authors it speaks for; each of them must approve it before anything is published."),
        h("div", { class: "oba-field" }, h("label", { for: kind.id }, "Kind"), kind),
        promptBox,
        showPrompts,
        h("div", { class: "oba-field" }, h("label", { for: area.id }, "Text (Markdown)"), area),
        picks.length ? h("fieldset", {}, h("legend", {}, "Who else it speaks for"), ...picks) : null,
        add,
      ].filter(Boolean));
      syncPrompt();
    };

    const render = () => {
      const items = current.items || [];
      controls.clear();
      if (editing && !items.some((item) => item.id === editing.id && item.mine)) editing = null;
      list.replaceChildren(...items.map((item, position) => itemView(item, position, items.length)));
      list.hidden = items.length === 0;
      renderForm();
      root.hidden = false;
    };

    const load = async (announce = true) => {
      try {
        current = await this.api.call("GET", `collaboration/synthesis?publicationId=${encodeURIComponent(id)}`);
        render();
        if (announce) status.textContent = "";
      } catch {
        // Never hide a panel that already shows a notice or typed text; only a first load that
        // cannot reach the conversation leaves it out.
        if (announce) root.hidden = true;
      }
    };

    root.append(
      heading,
      h("p", { class: "oba-small" }, "After comparing your reflections you may add shared items: where you agree, differ, still wonder, or would apply it. None are required. Only the authors of this reflection can see them."),
      status,
      problem,
      list,
      form,
    );
    return { element: root, load };
  }

  /**
   * Media moments: the writer's own located observations and quotations in the reflection's
   * sources (ADR 0062 to 0064). Private by default; a moment proposed for the piece goes with the
   * draft revision the writer offers and every author approves it. Loads only when asked and only
   * for a contributor of this reflection. Links are the server's, derived from the source's own
   * address, so a missing or unsupported embed still leaves a working link or the location as text.
   */
  momentsPanel(publication, index) {
    const id = publication.publicationId;
    const prefix = `oba-moments-${index}`;
    const heading = h("h4", { id: `${prefix}-heading`, tabindex: "-1" }, "Moments in the sources");
    const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const problem = h("p", { class: "oba-error", role: "alert", tabindex: "-1", hidden: true });
    const list = h("ul", { class: "oba-moments-list", "aria-label": "Your moments" });
    const sharedBlock = h("div", { class: "oba-moments-shared", hidden: true });
    const form = h("form", { class: "oba-moments-form", novalidate: true, "aria-labelledby": `${prefix}-form-heading` });
    const root = h("div", { class: "oba-moments", hidden: true });
    let current = { revision: 0, moments: [], shared: [], sources: [], you: "" };
    // What the writer typed survives a conflict, a refusal and a reload: the form is rebuilt
    // around it. `editing` names the moment being changed and keeps what the form cannot edit.
    const blank = () => ({ source: "", kind: "timestamp", value: "", to: "", quote: "", speaker: "", rights: "", rightsNote: "", provenance: "", observation: "", publish: false });
    let typed = blank();
    let editing = null;
    // One save at a time: while a change is in flight the buttons that would start another are
    // disabled and a repeat submit is ignored, so a second request never carries a stale revision.
    // `typedEdits` counts the writer's own changes so a finished save never wipes newer typing.
    let busy = false;
    let typedEdits = 0;
    let formButtons = [];
    const itemButtons = new Set();
    const gate = (button) => {
      if (!button) return button;
      button.disabled = busy;
      if (busy) button.setAttribute("aria-disabled", "true");
      else button.removeAttribute("aria-disabled");
      return button;
    };
    const setBusy = (value) => {
      busy = value;
      for (const button of [...formButtons, ...itemButtons]) gate(button);
    };
    const controls = new Map();
    const fields = new Map();
    let submit = (event) => event.preventDefault();
    form.addEventListener("submit", (event) => submit(event));

    const clearProblem = () => {
      problem.hidden = true;
      problem.textContent = "";
      for (const field of fields.values()) field.removeAttribute?.("aria-invalid");
    };
    // The server names the field of the writer's own submission; the form marks that control.
    const SERVER_FIELDS = { source: "source", locators: "value", quotation: "quote", speaker: "speaker", content: "quote", rights: "rights", rightsNote: "rightsNote", observation: "observation" };
    const fail = (message, field) => {
      problem.textContent = message;
      problem.hidden = false;
      const control = fields.get(field);
      if (control) control.setAttribute("aria-invalid", "true");
      problem.focus();
    };
    const focusTo = (keys) => {
      for (const key of [keys].flat()) {
        const control = key ? controls.get(key) : null;
        if (control && !control.disabled) {
          control.focus();
          return;
        }
      }
      heading.focus();
    };
    const send = async (change, done, focusKeys) => {
      if (busy) return false;
      clearProblem();
      setBusy(true);
      try {
        current = await this.api.call("POST", "collaboration/moments", { json: { publicationId: id, expectedRevision: current.revision, change } });
        setBusy(false);
        render();
        status.textContent = done;
        focusTo(typeof focusKeys === "function" ? focusKeys() : focusKeys);
        return true;
      } catch (error) {
        setBusy(false);
        const failure = momentsFailure(error);
        fail(failure.message, SERVER_FIELDS[failure.field]);
        // A conflict reloads the current moments around what was typed; a denial keeps the notice
        // and the typed text visible.
        if (failure.kind === "conflict") await load(false);
        return false;
      }
    };

    const sourceName = (sourceId) => {
      const source = current.sources.find((entry) => entry.id === sourceId);
      return source ? `${source.title} (${source.kindLabel})` : "A source that is no longer listed";
    };

    // `stater` names whose rights statement it is: "you" for the writer's own moments.
    const momentBody = (moment, stater = "you") => {
      const parts = [];
      if (moment.quotation) {
        const rights = QUOTATION_RIGHTS.find((entry) => entry.value === moment.quotation.rights)?.label || "";
        const provenance = QUOTATION_PROVENANCE.find((entry) => entry.value === moment.quotation.provenance)?.label || "";
        const statement = stater === "you" ? "Rights, as you state them" : `Rights, as ${stater} states them`;
        const notices = Array.isArray(moment.notices) ? moment.notices : [];
        parts.push(
          h(
            "figure",
            { class: "oba-moment-quote" },
            h("blockquote", {}, h("p", { class: "oba-draft-revealed" }, moment.quotation.text)),
            // The server's one attribution line: speaker, source and location, as every view shows it.
            h("figcaption", { class: "oba-small" }, `— ${moment.attribution || `${sourceName(moment.source)}, ${moment.location}`}`),
          ),
          h("p", { class: "oba-small" }, `${statement}: ${rights}. ${provenance}.`, moment.quotation.rightsNote ? ` Rights note: ${moment.quotation.rightsNote}` : ""),
          notices.length
            ? h("ul", { class: "oba-moment-notices", "aria-label": "Things to check in this quotation" }, notices.map((notice) => h("li", {}, notice.message)))
            : null,
        );
      }
      if (moment.observation) parts.push(h("pre", { class: "oba-draft-revealed", tabindex: "0", "aria-label": "Observation" }, moment.observation));
      const linkText = momentLinkText(moment);
      parts.push(
        linkText
          ? h("p", {}, h("a", { href: moment.link.href, rel: "noopener noreferrer external", target: "_blank" }, linkText, h("span", { class: "oba-sr" }, ` in ${sourceName(moment.source)} (opens in a new tab)`)))
          : h("p", { class: "oba-small" }, "This source has no link. The location is kept with the moment."),
      );
      return parts;
    };

    const itemView = (moment, position, total) => {
      const actions = h("div", { class: "oba-toolbar" });
      const edit = h("button", { class: "oba-btn", type: "button", "aria-label": `Edit moment ${position + 1} of ${total}` }, "Edit");
      const remove = h("button", { class: "oba-btn", type: "button", "aria-label": `Remove moment ${position + 1} of ${total}` }, "Remove");
      const confirmHolder = h("div", {});
      itemButtons.add(gate(edit));
      itemButtons.add(gate(remove));
      edit.addEventListener("click", () => {
        if (busy) return;
        const [first, ...rest] = moment.locators || [];
        editing = { id: moment.id, position, locators: rest, language: moment.quotation?.language || "" };
        typed = {
          source: moment.source,
          kind: first?.kind || "timestamp",
          value: first?.value || "",
          to: first?.to || "",
          quote: moment.quotation?.text || "",
          speaker: moment.quotation?.speaker || "",
          rights: moment.quotation?.rights || "",
          rightsNote: moment.quotation?.rightsNote || "",
          provenance: moment.quotation?.provenance || "",
          observation: moment.observation || "",
          publish: moment.intent === "publication",
        };
        renderForm();
        status.textContent = `Editing moment ${position + 1}. The source stays the same; to locate another source, add a new moment.`;
        fields.get("value")?.focus();
      });
      remove.addEventListener("click", () => {
        if (busy) return;
        const yes = h("button", { class: "oba-btn oba-btn-danger", type: "button" }, "Remove this moment");
        const no = h("button", { class: "oba-btn", type: "button" }, "Cancel");
        const box = h(
          "div",
          { class: "oba-confirm", role: "group", "aria-labelledby": `${prefix}-remove-${moment.id}`, tabindex: "-1" },
          h("p", { id: `${prefix}-remove-${moment.id}`, class: "oba-confirm-title" }, `Remove moment ${position + 1}?`),
          h("p", { class: "oba-small" }, moment.intent === "publication" ? "It is taken out of the piece, and every approval must be given again." : "It is deleted. Nobody else ever saw it."),
          h("div", { class: "oba-toolbar" }, yes, no),
        );
        itemButtons.add(gate(yes));
        itemButtons.add(gate(no));
        confirmHolder.replaceChildren(box);
        box.focus();
        const close = () => {
          confirmHolder.replaceChildren();
          remove.focus();
        };
        no.addEventListener("click", close);
        box.addEventListener("keydown", (event) => {
          if (event.key === "Escape") close();
        });
        yes.addEventListener("click", () => {
          if (busy) return;
          if (editing?.id === moment.id) {
            editing = null;
            typed = blank();
          }
          send({ action: "remove", id: moment.id }, "Moment removed.", "list-heading");
        });
      });
      controls.set(`${moment.id}:edit`, edit);
      actions.append(edit, remove);
      return h(
        "li",
        { class: "oba-moment" },
        h("p", { class: "oba-small" }, h("strong", {}, `Moment ${position + 1} of ${total}. `), momentText(moment, current.sources)),
        ...momentBody(moment),
        actions,
        confirmHolder,
      );
    };

    const select = (selectId, options, value, placeholder) =>
      h(
        "select",
        { id: selectId },
        placeholder ? h("option", { value: "", selected: !value }, placeholder) : null,
        options.map((option) => h("option", { value: option.value, selected: option.value === value }, option.label)),
      );

    const renderForm = () => {
      fields.clear();
      const bind = (key, control, event = "input") => {
        fields.set(key, control);
        control.addEventListener(event, () => {
          typedEdits += 1;
          typed[key] = control.getAttribute("type") === "checkbox" ? control.checked : control.value;
          control.removeAttribute?.("aria-invalid");
        });
        return control;
      };
      const sourceSelect = bind(
        "source",
        select(`${prefix}-source`, current.sources.map((source) => ({ value: source.id, label: `${source.title} (${source.kindLabel})` })), typed.source, "Choose a source"),
        "change",
      );
      sourceSelect.disabled = Boolean(editing);
      const kind = bind("kind", select(`${prefix}-kind`, MOMENT_LOCATOR_KINDS, typed.kind), "change");
      const hint = h("p", { class: "oba-small", id: `${prefix}-location-hint` });
      const syncHint = () => {
        hint.textContent = MOMENT_LOCATOR_KINDS.find((entry) => entry.value === kind.value)?.hint || "";
      };
      kind.addEventListener("change", syncHint);
      const value = bind("value", h("input", { id: `${prefix}-value`, type: "text", autocomplete: "off", spellcheck: "false", "aria-describedby": `${prefix}-location-hint`, value: typed.value }));
      const to = bind("to", h("input", { id: `${prefix}-to`, type: "text", autocomplete: "off", spellcheck: "false", "aria-describedby": `${prefix}-location-hint`, value: typed.to }));
      const quote = bind("quote", h("textarea", { id: `${prefix}-quote`, rows: "3", "aria-describedby": `${prefix}-quote-hint` }));
      quote.value = typed.quote;
      const speaker = bind("speaker", h("input", { id: `${prefix}-speaker`, type: "text", autocomplete: "off", "aria-describedby": `${prefix}-speaker-hint`, value: typed.speaker }));
      const rights = bind("rights", select(`${prefix}-rights`, QUOTATION_RIGHTS, typed.rights, "Choose a rights status"), "change");
      rights.setAttribute("aria-describedby", `${prefix}-rights-guidance`);
      const rightsNote = bind("rightsNote", h("input", { id: `${prefix}-rightsNote`, type: "text", autocomplete: "off", maxlength: "500", "aria-describedby": `${prefix}-rights-note-hint`, value: typed.rightsNote }));
      // Guidance follows the chosen status; warnings follow the typed words. Both are advice that
      // never blocks saving, and the live region speaks only when what it says changes.
      const rightsGuidance = h("p", { class: "oba-small", id: `${prefix}-rights-guidance`, "aria-live": "polite" });
      const quoteCount = h("p", { class: "oba-small", id: `${prefix}-quote-count` });
      const quoteNotices = h("ul", { class: "oba-moment-notices", id: `${prefix}-quote-notices`, "aria-live": "polite", "aria-label": "Things to check in this quotation" });
      let shownNotices = null;
      const syncGuidance = () => {
        const guide = current.quotationGuide;
        rightsGuidance.textContent = typed.rights ? rightsGuidanceText(typed.rights, guide) : guide?.statement || "";
        const count = [...String(typed.quote ?? "")].length;
        quoteCount.textContent = count ? `${count} of ${guide?.maxQuotationChars || 1000} characters.${guide?.briefQuotationChars ? ` Above ${guide.briefQuotationChars} counts as long.` : ""}` : "";
        const notices = quotationNotices(typed, guide);
        const key = notices.map((notice) => notice.code).join(" ");
        if (key !== shownNotices) {
          shownNotices = key;
          quoteNotices.replaceChildren(...notices.map((notice) => h("li", {}, notice.message)));
          quoteNotices.hidden = notices.length === 0;
        }
      };
      for (const control of [quote, speaker]) control.addEventListener("input", syncGuidance);
      rights.addEventListener("change", syncGuidance);
      const provenance = bind("provenance", select(`${prefix}-provenance`, QUOTATION_PROVENANCE, typed.provenance, "Choose where the words came from"), "change");
      const observation = bind("observation", h("textarea", { id: `${prefix}-observation`, rows: "4" }));
      observation.value = typed.observation;
      const publish = bind("publish", h("input", { id: `${prefix}-publish`, type: "checkbox", checked: typed.publish, "aria-describedby": `${prefix}-publish-hint` }), "change");
      const save = h("button", { class: "oba-btn oba-btn-primary", type: "submit" }, editing ? "Save changes" : "Add moment");
      const cancel = editing ? h("button", { class: "oba-btn", type: "button" }, "Cancel editing") : null;
      formButtons = [save, cancel].filter(Boolean);
      for (const button of formButtons) gate(button);
      cancel?.addEventListener("click", () => {
        if (busy) return;
        const position = editing.position;
        const editedId = editing.id;
        editing = null;
        typed = blank();
        renderForm();
        status.textContent = `Edit of moment ${position + 1} cancelled. Nothing was changed.`;
        focusTo(`${editedId}:edit`);
      });
      submit = async (event) => {
        event.preventDefault();
        if (busy) return;
        clearProblem();
        const result = momentPayload(typed, editing || {});
        if (result.error) {
          fail(result.error, result.field);
          return;
        }
        const editedId = editing?.id;
        const change = editedId ? { action: "edit", id: editedId, moment: result.moment } : { action: "add", moment: result.moment };
        const before = new Set(current.moments.map((moment) => moment.id));
        const done = editedId ? (result.moment.intent === "publication" ? "Moment saved. Every author must approve the piece again." : "Moment saved.") : result.moment.intent === "publication" ? "Moment added and proposed for the piece. It is shared with the next revision you offer." : "Moment added. Only you can see it.";
        const typedBefore = typedEdits;
        const stored = await send(change, done, () => {
          const added = current.moments.find((moment) => !before.has(moment.id));
          return [`${editedId || added?.id}:edit`, "list-heading"];
        });
        // Reset only a form the writer left alone; text typed during the save stays as typed.
        if (stored && typedEdits === typedBefore) {
          editing = null;
          typed = blank();
          renderForm();
        }
      };
      const field = (control, label, extra = null) => h("div", { class: "oba-field" }, h("label", { for: control.id }, label), control, extra);
      form.replaceChildren(
        h("h5", { id: `${prefix}-form-heading` }, editing ? `Edit moment ${editing.position + 1}` : "Add a moment"),
        field(sourceSelect, "Source", editing ? h("p", { class: "oba-small" }, "A moment keeps its source.") : null),
        h(
          "fieldset",
          {},
          h("legend", {}, "Where in the source"),
          field(kind, "Kind of location"),
          hint,
          field(value, "Location"),
          field(to, "Ends at (optional, for a range)"),
        ),
        h(
          "fieldset",
          {},
          h("legend", {}, "Quotation (optional)"),
          h("p", { class: "oba-small", id: `${prefix}-quote-hint` }, "Someone else's words, exactly as said or written, up to 1,000 characters. Quote a moment; never paste a transcript."),
          field(quote, "Quoted words", h("div", {}, quoteCount, quoteNotices)),
          field(speaker, "Speaker (optional)", h("p", { class: "oba-small", id: `${prefix}-speaker-hint` }, "Who said or wrote the words in the source. The quotation is credited to the speaker, the source and the location you give.")),
          field(rights, "Rights (your statement)", rightsGuidance),
          field(rightsNote, "Rights note (optional)", h("p", { class: "oba-small", id: `${prefix}-rights-note-hint` }, "One line for your co-authors, such as who gave permission and when, or which licence applies. It is never published.")),
          field(provenance, "Where the words came from"),
        ),
        field(observation, "Your observation (Markdown, optional)"),
        h("div", { class: "oba-field oba-check" }, publish, " ", h("label", { for: publish.id }, "Propose this moment for the piece")),
        h("p", { class: "oba-small", id: `${prefix}-publish-hint` }, "A proposed moment is shared with the next draft revision you offer, and every author must approve it before anything is published. Later edits stay private until you offer a newer revision."),
        h("div", { class: "oba-toolbar" }, save, cancel),
      );
      syncHint();
      syncGuidance();
    };

    const listHeading = h("h5", { id: `${prefix}-list-heading`, tabindex: "-1" }, "Your moments");
    controls.set("list-heading", listHeading);

    const render = () => {
      const moments = sortMoments(current.moments, current.sources);
      if (editing && !moments.some((moment) => moment.id === editing.id)) editing = null;
      const keep = controls.get("list-heading");
      itemButtons.clear();
      controls.clear();
      controls.set("list-heading", keep);
      list.replaceChildren(...moments.map((moment, position) => itemView(moment, position, moments.length)));
      list.hidden = moments.length === 0;
      listHeading.textContent = moments.length ? `Your moments (${moments.length})` : "Your moments (none yet)";
      const shared = current.shared || [];
      sharedBlock.replaceChildren(
        h("h5", {}, "Moments others shared with you"),
        ...shared.map((entry) =>
          h(
            "section",
            { "aria-label": `Moments from ${entry.participant?.displayName || "a participant"}` },
            h("p", { class: "oba-small" }, h("strong", {}, entry.participant?.displayName || "A participant")),
            h(
              "ul",
              { class: "oba-moments-list" },
              sortMoments(entry.moments, current.sources).map((moment) =>
                h("li", { class: "oba-moment" }, h("p", { class: "oba-small" }, `${sourceName(moment.source)}, ${moment.location}.`), ...momentBody(moment, entry.participant?.displayName || "a participant")),
              ),
            ),
          ),
        ),
      );
      sharedBlock.hidden = shared.length === 0;
      renderForm();
      root.hidden = false;
    };

    const load = async (announce = true) => {
      try {
        current = await this.api.call("GET", `collaboration/moments?publicationId=${encodeURIComponent(id)}`);
        render();
        if (announce) status.textContent = "";
      } catch {
        if (announce) root.hidden = true;
      }
    };

    root.append(
      heading,
      h("p", { class: "oba-small" }, "Pin an observation or a short quotation to a time, page or chapter in one of this reflection's sources. Moments are private to you unless you propose them for the piece. Nothing here is published yet."),
      status,
      problem,
      listHeading,
      list,
      sharedBlock,
      form,
    );
    return { element: root, load };
  }

  /** The page an invitation link opens. The token is sent only when the person chooses. */
  async showInvitationAccept(token) {
    const registry = await this.api.call("GET", "contributors");
    const profiles = Object.entries(registry.contributors || {});
    const problem = h("p", { class: "oba-error", role: "alert", tabindex: "-1", hidden: true });
    const profile = h("select", { id: "oba-accept-profile" }, profiles.map(([key, value]) => h("option", { value: key }, value.name || key)));
    const answer = async (path, body, done) => {
      problem.hidden = true;
      try {
        await this.api.call("POST", `collaboration/invitations/${path}`, { json: body });
        location.hash = "#/shared";
        await this.showSharedReflections(done);
      } catch (error) {
        problem.textContent = error?.message || "That did not work.";
        problem.hidden = false;
        problem.focus();
      }
    };
    const accept = h("button", { class: "oba-btn oba-btn-primary", type: "button", disabled: !token || !profiles.length }, "Accept and join");
    const decline = h("button", { class: "oba-btn", type: "button", disabled: !token }, "Decline");
    accept.addEventListener("click", () => answer("accept", { token, contributorId: profile.value }, "You joined the shared reflection."));
    decline.addEventListener("click", () => answer("decline", { token }, "Invitation declined."));
    this.mount(
      this.shell(
        "shared",
        h(
          "section",
          { class: "oba-contributor-card" },
          h("h2", {}, "Invitation to a shared reflection"),
          token ? h("p", {}, `You are signed in as ${this.user}. An invitation only works for the account it names.`) : h("p", { class: "oba-notice" }, "This invitation link is not complete. Ask for a new one."),
          profiles.length ? h("div", { class: "oba-field" }, h("label", { for: "oba-accept-profile" }, "You will appear as"), profile) : h("p", { class: "oba-notice" }, "Add yourself as a contributor first. ", h("a", { href: "#/contributors" }, "Open Contributors")),
          problem,
          h("div", { class: "oba-toolbar" }, decline, h("span", { class: "oba-spacer" }), accept),
        ),
      ),
    );
  }

  // ---- analytics

  async showAnalytics(days) {
    let engagement = null;
    try {
      engagement = await this.api.call("GET", "engagement/settings");
    } catch {
      // Older servers still expose the local analytics dashboard.
    }
    let data;
    try {
      data = engagement?.enabled && engagement?.analytics && engagement?.credential?.configured
        ? await this.api.call("GET", `engagement/analytics?days=${days}`)
        : await this.api.call("GET", `analytics?days=${days}`);
    } catch (err) {
      if (err.status === 404 && engagement) {
        data = { days, from: "", to: "", views: 0, uniques: 0, allTimeViews: 0, firstDay: "", series: [], topPosts: [], referrers: [], agentRequests: 0, agents: [], agentPages: [] };
      } else if (err.status === 404) {
        this.mount(this.shell("analytics", h("p", { class: "oba-notice" }, "The built-in view counter is switched off (analytics.builtin in openblog.json).")));
        return;
      } else throw err;
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
    let hostedSettings = null;
    let moderation = null;
    if (engagement) {
      const enabled = h("input", { type: "checkbox", checked: engagement.enabled });
      const comments = h("input", { type: "checkbox", checked: engagement.comments });
      const hostedAnalytics = h("input", { type: "checkbox", checked: engagement.analytics });
      const endpoint = h("input", { type: "url", value: engagement.endpoint || `${String(this.meta.siteUrl || "").replace(/\/$/, "")}/api`, placeholder: "https://your-site.example/api" });
      const credential = h("input", { type: "password", value: "", autocomplete: "new-password", placeholder: "Leave blank to keep the saved token" });
      const credentialStatus = () => {
        if (engagement.credential?.source === "environment") {
          return engagement.credential.boundToEndpoint
            ? `Configured by ${engagement.credential.environmentName}; the environment token takes precedence.`
            : `Set ${engagement.credential.originEnvironmentName} to this endpoint's exact origin before Admin can use the environment token.`;
        }
        if (engagement.credential?.configured) return "A private moderation token is saved, bound to this origin, and never displayed.";
        if (engagement.credential?.privateConfigured) return "The saved token belongs to another origin. Enter the token again to bind it to this endpoint.";
        return "No moderation token is configured.";
      };
      const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" }, credentialStatus());
      const save = h("button", {
        class: "oba-btn oba-btn-primary",
        type: "button",
        onClick: async () => {
          save.disabled = true;
          status.textContent = "Saving hosted engagement settings…";
          try {
            const result = await this.api.call("PUT", "engagement/settings", { json: {
              enabled: enabled.checked,
              comments: comments.checked,
              analytics: hostedAnalytics.checked,
              endpoint: endpoint.value.trim(),
              etag: engagement.etag,
              credentialAction: credential.value.trim() ? "replace" : "keep",
              ...(credential.value.trim() ? { credential: credential.value.trim() } : {}),
            } });
            engagement = result;
            credential.value = "";
            status.className = engagement.credential?.configured ? "oba-ok" : "oba-notice";
            status.textContent = `${credentialStatus()} Rebuild or publish to update public pages.`;
          } catch (error) {
            status.className = "oba-error";
            status.textContent = error.message;
          } finally {
            save.disabled = false;
          }
        },
      }, "Save hosted settings");
      const clear = h("button", {
        class: "oba-btn oba-btn-danger oba-btn-link",
        type: "button",
        disabled: !engagement.credential?.privateConfigured,
        onClick: async () => {
          if (!confirm("Remove the saved moderation token? A server environment token, if present, will remain active.")) return;
          const result = await this.api.call("PUT", "engagement/settings", { json: {
            enabled: enabled.checked, comments: comments.checked, analytics: hostedAnalytics.checked,
            endpoint: endpoint.value.trim(), etag: engagement.etag, credentialAction: "clear",
          } });
          engagement = result;
          clear.disabled = true;
          status.textContent = "Saved moderation token removed.";
        },
      }, "Remove saved token");
      hostedSettings = h(
        "section",
        { class: "oba-assistant-provider-settings-body", "aria-labelledby": "oba-hosted-engagement-title" },
        h("h2", { id: "oba-hosted-engagement-title" }, "Hosted comments and analytics"),
        h("p", {}, "Netlify Functions can persist comments and view counts in Supabase. The public site receives only this function endpoint; Supabase URL and service-role credentials stay in Netlify environment variables."),
        h("p", { class: "oba-notice" }, "Required Netlify variables: SUPABASE_URL, SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY), OPENBLOG_SITE_ID, OPENBLOG_SITE_ORIGIN, OPENBLOG_ADMIN_API_KEY, and OPENBLOG_ANALYTICS_SALT."),
        h("label", {}, enabled, " Enable hosted engagement"),
        h("label", {}, comments, " Enable moderated comments"),
        h("label", {}, hostedAnalytics, " Store analytics in Supabase"),
        h("div", { class: "oba-field" }, h("label", {}, "Public function endpoint"), endpoint),
        h("div", { class: "oba-field" }, h("label", {}, "Moderation API token (write-only)"), credential),
        status,
        h("div", { class: "oba-toolbar" }, save, clear),
      );
      if (engagement.enabled && engagement.credential?.configured) {
        moderation = h("p", { class: "oba-small" }, "Moderate comments, with reader feedback, in the ", h("a", { href: moderationHash("pending") }, "Moderation inbox"), ".");
      }
    }
    this.mount(
      this.shell(
        "analytics",
        hostedSettings,
        moderation,
        ranges,
        h("div", { class: "oba-tiles" }, tile("Views", n(data.views), `${data.from} to ${data.to}`), tile("Unique visitors", n(data.uniques), "per page, per day"), tile("All-time views", n(data.allTimeViews), data.firstDay ? `since ${data.firstDay}` : ""), tile("AI agent requests", n(data.agentRequests), "server-observed user-agent claims")),
        bars,
        h("div", { class: "oba-columns" }, table("Top pages", posts, ["Page", "Views", "Visitors", "All time"]), table("Referrers", refs, ["Site", "Views"])),
        h("div", { class: "oba-columns" }, table("AI agents", agents, ["Agent", "Kind", "Requests"]), table("Pages requested by AI agents", agentPages, ["Page", "Requests", "Named agents"])),
        h("p", { class: "oba-small" }, "No cookies, addresses, or raw user-agent strings are stored. AI labels are aggregate user-agent claims and may be spoofed. Readers with Do Not Track or Global Privacy Control are not counted."),
      ),
    );
  }

  // ---- moderation inbox (ADR 0104)

  /**
   * One inbox for comments and reader feedback, moderated through this server, which alone holds
   * the hosted token. The server sends only what the signed-in account may see on each item's work,
   * with the decisions it may take; a passage that moved or changed is said so before anyone can
   * approve it. Published notes keep their responses and revision notes below the list.
   */
  async showModeration(tail, params) {
    const { state, kind } = parseModerationRoute(tail, params);
    const queueStatus = h("p", { class: "oba-small", role: "status", "aria-live": "polite", tabindex: "-1" }, `Loading ${MODERATION_STATE_LABELS[state].toLowerCase()} items…`);
    const stateNote = MODERATION_STATE_NOTES[state] ? h("p", { class: "oba-small" }, MODERATION_STATE_NOTES[state]) : null;
    const queue = h("ol", { class: "oba-feedback-list oba-moderation-list", "aria-labelledby": "oba-moderation-queue-title" });
    const more = h("button", { class: "oba-btn", type: "button", hidden: true }, "Show more");
    const publishedStatus = h("p", { class: "oba-small", role: "status", "aria-live": "polite", tabindex: "-1" }, "Loading published feedback…");
    const published = h("ol", { class: "oba-feedback-list", "aria-labelledby": "oba-feedback-published-title" });
    const stateTabs = h(
      "nav",
      { class: "oba-tabs oba-moderation-states", "aria-label": "Items by moderation state" },
      MODERATION_STATES.map((each) => h("a", { class: "oba-tab", href: moderationHash(each, kind), "aria-current": each === state ? "page" : null }, MODERATION_STATE_LABELS[each])),
    );
    const kindSelect = h("select", { id: "oba-moderation-kind", name: "kind" }, MODERATION_KINDS.map(([id, label]) => h("option", { value: id, selected: id === kind ? "" : null }, label)));
    kindSelect.value = kind;
    const kindFilter = h(
      "form",
      { class: "oba-moderation-filter", role: "search", "aria-label": "Filter by kind", onSubmit: (event) => {
        event.preventDefault();
        location.hash = moderationHash(state, kindSelect.value);
      } },
      h("label", { for: "oba-moderation-kind" }, "Kind"), " ", kindSelect, " ",
      h("button", { class: "oba-btn", type: "submit" }, "Show"),
    );
    let next = null;
    let shown = 0;
    let publishedEtag = "absent";
    // A message for a published card that outlives the reload replacing it, such as a conflict.
    const publishedNotices = new Map();
    const announce = (line, message, kind_) => {
      line.className = kind_ ? `oba-${kind_}` : "oba-small";
      line.textContent = message;
    };

    const loadPublished = async () => {
      try {
        const result = await this.api.call("GET", "engagement/feedback/published");
        publishedEtag = result.etag;
        const items = Array.isArray(result.items) ? result.items : [];
        published.replaceChildren(...items.map((item) => h("li", {}, publishedCard(item))));
        announce(publishedStatus, items.length ? `${items.length} note${items.length === 1 ? "" : "s"} published on your posts.` : "No reader feedback is published on your posts yet.");
      } catch (error) {
        published.replaceChildren();
        announce(publishedStatus, `Published feedback could not be loaded. ${error.message}`, "error");
      }
    };

    // One page of the inbox; `append` keeps what is shown and moves focus to the first new item.
    const loadQueue = async (append = false) => {
      const query = new URLSearchParams({ state });
      if (kind) query.set("kind", kind);
      if (append && next) query.set("after", next);
      more.disabled = true;
      try {
        const result = await this.api.call("GET", `engagement/moderation?${query}`);
        const items = Array.isArray(result.items) ? result.items : [];
        const cards = items.map((item) => h("li", {}, queueCard(item)));
        if (append) queue.append(...cards);
        else queue.replaceChildren(...cards);
        shown = append ? shown + items.length : items.length;
        next = result.next || null;
        more.hidden = !next;
        const skipped = result.invalid ? ` ${result.invalid} item${result.invalid === 1 ? " was" : "s were"} not valid and ${result.invalid === 1 ? "is" : "are"} not shown.` : "";
        const legacy = result.protocol === "legacy" ? " Some decisions need the hosted moderation schema; see the setup guide." : "";
        announce(queueStatus, inboxSummary(state, shown, Boolean(next)) + skipped + legacy);
        if (append) cards[0]?.querySelector("h3")?.focus();
      } catch (error) {
        if (!append) queue.replaceChildren();
        more.hidden = true;
        announce(queueStatus, `The inbox could not be loaded. ${error.message}`, error.status === 404 || error.status === 503 ? "notice" : "error");
      } finally {
        more.disabled = false;
      }
    };
    more.addEventListener("click", () => loadQueue(true));

    const reloadAll = async (message, kind_) => {
      await Promise.all([loadQueue(), loadPublished()]);
      if (message) {
        announce(queueStatus, message, kind_);
        queueStatus.focus();
      }
    };

    const queueCard = (item) => {
      const key = `${item.source}-${item.id}`;
      const titleId = `oba-moderation-${key}-title`;
      const line = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
      const where = item.post ? `“${item.post.title}”` : item.work;
      const card = h(
        "article",
        { class: "oba-context-card oba-feedback-item oba-moderation-item", "aria-labelledby": titleId, "data-moderation-id": item.id, "data-source": item.source },
        h("h3", { id: titleId, tabindex: "-1" }, `${item.kindLabel} on ${where}`),
        h("p", { class: "oba-small" }, `Received ${formatWhen(item.receivedAt)} · ${item.statusLabel}${item.reasonLabel ? ` (${item.reasonLabel})` : ""}${item.public ? " · shown on the post now" : ""}`),
        item.post ? null : h("p", { class: "oba-notice" }, "No post has this address now: it may have moved, been renamed or been unpublished."),
        h("p", { class: "oba-small" }, moderationRoleLine(item.role)),
        item.clarification?.askedAboutThisText ? h("p", { class: "oba-notice" }, "A clarification was asked about this text. It can never be approved; only the reader’s answer can.") : null,
        feedbackPassage(item.passage),
        item.purged ? h("p", { class: "oba-notice" }, "Its text, details and any name were deleted. Only the private record of decisions remains.") : null,
        item.report ? h("p", {}, h("strong", {}, "Ground: "), item.report.groundLabel) : null,
        item.purged || (item.source === "report" && !item.body) ? null : h("h4", {}, item.source === "comment" ? "The comment" : item.source === "report" ? "What the reader wrote" : "The reader’s note"),
        item.purged || (item.source === "report" && !item.body) ? null : h("p", { class: "oba-feedback-body" }, item.body),
        item.source === "report" ? reportedItem(item.target) : null,
        item.details?.sourceUrl ? h("p", {}, "Suggested source: ", h("a", { href: item.details.sourceUrl, target: "_blank", rel: "noopener noreferrer nofollow" }, item.details.sourceUrl)) : null,
        item.details?.suggestedText ? h("div", {}, h("p", {}, "Suggested wording:"), h("blockquote", { class: "oba-feedback-body" }, item.details.suggestedText)) : null,
        h("p", { class: "oba-small" }, moderationReaderLine(item.reader, item.source)),
        feedbackPreview(item.publicPreview),
      );
      const actions = h("div", { class: "oba-moderation-actions" });
      let acknowledge = null;
      const busy = (on) => card.querySelectorAll("button, select, input").forEach((control) => { control.disabled = on; });
      const act = async (action, reason) => {
        busy(true);
        announce(line, `${(item.actions.find((option) => option.action === action)?.label) || action}…`);
        try {
          const result = await this.api.call("PATCH", "engagement/moderation", { json: moderationRequest(item, action, reason, acknowledge?.checked) });
          await reloadAll(moderationOutcome(item, action, result), result.publishError ? "notice" : "ok");
        } catch (error) {
          busy(false);
          announce(line, error.message, "error");
          if (error.status === 409) await reloadAll(`${error.message} The list was reloaded.`, "error");
        }
      };
      for (const option of item.actions || []) {
        const guidanceId = `oba-moderation-${key}-${option.action}-guidance`;
        const guidance = h("p", { class: "oba-small oba-moderation-guidance", id: guidanceId }, option.guidance || "");
        if (option.confirm) {
          // A decision that cannot be undone needs its own confirmation first.
          const confirmId = `oba-moderation-${key}-${option.action}-confirm`;
          const confirmBox = h("input", { type: "checkbox", id: confirmId, "aria-describedby": guidanceId });
          actions.append(h("div", { class: "oba-moderation-action" },
            h("p", { class: "oba-feedback-acknowledge" }, confirmBox, " ", h("label", { for: confirmId }, option.confirm)),
            h("button", { class: "oba-btn oba-btn-danger", type: "button", "aria-describedby": guidanceId, onClick: () => {
              if (!confirmBox.checked) {
                announce(line, "Confirm that you understand this cannot be undone first.", "error");
                confirmBox.focus();
                return;
              }
              act(option.action);
            } }, option.label),
            guidance));
          continue;
        }
        if (!option.reasons?.length) {
          if (option.action === "approve" && item.passage?.acknowledge) {
            const checkId = `oba-moderation-${key}-acknowledge`;
            acknowledge = h("input", { type: "checkbox", id: checkId });
            actions.append(h("p", { class: "oba-feedback-acknowledge" }, acknowledge, " ", h("label", { for: checkId }, "I have read the passage as it is published now, and still want to approve this note.")));
          }
          actions.append(h("div", { class: "oba-moderation-action" },
            h("button", { class: option.action === "approve" ? "oba-btn oba-btn-primary" : "oba-btn", type: "button", "aria-describedby": guidanceId, onClick: () => {
              if (option.action === "approve" && acknowledge && !acknowledge.checked) {
                announce(line, "Confirm that you read the passage as it is now before approving.", "error");
                acknowledge.focus();
                return;
              }
              act(option.action);
            } }, option.label),
            guidance));
        } else {
          const selectId = `oba-moderation-${key}-${option.action}-reason`;
          const select = h("select", { id: selectId, "aria-describedby": guidanceId }, h("option", { value: "" }, "Choose a reason"), option.reasons.map((reason) => h("option", { value: reason.id }, reason.label)));
          actions.append(h("div", { class: "oba-moderation-action oba-feedback-reason" },
            h("label", { for: selectId }, `Reason to ${option.label.toLowerCase()}`), " ", select, " ",
            h("button", { class: option.action === "request-clarification" ? "oba-btn" : "oba-btn oba-btn-danger", type: "button", "aria-describedby": guidanceId, onClick: () => {
              if (!select.value) {
                announce(line, "Choose a reason first.", "error");
                select.focus();
                return;
              }
              act(option.action, select.value);
            } }, option.label),
            guidance));
        }
      }
      if (!item.actions?.length && item.role !== "contributing-author" && !["withdrawn"].includes(item.status)) {
        actions.append(h("p", { class: "oba-small" }, "No decision is open to you on this item."));
      }
      const mismatch = item.source === "feedback" ? feedbackPublicationMismatch(item) : null;
      if (mismatch && item.role === "site-admin") {
        actions.append(h("button", { class: "oba-btn", type: "button", onClick: async () => {
          busy(true);
          try {
            await this.api.call("POST", `engagement/feedback/${mismatch.action}`, { json: { id: item.id } });
            await reloadAll(mismatch.action === "publish" ? `Published on ${where}.` : `Taken off ${where}. Rebuild or publish to update the live site.`, "ok");
          } catch (error) {
            busy(false);
            announce(line, error.message, "error");
          }
        } }, mismatch.label));
        card.append(h("p", { class: "oba-notice" }, mismatch.notice));
      } else if (item.source === "feedback" && item.status === "approved" && item.published === true) {
        card.append(h("p", { class: "oba-small" }, "Published on the post. ", h("a", { href: `#oba-published-${item.id}`, onClick: (event) => {
          event.preventDefault();
          document.getElementById(`oba-published-${item.id}-response`)?.focus();
        } }, "Respond or record a revision note")));
      }
      card.append(actions, line);
      return card;
    };

    const publishedCard = (item) => {
      const key = item.id;
      const titleId = `oba-published-${key}-title`;
      const line = h("p", { class: "oba-small", role: "status", "aria-live": "polite", id: `oba-published-${key}-line`, tabindex: "-1" });
      if (publishedNotices.has(key)) {
        announce(line, publishedNotices.get(key), "error");
        publishedNotices.delete(key);
      }
      const responseId = `oba-published-${key}-response`;
      const response = h("textarea", { id: responseId, rows: "4", maxlength: "4000", "aria-describedby": `${responseId}-hint` });
      response.value = item.response?.text || "";
      const saveResponse = async (text) => {
        announce(line, "Saving your response…");
        try {
          const result = await this.api.call("PUT", "engagement/feedback/response", { json: { id: item.id, etag: publishedEtag, response: text } });
          publishedEtag = result.etag;
          announce(line, text === null ? "Response removed. Rebuild or publish to update the live site." : "Response saved. Rebuild or publish to update the live site.", "ok");
        } catch (error) {
          announce(line, error.message, "error");
          if (error.status === 409) {
            publishedNotices.set(key, error.message);
            await loadPublished();
            document.getElementById(`oba-published-${key}-line`)?.focus();
          }
        }
      };
      const noteId = `oba-published-${key}-note`;
      const dateId = `oba-published-${key}-date`;
      const claimId = `oba-published-${key}-claim`;
      const note = h("input", { type: "text", id: noteId, maxlength: "200", "aria-describedby": `${noteId}-hint` });
      const date = h("input", { type: "date", id: dateId, value: new Date().toISOString().slice(0, 10) });
      const claim = h("input", { type: "text", id: claimId, pattern: "[a-z0-9-]*", "aria-describedby": `${claimId}-hint` });
      const public_ = item.public;
      return h(
        "article",
        { class: "oba-context-card oba-feedback-item", id: `oba-published-${key}`, "aria-labelledby": titleId },
        h("h3", { id: titleId }, `${item.kindLabel} on ${item.postTitle ? `“${item.postTitle}”` : item.post}`),
        h("p", { class: "oba-small" }, `Received ${item.received} · approved ${item.approved} · ${item.name ? `shown as from ${item.name}` : "shown as from a reader"}`),
        public_ ? feedbackPreview(public_.provenance) : h("p", { class: "oba-notice" }, "This post is not loaded, so the note is not shown anywhere until it is."),
        h("p", { class: "oba-feedback-body" }, item.body),
        h("div", { class: "oba-field" },
          h("label", { for: responseId }, "Your public response"),
          response,
          h("p", { class: "oba-small", id: `${responseId}-hint` }, "Shown under the note on the post. Replying here sends nothing to the reader."),
        ),
        h("div", { class: "oba-toolbar" },
          h("button", { class: "oba-btn oba-btn-primary", type: "button", onClick: () => {
            if (!response.value.trim()) {
              announce(line, "Write a response first, or use Remove response.", "error");
              response.focus();
              return;
            }
            saveResponse(response.value);
          } }, "Save response"),
          item.response ? h("button", { class: "oba-btn oba-btn-danger oba-btn-link", type: "button", onClick: () => {
            response.value = "";
            saveResponse(null);
          } }, "Remove response") : null,
        ),
        h("details", { class: "oba-feedback-revision" },
          h("summary", {}, "Record a revision note"),
          h("p", { class: "oba-small", id: `${noteId}-hint` }, "If this note led you to change the post, say what changed. The note is public, listed with the post’s revision notes; don’t name or quote the reader. Recording it does not change the post: edit the post itself separately."),
          h("div", { class: "oba-field" }, h("label", { for: dateId }, "Date of the change"), date),
          h("div", { class: "oba-field" }, h("label", { for: claimId }, "Claim id (optional)"), claim, h("p", { class: "oba-small", id: `${claimId}-hint` }, "The id of a claim in Evidence Studio this change is about.")),
          h("div", { class: "oba-field" }, h("label", { for: noteId }, "What changed"), note),
          h("button", { class: "oba-btn", type: "button", onClick: async () => {
            if (!note.value.trim()) {
              announce(line, "Say what changed first.", "error");
              note.focus();
              return;
            }
            announce(line, "Adding the revision note…");
            try {
              await this.api.call("POST", "engagement/feedback/revision-note", { json: { post: item.post, date: date.value, claim: claim.value, note: note.value } });
              note.value = "";
              announce(line, "Revision note added to the post’s front matter. Rebuild or publish to update the live site.", "ok");
            } catch (error) {
              announce(line, error.data?.problems ? `${error.message} ${error.data.problems.join(" ")}` : error.message, "error");
            }
          } }, "Add revision note"),
        ),
        line,
      );
    };

    // Retention (ADRs 0103 and 0131): a dry run first, then a run of exactly what it listed.
    const retentionStatus = h("p", { class: "oba-small", role: "status", "aria-live": "polite", tabindex: "-1" }, "");
    const retentionReport = h("div", { class: "oba-retention-report" });
    const checkRetention = h("button", { class: "oba-btn", type: "button" }, "Check what retention would do");
    const showRetention = async () => {
      checkRetention.disabled = true;
      announce(retentionStatus, "Checking what is due…");
      try {
        const report = await this.api.call("GET", "engagement/retention");
        const confirmBox = h("input", { type: "checkbox", id: "oba-retention-confirm" });
        const auditBox = h("input", { type: "checkbox", id: "oba-retention-audit", checked: "" });
        const due = (report.items?.length || 0) > 0 || Object.values(report.audit || {}).some((count) => Number(count) > 0);
        const run = h("button", { class: "oba-btn oba-btn-danger", type: "button", disabled: due ? null : "" }, "Run retention now");
        run.addEventListener("click", async () => {
          if (!confirmBox.checked) {
            announce(retentionStatus, "Confirm that you understand purged text cannot be recovered first.", "error");
            confirmBox.focus();
            return;
          }
          run.disabled = true;
          announce(retentionStatus, "Running retention…");
          try {
            const result = await this.api.call("POST", "engagement/retention", { json: { asOf: report.asOf, audit: auditBox.checked } });
            const parts = [`${result.expired} expired`, `${result.purged} purged`];
            if (result.auditDeleted) parts.push(`${result.auditDeleted} old records deleted`);
            if (result.skipped) parts.push(`${result.skipped} skipped because they changed or were not due`);
            retentionReport.replaceChildren();
            announce(retentionStatus, `Retention ran: ${parts.join(", ")}.${result.more ? " More are due; check again to continue." : ""}`, "ok");
            retentionStatus.focus();
            await loadQueue();
          } catch (error) {
            run.disabled = false;
            announce(retentionStatus, error.message, "error");
            retentionStatus.focus();
          }
        });
        retentionReport.replaceChildren(
          h("ul", {}, retentionSummaryLines(report).map((text) => h("li", {}, text))),
          report.items?.length ? h("details", {}, h("summary", {}, `The ${report.items.length} item${report.items.length === 1 ? "" : "s"} due`),
            h("ul", {}, report.items.map((entry) => h("li", {}, `${entry.kindLabel}, ${entry.statusLabel.toLowerCase()} since ${formatWhen(entry.since)}, on ${entry.work}: ${entry.step === "expire" ? "expires" : "text deleted"}`)))) : null,
          due ? h("p", { class: "oba-feedback-acknowledge" }, confirmBox, " ", h("label", { for: "oba-retention-confirm" }, "I understand that purged text, details and names cannot be recovered.")) : null,
          due ? h("p", { class: "oba-feedback-acknowledge" }, auditBox, " ", h("label", { for: "oba-retention-audit" }, `Also delete private records of decisions older than ${report.periods.auditDays} days`)) : null,
          due ? run : null,
        );
        announce(retentionStatus, `Checked as of ${formatWhen(report.asOf)}. Nothing has changed yet.`);
      } catch (error) {
        retentionReport.replaceChildren();
        announce(retentionStatus, error.message, error.status === 404 || error.status === 403 ? "notice" : "error");
      } finally {
        checkRetention.disabled = false;
        retentionStatus.focus();
      }
    };
    checkRetention.addEventListener("click", showRetention);

    this.mount(
      this.shell(
        "moderation",
        h("p", {}, "Comments, the questions, suggested sources, suggested corrections and other interpretations readers sent about passages, and abuse reports, in one list. Nothing is published until it is approved, approving never changes your post, and a suggested correction stays a suggestion until you decide to edit the post. Nothing here e-mails anyone."),
        h("section", { class: "oba-feedback-section", "aria-labelledby": "oba-moderation-queue-title" }, h("h2", { id: "oba-moderation-queue-title" }, "Moderation queue"), stateTabs, kindFilter, stateNote, queueStatus, queue, more),
        h("section", { class: "oba-feedback-section", "aria-labelledby": "oba-feedback-published-title" }, h("h2", { id: "oba-feedback-published-title" }, "Published on your posts"), publishedStatus, published),
        h("section", { class: "oba-feedback-section", "aria-labelledby": "oba-retention-title" },
          h("h2", { id: "oba-retention-title" }, "Retention"),
          h("p", {}, "Unpublished reader text is not kept for ever: pending notes expire, and the text of rejected, removed and withdrawn items and of upheld reports is deleted after the periods set in openblog.json. Retention never runs on its own. Check what it would do first; nothing changes until you run it, and the private record of each decision is kept longer than any text."),
          checkRetention, retentionStatus, retentionReport),
      ),
    );
    await Promise.all([loadQueue(), loadPublished()]);
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

export class Editor {
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
    ui.subtitle = kind === "posts" ? h("input", { class: "oba-subtitle-input", id: "oba-subtitle", type: "text", placeholder: "Subtitle (optional)", value: f.subtitle || f.subheading || f.dek || "", "aria-label": "Subtitle" }) : null;
    ui.body = h("textarea", { class: "oba-body", id: "oba-body", spellcheck: "true", "aria-label": "Markdown", value: this.doc.body || "" });
    ui.richBody = h("div", {
      class: "oba-rich-body",
      contenteditable: "true",
      role: "textbox",
      "aria-multiline": "true",
      "aria-label": "Visual editor",
      spellcheck: "true",
    });
    const savedEditorMode = this.app.preferences.editorMode;
    this.editorMode = savedEditorMode;
    ui.editorModeButtons = ["visual", "markdown"].map((mode) =>
      h(
        "button",
        {
          type: "button",
          class: "oba-mode-button",
          "aria-pressed": String(mode === savedEditorMode),
          onClick: () => this.setEditorMode(mode),
        },
        mode === "visual" ? "Visual" : "Markdown",
      ),
    );
    ui.editorModeSwitch = h("div", { class: "oba-mode-switch", role: "group", "aria-label": "Writing mode" }, ui.editorModeButtons);
    ui.editorModeStatus = h("span", { class: "oba-small" });
    ui.assistantAutocompleteToggle = h("input", { type: "checkbox" });
    ui.assistantAutocompleteStatus = h(
      "p",
      { class: "oba-small oba-autocomplete-status", role: "status", "aria-live": "polite" },
      "AI autocomplete is off. Your draft is not sent while you type.",
    );
    ui.assistantCompletionText = h("p", { class: "oba-autocomplete-text" });
    ui.assistantCompletionAccept = h("button", { class: "oba-btn oba-btn-primary", type: "button", onClick: () => this.acceptAssistantCompletion() }, "Accept (Tab)");
    ui.assistantCompletionDismiss = h("button", { class: "oba-btn", type: "button", onClick: () => this.dismissAssistantCompletion("Suggestion dismissed.") }, "Dismiss (Esc)");
    ui.assistantCompletion = h(
      "aside",
      { class: "oba-autocomplete-suggestion", hidden: true, role: "region", "aria-label": "AI autocomplete suggestion" },
      h("strong", {}, "Suggested continuation"),
      ui.assistantCompletionText,
      h("div", { class: "oba-toolbar" }, ui.assistantCompletionAccept, ui.assistantCompletionDismiss),
    );
    ui.assistantAutocomplete = h(
      "section",
      { class: "oba-autocomplete-controls", "aria-label": "AI autocomplete" },
      h("label", { class: "oba-autocomplete-toggle" }, ui.assistantAutocompleteToggle, " AI autocomplete"),
      h("p", { class: "oba-help" }, "Off by default. When enabled, typing pauses send the current unsaved draft and your selected Assistant context to the configured provider."),
      ui.assistantAutocompleteStatus,
      ui.assistantCompletion,
    );
    ui.preview = h("iframe", { class: "oba-preview", title: "Preview", sandbox: "allow-scripts" });
    ui.previewMode = h(
      "select",
      { class: "oba-preview-width", "aria-label": "Preview representation or destination" },
      h("option", { value: "site" }, "Site"),
      ...(kind === "posts"
        ? [
            h("option", { value: "portable-html" }, "Portable HTML"),
            h("option", { value: "portable-markdown" }, "Portable Markdown"),
            h("option", { value: "portable-text" }, "Portable text"),
            h("option", { value: "destination:dev" }, "DEV"),
            h("option", { value: "destination:hashnode" }, "Hashnode"),
            h("option", { value: "destination:ghost" }, "Ghost"),
            h("option", { value: "destination:wordpress" }, "WordPress"),
            h("option", { value: "destination:medium" }, "Medium manual import"),
          ]
        : []),
    );
    ui.previewMarkdown = h("pre", { class: "oba-portable-markdown", hidden: true, tabindex: "0", "aria-label": "Portable Markdown preview" });
    ui.previewCopy = h("button", { type: "button", class: "oba-btn", disabled: true }, "Copy portable output");
    ui.previewDownload = h("button", { type: "button", class: "oba-btn", disabled: true }, "Download portable output");
    ui.previewCopy.addEventListener("click", () => this.exportPreviewArtifact(false));
    ui.previewDownload.addEventListener("click", () => this.exportPreviewArtifact(true));
    ui.previewMode.addEventListener("change", () => {
      this.showPreviewRepresentation();
      this.updatePreviewWarnings();
    });
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
    ui.evidenceExportStatus = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    ui.evidenceExportCsl = h("button", { class: "oba-btn", type: "button" }, "Download cited references (CSL JSON)");
    ui.evidenceExportBibtex = h("button", { class: "oba-btn", type: "button" }, "Download cited references (BibTeX)");
    ui.evidenceExportCsl.addEventListener("click", () => this.exportCitedReferences("csl-json"));
    ui.evidenceExportBibtex.addEventListener("click", () => this.exportCitedReferences("bibtex"));
    ui.evidenceExports = h(
      "section",
      { class: "oba-evidence-exports", "aria-label": "Portable bibliography", hidden: true },
      h("h3", {}, "Portable bibliography"),
      h("p", { class: "oba-small" }, "Only the public description of the references this post cites, exactly as its notes show them."),
      h("div", { class: "oba-toolbar" }, ui.evidenceExportCsl, ui.evidenceExportBibtex),
      ui.evidenceExportStatus,
    );
    ui.claimsRegion = h("div", { class: "oba-claims-region", "data-claims-region": "true" });
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
            const value = this.profileFieldDrafts.has(field.key) ? this.profileFieldDrafts.get(field.key) : "";
            const control = field.kind === "production-status"
              ? h("select", { id: `oba-profile-${field.key}` },
                  ...["idea", "scripting", "storyboarding", "generating", "editing", "scheduled", "released"]
                    .map((stage) => h("option", { value: stage, selected: stage === String(value || "idea").toLowerCase() }, `${stage[0].toUpperCase()}${stage.slice(1)}`)),
                )
              : h("input", {
                  id: `oba-profile-${field.key}`,
                  type: field.kind === "number" ? "number" : "text",
                  value,
                  inputmode: field.kind === "number" ? "numeric" : null,
                  step: field.kind === "number" ? "any" : null,
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
        if (ui.profile.value !== "field-journal") {
          void this.discardPendingTrack();
          this.profileFieldDrafts.set("route", "");
        }
        syncProfileHelp();
        syncProfileFields();
      });
      syncProfileHelp();
      syncProfileFields();
      side.push(h("div", { class: "oba-field" }, h("label", { for: "oba-profile" }, "Content profile"), ui.profile, ui.profileHelp), ui.profileFields);
      ui.description = h("textarea", { id: "oba-desc", rows: 3, value: f.description || "" });
      side.push(this.field("oba-desc", "Description", ui.description, "Shown in search results and feeds. Leave empty to use an excerpt."));
      ui.commentPolicy = h("select", { id: "oba-comments" },
        h("option", { value: "open", selected: !f.comments || f.comments === "open" || f.comments === "true" }, "Open — show comments and submission form"),
        h("option", { value: "locked", selected: f.comments === "locked" }, "Locked — show approved comments only"),
        h("option", { value: "hidden", selected: f.comments === "hidden" || f.comments === "false" }, "Hidden — do not show comments"),
      );
      side.push(this.field("oba-comments", "Comments", ui.commentPolicy, "Applied when hosted comments are enabled for the site."));
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
    const captureButton = kind === "posts" ? h("button", { class: "oba-btn", type: "button", "data-research-capture": "true", onClick: () => this.openResearchCapture() }, "Capture research") : null;
    const quizButton = kind === "posts" ? h("button", { class: "oba-btn oba-btn-feature", type: "button", onClick: () => this.openKnowledgeCheck() }, "✦ Add knowledge check") : null;
    ui.imageFile = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/avif", class: "oba-sr", tabindex: "-1", "aria-hidden": "true" });
    ui.imageFile.addEventListener("change", async () => {
      const file = ui.imageFile.files[0];
      if (file) await this.insertImage(file);
      ui.imageFile.value = "";
    });
    const back = h("a", { class: "oba-btn", href: `#/${kind}` }, "← Back");
    const toolbar = h("div", { class: "oba-toolbar oba-editor-actions" }, back, ui.saveBtn, ui.deleteBtn, imageButton, captureButton, quizButton, ui.imageFile, ui.live, h("span", { class: "oba-small" }, "Ctrl+S saves"));

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
    ui.blockStyle = h(
      "select",
      { class: "oba-block-style", "aria-label": "Text style" },
      [
        ["paragraph", "Paragraph"],
        ["heading-2", "Heading 2"],
        ["heading-3", "Heading 3"],
        ["heading-4", "Heading 4"],
        ["heading-5", "Heading 5"],
        ["heading-6", "Heading 6"],
      ].map(([value, label]) => h("option", { value }, label)),
    );
    ui.blockStyle.addEventListener("change", () => {
      this.formatWriting(ui.blockStyle.value);
      ui.blockStyle.value = "paragraph";
    });
    const formatButtons = [
      ["bold", "B", "Bold (Ctrl+B)"],
      ["italic", "I", "Italic (Ctrl+I)"],
      ["link", "Link", "Link"],
      ["quote", "Quote", "Block quote"],
      ["list", "Bullets", "Bulleted list"],
      ["ordered-list", "Numbers", "Numbered list"],
      ["code", "Code", "Inline or fenced code"],
    ];
    ui.formatToolbar = h(
      "div",
      { class: "oba-format-toolbar", role: "group", "aria-label": "Writing formatting" },
      ui.blockStyle,
      formatButtons.map(([command, label, title]) =>
        h("button", { type: "button", class: `oba-format-button${command === "italic" ? " is-italic" : ""}`, title, "aria-label": title, onClick: () => this.formatWriting(command) }, label),
      ),
      kind === "posts"
        ? [
            h("button", { type: "button", class: "oba-format-button", title: "Insert Abstract section", onClick: () => this.addResearchSection("abstract") }, "Abstract"),
            h("button", { type: "button", class: "oba-format-button", title: "Insert References section", onClick: () => this.addResearchSection("references") }, "References"),
            h("button", { type: "button", class: "oba-format-button", title: "Insert or edit a citation", "aria-label": "Cite a source", "data-citation-open": "true", onClick: () => this.openCitationDialog() }, "Cite"),
            h("button", { type: "button", class: "oba-format-button", title: "Make a claim from the selected words, in Evidence Studio", "aria-label": "Make a claim from the selected words", "data-claim-from-selection": "true", onClick: () => void this.claimFromSelection() }, "Claim"),
          ]
        : null,
    );
    ui.formatToolbar.addEventListener("mousedown", () => this.captureVisualSelection());
    // The status stays rendered (visually hidden while empty) so its first message is announced.
    ui.citationStatus = h("span", { class: "oba-small", role: "status", "aria-live": "polite" });
    ui.citationUndo = h("button", { class: "oba-btn", type: "button", hidden: true, "data-citation-undo": "true", onClick: () => this.undoCitation() }, "Undo citation");
    ui.citationBar = kind === "posts" ? h("div", { class: "oba-toolbar oba-citation-bar" }, ui.citationStatus, ui.citationUndo) : null;
    ui.assistantStatus = h("p", { class: "oba-assistant-status-copy", role: "status", "aria-live": "polite" }, "Loading assistant configuration…");
    ui.assistantStatusBadge = h("span", { class: "oba-assistant-status-badge", "data-tone": "loading" }, "Checking…");
    ui.assistantProviderType = h("dd", {}, "Loading…");
    ui.assistantModel = h("dd", {}, "Loading…");
    ui.assistantDestination = h("dd", {}, "Loading…");
    ui.assistantConfigured = h("dd", {}, "Checking…");
    ui.assistantCapabilities = h("dd", {}, "Checking…");
    ui.assistantSettingsProvider = h(
      "select",
      {
        onChange: () => {
          this.updateAssistantProviderFields(true);
        },
      },
      Object.entries(ASSISTANT_PROVIDERS).map(([value, provider]) => h("option", { value }, provider.label)),
    );
    ui.assistantSettingsEndpoint = h("input", { type: "url", placeholder: "https://provider.example/generate", autocomplete: "off" });
    ui.assistantSettingsModel = h("input", { type: "text", placeholder: "Provider model", autocomplete: "off" });
    ui.assistantSettingsCredential = h("input", { type: "password", placeholder: "Leave blank to keep the saved credential", autocomplete: "new-password" });
    ui.assistantSettingsStatus = h("p", { class: "oba-small", role: "status", "aria-live": "polite" }, "Provider settings load when the Assistant opens.");
    ui.assistantSettingsSave = h("button", { class: "oba-btn oba-btn-primary", type: "button", onClick: () => this.saveAssistantSettings("save") }, "Save provider settings");
    ui.assistantSettingsClear = h("button", { class: "oba-btn oba-btn-danger oba-btn-link", type: "button", disabled: true, onClick: () => this.clearAssistantCredential() }, "Remove saved credential");
    ui.assistantSkillsStatus = h("p", { class: "oba-small", role: "status", "aria-live": "polite" }, "Skills load when the Assistant opens.");
    ui.assistantReviewSkills = h("div", { class: "oba-skill-list", role: "group", "aria-label": "Review skills" });
    ui.assistantReviewStatus = h("p", { class: "oba-notice", role: "status", "aria-live": "polite" }, "No review has run. Your draft is unchanged.");
    ui.assistantReviewDisclosure = h("div", { class: "oba-assistant-disclosure" });
    ui.assistantReviewResults = h("section", { class: "oba-assistant-review-results", tabindex: "-1", role: "region", "aria-label": "Review results" });
    ui.assistantReviewRun = h("button", { class: "oba-btn oba-btn-primary", type: "button", onClick: () => this.runAssistantReview() }, "Run document review");
    ui.assistantReviewUndo = h("button", { class: "oba-btn", type: "button", hidden: true, onClick: () => this.undoAssistantSuggestion() }, "Undo applied suggestion");
    ui.assistantInteractionStatus = h("p", { class: "oba-notice", role: "status", "aria-live": "polite" }, "Generated interactions remain editable proposals until you review and insert them into the unsaved draft.");
    ui.assistantInteractionCreate = h("button", { class: "oba-btn oba-btn-primary", type: "button" }, "Create knowledge-check proposal");
    ui.assistantCodeInteractionCreate = h("button", { class: "oba-btn", type: "button" }, "Create runnable-code proposal");
    bindAssistantInteractionControl(this, ui.assistantInteractionCreate);
    bindAssistantInteractionControl(this, ui.assistantCodeInteractionCreate, "code");
    ui.assistantCatalog = h("div", { class: "oba-skill-list", "aria-label": "Assistant skill catalog" });
    ui.assistantSkillEditorStatus = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    ui.assistantSkillEditor = h("textarea", { rows: 16, "aria-label": "Project skill Markdown", spellcheck: false });
    ui.assistantSkillNew = h("button", { class: "oba-btn", type: "button", onClick: () => this.beginAssistantSkill() }, "Create project skill");
    ui.assistantSkillSave = h("button", { class: "oba-btn oba-btn-primary", type: "button", onClick: () => this.saveAssistantSkill() }, "Save project skill");
    this.assistantContextDocuments = [];
    this.assistantContextSelected = new Set();
    ui.assistantContextStatus = h("p", { class: "oba-notice", role: "status", "aria-live": "polite" }, "Open Context to load author and site context.");
    ui.assistantContextSafety = h("p", { class: "oba-notice is-warning", role: "alert", hidden: true });
    ui.assistantContextCards = h("div", { class: "oba-assistant-context-cards" });
    ui.assistantReferenceName = h("input", { type: "text", placeholder: "notes.md", "aria-label": "Reference filename" });
    ui.assistantReferenceVisibility = h("select", { "aria-label": "Reference visibility" }, h("option", { value: "portable" }, "Portable"), h("option", { value: "private" }, "Private"));
    ui.assistantReferenceContent = h("textarea", { rows: 6, "aria-label": "Reference Markdown or text" });
    ui.assistantReferenceCreate = h("button", { class: "oba-btn oba-btn-primary", type: "button", onClick: () => this.createAssistantReference() }, "Add reference");
    ui.assistantReferenceCards = h("div", { class: "oba-assistant-context-cards" });
    ui.assistantPostSnapshots = h("div", { class: "oba-assistant-context-cards" });
    ui.assistantContextDisclosure = h("div", { class: "oba-assistant-disclosure", "aria-live": "polite" }, h("p", {}, "No context selected."));
    ui.assistantUrlInput = h("input", { type: "url", placeholder: "https://example.com/reference", "aria-label": "Reference URL" });
    ui.assistantUrlStatus = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    ui.assistantUrlPreview = h("div", { class: "oba-url-context-preview" });
    ui.assistantUrlRetrieve = h("button", { class: "oba-btn", type: "button", onClick: () => this.retrieveAssistantUrlContext() }, "Retrieve URL snapshot");
    const assistantViews = {
      review: h(
        "section",
        { class: "oba-assistant-empty", "data-assistant-view": "review", "aria-labelledby": "oba-assistant-review-title" },
        h("h3", { id: "oba-assistant-review-title" }, "Document review"),
        h("p", {}, "Choose review skills, inspect the disclosure, then send the current unsaved document explicitly. Findings are AI-generated advice and never change the draft."),
        ui.assistantSkillsStatus,
        ui.assistantReviewSkills,
        h("aside", { class: "oba-assistant-disclosure-panel", "aria-labelledby": "oba-review-disclosure-title" }, h("h4", { id: "oba-review-disclosure-title" }, "Review disclosure"), ui.assistantReviewDisclosure),
        h("div", { class: "oba-toolbar" }, ui.assistantReviewRun, ui.assistantReviewUndo),
        ui.assistantReviewStatus,
        ui.assistantReviewResults,
      ),
      interactions: h(
        "section",
        { class: "oba-assistant-empty", "data-assistant-view": "interactions", "aria-labelledby": "oba-assistant-interactions-title", hidden: true },
        h("h3", { id: "oba-assistant-interactions-title" }, "Interactions"),
        h("p", {}, "Draft a knowledge check, runnable Rust example, or small coding challenge from selected text or the current section. Every result stays editable until you insert it."),
        ui.assistantInteractionStatus,
        h("div", { class: "oba-toolbar" }, ui.assistantInteractionCreate, ui.assistantCodeInteractionCreate),
      ),
      context: h(
        "section",
        { class: "oba-assistant-context", "data-assistant-view": "context", "aria-labelledby": "oba-assistant-context-title", hidden: true },
        h("h3", { id: "oba-assistant-context-title" }, "Context"),
        h("p", {}, "Portable context can be shared with the project. Private context stays under .openblog/private and must remain outside Git."),
        ui.assistantContextStatus,
        ui.assistantContextSafety,
        h("section", { class: "oba-assistant-disclosure-panel", "aria-labelledby": "oba-url-context-title" }, h("h4", { id: "oba-url-context-title" }, "Add URL snapshot"), h("p", {}, "Retrieve a supported page once, inspect its untrusted text, then save a stable snapshot. Reviews never refetch it."), this.field("oba-url-context", "HTTP(S) reference URL", ui.assistantUrlInput), ui.assistantUrlStatus, h("div", { class: "oba-toolbar" }, ui.assistantUrlRetrieve), ui.assistantUrlPreview),
        ui.assistantContextCards,
        h("section", { class: "oba-assistant-context-tools", "aria-labelledby": "oba-reference-context-title" }, h("h4", { id: "oba-reference-context-title" }, "Text references"), h("p", {}, "Add a bounded Markdown or plain-text source. Reference content is treated as untrusted data."), this.field("oba-reference-name", "Filename (.md or .txt)", ui.assistantReferenceName), this.field("oba-reference-visibility", "Visibility", ui.assistantReferenceVisibility), this.field("oba-reference-content", "Reference content", ui.assistantReferenceContent), ui.assistantReferenceCreate, ui.assistantReferenceCards),
        h("section", { class: "oba-assistant-context-tools", "aria-labelledby": "oba-post-snapshots-title" }, h("h4", { id: "oba-post-snapshots-title" }, "Existing post snapshots"), h("p", {}, "Select an immutable snapshot of an existing post without copying images or other repository files."), ui.assistantPostSnapshots),
        h("aside", { class: "oba-assistant-disclosure-panel", "aria-labelledby": "oba-assistant-disclosure-title" }, h("h4", { id: "oba-assistant-disclosure-title" }, "Context disclosure"), h("p", {}, "Selected context that would be sent with an explicit Assistant request:"), ui.assistantContextDisclosure),
        h("div", { class: "oba-skill-editor" }, h("h4", {}, "Skill catalog"), h("p", {}, "Skills are non-executable Markdown instructions. Article and reference content remains untrusted data."), ui.assistantCatalog, h("h4", {}, "Project skill Markdown"), ui.assistantSkillEditorStatus, ui.assistantSkillEditor, h("div", { class: "oba-toolbar" }, ui.assistantSkillNew, ui.assistantSkillSave)),
      ),
    };
    const activateAssistantView = (view) => {
      for (const [name, section] of Object.entries(assistantViews)) section.hidden = name !== view;
      ui.assistantViewButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.assistantView === view)));
      if (view === "context") void this.loadAssistantContext();
    };
    ui.assistantViewButtons = ["review", "interactions", "context"].map((view) =>
      h("button", { class: "oba-tab", type: "button", "data-assistant-view": view, "aria-pressed": String(view === "review"), onClick: () => activateAssistantView(view) }, view[0].toUpperCase() + view.slice(1)),
    );
    ui.assistantViewNav = h("nav", { class: "oba-assistant-nav", "aria-label": "Assistant views" }, ui.assistantViewButtons);
    let paneButtons = [];
    const activatePane = (pane, focus = false) => {
      if (pane !== "write") this.captureVisualSelection();
      applyPaneSelection(this.root, paneButtons, pane);
      this.syncMoreTools(pane);
      if (pane === "release") this.updateReleaseKit();
      else if (pane === "field") this.updateFieldReview();
      else if (pane === "assistant") {
        void this.loadAssistantStatus();
        void this.loadAssistantSettings();
        void this.loadAssistantSkills();
        void this.loadAssistantContext();
        this.renderAssistantReviewSummary();
      }
      else if (["preview", "social", "accessibility", "evidence"].includes(pane)) {
        this.renderPreview();
        if (pane === "evidence") void this.loadClaims();
      }
      else {
        clearTimeout(this.previewTimer);
        this.previewRequest += 1;
      }
      if (focus) {
        const container = this.root.querySelector(`[data-pane="${pane}"]`);
        const target = pane === "write" ? this.writingSurface() : pane === "preview" ? this.ui.preview : container?.querySelector("input,select,textarea,button,[tabindex]");
        requestAnimationFrame(() => target?.focus());
      }
    };
    this.activatePane = activatePane;
    const paneLabels = { write: "Write", preview: "Site preview", social: "Social", release: "Release kit", field: "Field review", optimize: "Optimize", settings: "Settings", accessibility: "Accessibility", evidence: "Evidence", assistant: "Assistant" };
    const editorPanes = ["write", "preview", "social", "release", "field", "optimize", "settings", "accessibility", "evidence", ...(kind === "posts" ? ["assistant"] : [])];
    paneButtons = editorPanes.map((pane) =>
      h(
        "button",
        {
          class: "oba-tab",
          type: "button",
          "data-pane-target": pane,
          "aria-pressed": String(pane === "write"),
          title: pane === "assistant" ? "Assistant (Alt+0)" : null,
          onClick: () => activatePane(pane),
        },
        paneLabels[pane],
      ),
    );
    this.paneLabels = paneLabels;
    this.optionalPanes = editorPanes.filter((pane) => !ADMIN_ESSENTIAL_PANES.includes(pane));
    this.paneButtonMap = new Map(editorPanes.map((pane, index) => [pane, paneButtons[index]]));
    this.primaryPaneNav = h("div", { class: "oba-editor-primary" });
    this.advancedPaneActions = h("div", { class: "oba-editor-advanced-actions" });
    this.moreToolsSummary = h("summary", {}, "More tools");
    this.advancedPaneDetails = h("details", { class: "oba-editor-advanced" }, this.moreToolsSummary, this.advancedPaneActions);
    const viewNav = h("nav", { class: "oba-editor-nav", "aria-label": "Editor views" }, this.primaryPaneNav, this.advancedPaneDetails);
    ui.socialCardPreview = h(
      "article",
      { class: "oba-social-card", tabindex: "-1", "aria-label": "Social card preview" },
      ui.socialImage,
      h("div", { class: "oba-social-copy" }, ui.socialSite, ui.socialTitle, ui.socialDescription, ui.socialUrl),
    );
    ui.releaseStatus = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    ui.releaseIssues = h("ul", { class: "oba-release-issues" });
    ui.releaseWorkflow = h("ol", { class: "oba-release-workflow", "aria-label": "Production workflow" });
    ui.releaseOutput = h("textarea", { class: "oba-release-output", rows: 14, readonly: true, "aria-label": "YouTube release description" });
    ui.releaseCopy = h(
      "button",
      {
        class: "oba-btn oba-btn-primary",
        type: "button",
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(ui.releaseOutput.value);
            ui.releaseStatus.textContent = "Release description copied.";
          } catch {
            ui.releaseOutput.select();
            ui.releaseStatus.textContent = "Copy is unavailable; the release description is selected.";
          }
        },
      },
      "Copy release description",
    );
    ui.fieldStatus = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    ui.fieldIssues = h("ul", { class: "oba-release-issues" });
    ui.fieldPrivacy = h(
      "select",
      { id: "oba-field-privacy" },
      [
        ["hidden", "Hidden (safest)"],
        ["trimmed", "Trim endpoints"],
        ["approximate", "Approximate outline"],
        ["exact", "Exact route + download"],
      ].map(([value, label]) => h("option", { value, selected: value === String(this.profileFieldDrafts?.get("locationPrivacy") || f.locationPrivacy || "hidden").toLowerCase() }, label)),
    );
    ui.fieldTrim = h("input", { id: "oba-field-trim", type: "number", min: 0, value: 200, inputmode: "numeric" });
    ui.fieldFile = h("input", { id: "oba-field-file", type: "file", accept: ".gpx,application/gpx+xml" });
    ui.fieldFacts = h("dl", { class: "oba-social-meta" });
    ui.fieldCharts = h("div", { class: "oba-field-charts" });
    ui.fieldPrivacy.addEventListener("change", () => {
      this.profileFieldDrafts.set("locationPrivacy", ui.fieldPrivacy.value);
      if (ui.fieldPrivacy.value !== "exact") {
        void this.discardPendingTrack();
        this.profileFieldDrafts.set("route", "");
      }
      const control = ui.profileFieldControls?.get("locationPrivacy");
      if (control) control.value = ui.fieldPrivacy.value;
      this.app.dirty = true;
      this.markDirty();
      this.updateFieldReview();
    });
    ui.fieldImport = h("button", { class: "oba-btn oba-btn-primary", type: "button", onClick: () => this.importGpx() }, "Analyze GPX locally");

    this.root = h(
      "div",
      { class: "oba-editor", "data-editor-view": "write", "data-preview-width": savedPreviewWidth },
      h(
        "div",
        { class: "oba-main" },
        toolbar,
        ui.status,
        ui.title,
        ui.subtitle,
        viewNav,
        h(
          "div",
          { class: "oba-panes" },
          h(
            "section",
            { class: "oba-pane oba-markdown-pane", "data-pane": "write", "aria-label": "Writing editor" },
            paneHeader("Write", "Editor", h("div", { class: "oba-editor-mode" }, ui.editorModeSwitch)),
            ui.formatToolbar,
            ui.citationBar,
            ui.richBody,
            ui.body,
            ui.assistantAutocomplete,
          ),
          h(
            "section",
            { class: "oba-pane oba-preview-pane", "data-pane": "preview", "aria-label": "Live preview" },
            paneHeader("Review", "Site preview", h("div", { class: "oba-preview-tools" }, ui.previewTheme, ui.previewMode, ui.previewWidth)),
            ui.previewWarnings,
            h("div", { class: "oba-preview-tools", "aria-label": "Portable output actions" }, ui.previewCopy, ui.previewDownload),
            h("div", { class: "oba-preview-canvas" }, ui.preview, ui.previewMarkdown),
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
            { class: "oba-pane oba-release-pane", "data-pane": "release", "aria-label": "Video release kit" },
            paneHeader("Publish", "Video release kit", ui.releaseStatus),
            h(
              "div",
              { class: "oba-release-workspace" },
              h("p", {}, "Write timestamp lines in the Markdown draft. OpenBlog validates them and composes a YouTube-ready description from the current summary, chapters, and AI-assistance disclosure."),
              ui.releaseWorkflow,
              ui.releaseIssues,
              ui.releaseOutput,
              h("div", { class: "oba-toolbar" }, ui.releaseCopy),
            ),
          ),
          h(
            "section",
            { class: "oba-pane oba-field-pane", "data-pane": "field", "aria-label": "Field journal review" },
            paneHeader("Publish", "Field Review", ui.fieldStatus),
            h(
              "div",
              { class: "oba-release-workspace" },
              h("p", {}, "Analyze a GPX file in this browser. Hidden, trimmed, and approximate modes save only derived statistics and normalized drawing points; only Exact uploads the source track."),
              this.field("oba-field-privacy", "Location privacy", ui.fieldPrivacy),
              this.field("oba-field-trim", "Trim each endpoint (metres)", ui.fieldTrim),
              this.field("oba-field-file", "GPX track", ui.fieldFile),
              h("div", { class: "oba-toolbar" }, ui.fieldImport),
              ui.fieldIssues,
              ui.fieldFacts,
              ui.fieldCharts,
            ),
          ),
          kind === "posts"
            ? h(
                "section",
                { class: "oba-pane oba-assistant-pane", "data-pane": "assistant", "aria-label": "Assistant workspace" },
                paneHeader("Assist", "Assistant", h("span", { class: "oba-small" }, "Alt+0")),
                h(
                  "div",
                  { class: "oba-assistant-workspace" },
                  h(
                    "aside",
                    { class: "oba-assistant-provider", "aria-label": "Assistant provider" },
                    h("div", { class: "oba-assistant-provider-heading" }, h("h3", {}, "AI provider"), ui.assistantStatusBadge),
                    ui.assistantStatus,
                    h(
                      "details",
                      { class: "oba-assistant-provider-details" },
                      h("summary", {}, "Connection details"),
                      h(
                        "dl",
                        { class: "oba-social-meta" },
                        h("div", {}, h("dt", {}, "Type"), ui.assistantProviderType),
                        h("div", {}, h("dt", {}, "Model"), ui.assistantModel),
                        h("div", {}, h("dt", {}, "Destination"), ui.assistantDestination),
                        h("div", {}, h("dt", {}, "Credential"), ui.assistantConfigured),
                        h("div", {}, h("dt", {}, "Capabilities"), ui.assistantCapabilities),
                      ),
                    ),
                    h(
                      "details",
                      { class: "oba-assistant-provider-settings" },
                      h("summary", {}, "Edit provider settings"),
                      h(
                        "div",
                        { class: "oba-assistant-provider-settings-body" },
                        h("p", { class: "oba-small" }, "Connect a supported AI API directly, route through OpenRouter, or use a compatible custom HTTPS service. This is optional; your other writing tools keep working without it."),
                        this.field("oba-assistant-provider-choice", "Provider", ui.assistantSettingsProvider, "Choose a native API provider, OpenRouter, or your own compatible HTTPS endpoint."),
                        (ui.assistantEndpointField = this.field("oba-assistant-endpoint", "Generation endpoint URL", ui.assistantSettingsEndpoint, "The HTTPS address that receives generation requests.")),
                        this.field("oba-assistant-model", "Model", ui.assistantSettingsModel, "Required for every native provider. OpenRouter has no default; enter a routed model ID such as provider/model."),
                        this.field("oba-assistant-credential", "API key (write-only)", ui.assistantSettingsCredential, "Leave blank to keep the saved key. Its value is never displayed."),
                        ui.assistantSettingsStatus,
                        h("p", { class: "oba-assistant-settings-note" }, "A server environment credential overrides a saved credential."),
                        h("div", { class: "oba-assistant-settings-actions" }, ui.assistantSettingsSave, ui.assistantSettingsClear),
                      ),
                    ),
                  ),
                  h("div", { class: "oba-assistant-main" }, ui.assistantViewNav, assistantViews.review, assistantViews.interactions, assistantViews.context),
                ),
              )
            : null,
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
                ui.evidenceExports,
                h("h3", {}, "Author-controlled signals"),
                h(
                  "ul",
                  { class: "oba-accessibility-manual" },
                  ["Visible Abstract and References sections", "DOI and license syntax", "Resolvable reference links", "Defined Markdown footnotes", "Citation syntax, keys and reference details", "Cited locations, which only a person can check"].map((item) => h("li", {}, item)),
                ),
              ),
              ui.evidenceFindings,
            ),
            ui.claimsRegion,
          ),
        ),
        h("footer", { class: "oba-editor-status" }, ui.saveState, h("span", { class: "oba-spacer" }), ui.documentStats, ui.editorModeStatus),
      ),
    );
    this.applyWorkspacePreferences(this.app.preferences);
    return this.root;
  }

  slugFromPath() {
    const name = (this.doc.path || "").split("/").pop().replace(/\.md$/, "");
    return name.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  }

  writingSurface() {
    return this.editorMode === "visual" ? this.ui.richBody : this.ui.body;
  }

  setEditorMode(mode, persist = true) {
    if (!["visual", "markdown"].includes(mode)) return;
    if (this.editorMode === "visual" && mode === "markdown") this.syncRichToMarkdown();
    this.editorMode = mode;
    if (mode === "visual") this.renderRichEditor();
    this.ui.richBody.hidden = mode !== "visual";
    this.ui.body.hidden = mode !== "markdown";
    this.root.dataset.writingMode = mode;
    this.ui.editorModeButtons.forEach((button, index) => button.setAttribute("aria-pressed", String(["visual", "markdown"][index] === mode)));
    this.ui.editorModeStatus.textContent = `${mode === "visual" ? "Visual" : "Markdown"} · Markdown saved · UTF-8`;
    if (persist) {
      void this.app.persistEditorMode(mode);
      this.writingSurface().focus();
    }
  }

  applyWorkspacePreferences(preferences) {
    if (!this.primaryPaneNav || !this.advancedPaneActions) return;
    const layout = editorPaneLayout(preferences, [...this.paneButtonMap.keys()]);
    this.morePanes = layout.more;
    this.primaryPaneNav.replaceChildren(...layout.primary.map((pane) => this.paneButtonMap.get(pane)));
    this.advancedPaneActions.replaceChildren(...layout.more.map((pane) => this.paneButtonMap.get(pane)));
    this.advancedPaneDetails.hidden = layout.more.length === 0;
    this.syncMoreTools(this.root?.dataset.editorView || "write");
    if (this.root) {
      this.root.dataset.workspacePreset = preferences.preset;
      this.root.dataset.workspaceDensity = preferences.density;
      if (this.editorMode !== preferences.editorMode) this.setEditorMode(preferences.editorMode, false);
    }
  }

  /**
   * Name the active view on the More tools menu when it lives there, and close
   * the menu after a choice. Focus inside the closing menu moves to its summary,
   * which now names the chosen view, instead of falling back to the page.
   */
  syncMoreTools(pane) {
    if (!this.advancedPaneDetails) return;
    const inMore = this.morePanes?.includes(pane);
    this.moreToolsSummary.textContent = inMore ? `More tools: ${this.paneLabels[pane]}` : "More tools";
    if (this.advancedPaneActions?.contains(document.activeElement)) this.moreToolsSummary.focus();
    this.advancedPaneDetails.open = false;
  }

  renderRichEditor() {
    const editor = this.ui.richBody;
    editor.replaceChildren();
    this.visualDirty = false;
    for (const block of parseVisualMarkdown(this.ui.body.value)) {
      if (block.type === "space") continue;
      if (block.type === "protected") {
        const card = h(
          "section",
          {
            class: "oba-protected-block",
            contenteditable: "false",
            "data-markdown": block.source,
            "aria-label": `${block.label} block`,
          },
          h("div", {}, h("strong", {}, block.label), h("span", {}, "Preserved exactly in Markdown")),
          h(
            "div",
            { class: "oba-protected-actions" },
            h("button", { type: "button", onClick: () => this.editProtectedBlock(card) }, "Edit in Markdown"),
            h("button", { type: "button", "aria-label": `Move ${block.label} up`, onClick: () => this.moveProtectedBlock(card, -1) }, "↑"),
            h("button", { type: "button", "aria-label": `Move ${block.label} down`, onClick: () => this.moveProtectedBlock(card, 1) }, "↓"),
            h("button", { type: "button", "aria-label": `Remove ${block.label}`, onClick: () => this.removeProtectedBlock(card) }, "Remove"),
          ),
        );
        editor.append(card);
        continue;
      }
      const source = block.source.replace(/\n+$/, "");
      if (block.type === "heading") {
        const heading = h(`h${block.level}`, { "data-visual-block": "heading" });
        appendVisualInline(heading, block.text);
        editor.append(heading);
      } else if (block.type === "code") {
        const lines = source.split("\n");
        const pre = h("pre", { "data-visual-block": "code", "data-language": block.language || "" }, h("code", {}, lines.slice(1, -1).join("\n")));
        editor.append(pre);
      } else if (block.type === "unordered-list" || block.type === "ordered-list") {
        const firstNumber = block.type === "ordered-list" ? /^\s*(\d+)[.)]\s+/.exec(source)?.[1] : null;
        const listAttrs = { "data-visual-block": block.type };
        if (firstNumber && firstNumber !== "1") listAttrs.start = firstNumber;
        const list = h(block.type === "ordered-list" ? "ol" : "ul", listAttrs);
        for (const line of source.split("\n")) {
          const match = /^\s*(?:[-*+]\s+|\d+[.)]\s+)(.*)$/.exec(line);
          if (!match) continue;
          const item = h("li");
          appendVisualInline(item, match[1]);
          list.append(item);
        }
        editor.append(list);
      } else if (block.type === "quote") {
        const quote = h("blockquote", { "data-visual-block": "quote" });
        appendVisualLines(quote, source.split("\n").map((line) => line.replace(/^ {0,3}>\s?/, "")).join("\n"));
        editor.append(quote);
      } else {
        const paragraph = h("p", { "data-visual-block": "paragraph" });
        appendVisualLines(paragraph, source);
        editor.append(paragraph);
      }
    }
    if (!editor.children.length) editor.append(h("p", { "data-visual-block": "paragraph" }, h("br")));
  }

  richEditorMarkdown() {
    const blocks = [...this.ui.richBody.children].map(visualBlockMarkdown);
    return blocks.filter((block) => block.length).join("\n\n") + (blocks.length ? "\n" : "");
  }

  syncRichToMarkdown() {
    if (this.editorMode !== "visual" || !this.visualDirty) return;
    this.ui.body.value = this.richEditorMarkdown();
  }

  visualChanged() {
    this.visualDirty = true;
    this.syncRichToMarkdown();
    this.ui.body.dispatchEvent(new Event("input", { bubbles: true }));
  }

  editProtectedBlock(card) {
    const source = card.dataset.markdown || "";
    this.syncRichToMarkdown();
    this.setEditorMode("markdown");
    const start = this.ui.body.value.indexOf(source.replace(/\n+$/, ""));
    if (start >= 0) this.ui.body.setSelectionRange(start, start + source.replace(/\n+$/, "").length);
    this.ui.body.focus();
  }

  moveProtectedBlock(card, direction) {
    const sibling = direction < 0 ? card.previousElementSibling : card.nextElementSibling;
    if (!sibling) return;
    if (direction < 0) card.parentElement.insertBefore(card, sibling);
    else card.parentElement.insertBefore(sibling, card);
    this.visualChanged();
    card.querySelector("button")?.focus();
  }

  removeProtectedBlock(card) {
    card.remove();
    this.visualChanged();
    this.ui.richBody.focus();
  }

  /** Claims and evidence links about this post, in Evidence Studio. Only a saved post can carry them. */
  async loadClaims() {
    const region = this.ui?.claimsRegion;
    if (!region) return;
    if (this.kind !== "posts") {
      region.replaceChildren();
      return;
    }
    if (this.isNew || !this.doc.path) {
      this.claimsStudio = null;
      region.replaceChildren(h("p", { class: "oba-small", "data-claims-unsaved": "true" }, "Save the post to record claims about it and link evidence to them."));
      return;
    }
    if (!this.claimsStudio) {
      this.claimsStudio = createClaimsStudio({
        api: this.app.api,
        post: () => ({ path: this.doc.path, etag: this.doc.etag, dirty: Boolean(this.app.dirty), slug: slugify(String(this.f.slug || "")) || this.slugFromPath() }),
        selection: () => this.claimSelection(),
      });
      region.replaceChildren(this.claimsStudio.element);
    }
    try {
      await this.claimsStudio.load();
    } catch (error) {
      if (error.status === 401) this.app.showLogin("Your session ended. Sign in again to see this post's claims.");
    }
  }

  /** The words selected in the draft, as a claim anchor (`{ anchor }`) or the reason there is none (`{ error }`). */
  claimSelection() {
    if (this.editorMode === "visual") {
      const range = this.visualSelection;
      const blockOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.("[data-visual-block]") || null;
      const block = blockOf(range?.startContainer);
      const whole = block && block === blockOf(range?.endContainer) && block.parentElement === this.ui.richBody;
      const children = [...this.ui.richBody.children];
      let where = { index: -1, type: "" };
      if (whole && this.visualDirty) {
        // The draft was written from the editor, which leaves out blocks that write no Markdown
        // (an empty paragraph), so only blocks that write some are counted.
        const markdown = visualBlockMarkdown(block);
        where = { index: children.filter((child) => visualBlockMarkdown(child).length).indexOf(block), type: block.dataset.visualBlock, markdown, text: visualBlockText(block) };
      } else if (whole) {
        where = { index: children.indexOf(block), type: block.dataset.visualBlock, count: children.length, text: visualBlockText(block) };
      }
      return visualSelectionAnchor(this.ui.body.value, range?.toString?.() || "", where);
    }
    return claimSelectionAnchor(this.ui.body.value, this.ui.body.selectionStart, this.ui.body.selectionEnd);
  }

  /** Open Evidence Studio and start a claim from the selected words, from the writing toolbar. */
  async claimFromSelection() {
    this.captureVisualSelection();
    this.activatePane?.("evidence");
    await this.loadClaims();
    await this.claimsStudio?.newClaim();
  }

  captureVisualSelection() {
    if (this.editorMode !== "visual") return;
    const selection = getSelection();
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      if (this.ui.richBody.contains(range.commonAncestorContainer)) this.visualSelection = range.cloneRange();
    }
  }

  restoreVisualSelection() {
    if (!this.visualSelection) return;
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(this.visualSelection);
  }

  formatWriting(command) {
    if (this.editorMode === "markdown") {
      this.formatMarkdown(command);
      return;
    }
    const editor = this.ui.richBody;
    editor.focus();
    this.restoreVisualSelection();
    const heading = /^heading-([2-6])$/.exec(command);
    if (heading) document.execCommand("formatBlock", false, `h${heading[1]}`);
    else if (command === "paragraph") document.execCommand("formatBlock", false, "p");
    else if (command === "bold" || command === "italic") document.execCommand(command, false);
    else if (command === "quote") document.execCommand("formatBlock", false, "blockquote");
    else if (command === "list") document.execCommand("insertUnorderedList", false);
    else if (command === "ordered-list") document.execCommand("insertOrderedList", false);
    else if (command === "link") {
      const url = prompt("Link address (https://… or a site path)");
      if (!url) return;
      const safe = safeVisualUrl(url);
      if (!safe) {
        this.flash("error", "Use an HTTP(S), email, anchor, or site-relative link.");
        return;
      }
      document.execCommand("createLink", false, safe);
    } else if (command === "code") {
      const selection = getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (!range || !editor.contains(range.commonAncestorContainer)) return;
      const code = h("code", {}, range.collapsed ? "code" : range.extractContents());
      range.insertNode(code);
      range.selectNodeContents(code);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    this.visualChanged();
  }

  async setAssistantAutocomplete(enabled) {
    this.assistantAutocompleteEnabled = Boolean(enabled);
    this.assistantAutocompleteGeneration = (this.assistantAutocompleteGeneration || 0) + 1;
    clearTimeout(this.assistantAutocompleteTimer);
    this.dismissAssistantCompletion("", false);
    if (!enabled) {
      this.ui.assistantAutocompleteStatus.textContent = "AI autocomplete is off. Your draft is not sent while you type.";
      return;
    }
    this.ui.assistantAutocompleteStatus.textContent = "Checking the Assistant provider…";
    const status = await this.loadAssistantStatus();
    if (!this.assistantAutocompleteEnabled) return;
    if (!status?.configured || status.capabilities?.autocomplete !== true) {
      this.assistantAutocompleteEnabled = false;
      this.ui.assistantAutocompleteToggle.checked = false;
      this.ui.assistantAutocompleteStatus.textContent = "AI autocomplete is unavailable. Configure a provider in Assistant; non-AI writing remains available.";
      return;
    }
    this.ui.assistantAutocompleteStatus.textContent = "AI autocomplete is on. Suggestions appear after you pause typing; nothing is inserted automatically.";
  }

  scheduleAssistantAutocomplete() {
    this.assistantAutocompleteGeneration = (this.assistantAutocompleteGeneration || 0) + 1;
    clearTimeout(this.assistantAutocompleteTimer);
    this.dismissAssistantCompletion("", false);
    if (!this.assistantAutocompleteEnabled) return;
    const generation = this.assistantAutocompleteGeneration;
    this.assistantAutocompleteTimer = setTimeout(() => this.requestAssistantAutocomplete(generation), 850);
  }

  captureAssistantAutocomplete() {
    this.syncRichToMarkdown();
    const markdown = this.ui.body.value;
    const requestInputs = {
      title: this.ui.title.value,
      metadata: this.collect(),
      contextIds: [...(this.assistantContextSelected || [])],
    };
    if (this.editorMode === "markdown") {
      const start = this.ui.body.selectionStart;
      const end = this.ui.body.selectionEnd;
      if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
      return { mode: "markdown", markdown, prefix: Array.from(markdown.slice(0, start)).slice(-8_000).join(""), suffix: Array.from(markdown.slice(end)).slice(0, 8_000).join(""), start, end, ...requestInputs };
    }
    const selection = globalThis.getSelection?.();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!this.ui.richBody.contains(range.commonAncestorContainer)) return null;
    const parent = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (!parent || parent.closest?.(".oba-protected-block")) return null;
    const block = parent.closest?.("[data-visual-block]");
    if (!block) return null;
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(block);
    after.setStart(range.endContainer, range.endOffset);
    return {
      mode: "visual",
      markdown,
      prefix: Array.from(before.toString()).slice(-8_000).join(""),
      suffix: Array.from(after.toString()).slice(0, 8_000).join(""),
      range: range.cloneRange(),
      ...requestInputs,
    };
  }

  assistantAutocompleteCaptureIsCurrent(capture) {
    if (!capture || this.editorMode !== capture.mode || this.ui.body.value !== capture.markdown) return false;
    if (this.ui.title.value !== capture.title || JSON.stringify(this.collect()) !== JSON.stringify(capture.metadata)) return false;
    if (JSON.stringify([...(this.assistantContextSelected || [])]) !== JSON.stringify(capture.contextIds)) return false;
    if (capture.mode === "markdown") return this.ui.body.selectionStart === capture.start && this.ui.body.selectionEnd === capture.end;
    const selection = globalThis.getSelection?.();
    if (!selection?.rangeCount) return false;
    const current = selection.getRangeAt(0);
    return current.startContainer === capture.range.startContainer && current.startOffset === capture.range.startOffset && current.endContainer === capture.range.endContainer && current.endOffset === capture.range.endOffset;
  }

  async requestAssistantAutocomplete(generation) {
    if (this.disposed || !this.assistantAutocompleteEnabled || generation !== this.assistantAutocompleteGeneration) return;
    if (this.assistantAutocompleteActive) {
      this.assistantAutocompleteQueued = true;
      return;
    }
    const capture = this.captureAssistantAutocomplete();
    if (!capture || capture.prefix.trim().length < 12) {
      this.ui.assistantAutocompleteStatus.textContent = "Keep typing a little more to request a suggestion.";
      return;
    }
    this.assistantAutocompleteActive = true;
    this.assistantAutocompleteQueued = false;
    this.ui.assistantAutocompleteStatus.textContent = "Requesting an AI suggestion…";
    this.assistantAutocompleteAbort = typeof AbortController === "undefined" ? null : new AbortController();
    try {
      const result = await this.app.api.call("POST", "assistant/complete", {
        json: {
          source: { title: capture.title, metadata: capture.metadata, markdown: capture.markdown, prefix: capture.prefix, suffix: capture.suffix, editorMode: capture.mode },
          contextIds: capture.contextIds,
        },
        signal: this.assistantAutocompleteAbort?.signal,
      });
      if (generation !== this.assistantAutocompleteGeneration || !this.assistantAutocompleteCaptureIsCurrent(capture)) return;
      const completion = typeof result?.completion === "string" ? result.completion : "";
      if (!completion) {
        this.ui.assistantAutocompleteStatus.textContent = "No useful suggestion was returned. Keep writing normally.";
        return;
      }
      this.assistantCompletionCapture = capture;
      this.assistantCompletionText = completion;
      this.ui.assistantCompletionText.textContent = completion;
      this.ui.assistantCompletion.hidden = false;
      this.ui.assistantAutocompleteStatus.textContent = "AI suggestion ready. Press Tab to accept or Escape to dismiss.";
    } catch (error) {
      if (generation === this.assistantAutocompleteGeneration) this.ui.assistantAutocompleteStatus.textContent = `Autocomplete request failed. Your draft is unchanged. ${error.message}`;
    } finally {
      this.assistantAutocompleteActive = false;
      this.assistantAutocompleteAbort = null;
      if (this.assistantAutocompleteQueued && this.assistantAutocompleteEnabled) this.scheduleAssistantAutocomplete();
    }
  }

  acceptAssistantCompletion() {
    const capture = this.assistantCompletionCapture;
    const completion = this.assistantCompletionText;
    if (!completion || !this.assistantAutocompleteCaptureIsCurrent(capture)) {
      this.dismissAssistantCompletion("The caret or draft changed, so the stale suggestion was dismissed.");
      return false;
    }
    if (capture.mode === "markdown") {
      this.ui.body.setRangeText(completion, capture.start, capture.end, "end");
      this.ui.body.dispatchEvent(new Event("input", { bubbles: true }));
      this.ui.body.focus();
    } else {
      const selection = globalThis.getSelection();
      const range = capture.range;
      selection.removeAllRanges();
      selection.addRange(range);
      range.deleteContents();
      const node = document.createTextNode(completion);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      this.visualChanged();
      this.ui.richBody.focus();
    }
    this.dismissAssistantCompletion("Suggestion accepted into your unsaved draft.");
    return true;
  }

  dismissAssistantCompletion(message = "Suggestion dismissed.", invalidate = true) {
    if (invalidate) this.assistantAutocompleteGeneration = (this.assistantAutocompleteGeneration || 0) + 1;
    this.assistantCompletionCapture = null;
    this.assistantCompletionText = "";
    if (this.ui?.assistantCompletion) this.ui.assistantCompletion.hidden = true;
    if (this.ui?.assistantCompletionText) this.ui.assistantCompletionText.textContent = "";
    if (message && this.ui?.assistantAutocompleteStatus) this.ui.assistantAutocompleteStatus.textContent = message;
  }

  dispose() {
    this.disposed = true;
    this.assistantAutocompleteEnabled = false;
    this.assistantAutocompleteGeneration = (this.assistantAutocompleteGeneration || 0) + 1;
    this.assistantAutocompleteQueued = false;
    clearTimeout(this.assistantAutocompleteTimer);
    this.assistantAutocompleteAbort?.abort();
    this.dismissAssistantCompletion("", false);
  }

  afterMount() {
    const ui = this.ui;
    this.setEditorMode(this.editorMode, false);
    ui.title.addEventListener("input", () => {
      if (!this.slugTouched) ui.slug.value = slugify(ui.title.value);
    });
    ui.slug.addEventListener("input", () => (this.slugTouched = true));
    ui.body.addEventListener("input", () => this.updateDocumentStats());
    const writingShortcut = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const command = event.key.toLowerCase() === "b" ? "bold" : event.key.toLowerCase() === "i" ? "italic" : null;
      if (!command) return;
      event.preventDefault();
      this.formatWriting(command);
    };
    ui.body.addEventListener("keydown", writingShortcut);
    ui.richBody.addEventListener("keydown", writingShortcut);
    // Undo after inserting a citation restores the exact prior draft and caret.
    const citationUndoShortcut = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "z") return;
      if (this.citationUndoAvailable()) {
        event.preventDefault();
        this.undoCitation();
      }
    };
    ui.body.addEventListener("keydown", citationUndoShortcut);
    ui.richBody.addEventListener("keydown", citationUndoShortcut);
    // A citation chip opens the citation dialog to edit it: click, Enter or Space.
    ui.richBody.addEventListener("click", (event) => {
      const chip = event.target?.closest?.(".oba-citation");
      if (chip && ui.richBody.contains(chip)) {
        event.preventDefault();
        this.openCitationDialog(chip);
      }
    });
    ui.richBody.addEventListener("keydown", (event) => {
      const chip = event.target?.closest?.(".oba-citation");
      if (!chip || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      this.openCitationDialog(chip);
    });
    bindAssistantAutocompleteControls(this, ui);
    ui.richBody.addEventListener("input", (event) => {
      event.stopPropagation();
      // A citation typed in Visual mode becomes a chip when its closing `]` is typed.
      if (event.inputType === "insertText" && String(event.data || "").endsWith("]")) this.chipCitationBeforeCaret();
      this.visualChanged();
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
    for (const control of [ui.title, ui.subtitle, ui.slug, ui.description, ui.tags, ui.cover, ui.coverAlt, ui.canonical, ui.body].filter(Boolean)) {
      control.addEventListener("input", () => {
        this.updateSeoAudit();
        this.schedulePreview();
      });
    }
    for (const control of [ui.theme, ui.profile, ui.series, ui.order, ui.date, ui.nav].filter(Boolean)) control.addEventListener("change", () => this.schedulePreview());
    for (const radio of ui.statusRadios || []) radio.querySelector("input").addEventListener("change", () => this.schedulePreview());

    // Drag and drop or paste an image into either writing mode.
    const imageDragOver = (e) => {
      if ([...(e.dataTransfer?.types || [])].includes("Files")) {
        e.preventDefault();
        this.writingSurface().classList.add("oba-dropping");
      }
    };
    const imageDragLeave = () => this.writingSurface().classList.remove("oba-dropping");
    const imageDrop = async (e) => {
      this.writingSurface().classList.remove("oba-dropping");
      const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        await this.insertImage(file);
      }
    };
    const imagePaste = async (e) => {
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        await this.insertImage(file);
      } else if (e.currentTarget === ui.richBody) {
        e.preventDefault();
        this.pasteVisualText(e.clipboardData?.getData("text/plain") || "");
      }
    };
    for (const surface of [ui.body, ui.richBody]) {
      surface.addEventListener("dragover", imageDragOver);
      surface.addEventListener("dragleave", imageDragLeave);
      surface.addEventListener("drop", imageDrop);
      surface.addEventListener("paste", imagePaste);
    }

    this.syncDateField();
    this.updateSeoAudit();
    this.updateDocumentStats();
    (this.isNew ? ui.title : this.writingSurface()).focus();
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
        this.writingSurface().focus();
        return;
      }
      body.value = edit.value;
      if (this.editorMode === "visual") this.renderRichEditor();
      else {
        body.focus();
        body.setSelectionRange(edit.start, edit.end);
      }
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
      subtitle: ui.subtitle?.value.replace(/\s+/g, " ").trim() || "",
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
    this.previewRequest += 1;
    this.previewResult = null;
    this.ui.previewCopy.disabled = true;
    this.ui.previewDownload.disabled = true;
    if (this.root?.dataset.editorView === "release") {
      this.updateReleaseKit();
      return;
    }
    if (this.root?.dataset.editorView === "field") {
      this.updateFieldReview();
      return;
    }
    if (!["preview", "social", "accessibility", "evidence"].includes(this.root?.dataset.editorView)) {
      this.previewRequest += 1;
      return;
    }
    this.previewTimer = setTimeout(() => this.renderPreview(), 250);
  }

  updateReleaseKit() {
    const fields = this.collect();
    const kit = buildVideoReleaseKit({
      profile: this.ui.profile?.value || fields.profile || "article",
      description: this.ui.description?.value || fields.description || "",
      body: this.ui.body.value,
      duration: fields.duration || "",
      aiDisclosure: fields.aiDisclosure || "",
      productionStatus: fields.productionStatus || "",
    });
    this.ui.releaseOutput.value = kit.description;
    this.ui.releaseCopy.disabled = !kit.active || !kit.description;
    this.ui.releaseIssues.replaceChildren(...kit.issues.map((issue) => h("li", {}, issue)));
    this.ui.releaseWorkflow.replaceChildren(...kit.workflow.map((stage) => h("li", { "aria-current": stage.current ? "step" : null }, `${stage.complete ? "✓ " : "○ "}${stage.stage}`)));
    if (!kit.active) this.ui.releaseStatus.textContent = "Choose the Video production content profile to build a release kit.";
    else if (kit.issues.length) this.ui.releaseStatus.textContent = `${kit.issues.length} chapter issue${kit.issues.length === 1 ? "" : "s"} to resolve.`;
    else this.ui.releaseStatus.textContent = `${kit.chapters.length} valid chapters · ready to copy.`;
  }

  updateFieldReview() {
    const fields = this.collect();
    fields.profile = this.ui.profile?.value || fields.profile;
    fields.locationPrivacy = this.ui.fieldPrivacy.value;
    const review = fieldJournalReview(fields);
    this.ui.fieldStatus.textContent = review.status;
    this.ui.fieldIssues.replaceChildren(...review.issues.map((issue) => h("li", {}, issue)));
    const facts = [
      ["Distance", fields.distanceKm ? `${fields.distanceKm} km` : "Not set"],
      ["Elevation gain", fields.elevationGainM ? `${fields.elevationGainM} m` : "Not set"],
      ["Duration", fields.duration || "Not set"],
      ["Published track", this.pendingTrack ? "Staged privately until save" : review.privacy === "exact" && fields.route ? "Downloadable GPX" : fields.routeShape ? "Normalized outline only" : "No route"],
    ];
    this.ui.fieldFacts.replaceChildren(...facts.map(([label, value]) => h("div", {}, h("dt", {}, label), h("dd", {}, value))));
    this.ui.fieldCharts.replaceChildren(fieldChart(fields.routeShape, "Privacy-filtered route outline"), fieldChart(fields.elevationProfile, "Elevation profile"));
  }

  renderAssistantContext(catalog) {
    const managedDocuments = catalog.documents || [];
    const references = catalog.references || [];
    const postSnapshots = catalog.postSnapshots || [];
    this.assistantContextDocuments = [...managedDocuments, ...references.map((reference) => ({ ...reference, kind: "reference" })), ...postSnapshots];
    for (const id of [...this.assistantContextSelected]) {
      const document = this.assistantContextDocuments.find((candidate) => candidate.id === id);
      if (!document?.exists || !document.valid) this.assistantContextSelected.delete(id);
    }
    const cards = managedDocuments.map((document) => {
      const visibilityLabel = document.visibility === "private" ? "Private" : "Portable";
      const reference = document.contextType === "reference";
      const typeLabel = document.contextType === "author" ? "Author" : document.contextType === "post" ? "Post brief" : reference ? "URL reference" : "Site";
      const textarea = h("textarea", { rows: "8", "aria-label": `${visibilityLabel} ${typeLabel} context`, readonly: reference }, document.content || "");
      const postFields = document.contextType === "post" ? postContextFields(document.content) : null;
      const postInputs = postFields
        ? Object.fromEntries(
            [
              ["goal", "Goal"],
              ["audience", "Audience"],
              ["learningOutcomes", "Learning outcomes"],
              ["sources", "Sources"],
              ["constraints", "Free-form constraints"],
            ].map(([key, label]) => [key, h("textarea", { rows: key === "constraints" ? 4 : 3, "aria-label": `${visibilityLabel} post ${label}` }, postFields[key])]),
          )
        : null;
      const selected = h("input", {
        type: "checkbox",
        checked: this.assistantContextSelected.has(document.id),
        disabled: !document.exists || !document.valid,
        onChange: () => {
          if (selected.checked) this.assistantContextSelected.add(document.id);
          else this.assistantContextSelected.delete(document.id);
          this.renderAssistantContextDisclosure();
          this.renderAssistantReviewSummary();
        },
      });
      const save = reference ? null : h("button", {
        class: "oba-btn oba-btn-primary",
        type: "button",
        onClick: () => this.saveAssistantContext(document, postInputs ? Object.fromEntries(Object.entries(postInputs).map(([key, input]) => [key, input.value])) : textarea.value),
      }, document.exists ? "Save changes" : "Create context");
      const remove = reference ? null : h("button", { class: "oba-btn oba-btn-danger", type: "button", disabled: !document.exists, onClick: () => this.deleteAssistantContext(document) }, "Remove");
      const relative = document.contextType === "post" ? `posts/${document.name}` : reference ? `references/${document.name}` : document.name;
      const path = document.visibility === "private" ? `.openblog/private/context/${relative}` : `assistant/context/${relative}`;
      return h(
        "section",
        { class: "oba-assistant-context-card", "data-visibility": document.visibility, "aria-labelledby": `oba-context-${document.id.replaceAll(":", "-")}` },
        h("div", { class: "oba-assistant-context-heading" }, h("h4", { id: `oba-context-${document.id.replaceAll(":", "-")}` }, `${typeLabel} · ${visibilityLabel}`), h("span", { class: "oba-badge" }, visibilityLabel)),
        h("p", { class: "oba-small" }, path),
        reference ? h("p", { class: "oba-small" }, `Untrusted reference · Retrieved ${document.retrievedAt} · ${document.contentType} · ${document.canonicalUrl}`) : null,
        document.guidance ? h("p", { class: "oba-notice is-warning" }, document.guidance) : null,
        postInputs
          ? Object.entries(postInputs).map(([key, input]) => this.field(`oba-context-${document.id}-${key}`, key === "learningOutcomes" ? "Learning outcomes" : key === "constraints" ? "Free-form constraints" : key[0].toUpperCase() + key.slice(1), input))
          : this.field(`oba-context-${document.id}-content`, `${typeLabel} context Markdown`, textarea),
        h("label", { class: "oba-check" }, selected, h("span", {}, `Selected context · ${document.characters} characters`)),
        h("div", { class: "oba-toolbar" }, save, remove),
      );
    });
    this.ui.assistantContextCards.replaceChildren(...cards);
    this.ui.assistantReferenceCards.replaceChildren(
      ...references.map((reference) => {
        const selected = h("input", {
          type: "checkbox",
          checked: this.assistantContextSelected.has(reference.id),
          disabled: !reference.valid,
          onChange: () => {
            if (selected.checked) this.assistantContextSelected.add(reference.id);
            else this.assistantContextSelected.delete(reference.id);
            this.renderAssistantContextDisclosure();
            this.renderAssistantReviewSummary();
          },
        });
        return h(
          "article",
          { class: "oba-assistant-context-card", "data-visibility": reference.visibility },
          h("div", { class: "oba-assistant-context-heading" }, h("h5", {}, reference.name), h("span", { class: "oba-badge" }, reference.visibility === "private" ? "Private" : "Portable")),
          reference.guidance ? h("p", { class: "oba-notice is-warning" }, reference.guidance) : null,
          h("textarea", { rows: 6, readOnly: true, "aria-label": `${reference.name} reference content` }, reference.content || ""),
          h("label", { class: "oba-check" }, selected, h("span", {}, `Selected reference · ${reference.characters} characters`)),
          h("button", { class: "oba-btn oba-btn-danger", type: "button", onClick: () => this.deleteAssistantReference(reference) }, "Remove reference"),
        );
      }),
    );
    this.ui.assistantPostSnapshots.replaceChildren(
      ...postSnapshots.map((snapshot) => {
        const selected = h("input", {
          type: "checkbox",
          checked: this.assistantContextSelected.has(snapshot.id),
          disabled: !snapshot.valid,
          onChange: () => {
            if (selected.checked) this.assistantContextSelected.add(snapshot.id);
            else this.assistantContextSelected.delete(snapshot.id);
            this.renderAssistantContextDisclosure();
            this.renderAssistantReviewSummary();
          },
        });
        return h(
          "details",
          { class: "oba-assistant-context-card", "data-visibility": "source" },
          h("summary", {}, snapshot.path),
          snapshot.guidance ? h("p", { class: "oba-notice is-warning" }, snapshot.guidance) : h("pre", { class: "oba-assistant-source-preview" }, snapshot.content),
          h("label", { class: "oba-check" }, selected, h("span", {}, `Selected post snapshot · ${snapshot.characters} characters`)),
        );
      }),
    );
    const warning = catalog.privateSafety?.warning || "";
    this.ui.assistantContextSafety.textContent = warning;
    this.ui.assistantContextSafety.hidden = !warning;
    this.renderAssistantContextDisclosure();
    this.renderAssistantReviewSummary();
  }

  renderAssistantContextDisclosure() {
    const disclosure = assistantContextDisclosure(this.assistantContextDocuments, this.assistantContextSelected);
    if (!disclosure.documents.length) {
      this.ui.assistantContextDisclosure.replaceChildren(h("p", {}, "No context selected."));
      return;
    }
    this.ui.assistantContextDisclosure.replaceChildren(
      h("ul", {}, disclosure.documents.map((document) => h("li", {}, `${document.path || document.name} · ${document.kind === "postSnapshot" ? "Post snapshot" : document.visibility === "private" ? "Private" : "Portable"} · ${document.characters} characters`))),
      h("p", { class: "oba-small" }, `${disclosure.totalCharacters} context characters selected in total.`),
    );
  }

  async loadAssistantContext(force = false) {
    if ((this.assistantContextLoaded && !force) || this.assistantContextLoading) return;
    this.assistantContextLoading = true;
    this.ui.assistantContextStatus.textContent = "Loading Assistant context…";
    try {
      const endpoint = this.doc.path ? `assistant/context?path=${encodeURIComponent(this.doc.path)}` : "assistant/context";
      const catalog = await this.app.api.call("GET", endpoint);
      this.renderAssistantContext(catalog);
      this.assistantContextLoaded = true;
      this.ui.assistantContextStatus.textContent = "Assistant context and source snapshots loaded.";
    } catch (error) {
      this.ui.assistantContextStatus.textContent = `Assistant context could not be loaded. ${error.message}`;
    } finally {
      this.assistantContextLoading = false;
    }
  }

  async retrieveAssistantUrlContext() {
    const url = this.ui.assistantUrlInput.value.trim();
    if (!url) {
      this.ui.assistantUrlStatus.textContent = "Enter an HTTP(S) URL first.";
      return;
    }
    if (!confirm(`Retrieve ${url} as untrusted reference context?`)) return;
    this.ui.assistantUrlStatus.textContent = "Retrieving this URL once…";
    this.ui.assistantUrlRetrieve.disabled = true;
    try {
      const { snapshot } = await this.app.api.call("POST", "assistant/context/url/retrieve", { json: { url, confirmed: true } });
      this.pendingUrlSnapshot = snapshot;
      const fileId = h("input", { value: slugify(new URL(snapshot.canonicalUrl).hostname) || "reference", "aria-label": "Snapshot file ID" });
      const visibility = h("select", { "aria-label": "Snapshot visibility" }, h("option", { value: "portable" }, "Portable"), h("option", { value: "private" }, "Private"));
      const text = h("textarea", { rows: "12", readonly: true, "aria-label": "Retrieved untrusted reference text" }, snapshot.text);
      const save = h("button", { class: "oba-btn oba-btn-primary", type: "button", onClick: () => this.saveAssistantUrlContext(snapshot, fileId.value.trim(), visibility.value) }, "Save inspected snapshot");
      this.ui.assistantUrlPreview.replaceChildren(
        h("h5", {}, "Inspect the retrieved text before saving"),
        h("dl", { class: "oba-definition-list" }, h("dt", {}, "Source URL"), h("dd", {}, snapshot.sourceUrl), h("dt", {}, "Canonical URL"), h("dd", {}, snapshot.canonicalUrl), h("dt", {}, "Retrieved"), h("dd", {}, snapshot.retrievedAt), h("dt", {}, "Content type"), h("dd", {}, snapshot.contentType)),
        this.field("oba-url-snapshot-id", "Snapshot file ID", fileId),
        this.field("oba-url-snapshot-visibility", "Visibility", visibility),
        this.field("oba-url-snapshot-text", "Untrusted extracted text", text),
        save,
      );
      this.ui.assistantUrlStatus.textContent = "Retrieved once. Inspect the text and metadata before saving.";
    } catch (error) {
      this.pendingUrlSnapshot = null;
      this.ui.assistantUrlPreview.replaceChildren();
      this.ui.assistantUrlStatus.textContent = `Could not retrieve URL context. ${error.message}`;
    } finally {
      this.ui.assistantUrlRetrieve.disabled = false;
    }
  }

  async saveAssistantUrlContext(snapshot, fileId, visibility) {
    if (!fileId) {
      this.ui.assistantUrlStatus.textContent = "Choose a snapshot file ID before saving.";
      return;
    }
    this.ui.assistantUrlStatus.textContent = "Saving the inspected snapshot without refetching…";
    try {
      const saved = await this.app.api.call("POST", "assistant/context/url/save", { json: { confirmed: true, visibility, fileId, snapshot } });
      this.assistantContextSelected.add(saved.id);
      this.assistantContextLoaded = false;
      await this.loadAssistantContext(true);
      this.renderAssistantContextDisclosure();
      this.pendingUrlSnapshot = null;
      this.ui.assistantUrlInput.value = "";
      this.ui.assistantUrlPreview.replaceChildren();
      this.ui.assistantUrlStatus.textContent = "URL snapshot saved and selected. Future reviews use this saved text without refetching.";
    } catch (error) {
      this.ui.assistantUrlStatus.textContent = `Could not save URL snapshot. ${error.message}`;
    }
  }

  async saveAssistantContext(document, content) {
    this.ui.assistantContextStatus.textContent = `Saving ${document.name}…`;
    try {
      await this.app.api.call("PUT", "assistant/context", {
        json: { contextType: document.contextType, visibility: document.visibility, ...(document.contextType === "post" ? { documentPath: this.doc.path, fields: content } : { content }), etag: document.etag },
      });
      this.assistantContextLoaded = false;
      await this.loadAssistantContext(true);
      this.ui.assistantContextStatus.textContent = `${document.name} saved.`;
    } catch (error) {
      this.ui.assistantContextStatus.textContent = `Could not save ${document.name}. ${error.message}`;
    }
  }

  async deleteAssistantContext(document) {
    if (!confirm(`Remove ${document.visibility} ${document.name}?`)) return;
    this.ui.assistantContextStatus.textContent = `Removing ${document.name}…`;
    try {
      await this.app.api.call("DELETE", "assistant/context", {
        json: { contextType: document.contextType, visibility: document.visibility, ...(document.contextType === "post" ? { documentPath: this.doc.path } : {}), etag: document.etag },
      });
      this.assistantContextSelected.delete(document.id);
      this.assistantContextLoaded = false;
      await this.loadAssistantContext(true);
      this.ui.assistantContextStatus.textContent = `${document.name} removed.`;
    } catch (error) {
      this.ui.assistantContextStatus.textContent = `Could not remove ${document.name}. ${error.message}`;
    }
  }

  async createAssistantReference() {
    const name = this.ui.assistantReferenceName.value.trim();
    const content = this.ui.assistantReferenceContent.value;
    this.ui.assistantContextStatus.textContent = `Adding ${name || "reference"}…`;
    try {
      await this.app.api.call("POST", "assistant/reference", { json: { name, visibility: this.ui.assistantReferenceVisibility.value, content } });
      this.ui.assistantReferenceName.value = "";
      this.ui.assistantReferenceContent.value = "";
      this.assistantContextLoaded = false;
      await this.loadAssistantContext(true);
      this.ui.assistantContextStatus.textContent = `${name} added.`;
    } catch (error) {
      this.ui.assistantContextStatus.textContent = `Could not add reference. ${error.message}`;
    }
  }

  async deleteAssistantReference(reference) {
    if (!confirm(`Remove ${reference.visibility} reference ${reference.name}?`)) return;
    try {
      await this.app.api.call("DELETE", "assistant/reference", { json: { name: reference.name, visibility: reference.visibility, etag: reference.etag } });
      this.assistantContextSelected.delete(reference.id);
      this.assistantContextLoaded = false;
      await this.loadAssistantContext(true);
      this.ui.assistantContextStatus.textContent = `${reference.name} removed.`;
    } catch (error) {
      this.ui.assistantContextStatus.textContent = `Could not remove reference. ${error.message}`;
    }
  }

  renderAssistantReviewSummary() {
    if (!this.ui.assistantReviewDisclosure) return;
    const summary = assistantReviewSummary({
      title: this.ui.title?.value || "",
      markdown: this.ui.body?.value || "",
      skills: this.assistantSkills || [],
      selectedSkillIds: this.selectedAssistantSkills || new Set(),
      context: this.assistantContextDocuments || [],
      selectedContextIds: this.assistantContextSelected || new Set(),
      provider: this.assistantProviderStatus || {},
    });
    const list = h(
      "dl",
      { class: "oba-social-meta" },
      [
        ["Scope", summary.scope],
        ["Source", `${summary.sourceCharacters} approximate characters`],
        ["Skills", summary.skills.length ? summary.skills.join(", ") : "None selected"],
        ["Context", summary.context.length ? summary.context.join(", ") : "None selected"],
        ["Provider", summary.provider],
        ["External research", summary.research],
      ].map(([term, description]) => h("div", {}, h("dt", {}, term), h("dd", {}, description))),
    );
    this.ui.assistantReviewDisclosure.replaceChildren(list);
  }

  renderAssistantReviewResult(review, sourceChanged = false) {
    const groups = assistantReviewGroups(review, this.assistantSkills || []);
    if (!groups.length) {
      this.ui.assistantReviewResults.replaceChildren();
      this.ui.assistantReviewStatus.textContent = sourceChanged
        ? "Review finished for an older draft with no findings. Your current draft is unchanged."
        : "No findings returned. Your draft is unchanged.";
      this.ui.assistantReviewResults.focus();
      return;
    }
    this.ui.assistantReviewResults.replaceChildren(
      ...groups.map((group) =>
        h(
          "section",
          { class: "oba-review-group", "aria-labelledby": `oba-review-${group.id}` },
          h("div", { class: "oba-assistant-context-heading" }, h("h4", { id: `oba-review-${group.id}` }, group.name), h("span", { class: "oba-badge" }, group.label)),
          ...group.findings.map((finding) =>
            h(
              "article",
              { class: "oba-review-finding" },
              h("p", { class: "oba-small" }, `${finding.severity[0].toUpperCase()}${finding.severity.slice(1)} · ${finding.category}`),
              h("h5", {}, finding.title),
              h("blockquote", {}, finding.evidence),
              h("p", {}, finding.explanation),
              finding.suggestion == null
                ? null
                : h(
                    "div",
                    { class: "oba-review-suggestion" },
                    h("details", {}, h("summary", {}, "Suggested replacement"), h("pre", {}, finding.suggestion)),
                    h("button", { class: "oba-btn", type: "button", onClick: (event) => this.applyAssistantReviewFinding(finding, event.currentTarget) }, "Apply suggestion"),
                  ),
              h("p", { class: "oba-small" }, finding.verification === "supplied-context" ? "Based on supplied context" : "Unverified review advice"),
            ),
          ),
        ),
      ),
    );
    this.ui.assistantReviewStatus.textContent = sourceChanged
      ? `Review finished for an older draft with ${review.findings.length} AI-generated finding${review.findings.length === 1 ? "" : "s"}. Your current draft is unchanged.`
      : `${review.findings.length} AI-generated finding${review.findings.length === 1 ? "" : "s"}. Your draft is unchanged.`;
    this.ui.assistantReviewResults.focus();
  }

  applyAssistantReviewFinding(finding, button = null) {
    this.syncRichToMarkdown();
    const before = this.ui.body.value;
    this.assistantAppliedReviewRanges ||= [];
    if (this.assistantAppliedReviewRanges.length && before !== this.assistantAppliedDraft) {
      this.ui.assistantReviewStatus.textContent = "The draft changed after a suggestion was applied. Run a new review before applying another finding.";
      return false;
    }
    this.assistantAppliedFindingIds ||= new Set();
    if (this.assistantAppliedFindingIds.has(finding.id)) {
      this.ui.assistantReviewStatus.textContent = "That suggestion was already applied. Nothing was changed.";
      return false;
    }
    const result = applyAssistantSuggestion(before, finding);
    if (!result.ok) {
      this.ui.assistantReviewStatus.textContent = result.error;
      return false;
    }
    const reviewRange = finding.range;
    const hasReviewRange = Number.isInteger(reviewRange?.start) && Number.isInteger(reviewRange?.end) && reviewRange.start < reviewRange.end;
    const overlaps =
      !hasReviewRange || this.assistantAppliedReviewRanges.some((range) => reviewRange.start < range.end && reviewRange.end > range.start);
    if (overlaps) {
      this.ui.assistantReviewStatus.textContent = "That suggestion overlaps text changed by an earlier finding. Run a new review before applying it.";
      return false;
    }
    const priorReviewRanges = this.assistantAppliedReviewRanges.map((range) => ({ ...range }));
    const priorFindingIds = new Set(this.assistantAppliedFindingIds);
    this.assistantAppliedReviewRanges.push({ start: reviewRange.start, end: reviewRange.end });
    this.assistantAppliedFindingIds.add(finding.id);
    this.ui.body.value = result.markdown;
    this.assistantAppliedDraft = result.markdown;
    this.assistantSuggestionUndo = { before, after: result.markdown, priorReviewRanges, priorFindingIds, button };
    this.ui.body.dispatchEvent(new Event("input", { bubbles: true }));
    if (this.editorMode === "visual") this.renderRichEditor();
    if (button) button.disabled = true;
    if (this.ui.assistantReviewUndo) this.ui.assistantReviewUndo.hidden = false;
    this.ui.assistantReviewStatus.textContent = "Suggestion applied to your unsaved draft. Review it before saving. You can undo this change.";
    return true;
  }

  undoAssistantSuggestion() {
    this.syncRichToMarkdown();
    const undo = this.assistantSuggestionUndo;
    if (!undo || this.ui.body.value !== undo.after) {
      this.ui.assistantReviewStatus.textContent = "Undo is unavailable because the draft changed after the suggestion was applied.";
      return false;
    }
    this.ui.body.value = undo.before;
    this.ui.body.dispatchEvent(new Event("input", { bubbles: true }));
    if (this.editorMode === "visual") this.renderRichEditor();
    this.assistantAppliedReviewRanges = undo.priorReviewRanges;
    this.assistantAppliedFindingIds = undo.priorFindingIds;
    this.assistantAppliedDraft = undo.priorReviewRanges.length ? undo.before : null;
    if (undo.button) undo.button.disabled = false;
    this.assistantSuggestionUndo = null;
    if (this.ui.assistantReviewUndo) this.ui.assistantReviewUndo.hidden = true;
    this.ui.assistantReviewStatus.textContent = "Applied suggestion undone. Your draft remains unsaved.";
    return true;
  }

  async runAssistantReview() {
    this.syncRichToMarkdown();
    const skillIds = [...(this.selectedAssistantSkills || [])];
    if (!skillIds.length) {
      this.ui.assistantReviewStatus.textContent = "Select at least one document review skill.";
      return;
    }
    this.ui.assistantReviewRun.disabled = true;
    this.ui.assistantReviewStatus.textContent = "Preparing provider disclosure…";
    await this.loadAssistantStatus();
    if (!this.assistantProviderStatus?.destination) {
      this.ui.assistantReviewStatus.textContent = "Document review did not run because the provider destination is unavailable. Your draft is unchanged.";
      this.ui.assistantReviewRun.disabled = false;
      return;
    }
    this.renderAssistantReviewSummary();
    this.ui.assistantReviewStatus.textContent = "Running document review…";
    this.ui.assistantReviewResults.replaceChildren();
    const source = {
      title: this.ui.title.value,
      metadata: this.collect(),
      markdown: this.ui.body.value,
    };
    try {
      const review = await this.app.api.call("POST", "assistant/review", {
        json: {
          source,
          skillIds,
          contextIds: [...this.assistantContextSelected],
        },
      });
      this.syncRichToMarkdown();
      const currentSource = { title: this.ui.title.value, metadata: this.collect(), markdown: this.ui.body.value };
      this.assistantAppliedFindingIds = new Set();
      this.assistantAppliedReviewRanges = [];
      this.assistantAppliedDraft = null;
      this.assistantSuggestionUndo = null;
      if (this.ui.assistantReviewUndo) this.ui.assistantReviewUndo.hidden = true;
      this.renderAssistantReviewResult(review, assistantReviewSourceChanged(source, currentSource));
    } catch (error) {
      this.ui.assistantReviewStatus.textContent = `Document review failed. Your draft is unchanged. ${error.message}`;
      this.ui.assistantReviewResults.replaceChildren();
      this.ui.assistantReviewResults.focus();
    } finally {
      this.ui.assistantReviewRun.disabled = false;
    }
  }

  async loadAssistantStatus() {
    if (this.assistantStatusLoaded) return this.assistantProviderStatus;
    if (this.assistantStatusPromise) return this.assistantStatusPromise;
    this.assistantStatusLoading = true;
    this.assistantStatusPromise = (async () => {
      this.ui.assistantStatus.textContent = "Loading assistant configuration…";
      try {
        const status = await this.app.api.call("GET", "assistant/status");
        this.assistantProviderStatus = status;
        const presentation = assistantStatusPresentation(status);
        this.ui.assistantProviderType.textContent = presentation.providerType;
        this.ui.assistantModel.textContent = presentation.model;
        this.ui.assistantDestination.textContent = presentation.destination;
        this.ui.assistantConfigured.textContent = presentation.configured;
        this.ui.assistantCapabilities.textContent = presentation.capabilities;
        this.ui.assistantStatus.textContent = presentation.message;
        this.ui.assistantStatusBadge.textContent = presentation.statusLabel;
        this.ui.assistantStatusBadge.dataset.tone = presentation.statusTone;
        if (this.meta) {
          this.meta.quizGeneration = status?.configured === true && status.capabilities?.knowledgeChecks === true;
          this.meta.codeInteractionGeneration = status?.configured === true && status.capabilities?.codeInteractions === true;
        }
        this.assistantStatusLoaded = true;
        this.renderAssistantReviewSummary();
        return status;
      } catch (error) {
        this.ui.assistantStatus.textContent = `Assistant configuration could not be loaded. Non-AI authoring remains available. ${error.message}`;
        this.ui.assistantStatusBadge.textContent = "Unavailable";
        this.ui.assistantStatusBadge.dataset.tone = "invalid";
        return null;
      } finally {
        this.assistantStatusLoading = false;
        this.assistantStatusPromise = null;
      }
    })();
    return this.assistantStatusPromise;
  }

  async loadAssistantSettings(force = false) {
    if (!force && this.assistantSettingsEtag) return;
    this.ui.assistantSettingsStatus.textContent = "Loading provider settings…";
    try {
      const settings = await this.app.api.call("GET", "assistant/settings");
      this.assistantSettingsEtag = settings.etag;
      this.ui.assistantSettingsProvider.value = settings.provider || "custom-https";
      this.ui.assistantSettingsEndpoint.value = settings.generationEndpoint || "";
      this.ui.assistantSettingsModel.value = settings.model || "";
      this.updateAssistantProviderFields(false);
      const source = settings.credential?.source || "none";
      this.assistantCredentialSource = source;
      this.assistantPrivateCredentialConfigured = settings.credential?.privateConfigured === true || source === "private";
      this.ui.assistantSettingsClear.disabled = !this.assistantPrivateCredentialConfigured;
      this.ui.assistantSettingsStatus.textContent = source === "environment"
        ? `Configured by ${settings.credential.environmentName || "the server environment"}. Environment credential takes precedence; a saved private credential is never displayed.`
        : source === "private"
          ? "A private credential is saved. Enter a new value only to replace it."
          : settings.credential?.targetMismatch
            ? "The saved key belongs to another provider or destination. Enter the correct key for this connection."
            : "No credential is configured. Non-AI authoring remains available.";
    } catch (error) {
      this.ui.assistantSettingsStatus.textContent = `Provider settings could not be loaded. ${error.message}`;
    }
  }

  updateAssistantProviderFields(providerChanged = true) {
    const selected = this.ui.assistantSettingsProvider.value;
    const custom = selected === "custom-https";
    const provider = ASSISTANT_PROVIDERS[selected] || ASSISTANT_PROVIDERS["custom-https"];
    this.ui.assistantEndpointField.hidden = !custom;
    this.ui.assistantSettingsEndpoint.disabled = !custom;
    if (providerChanged || !this.ui.assistantSettingsModel.value.trim()) {
      this.ui.assistantSettingsModel.value = provider.defaultModel;
    }
  }

  async clearAssistantCredential() {
    const environmentNote = this.assistantCredentialSource === "environment"
      ? " The environment credential will remain active."
      : " AI review and generation will be unavailable until another credential is configured.";
    if (!globalThis.confirm(`Permanently remove the saved private credential?${environmentNote}`)) return;
    await this.saveAssistantSettings("clear");
  }

  async saveAssistantSettings(action = "save") {
    const credential = this.ui.assistantSettingsCredential.value;
    const credentialAction = action === "clear" ? "clear" : credential ? "replace" : "keep";
    this.ui.assistantSettingsSave.disabled = true;
    this.ui.assistantSettingsClear.disabled = true;
    this.ui.assistantSettingsStatus.textContent = action === "clear" ? "Clearing private credential…" : "Saving provider settings…";
    try {
      const settings = await this.app.api.call("PUT", "assistant/settings", {
        json: {
          provider: this.ui.assistantSettingsProvider.value,
          generationEndpoint: this.ui.assistantSettingsEndpoint.value.trim(),
          model: this.ui.assistantSettingsModel.value.trim(),
          etag: this.assistantSettingsEtag,
          credentialAction,
          ...(credentialAction === "replace" ? { credential } : {}),
        },
      });
      this.assistantSettingsEtag = settings.etag;
      this.ui.assistantSettingsCredential.value = "";
      this.assistantStatusLoaded = false;
      this.assistantProviderStatus = null;
      const status = await this.loadAssistantStatus();
      if (this.meta) {
        this.meta.quizGeneration = status?.configured === true && status.capabilities?.knowledgeChecks === true;
        this.meta.codeInteractionGeneration = status?.configured === true && status.capabilities?.codeInteractions === true;
      }
      await this.loadAssistantSettings(true);
    } catch (error) {
      this.ui.assistantSettingsStatus.textContent = `Provider settings were not saved. ${error.message}`;
    } finally {
      this.ui.assistantSettingsSave.disabled = false;
      this.ui.assistantSettingsClear.disabled = !this.assistantPrivateCredentialConfigured;
    }
  }

  async loadAssistantSkills(force = false) {
    if ((!force && this.assistantSkillsLoaded) || this.assistantSkillsLoading) return;
    this.assistantSkillsLoading = true;
    this.ui.assistantSkillsStatus.textContent = "Loading assistant skills…";
    try {
      const catalog = await this.app.api.call("GET", "assistant/skills");
      this.assistantSkills = Array.isArray(catalog.skills) ? catalog.skills : [];
      this.assistantSkillsLoaded = true;
      this.renderAssistantSkills();
    } catch (error) {
      this.ui.assistantSkillsStatus.textContent = `Assistant skills could not be loaded. ${error.message}`;
    } finally {
      this.assistantSkillsLoading = false;
    }
  }

  renderAssistantSkills() {
    const skills = this.assistantSkills || [];
    const reviewSkills = skills.filter((skill) => skill.output === "review");
    this.selectedAssistantSkills ||= new Set();
    const selected = selectableAssistantSkillIds(reviewSkills, [...this.selectedAssistantSkills]);
    this.selectedAssistantSkills = new Set(selected);
    const reviewCards = reviewSkills.map((skill) => {
      const presentation = assistantSkillPresentation(skill);
      const input = h("input", {
        type: "checkbox",
        value: skill.id,
        checked: this.selectedAssistantSkills.has(skill.id),
        disabled: presentation.disabled,
        onChange: (event) => {
          if (event.target.checked) this.selectedAssistantSkills.add(skill.id);
          else this.selectedAssistantSkills.delete(skill.id);
          this.renderAssistantReviewSummary();
        },
      });
      return h(
        "label",
        { class: `oba-skill-card${presentation.disabled ? " is-invalid" : ""}` },
        input,
        h("span", {}, h("strong", {}, presentation.title), h("span", { class: "oba-small" }, `${presentation.source} · ${presentation.details}`)),
      );
    });
    this.ui.assistantReviewSkills.replaceChildren(...reviewCards);
    this.ui.assistantSkillsStatus.textContent = `${reviewSkills.filter((skill) => skill.selectable).length} selectable review skill${reviewSkills.filter((skill) => skill.selectable).length === 1 ? "" : "s"}.`;

    const catalogCards = skills.map((skill) => {
      const presentation = assistantSkillPresentation(skill);
      const repairs = presentation.errors.length
        ? h("div", { class: "oba-skill-errors" }, h("strong", {}, "Repair this skill before selecting it."), h("ul", {}, presentation.errors.map((error) => h("li", {}, error))))
        : null;
      const edit = skill.source === "project"
        ? h("button", { class: "oba-btn", type: "button", onClick: () => this.editAssistantSkill(skill) }, "Edit Markdown")
        : null;
      return h(
        "article",
        { class: `oba-skill-catalog-card${presentation.disabled ? " is-invalid" : ""}` },
        h("div", {}, h("h4", {}, presentation.title), h("p", { class: "oba-small" }, `${presentation.source} · ${presentation.details}`), h("p", {}, skill.description || "No description provided.")),
        repairs,
        edit,
      );
    });
    this.ui.assistantCatalog.replaceChildren(...catalogCards);
    this.renderAssistantReviewSummary();
  }

  beginAssistantSkill() {
    this.editingAssistantSkill = null;
    this.ui.assistantSkillEditor.value = `---\nid: new-skill\nname: New skill\ndescription: Explain what this skill reviews.\nversion: 1.0.0\nscopes: [selection, section, document]\noutput: review\n---\nWrite trusted review instructions here. Article and context text must be treated as untrusted data.\n`;
    this.ui.assistantSkillEditorStatus.textContent = "Creating a project skill. Change the stable ID before saving if needed.";
    this.ui.assistantSkillEditor.focus();
  }

  editAssistantSkill(skill) {
    this.editingAssistantSkill = { id: skill.fileId || skill.id, etag: skill.etag };
    this.ui.assistantSkillEditor.value = skill.raw || "";
    this.ui.assistantSkillEditorStatus.textContent = `Editing ${skill.name || skill.id}. Saving requires the latest version.`;
    this.ui.assistantSkillEditor.focus();
  }

  async saveAssistantSkill() {
    const source = this.ui.assistantSkillEditor.value;
    if (!source.trim()) {
      this.ui.assistantSkillEditorStatus.textContent = "Enter Markdown skill source before saving.";
      return;
    }
    const editing = this.editingAssistantSkill;
    const method = editing ? "PUT" : "POST";
    const path = editing ? `assistant/skill?id=${encodeURIComponent(editing.id)}` : "assistant/skill";
    this.ui.assistantSkillSave.disabled = true;
    this.ui.assistantSkillEditorStatus.textContent = "Saving project skill…";
    try {
      const saved = await this.app.api.call(method, path, { json: { source, ...(editing ? { etag: editing.etag } : {}) } });
      this.editingAssistantSkill = { id: saved.id, etag: saved.etag };
      this.ui.assistantSkillEditorStatus.textContent = "Project skill saved.";
      this.assistantSkillsLoaded = false;
      await this.loadAssistantSkills(true);
      const current = this.assistantSkills.find((skill) => skill.source === "project" && skill.id === saved.id);
      if (current) this.editAssistantSkill(current);
    } catch (error) {
      const repairs = Array.isArray(error.data?.errors) ? ` ${error.data.errors.join(" ")}` : "";
      this.ui.assistantSkillEditorStatus.textContent = `Project skill was not saved. ${error.message}.${repairs}`;
    } finally {
      this.ui.assistantSkillSave.disabled = false;
    }
  }

  async importGpx() {
    const file = this.ui.fieldFile.files[0];
    if (!file) {
      this.flash("error", "Choose a GPX file first.");
      return;
    }
    try {
      const privacy = this.ui.fieldPrivacy.value;
      const source = await file.text();
      const analysis = analyzeGpx(source, { privacy, trimMeters: this.ui.fieldTrim.value });
      await this.discardPendingTrack();
      if (privacy === "exact") {
        const token = await this.uploadTrack(file);
        if (!token) return;
        this.pendingTrack = { token, name: file.name };
      }
      const duration = analysis.durationSeconds == null ? "" : analysis.durationSeconds >= 3600 ? `${Math.floor(analysis.durationSeconds / 3600)} hr ${Math.round((analysis.durationSeconds % 3600) / 60)} min` : `${Math.round(analysis.durationSeconds / 60)} min`;
      const values = {
        locationPrivacy: privacy,
        distanceKm: analysis.distanceKm,
        elevationGainM: analysis.elevationGainM,
        duration,
        routeShape: analysis.routeShape,
        elevationProfile: analysis.elevationProfile,
        route: "",
      };
      for (const [key, value] of Object.entries(values)) {
        this.profileFieldDrafts.set(key, value == null ? "" : String(value));
        const control = this.ui.profileFieldControls?.get(key);
        if (control) control.value = value == null ? "" : String(value);
      }
      this.app.dirty = true;
      this.markDirty();
      this.updateFieldReview();
      this.schedulePreview();
      this.flash("ok", privacy === "exact" ? "Track analyzed and staged privately. It becomes public only when this post saves successfully." : "Track analyzed locally. Only privacy-filtered derived data will be saved.");
    } catch (error) {
      this.flash("error", error.message);
    }
  }

  async renderPreview() {
    const request = ++this.previewRequest;
    this.previewResult = null;
    this.ui.previewCopy.disabled = true;
    this.ui.previewDownload.disabled = true;
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
      this.previewResult = preview;
      this.showPreviewRepresentation(preview);
      this.updatePreviewWarnings(preview);
      this.updateSocialPreview(preview.social);
      this.updateAccessibility(preview.accessibility);
      this.updateEvidence(preview.evidence, preview.research, preview.citations, preview.citationsOptedIn === true);
    } catch (error) {
      if (request !== this.previewRequest) return;
      this.previewResult = null;
      this.ui.preview.srcdoc = "<!doctype html><html><body><p>Preview unavailable. Check the editor for validation problems.</p></body></html>";
      this.ui.preview.hidden = false;
      this.ui.previewMarkdown.hidden = true;
      this.ui.previewTheme.textContent = `Preview unavailable: ${error.message}`;
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
      this.citationExports = null;
      this.ui.evidenceExports.hidden = true;
      this.ui.evidenceFindings.replaceChildren(h("p", { class: "oba-notice" }, "Fix the document validation problems, then run the checks again."));
    }
  }

  showPreviewRepresentation(preview = this.previewResult) {
    const mode = this.ui.previewMode.value;
    const artifact = portablePreviewArtifact(preview, mode);
    this.ui.previewCopy.disabled = !artifact;
    this.ui.previewDownload.disabled = !artifact;
    const portable = preview?.portablePreview;
    const destinationMode = mode.startsWith("destination:");
    const destination = destinationMode
      ? previewDestinationPolicy(portable?.destinations, mode)
      : null;
    if (destinationMode && !destination) {
      this.ui.previewMarkdown.hidden = true;
      this.ui.preview.hidden = true;
      this.ui.previewTheme.textContent = "Destination policy unavailable";
      return;
    }
    const representation = destination?.representation || mode;
    const textMode = representation === "portable-text";
    const markdownMode = textMode || representation === "portable-markdown" || representation === "manual-markdown";
    this.ui.previewMarkdown.hidden = !markdownMode || !portable;
    this.ui.preview.hidden = !this.ui.previewMarkdown.hidden;
    if (!preview) return;
    if (markdownMode && portable) {
      this.ui.previewMarkdown.textContent = textMode ? portable.text : portable.markdown;
      this.ui.previewMarkdown.setAttribute("aria-label", textMode ? "Portable text preview" : "Portable Markdown preview");
      this.ui.previewTheme.textContent = destination
        ? `${destination.label} · ${representation === "manual-markdown" ? "manual import" : "portable Markdown"}`
        : textMode ? "Portable text fallback" : "Portable Markdown fallback";
      return;
    }
    this.ui.preview.removeAttribute("srcdoc");
    if (representation === "portable-html" && portable) {
      const escape = (value) => String(value).replace(/[&<>"]/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      })[character]);
      this.ui.preview.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body><main><h1>${escape(preview.social.title)}</h1>${portable.html}</main></body></html>`;
      this.ui.previewTheme.textContent = destination
        ? `${destination.label} · portable HTML`
        : "Portable HTML fallback";
      return;
    }
    this.ui.preview.src = preview.previewUrl;
    this.ui.previewTheme.textContent = `Theme: ${preview.theme}`;
  }

  async exportPreviewArtifact(download) {
    const artifact = portablePreviewArtifact(this.previewResult, this.ui.previewMode.value);
    if (!artifact) {
      this.ui.previewTheme.textContent = "Render a current portable preview before exporting.";
      return;
    }
    try {
      if (download) {
        const url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mime }));
        try {
          const link = h("a", { href: url, download: `portable-preview.${artifact.extension}` });
          document.body.append(link);
          link.click();
          link.remove();
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 0);
        }
      } else {
        await navigator.clipboard.writeText(artifact.content);
      }
      this.ui.previewTheme.textContent = download ? "Portable output downloaded; source unchanged." : "Portable output copied; source unchanged.";
    } catch (error) {
      this.ui.previewTheme.textContent = `Portable export failed: ${error.message}`;
    }
  }

  updatePreviewWarnings(preview = this.previewResult) {
    const portable = preview?.portablePreview;
    const mode = this.ui.previewMode.value;
    const scope = portabilityAcknowledgementScope(portable?.destinations, mode);
    const acknowledgements = Array.isArray(portable?.acknowledgements) ? portable.acknowledgements : [];
    const staleCount = portable?.sourceRevision
      ? acknowledgements.filter((acknowledgement) => acknowledgement.sourceRevision !== portable.sourceRevision).length
      : 0;
    const items = [
      ...previewWarningsForDisplay(preview?.warnings).map((warning) => h("li", {}, warning)),
      ...(staleCount
        ? [h("li", {}, `${staleCount} previous portability acknowledgement${staleCount === 1 ? " is" : "s are"} stale after source changes. Review the current warnings; stale records never suppress them.`)]
        : []),
      ...portabilityGroups(preview, mode).map((group) => {
        const labels = {
          "fully-portable": "Fully portable",
          "gracefully-transformed": "Gracefully transformed",
          "canonical-only-interaction": "Canonical-only interaction",
        };
        const findings = group.diagnostics.map((diagnostic) => {
          const children = [portableDiagnosticsForDisplay([diagnostic])[0] || diagnostic.message];
          if (diagnostic.affectedSemantics) children.push(h("p", {}, diagnostic.affectedSemantics));
          if (diagnostic.sourceRange) {
            children.push(h("button", { type: "button", class: "oba-btn", onClick: () => this.navigatePortabilitySource(diagnostic.sourceRange, preview) }, `Edit source at line ${diagnostic.sourceRange.startLine}`));
          }
          if (!scope || diagnostic.severity !== "warning" || !diagnostic.capabilityId || !portable?.sourceRevision) {
            return h("li", {}, ...children);
          }
          const sameScope = acknowledgements.filter((acknowledgement) =>
            acknowledgement.capabilityId === diagnostic.capabilityId
            && acknowledgement.representation === scope.representation
            && acknowledgement.destination === scope.destination);
          const acknowledged = sameScope.some((acknowledgement) =>
            acknowledgement.sourceRevision === portable.sourceRevision);
          if (acknowledged) {
            children.push(h("span", { class: "oba-small" }, " Acknowledged for this revision."));
          } else {
            const button = h("button", { type: "button", class: "oba-btn" }, "Acknowledge this warning");
            button.addEventListener("click", async () => {
              button.disabled = true;
              try {
                const result = await this.app.api.call("POST", "portability/acknowledge", {
                  json: {
                    path: this.doc.path,
                    sourceRevision: portable.sourceRevision,
                    capabilityId: diagnostic.capabilityId,
                    representation: scope.representation,
                    destination: scope.destination,
                    expectedEtag: portable.acknowledgementEtag,
                  },
                });
                portable.acknowledgements = result.acknowledgements;
                portable.acknowledgementEtag = result.etag;
                this.updatePreviewWarnings(preview);
              } catch (error) {
                button.disabled = false;
                this.ui.previewTheme.textContent = `Acknowledgement failed: ${error.message}`;
              }
            });
            children.push(button);
          }
          return h("li", {}, ...children);
        });
        return h("li", {}, h("strong", {}, `${group.capabilityId} · ${labels[group.level] || "Review required"} · ${group.representation} · ${group.destination}`), h("ul", {}, ...findings));
      }),
      ...destinationPolicyForDisplay(portable?.destinations, mode).map((warning) => h("li", {}, warning)),
      ...destinationTagsForDisplay(portable?.destinationTagPlans, mode).map((warning) => h("li", {}, warning)),
      ...destinationContentForDisplay(portable?.destinationContentPlans, mode).map((warning) => h("li", {}, warning)),
    ];
    this.ui.previewWarnings.replaceChildren(
      ...(items.length ? [h("strong", {}, "Publishing warnings"), h("ul", {}, ...items)] : []),
    );
    this.ui.previewWarnings.hidden = items.length === 0;
  }

  navigatePortabilitySource(range, preview) {
    if (preview !== this.previewResult) {
      this.ui.previewTheme.textContent = "Source changed; render a current preview before navigating.";
      return;
    }
    this.syncRichToMarkdown();
    const selection = portabilitySourceSelection(this.ui.body.value, range);
    if (!selection) {
      this.ui.previewTheme.textContent = "Source location is unavailable; render a current preview.";
      return;
    }
    this.setEditorMode("markdown");
    this.activatePane("write");
    this.ui.body.setSelectionRange(selection.start, selection.end);
    this.ui.body.focus();
    this.ui.live.textContent = `Editing portability source at line ${range.startLine}. Unsaved content is unchanged.`;
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

  updateEvidence(findings, research, citations = null, citationsOptedIn = false) {
    const state = evidenceStudioState(findings, research, citations, citationsOptedIn);
    this.citationExports = citations?.references ? citations.exports : null;
    this.ui.evidenceExports.hidden = !this.citationExports;
    this.ui.evidenceExportStatus.textContent = "";
    if (!state.active) {
      this.ui.evidenceCounts.replaceChildren();
      this.ui.evidenceFindings.replaceChildren(
        h("p", { class: "oba-notice" }, "Evidence checks run for posts using the Research content profile and for posts that publish citations."),
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
      ...(research
        ? [
            h("div", {}, h("dt", {}, "DOI"), h("dd", {}, research.doiUrl || research.doi || "Not supplied")),
            h("div", {}, h("dt", {}, "License"), h("dd", {}, research.licenseUrl || "Not supplied")),
            h("div", {}, h("dt", {}, "Linked references"), h("dd", {}, String(research.referenceCount || 0))),
          ]
        : []),
      ...citationEvidenceRows(citations).map(([term, description]) => h("div", {}, h("dt", {}, term), h("dd", {}, description))),
    );
    this.ui.evidenceStatus.textContent = state.status;
  }

  /** Download the previewed post's cited references; the draft and the library are never changed. */
  exportCitedReferences(format) {
    const exported = this.citationExports?.[format];
    if (!exported) {
      this.ui.evidenceExportStatus.textContent = citationExportStatus(null);
      return;
    }
    try {
      const url = URL.createObjectURL(new Blob([exported.content], { type: `${exported.mediaType};charset=utf-8` }));
      try {
        const link = h("a", { href: url, download: exported.filename });
        document.body.append(link);
        link.click();
        link.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      this.ui.evidenceExportStatus.textContent = citationExportStatus(exported);
    } catch (error) {
      this.ui.evidenceExportStatus.textContent = `The references could not be downloaded: ${error.message}`;
    }
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

  async uploadTrack(file) {
    try {
      const response = await this.app.api.call("POST", `track-upload?name=${encodeURIComponent(file.name)}`, {
        body: file,
        headers: { "Content-Type": "application/gpx+xml" },
      });
      return response.token;
    } catch (error) {
      this.flash("error", error.message);
      return null;
    }
  }

  async discardPendingTrack() {
    const pending = this.pendingTrack;
    this.pendingTrack = null;
    if (!pending) return;
    try {
      await this.app.api.call("DELETE", `track-upload?token=${encodeURIComponent(pending.token)}`);
    } catch (error) {
      this.flash("error", `The private staged track could not be discarded: ${error.message}`);
    }
  }

  async insertImage(file) {
    const url = await this.upload(file);
    if (!url) return;
    const alt = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    if (this.editorMode === "visual") {
      const image = h("img", { src: url, alt, class: "oba-rich-image" });
      const selection = getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (range && this.ui.richBody.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        range.insertNode(image);
        range.setStartAfter(image);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        this.ui.richBody.append(h("p", { "data-visual-block": "paragraph" }, image));
      }
      this.visualChanged();
      image.scrollIntoView({ block: "nearest" });
      return;
    }
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

  knowledgeCheckTarget() {
    this.syncRichToMarkdown();
    const markdown = this.ui.body.value;
    if (this.editorMode !== "visual" || !this.visualSelection) {
      const start = this.ui.body.selectionStart ?? markdown.length;
      const end = this.ui.body.selectionEnd ?? start;
      return { markdown, at: end, selected: markdown.slice(start, end).trim() };
    }
    const range = this.visualSelection.cloneRange();
    if (!this.ui.richBody.contains(range.commonAncestorContainer)) return { markdown, at: markdown.length, selected: "" };
    const selected = range.toString().trim();
    range.collapse(false);
    let marker = "OPENBLOGKNOWLEDGECHECKCURSOR";
    while (markdown.includes(marker)) marker += "X";
    const node = document.createTextNode(marker);
    range.insertNode(node);
    const marked = this.richEditorMarkdown();
    const at = marked.indexOf(marker);
    const parent = node.parentNode;
    node.remove();
    parent?.normalize();
    if (at < 0) return { markdown, at: markdown.length, selected };
    return { markdown: marked.slice(0, at) + marked.slice(at + marker.length), at, selected };
  }

  interactionContext(target) {
    if (target.selected) return target.selected;
    const cursor = target.at;
    const before = target.markdown.slice(0, cursor);
    const heading = [...before.matchAll(/^#{1,6}\s+.+$/gm)].pop();
    if (!heading) return target.markdown.trim();
    const rest = target.markdown.slice(cursor);
    const next = rest.match(/^#{1,6}\s+.+$/m);
    const end = next?.index === undefined ? target.markdown.length : cursor + next.index;
    return target.markdown.slice(heading.index, end).trim();
  }

  insertInteractionBlocks(blocks, target) {
    const before = target.markdown.slice(0, target.at).replace(/\s*$/, "");
    const after = target.markdown.slice(target.at).replace(/^\s*/, "");
    const snippet = `${before ? "\n\n" : ""}${blocks.join("\n\n")}${after ? "\n\n" : ""}`;
    this.ui.body.value = before + snippet + after;
    this.ui.body.selectionStart = this.ui.body.selectionEnd = (before + snippet).length;
    this.ui.body.dispatchEvent(new Event("input", { bubbles: true }));
    if (this.editorMode === "visual") this.renderRichEditor();
    this.activatePane?.("write");
    requestAnimationFrame(() => this.writingSurface().focus());
  }

  insertKnowledgeCheckBlocks(blocks, target) {
    this.insertInteractionBlocks(blocks, target);
  }

  openCodeInteraction() {
    this.captureVisualSelection();
    const target = this.knowledgeCheckTarget();
    const trigger = document.activeElement;
    const dialog = h("dialog", { class: "oba-dialog", "aria-labelledby": "oba-code-interaction-title" });
    const status = h("p", { class: "oba-error", role: "alert", hidden: true });
    const kind = h("select", { id: "oba-code-interaction-kind", value: "example" }, h("option", { value: "example" }, "Runnable example"), h("option", { value: "challenge" }, "Coding challenge"));
    const availableLanguages = [...new Set(
      ["rust", "web", ...(this.meta.codeRunnerLanguages || [])]
        .map(normalizeCodeRunnerLanguage)
        .filter(Boolean),
    )];
    const language = h("select", { id: "oba-code-interaction-language", value: "rust" },
      ...availableLanguages.map((value) => h("option", { value }, value === "web" ? "Web (HTML/CSS/JavaScript)" : value[0].toUpperCase() + value.slice(1))));
    const title = h("input", { id: "oba-code-interaction-name", type: "text", maxlength: 120, placeholder: "Ownership in action" });
    const instructions = h("textarea", { id: "oba-code-interaction-instructions", rows: 3, placeholder: "Tell the reader what to try or notice." });
    const code = h("textarea", { id: "oba-code-interaction-code", rows: 12, spellcheck: false, value: "fn main() {\n    println!(\"Hello, open.blog!\");\n}" });
    const expectedOutput = h("textarea", { id: "oba-code-interaction-output", rows: 2, placeholder: "What should happen when the reader succeeds?" });
    const hint = h("textarea", { id: "oba-code-interaction-hint", rows: 2, placeholder: "Optional hint" });
    const explanation = h("textarea", { id: "oba-code-interaction-explanation", rows: 3, placeholder: "Optional explanation after the code" });
    const outputField = this.field("oba-code-interaction-output", "Expected result", expectedOutput, "Required for a coding challenge.");
    const hintField = this.field("oba-code-interaction-hint", "Hint", hint);
    const syncKind = () => {
      const challenge = kind.value === "challenge";
      outputField.hidden = !challenge;
      hintField.hidden = !challenge;
    };
    kind.addEventListener("change", syncKind);

    const generation = [];
    if (this.meta.codeInteractionGeneration) {
      const generate = h("button", {
        class: "oba-btn oba-btn-primary",
        type: "button",
        onClick: async () => {
          const generationSnapshot = JSON.stringify([kind.value, language.value, title.value, instructions.value, code.value, expectedOutput.value, hint.value, explanation.value]);
          generate.disabled = true;
          status.hidden = true;
          try {
            const result = await this.app.api.call("POST", "assistant/code-interaction", {
              json: { context: this.interactionContext(target), kind: kind.value, language: language.value },
            });
            if (generationSnapshot !== JSON.stringify([kind.value, language.value, title.value, instructions.value, code.value, expectedOutput.value, hint.value, explanation.value])) {
              status.textContent = "The proposal changed while generation was running, so the returned draft was not applied.";
              status.className = "oba-error";
              status.hidden = false;
              return;
            }
            title.value = result.title;
            instructions.value = result.instructions;
            code.value = result.code;
            expectedOutput.value = result.expectedOutput;
            hint.value = result.hint;
            explanation.value = result.explanation;
            status.textContent = "Draft interaction generated. Review and edit it before inserting.";
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
      generation.push(h("div", { class: "oba-generation" }, h("span", {}, "Use the selected text or current section:"), generate));
    }
    const close = () => {
      dialog.close();
      dialog.remove();
      if (trigger instanceof HTMLElement) trigger.focus();
    };
    const insert = h("button", {
      class: "oba-btn oba-btn-primary",
      type: "button",
      onClick: () => {
        const fields = [title, instructions, code];
        if (fields.some((field) => !field.value.trim()) || (kind.value === "challenge" && !expectedOutput.value.trim())) {
          status.textContent = "Title, instructions, code, and the challenge expected result are required.";
          status.className = "oba-error";
          status.hidden = false;
          return;
        }
        if ([title, instructions, code, expectedOutput, hint, explanation].some((field) => field.value.includes("```"))) {
          status.textContent = "Interaction fields cannot contain a triple backtick.";
          status.className = "oba-error";
          status.hidden = false;
          return;
        }
        if (language.value === "web" && (!/^\s*---(?:html|css|js)\s*$/m.test(code.value) || !code.value.split(/^\s*---(?:html|css|js)\s*$/m).some((section) => section.trim()))) {
          status.textContent = "Web interactions need a non-empty ---html, ---css, or ---js section.";
          status.className = "oba-error";
          status.hidden = false;
          return;
        }
        if (kind.value === "challenge" && !/^\s*(?:\/\/|#|--|;|\/\*|<!--).*\bTODO\b/im.test(code.value)) {
          status.textContent = "Challenge starter code needs a visible TODO comment.";
          status.className = "oba-error";
          status.hidden = false;
          return;
        }
        const markdown = codeInteractionMarkdown({
          kind: kind.value,
          language: language.value,
          title: title.value,
          instructions: instructions.value,
          code: code.value,
          expectedOutput: expectedOutput.value,
          hint: kind.value === "challenge" ? hint.value : "",
          explanation: explanation.value,
        });
        this.insertInteractionBlocks([markdown], target);
        close();
      },
    }, "Insert into draft");
    dialog.append(
      h("h2", { id: "oba-code-interaction-title" }, "Add runnable code"),
      h("p", { class: "oba-help" }, "Create a self-contained Rust or web interaction, or use a language explicitly enabled by the site's external runner. Readers review a disclosure before source is sent externally."),
      ...generation,
      this.field("oba-code-interaction-kind", "Interaction type", kind),
      this.field("oba-code-interaction-language", "Language", language),
      this.field("oba-code-interaction-name", "Title", title),
      this.field("oba-code-interaction-instructions", "Instructions", instructions),
      this.field("oba-code-interaction-code", "Source", code, "Web source uses ---html, ---css, and ---js markers. Other configured languages run through the site's external runner."),
      outputField,
      hintField,
      this.field("oba-code-interaction-explanation", "Explanation", explanation),
      status,
      h("div", { class: "oba-toolbar" }, h("span", { class: "oba-spacer" }), h("button", { class: "oba-btn", type: "button", onClick: close }, "Cancel"), insert),
    );
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    syncKind();
    document.body.append(dialog);
    dialog.showModal();
    title.focus();
  }

  /**
   * Where a citation goes: in Markdown, the selection and any citation it sits
   * in; in Visual, the saved range and any citation chip it touches. A chip or
   * citation found here is edited in place instead of adding another.
   */
  citationTarget(chip = null) {
    if (this.editorMode === "markdown") {
      const body = this.ui.body;
      const start = Number.isInteger(body.selectionStart) ? body.selectionStart : body.value.length;
      const end = Number.isInteger(body.selectionEnd) ? body.selectionEnd : start;
      return { mode: "markdown", start, end, span: citationAt(body.value, start, end) };
    }
    const range = this.visualSelection?.cloneRange?.() || null;
    let found = chip;
    if (!found && range) {
      const node = range.startContainer?.nodeType === 1 ? range.startContainer : range.startContainer?.parentElement;
      found = node?.closest?.(".oba-citation") || null;
      if (!found && range.startContainer === range.endContainer && range.endOffset === range.startOffset + 1) {
        const selected = range.startContainer?.childNodes?.[range.startOffset];
        if (selected?.classList?.contains("oba-citation")) found = selected;
      }
    }
    return { mode: "visual", range, chip: found && this.ui.richBody.contains(found) ? found : null };
  }

  /**
   * Why a new citation cannot go at the target, as a message for the author,
   * or "" when it can. Editing an existing citation or chip always can.
   * Inside code, a link or a protected block a citation would not be read as
   * one (or would break the link), so the dialog refuses it and keeps the
   * author's choices.
   */
  citationTargetProblem(target) {
    if (target.span || target.chip) return "";
    const inCode = "A citation cannot go inside code or a protected block. Cancel, move the caret into ordinary text and choose Cite again; your draft is unchanged.";
    const inLink = "A citation cannot go inside a link, where it would not be read as a citation. Cancel, move the caret after the link and choose Cite again; your draft is unchanged.";
    const inHtml = "A citation cannot go inside HTML or a comment, where it would not be read as a citation. Cancel, move the caret into ordinary text and choose Cite again; your draft is unchanged.";
    if (target.mode === "markdown") {
      const problem = citationInsertionProblem(this.ui.body.value, Math.max(target.start, target.end));
      if (problem === "html") return inHtml;
      return problem === "link" ? inLink : problem ? inCode : "";
    }
    const editor = this.ui.richBody;
    const range = target.range;
    const container = range ? (range.endContainer?.nodeType === 1 ? range.endContainer : range.endContainer?.parentElement) : null;
    if (!range || !container || !editor?.contains(container)) return "Place the caret in the text where the citation belongs: cancel, click in your draft and choose Cite again. Your draft is unchanged.";
    return visualCitationContainerProblem(container) === "link" ? inLink : visualCitationContainerProblem(container) ? inCode : "";
  }

  /**
   * Insert or edit a citation. The dialog is modal and keyboard operable;
   * Cancel or Escape returns focus to the writing surface with the selection
   * restored and the draft unchanged. A target the citation cannot go in is
   * reported inside the dialog, which stays open with the author's choices.
   * Insert checks the citation with the server (the core parser and
   * resolver) before the draft changes.
   */
  async openCitationDialog(chip = null) {
    if (chip) this.visualSelection = null;
    else this.captureVisualSelection();
    const target = this.citationTarget(chip);
    const existing = target.mode === "markdown" ? target.span?.text : target.chip?.dataset.citation;
    const initial = existing ? parseCitationText(existing) : null;
    const trigger = document.activeElement;
    const dialog = h("dialog", { class: "oba-dialog oba-capture-dialog oba-citation-dialog", "aria-labelledby": "oba-citation-title" });
    const body = h("div", {}, h("p", { class: "oba-small", role: "status" }, "Loading the source library…"));
    const returnToDraft = () => {
      dialog.close();
      dialog.remove();
      if (target.chip?.isConnected) {
        target.chip.focus();
        return;
      }
      const surface = this.writingSurface();
      surface.focus();
      if (target.mode === "markdown" && this.editorMode === "markdown") this.ui.body.setSelectionRange(target.start, target.end);
      else if (this.editorMode === "visual") this.restoreVisualSelection();
      else if (trigger instanceof HTMLElement && trigger !== surface) trigger.focus?.();
    };
    const problem = this.citationTargetProblem(target);
    dialog.append(
      h("h2", { id: "oba-citation-title" }, initial ? "Edit citation" : "Insert citation"),
      h("p", { class: "oba-help" }, "Cite a source from your library. Only the source key and the locators you enter are written into the post; quotations and notes stay private."),
      problem ? h("p", { class: "oba-notice", "data-citation-target": "refused" }, problem) : null,
      body,
    );
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      returnToDraft();
    });
    document.body.append(dialog);
    dialog.showModal();
    try {
      const loaded = await this.app.api.call("GET", "citations/library");
      if (!dialog.isConnected) return;
      const state = { revision: loaded.revision, sources: loaded.sources || [], passages: loaded.passages || [], notebookAvailable: loaded.notebookAvailable !== false };
      const form = createCitationForm({
        api: this.app.api,
        state,
        initial,
        // Checked before the server is asked, so nothing is sent for a target that cannot take a citation.
        refuse: () => this.citationTargetProblem(target),
        onInsert: (result) => {
          if (!CITATION_WHOLE.test(String(result?.markdown || ""))) return "The server returned no citation, so your draft is unchanged.";
          const refused = this.citationTargetProblem(target);
          if (refused) return refused;
          dialog.close();
          dialog.remove();
          if (!this.applyCitation(target, result.markdown)) this.writingSurface().focus();
          return "";
        },
        onCancel: returnToDraft,
      });
      body.replaceChildren(form.element);
      form.focus();
    } catch (error) {
      if (!dialog.isConnected) return;
      body.replaceChildren(
        h("p", { class: "oba-error", role: "alert" }, `The source library could not be read. Your draft is unchanged. ${error.message}`),
        h("div", { class: "oba-toolbar" }, h("button", { class: "oba-btn", type: "button", onClick: returnToDraft }, "Close")),
      );
      body.querySelector("button")?.focus();
    }
  }

  /** Apply checked citation Markdown to the draft, remembering exactly what to restore on undo. */
  applyCitation(target, markdown) {
    if (!CITATION_WHOLE.test(String(markdown || ""))) {
      this.sayCitation("The server returned no citation, so the draft is unchanged.");
      return false;
    }
    const problem = this.citationTargetProblem(target);
    if (problem) {
      this.sayCitation(problem);
      return false;
    }
    if (target.mode === "markdown") {
      if (this.editorMode !== "markdown") this.setEditorMode("markdown", false);
      const body = this.ui.body;
      const before = body.value;
      const next = insertCitationText(before, target.start, target.end, markdown, target.span);
      body.value = next.value;
      body.focus();
      body.setSelectionRange(next.start, next.end);
      body.dispatchEvent(new Event("input", { bubbles: true }));
      this.citationUndo = { mode: "markdown", before, after: body.value, selection: [target.start, target.end] };
    } else {
      if (this.editorMode !== "visual") this.setEditorMode("visual", false);
      this.syncRichToMarkdown();
      const editor = this.ui.richBody;
      const before = this.ui.body.value;
      const visualDirty = Boolean(this.visualDirty);
      const snapshot = [...editor.childNodes].map((node) => node.cloneNode(true));
      const path = target.range ? { start: nodePath(editor, target.range.startContainer), startOffset: target.range.startOffset, end: nodePath(editor, target.range.endContainer), endOffset: target.range.endOffset } : null;
      const chipPath = target.chip ? nodePath(editor, target.chip) : null;
      const chip = this.insertCitationChip(target, markdown);
      if (!chip) return false;
      this.visualChanged();
      this.citationUndo = { mode: "visual", before, after: this.ui.body.value, snapshot, path, chipPath, visualDirty };
    }
    if (this.ui.citationUndo) this.ui.citationUndo.hidden = false;
    this.sayCitation(`${target.span || target.chip ? "Citation updated" : "Citation inserted"} into your unsaved draft. Press Ctrl+Z or choose Undo citation to restore the draft as it was.`);
    return true;
  }

  /** Put a chip at the saved caret (or update the chip being edited) and move the caret after it. The target was checked first. */
  insertCitationChip(target, markdown) {
    const editor = this.ui.richBody;
    let chip = null;
    if (target.chip && editor.contains(target.chip)) {
      chip = citationChip(markdown);
      target.chip.replaceWith(chip);
    } else {
      const range = target.range?.cloneRange?.();
      const container = range ? (range.endContainer?.nodeType === 1 ? range.endContainer : range.endContainer?.parentElement) : null;
      if (!range || !container) return null;
      range.collapse(false);
      chip = citationChip(markdown);
      const previous = range.startContainer?.nodeType === 3 ? range.startContainer.nodeValue.slice(0, range.startOffset) : "";
      if (container === editor) {
        const paragraph = h("p", { "data-visual-block": "paragraph" }, chip);
        range.insertNode(paragraph);
      } else {
        range.insertNode(chip);
        if (previous && !/[\s([]$/.test(previous)) range.insertNode(document.createTextNode(" "));
      }
    }
    editor.focus();
    placeCaretAfter(chip, this);
    return chip;
  }

  /**
   * Turn a well-formed citation just typed or pasted in Visual mode into a
   * chip, so it is written back as a citation instead of escaped text. Only
   * the text that ends at the caret is looked at, never older text (an
   * author's escaped `\[@...]` stays text), and never inside code, links or
   * protected blocks.
   */
  chipCitationBeforeCaret() {
    const selection = globalThis.getSelection?.();
    if (this.editorMode !== "visual" || !selection?.rangeCount || !selection.isCollapsed) return null;
    const node = selection.anchorNode;
    const offset = selection.anchorOffset;
    if (node?.nodeType !== Node.TEXT_NODE || !this.ui.richBody.contains(node) || visualCitationContainerProblem(node.parentElement)) return null;
    const match = /(?<!\\)\[@[^[\]\n]*\]$/.exec(node.nodeValue.slice(0, offset));
    if (!match) return null;
    const chip = replaceTextWithChip(node, match.index, offset);
    placeCaretAfter(chip, this);
    return chip;
  }

  /** Paste plain text into the visual editor, making each well-formed citation in it a chip. */
  pasteVisualText(text) {
    const value = String(text || "");
    const editor = this.ui.richBody;
    const selection = globalThis.getSelection?.();
    const node = selection?.rangeCount ? selection.getRangeAt(0).endContainer : null;
    const container = node?.nodeType === 1 ? node : node?.parentElement;
    const matches = container && editor.contains(container) && !visualCitationContainerProblem(container) ? [...value.matchAll(CITATION_TEXT)] : [];
    let offset = 0;
    for (const match of matches) {
      // The input handler usually makes the chip as the text lands; this covers browsers that report the paste differently.
      document.execCommand("insertText", false, value.slice(offset, match.index + match[0].length));
      offset = match.index + match[0].length;
      this.chipCitationBeforeCaret();
    }
    if (offset < value.length || !matches.length) document.execCommand("insertText", false, value.slice(offset));
    if (matches.length) this.visualChanged();
  }

  citationUndoAvailable() {
    const undo = this.citationUndo;
    return Boolean(undo && undo.mode === this.editorMode && this.ui.body.value === undo.after);
  }

  /** Restore the draft and caret exactly as they were before the last citation was applied. */
  undoCitation() {
    const undo = this.citationUndo;
    this.citationUndo = null;
    if (this.ui.citationUndo) this.ui.citationUndo.hidden = true;
    if (!undo || undo.mode !== this.editorMode || this.ui.body.value !== undo.after) {
      this.sayCitation("Undo is unavailable because the draft changed after the citation was applied.");
      return false;
    }
    this.ui.body.value = undo.before;
    if (undo.mode === "markdown") {
      this.ui.body.focus();
      this.ui.body.setSelectionRange(undo.selection[0], undo.selection[1]);
    } else {
      const editor = this.ui.richBody;
      editor.replaceChildren(...undo.snapshot);
      this.visualDirty = undo.visualDirty;
      editor.focus();
      const chip = undo.chipPath ? nodeAtPath(editor, undo.chipPath) : null;
      const start = undo.path ? nodeAtPath(editor, undo.path.start) : null;
      const end = undo.path ? nodeAtPath(editor, undo.path.end) : null;
      if (chip?.focus) chip.focus();
      else if (start && end) {
        const range = document.createRange?.();
        const selection = globalThis.getSelection?.();
        if (range && selection) {
          range.setStart(start, undo.path.startOffset);
          range.setEnd(end, undo.path.endOffset);
          selection.removeAllRanges();
          selection.addRange(range);
          this.visualSelection = range.cloneRange();
        }
      }
    }
    this.ui.body.dispatchEvent(new Event("input", { bubbles: true }));
    this.sayCitation("Citation undone. The draft is as it was before.");
    return true;
  }

  sayCitation(message) {
    if (this.ui?.citationStatus) this.ui.citationStatus.textContent = message;
  }

  /**
   * Capture a passage or note from the draft without leaving it. The dialog
   * is modal; Save and Cancel (and Escape) both return focus to the editing
   * surface with the author's selection restored, and neither changes the draft.
   */
  async openResearchCapture() {
    this.captureVisualSelection();
    const selectedText = this.knowledgeCheckTarget().selected;
    const trigger = document.activeElement;
    const markdownSelection = this.editorMode === "markdown" ? [this.ui.body.selectionStart, this.ui.body.selectionEnd] : null;
    const dialog = h("dialog", { class: "oba-dialog oba-capture-dialog", "aria-labelledby": "oba-capture-title" });
    const body = h("div", {}, h("p", { class: "oba-small", role: "status" }, "Loading the research notebook…"));
    const returnToDraft = () => {
      dialog.close();
      dialog.remove();
      const surface = this.writingSurface();
      surface.focus();
      if (markdownSelection && this.editorMode === "markdown") this.ui.body.setSelectionRange(markdownSelection[0], markdownSelection[1]);
      else if (this.editorMode === "visual") this.restoreVisualSelection();
      else if (trigger instanceof HTMLElement && trigger !== surface) trigger.focus?.();
    };
    dialog.append(
      h("h2", { id: "oba-capture-title" }, "Capture research"),
      h("p", { class: "oba-help" }, "Quote a passage from a source, or record a note. Saved to your private notebook; your draft is not changed."),
      body,
    );
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      returnToDraft();
    });
    document.body.append(dialog);
    dialog.showModal();
    try {
      const loaded = await this.app.api.call("GET", "research/notebook");
      if (!dialog.isConnected) return;
      const state = { revision: loaded.revision, sources: loaded.sources, passages: loaded.passages, notes: loaded.notes };
      const form = createCaptureForm({
        api: this.app.api,
        state,
        idPrefix: "oba-capture",
        prefill: { excerpt: selectedText },
        onSaved: (result) => {
          if (!result.partial) returnToDraft();
        },
        onCancel: returnToDraft,
      });
      body.replaceChildren(form.element);
      form.focus();
    } catch (error) {
      if (!dialog.isConnected) return;
      body.replaceChildren(
        h("p", { class: "oba-error", role: "alert" }, `The research notebook could not be read. ${notebookErrorMessage(error)}`),
        h("div", { class: "oba-toolbar" }, h("button", { class: "oba-btn", type: "button", onClick: returnToDraft }, "Close")),
      );
      body.querySelector("button")?.focus();
    }
  }

  openKnowledgeCheck() {
    this.captureVisualSelection();
    const target = this.knowledgeCheckTarget();
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
          const context = this.interactionContext(target);
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
      if (focusBody) this.writingSurface().focus();
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
        this.insertKnowledgeCheckBlocks(blocks, target);
        close(false);
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
      set("subtitle", ui.subtitle.value.replace(/\s+/g, " ").trim());
      // The editor writes the canonical key; aliases would otherwise survive a cleared field.
      set("subheading", "");
      set("dek", "");
      set("description", ui.description.value.trim());
      set("comments", ui.commentPolicy.value === "open" ? "" : ui.commentPolicy.value);
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
    this.syncRichToMarkdown();
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
    const exactTrack = this.pendingTrack && fields.profile === "field-journal" && fields.locationPrivacy === "exact" ? this.pendingTrack : null;
    const payload = { fields, body: ui.body.value, etag: this.doc.etag, kind: this.kind, ...(exactTrack ? { trackToken: exactTrack.token, trackName: exactTrack.name } : {}), ...this.creditRequestFields(true) };
    try {
      const res = this.doc.path
        ? await this.app.api.call("PUT", `document?path=${encodeURIComponent(this.doc.path)}`, { json: payload })
        : await this.app.api.call("POST", "document", { json: payload });
      this.f = fields;
      if (res.trackUrl) {
        fields.route = res.trackUrl;
        this.profileFieldDrafts.set("route", res.trackUrl);
        this.pendingTrack = null;
      }
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
      // Redraw the visual editor from the saved draft, so its blocks match the draft's again (an
      // empty paragraph writes nothing). Only when nothing changed during the save and the caret
      // is not in the editor, so no typing or caret position is lost.
      if (this.editorMode === "visual" && this.visualDirty && savedState.messageIsCurrent && !ui.richBody?.contains(document.activeElement)) {
        this.renderRichEditor();
        this.visualSelection = null;
      }
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
