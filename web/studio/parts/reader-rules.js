// What readers sent, as rules: the six views, the nine kinds, the buttons each kind offers (only
// what the server offered), the request a decision sends, what each one says afterwards, who sent it,
// what is on the post, and a failure in her words. The server decides who may do what and sends the
// actions; these only name and shape what it sent. DOM-free, tested. Lifted from the old Admin's
// moderation helpers (web/admin/admin.js, "The moderation inbox"). Studio R10.
import { say } from "./words.js";

// ---- views --------------------------------------------------------------------------------------

/**
 * The six views, in the order the picker lists them. `state` is the server's state; `suffix` names
 * the word ids; `beyondComments` means the view only exists on a site with kinds beyond comments.
 */
export const VIEWS = Object.freeze([
  { id: "", state: "pending", suffix: "Waiting", other: "shown", beyondComments: false },
  { id: "asked", state: "clarification", suffix: "Asked", other: "", beyondComments: true },
  { id: "shown", state: "approved", suffix: "Shown", other: "", beyondComments: false },
  { id: "not-shown", state: "rejected", suffix: "NotShown", other: "", beyondComments: false },
  { id: "taken-down", state: "removed", suffix: "TakenDown", other: "shown", beyondComments: false },
  { id: "taken-back", state: "withdrawn", suffix: "TakenBack", other: "", beyondComments: true },
]);

/** The view an address names ("" and anything unknown are Waiting). */
export const viewOf = (arg) => VIEWS.find((v) => v.id === arg) || VIEWS[0];

/** The views a site shows: the two that only scholarly kinds use are left out of a comments-only site. */
export const shownViews = (beyondComments) => VIEWS.filter((v) => !v.beyondComments || beyondComments);

/** A view's label. */
export function viewLabel(view) {
  switch (view.suffix) {
    case "Waiting": return say("readers.viewWaiting");
    case "Asked": return say("readers.viewAsked");
    case "Shown": return say("readers.viewShown");
    case "NotShown": return say("readers.viewNotShown");
    case "TakenDown": return say("readers.viewTakenDown");
    default: return say("readers.viewTakenBack");
  }
}

/** A view's one-line introduction; Shown adds the sentence about kinds that never show. */
export function viewLede(view, { privateKinds = false } = {}) {
  const base = {
    Waiting: say("readers.ledeWaiting"), Asked: say("readers.ledeAsked"), Shown: say("readers.ledeShown"),
    NotShown: say("readers.ledeNotShown"), TakenDown: say("readers.ledeTakenDown"), TakenBack: say("readers.ledeTakenBack"),
  }[view.suffix];
  return view.suffix === "Shown" && privateKinds ? `${base} ${say("readers.ledeShownPrivate")}` : base;
}

/** [title, text] for an empty view; a comments-only site says "comment" instead of "note". */
export function emptyWords(view, { commentsOnly = false } = {}) {
  switch (view.suffix) {
    case "Waiting": return [say("readers.emptyWaitingTitle"), commentsOnly ? say("readers.emptyWaitingComments") : say("readers.emptyWaitingText")];
    case "Asked": return [say("readers.emptyAskedTitle"), say("readers.emptyAskedText")];
    case "Shown": return commentsOnly ? [say("readers.emptyShownTitleComments"), say("readers.emptyShownComments")] : [say("readers.emptyShownTitle"), say("readers.emptyShownText")];
    case "NotShown": return [say("readers.emptyNotShownTitle"), commentsOnly ? say("readers.emptyNotShownComments") : say("readers.emptyNotShownText")];
    case "TakenDown": return [say("readers.emptyTakenDownTitle"), commentsOnly ? say("readers.emptyTakenDownComments") : say("readers.emptyTakenDownText")];
    default: return [say("readers.emptyTakenBackTitle"), say("readers.emptyTakenBackText")];
  }
}

/** The empty-state button's words. */
export const otherViewWords = (view) => (view.other === "shown" ? say("readers.seeShown") : say("readers.seeWaiting"));

// ---- kinds --------------------------------------------------------------------------------------

/** The nine kinds: the server's id, the suffix its word ids use, and whether it is ever public. */
export const KINDS = Object.freeze([
  { id: "comment", suffix: "comment", public: true },
  { id: "question", suffix: "question", public: true },
  { id: "source-suggestion", suffix: "sourceSuggestion", public: true },
  { id: "correction-suggestion", suffix: "correctionSuggestion", public: true },
  { id: "alternative-interpretation", suffix: "alternativeInterpretation", public: true },
  { id: "third-perspective", suffix: "thirdPerspective", public: true },
  { id: "author-response", suffix: "authorResponse", public: true },
  { id: "abuse-report", suffix: "abuseReport", public: false },
  { id: "future-suggestion", suffix: "futureSuggestion", public: false },
]);

export const kindKnown = (id) => KINDS.some((k) => k.id === id);

// Literal ids per kind, so the catalog tests can find every one.
const FILTER_WORDS = {
  comment: () => say("readers.kinds.comment"), question: () => say("readers.kinds.question"),
  "source-suggestion": () => say("readers.kinds.sourceSuggestion"), "correction-suggestion": () => say("readers.kinds.correctionSuggestion"),
  "alternative-interpretation": () => say("readers.kinds.alternativeInterpretation"), "third-perspective": () => say("readers.kinds.thirdPerspective"),
  "author-response": () => say("readers.kinds.authorResponse"), "abuse-report": () => say("readers.kinds.abuseReport"),
  "future-suggestion": () => say("readers.kinds.futureSuggestion"),
};
const BADGE_WORDS = {
  comment: () => say("readers.kind.comment"), question: () => say("readers.kind.question"),
  "source-suggestion": () => say("readers.kind.sourceSuggestion"), "correction-suggestion": () => say("readers.kind.correctionSuggestion"),
  "alternative-interpretation": () => say("readers.kind.alternativeInterpretation"), "third-perspective": () => say("readers.kind.thirdPerspective"),
  "author-response": () => say("readers.kind.authorResponse"), "abuse-report": () => say("readers.kind.abuseReport"),
  "future-suggestion": () => say("readers.kind.futureSuggestion"),
};

/** A kind in the filter ("Questions"); an unknown future kind shows under the server's own label. */
export const kindFilterWords = (id, fallback = "") => (id === "" ? say("readers.kinds.all") : FILTER_WORDS[id]?.() || fallback || id);

/** A kind as a badge on a card ("Question"). */
export const kindBadgeWords = (item) => BADGE_WORDS[item.kind]?.() || item.kindLabel || item.kind || "";

/**
 * The kinds the filter lists: "Everything", then each kind the site has on (`settings.kinds`, with
 * comment when comments are on) or, until the server says, the kinds seen on the loaded page plus the
 * current one. Order is the table's.
 */
export function kindsOffered(settings, page, current = "") {
  const on = new Set();
  if (Array.isArray(settings?.kinds)) {
    for (const k of settings.kinds) if (kindKnown(k.id) && k.setting !== "off") on.add(k.id);
    if (settings.comments !== false) on.add("comment");
  } else {
    for (const item of page?.items || []) if (kindKnown(item.kind)) on.add(item.kind);
    if (settings?.comments !== false && settings) on.add("comment");
  }
  if (kindKnown(current)) on.add(current);
  return KINDS.filter((k) => on.has(k.id)).map((k) => k.id);
}

/** True when the site takes anything but comments (its extra views and its filter show). */
export const hasBeyondComments = (kinds) => kinds.some((id) => id !== "comment");

// ---- addresses ----------------------------------------------------------------------------------

/** `#/readers[/<view>][?kind=&item=]`; empty values are left out. */
export function readersHash(view = "", kind = "", item = "") {
  const search = new URLSearchParams(Object.entries({ kind, item }).filter(([, v]) => v)).toString();
  return `#/readers${view ? `/${view}` : ""}${search ? `?${search}` : ""}`;
}

/** "comment:abc" → { source: "comment", id: "abc" }, or null. */
export function parseItemRef(ref) {
  const text = String(ref || "");
  const at = text.indexOf(":");
  if (at < 1 || at === text.length - 1) return null;
  const source = text.slice(0, at);
  return ["comment", "feedback", "report"].includes(source) ? { source, id: text.slice(at + 1) } : null;
}

const OLD_STATES = { pending: "", clarification: "asked", approved: "shown", rejected: "not-shown", removed: "taken-down", withdrawn: "taken-back" };
const OLD_VISITOR_DAYS = new Set(["7", "90", "365"]);

/**
 * The Readers address for an old one: the old Admin's `#/moderation[/<state>][?kind=]`,
 * `#/feedback[…]`, `#/analytics[/<days>]` and Studio's own retired `#/comments[/<view>]`,
 * `#/visitors[/<days>]`. `null` when `name` isn't one of them. `search` has no leading "?".
 */
export function readersRoute(name, rest = [], search = "") {
  const params = new URLSearchParams(search);
  const tail = rest.filter(Boolean);
  if (name === "moderation" || name === "feedback") {
    const view = OLD_STATES[tail[0]] ?? "";
    const kind = kindKnown(params.get("kind")) ? params.get("kind") : "";
    return readersHash(view, kind);
  }
  if (name === "comments") {
    const known = VIEWS.some((v) => v.id === tail[0]);
    return `#/readers${known && tail[0] ? `/${tail[0]}` : ""}${search ? `?${search}` : ""}`;
  }
  if (name === "analytics" || name === "visitors") {
    return `#/readers/visitors${OLD_VISITOR_DAYS.has(tail[0]) ? `/${tail[0]}` : ""}${name === "visitors" && search ? `?${search}` : ""}`;
  }
  return null;
}

// ---- cards: labels, buttons, requests ------------------------------------------------------------

const name80 = (value) => {
  const text = String(value ?? "");
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
};

/** Whose it is, for a button's name and a menu: "Comment from Linda on Apple pie". Names are cut at 80 letters. */
export function cardLabel(item) {
  const who = name80(item.reader?.name) || say("readers.someone");
  const on = item.post?.title ? say("readers.cardOn", { title: name80(item.post.title) }) : "";
  if (item.source === "report") return say("readers.cardReport", { name: who, on });
  if (item.source === "comment") return say("readers.cardComment", { name: who, on });
  return say("readers.cardNote", { kind: kindBadgeWords(item), name: who, on });
}

const where = (item) => (item.post?.title ? `“${item.post.title}”` : say("readers.onSite").replace(/^on /, ""));

/** The reasons a decision takes, in her words; one Studio doesn't know shows under the server's label. */
const REASON_WORDS = {
  spam: () => say("readers.reason.spam"), abusive: () => say("readers.reason.abusive"),
  "personal-data": () => say("readers.reason.personalData"), "off-topic": () => say("readers.reason.offTopic"),
  duplicate: () => say("readers.reason.duplicate"), rights: () => say("readers.reason.rights"),
  "no-action": () => say("readers.reason.noAction"), other: () => say("readers.reason.other"),
};
export function reasonWords(reason, { report = false } = {}) {
  if (report && reason.id === "duplicate") return say("readers.reason.reportDuplicate");
  if (report && reason.id === "spam") return say("readers.reason.reportSpam");
  return REASON_WORDS[reason.id]?.() || reason.label || reason.id;
}

/** Taking a reported item down sends the report's own reason, when the server takes it. */
export function reportReason(item) {
  const ground = item.report?.ground;
  const offer = (item.actions || []).find((a) => a.action === "uphold-report");
  return ground && (offer?.reasons || []).some((r) => r.id === ground) ? ground : null;
}

/** "Keep the comment" sends this reason without asking, when the server offers it. */
export function quietReason(offer) {
  return (offer?.reasons || []).some((r) => r.id === "no-action") ? "no-action" : null;
}

/**
 * The buttons a card shows, from the actions the server offered: `top` each
 * `{ action, label, primary, asks, offer }` (`asks`: it opens the Why menu), `more` the rest under the
 * server's label (a new server action still shows). An action the server didn't offer never shows;
 * `erase` is always in `more` when offered. Kinds differ in words, never in what is offered.
 */
export function buttonsFor(item) {
  const offered = new Map((item.actions || []).map((a) => [a.action, a]));
  const top = [];
  const take = (action, label, primary, asks) => {
    const offer = offered.get(action);
    if (!offer) return;
    top.push({ action, label, primary, asks: asks && (offer.reasons || []).length > 0, offer });
    offered.delete(action);
  };
  if (item.source === "report") {
    take("uphold-report", say("readers.btnTakeDown"), true, !reportReason(item));
    take("reject", say("readers.btnKeepComment"), false, !quietReason(offered.get("reject")));
    take("reopen", say("readers.btnDecideAgain"), false, false);
  } else if (item.kind === "future-suggestion") {
    take("approve", say("readers.btnKeepLater"), true, false);
    take("reject", say("readers.btnNotNow"), false, true);
    take("remove", say("readers.btnClose"), false, true);
    take("reopen", say("readers.btnPutBack"), false, false);
  } else {
    take("approve", say("readers.btnShow"), true, false);
    take("reject", say("readers.btnDontShow"), false, true);
    take("request-clarification", say("readers.btnAsk"), false, true);
    take("remove", say("readers.btnTakeDown"), false, true);
    take("reopen", say("readers.btnPutBack"), false, false);
  }
  const more = [...offered.values()].map((offer) => ({
    action: offer.action,
    label: offer.action === "erase" ? say("readers.btnErase") : offer.label,
    asks: offer.action !== "erase" && (offer.reasons || []).length > 0,
    offer,
  }));
  return { top, more };
}

/**
 * The body of one decision: what she saw (`from`, `version`) and, to show a note whose passage has
 * changed, the passage check she read; a reflection's approval binds the text and consent she saw.
 * Nothing says who is deciding: the server knows. Erase carries no extra field (the dialog is the question).
 */
export function decisionRequest(item, action, reason, { acknowledged = false } = {}) {
  const request = { source: item.source, id: item.id, action, from: item.status, version: item.version };
  if (reason) request.reason = reason;
  if (action === "approve" && item.passage?.acknowledge && acknowledged) request.acknowledge = item.passage.check;
  if (action === "approve" && item.perspective) {
    request.seenRevision = item.revision;
    request.seenConsent = item.perspective.consent?.number;
  }
  return request;
}

/** Does Show it need the passage dialog first? */
export const needsAcknowledge = (item, action) => action === "approve" && Boolean(item.passage?.acknowledge);


/**
 * Words for an id a rule chose (a state, a problem, a button). Every id is written out as a literal so the
 * words check can see it is used; ask for one that is not here and it says nothing.
 */
export function readerWords(id, vars = {}) {
  switch (id) {
    case "readers.cardFailed": return say("readers.cardFailed", vars);
    case "readers.cardServiceDown": return say("readers.cardServiceDown", vars);
    case "readers.changedHere": return say("readers.changedHere", vars);
    case "readers.chooseWhy": return say("readers.chooseWhy", vars);
    case "readers.connBadAddress": return say("readers.connBadAddress", vars);
    case "readers.connBadKey": return say("readers.connBadKey", vars);
    case "readers.connNeedAddress": return say("readers.connNeedAddress", vars);
    case "readers.connNeedSiteKey": return say("readers.connNeedSiteKey", vars);
    case "readers.didAsked": return say("readers.didAsked", vars);
    case "readers.didBack": return say("readers.didBack", vars);
    case "readers.didClosed": return say("readers.didClosed", vars);
    case "readers.didDone": return say("readers.didDone", vars);
    case "readers.didErased": return say("readers.didErased", vars);
    case "readers.didKept": return say("readers.didKept", vars);
    case "readers.didKeptComment": return say("readers.didKeptComment", vars);
    case "readers.didNotNow": return say("readers.didNotNow", vars);
    case "readers.didNotShown": return say("readers.didNotShown", vars);
    case "readers.didShownComment": return say("readers.didShownComment", vars);
    case "readers.didShownNote": return say("readers.didShownNote", vars);
    case "readers.didTakenDown": return say("readers.didTakenDown", vars);
    case "readers.didUpheld": return say("readers.didUpheld", vars);
    case "readers.didUpheldGone": return say("readers.didUpheldGone", vars);
    case "readers.fixAnswerButton": return say("readers.fixAnswerButton", vars);
    case "readers.fixAnswerPublish": return say("readers.fixAnswerPublish", vars);
    case "readers.fixDecision": return say("readers.fixDecision", vars);
    case "readers.fixDecisionButton": return say("readers.fixDecisionButton", vars);
    case "readers.fixName": return say("readers.fixName", vars);
    case "readers.fixNameButton": return say("readers.fixNameButton", vars);
    case "readers.fixPublish": return say("readers.fixPublish", vars);
    case "readers.fixPublishButton": return say("readers.fixPublishButton", vars);
    case "readers.fixUnknown": return say("readers.fixUnknown", vars);
    case "readers.fixUnpublish": return say("readers.fixUnpublish", vars);
    case "readers.fixUnpublishButton": return say("readers.fixUnpublishButton", vars);
    case "readers.fixWithdrawn": return say("readers.fixWithdrawn", vars);
    case "readers.gone": return say("readers.gone", vars);
    case "readers.listFailed": return say("readers.listFailed", vars);
    case "readers.listReset": return say("readers.listReset", vars);
    case "readers.listServiceDown": return say("readers.listServiceDown", vars);
    case "readers.noSignal": return say("readers.noSignal", vars);
    case "readers.notOffered": return say("readers.notOffered", vars);
    case "readers.notYours": return say("readers.notYours", vars);
    case "readers.onPost": return say("readers.onPost", vars);
    case "readers.onPostAnswer": return say("readers.onPostAnswer", vars);
    case "readers.onPostReflection": return say("readers.onPostReflection", vars);
    case "readers.setupNotSetUp": return say("readers.setupNotSetUp", vars);
    case "readers.setupNotWorking": return say("readers.setupNotWorking", vars);
    case "readers.setupOff": return say("readers.setupOff", vars);
    case "readers.setupWorking": return say("readers.setupWorking", vars);
    default: return "";
  }
}

// ---- deciding many at once ----------------------------------------------------------------------

/**
 * Whether a card can be part of a bulk decision: waiting, and the server offers both Show and Don't show,
 * and showing it does not need the passage read first. Anything else is decided by itself.
 */
export function bulkEligible(item) {
  if (item.status !== "pending") return false;
  const offered = new Set((item.actions || []).map((a) => a.action));
  return offered.has("approve") && offered.has("reject") && !needsAcknowledge(item, "approve") && item.source !== "report";
}

/** The reasons the server takes for Don't show on every one of these notes (the ones they all share). */
export function sharedReasons(items) {
  const lists = items.map((item) => (item.actions || []).find((a) => a.action === "reject")?.reasons || []);
  if (!lists.length) return [];
  return lists[0].filter((reason) => lists.every((list) => list.some((r) => r.id === reason.id)));
}

/** The body for `engagement/moderation/batch`: each note as the server sent it, and one action and reason. */
export function bulkRequest(items, action, reason = null) {
  const body = { items: items.map((i) => ({ source: i.source, id: i.id, from: i.status, version: i.version })), action };
  if (reason) body.reason = reason;
  return body;
}

/** What a batch did: the notes that were decided (with the server's new version) and each that wasn't, by code. */
export function bulkOutcome(items, reply) {
  const byId = new Map((reply?.results || []).map((r) => [r.id, r]));
  const done = [];
  const failed = [];
  for (const item of items) {
    const result = byId.get(item.id);
    if (result?.ok) done.push({ ...item, ...(result.item || {}), source: item.source });
    else failed.push({ item, code: result?.code || "failed" });
  }
  return { done, failed };
}

/** The line a batch ends with, in her words. */
export function bulkWords(outcome, action) {
  const done = outcome.done.length;
  const failed = outcome.failed.length;
  if (!done) return say("readers.bulkNone");
  if (failed) return say("readers.bulkPartial", { done, failed });
  return action === "approve" ? say("readers.bulkShown", { done }) : say("readers.bulkDone", { done });
}

/** The line under a card that didn't go through. */
export const bulkLine = (code) => (code === "conflict" || code === "changed" ? say("readers.bulkLineChanged") : say("readers.bulkLineFailed"));

/** The decision and what it says: `{ id, vars, text }`; a public note also says when readers will see it (the screen adds that). */
export function didWords(item, action, result = {}) {
  const post = where(item);
  const comment = item.source === "comment";
  const report = item.source === "report";
  let id;
  if (action === "approve") id = item.kind === "future-suggestion" ? "readers.didKept" : comment ? "readers.didShownComment" : "readers.didShownNote";
  else if (action === "reject") id = report ? "readers.didKeptComment" : item.kind === "future-suggestion" ? "readers.didNotNow" : "readers.didNotShown";
  else if (action === "remove") id = item.kind === "future-suggestion" ? "readers.didClosed" : "readers.didTakenDown";
  else if (action === "request-clarification") id = "readers.didAsked";
  else if (action === "uphold-report") id = result.removedTarget === false ? "readers.didUpheldGone" : "readers.didUpheld";
  else if (action === "reopen") id = "readers.didBack";
  else if (action === "erase") id = "readers.didErased";
  else id = "readers.didDone";
  const vars = { where: post };
  return { id, vars, text: readerWords(id, vars) };
}

/** The Undo banner's words for a decision that can go back to Waiting, or null. */
export function undoWords(item, action) {
  const label = cardLabel(item);
  if (action === "reject" && item.source === "report") return say("readers.undoKept", { label });
  if (action === "reject") return say("readers.undoNotShown", { label });
  if (action === "remove" || action === "uphold-report") return say("readers.undoTakenDown", { label });
  return null;
}

/** The line a decided card adds: "Not shown: it's spam. You decided Tuesday, November 10." */
export function decisionLine(item, sayDay) {
  const day = item.moderatedAt ? say("readers.decidedDay", { day: sayDay(item.moderatedAt) }) : "";
  if (item.source === "report") {
    if (item.status === "approved") return say("readers.decidedReportUpheld", { day });
    if (item.status === "rejected") return say("readers.decidedReportKept", { day });
    return "";
  }
  const why = item.reason ? `: ${reasonWords({ id: item.reason, label: item.reasonLabel }).replace(/^./, (c) => c.toLowerCase())}` : "";
  if (item.kind === "future-suggestion" && item.status === "approved") return say("readers.decidedKept", { day });
  if (item.status === "approved") return say("readers.decidedShown", { day });
  if (item.status === "rejected") return say("readers.decidedNotShown", { why, day });
  if (item.status === "removed") return say("readers.decidedTakenDown", { why, day });
  return "";
}

// ---- reading a card -----------------------------------------------------------------------------

/** What she can do with an item, from the role the server resolved; the site's owner gets no line. */
export function roleLine(role) {
  if (role === "coordinator") return say("readers.roleCoordinator");
  if (role === "contributing-author") return say("readers.roleContributor");
  return "";
}

/** Who sent it, for her only. Given `isolating` (parts/words.js), parts with the reader's name apart. */
export function readerLine(reader, source = "feedback", kind = "", speak = say) {
  if (source === "report") return speak("readers.reportAnonymous");
  if (kind === "author-response") return speak("readers.answerByAuthor");
  if (source === "comment") return reader?.name ? (reader.publishName === false ? speak("readers.onlyYou") : speak("readers.nameShown")) : speak("readers.anonymous");
  if (reader?.private) return speak("readers.nameOnlyOwner");
  if (!reader?.name) return speak("readers.anonymous");
  return reader.publishName ? speak("readers.nameIfShown", { name: name80(reader.name) }, ["name"]) : speak("readers.namePrivate");
}

/** The passage block: `{ quoted, line, stale }`, where `line` is her words about it (or ""), or null with no passage. */
export function passageView(passage) {
  if (!passage) return null;
  const line = passage.check === "stale" ? say("readers.passageChanged")
    : passage.check === "reanchored" ? say("readers.passageMoved")
      : passage.check === "unknown-work" ? say("readers.postGone") : "";
  return { quoted: passage.quoted || "", line, stale: passage.check === "stale" };
}

/** How a published note would read, in her words. */
export function previewWords(preview, speak = say) {
  if (!preview) return "";
  // The reader's own words (their name, their quote) are kept apart; "someone" is Studio's.
  const name = preview.name || say("readers.someone");
  const theirs = preview.name ? ["name"] : [];
  if (preview.quote) return speak("readers.previewQuote", { quote: preview.quote, name }, ["quote", ...theirs]);
  return preview.stale ? speak("readers.previewNoQuote") : speak("readers.previewPlain", { name }, theirs);
}

/** Links to cards on the same page that may be about the same thing: `[{ ref, label }]`. */
export function similarLinks(item, sayWhen) {
  return (item.similar || []).filter((s) => s?.id).map((s) => ({
    ref: `${s.source || item.source}:${s.id}`,
    label: say("readers.similarLink", { kind: kindBadgeWords({ kind: s.kind, kindLabel: s.kindLabel }), when: s.receivedAt ? sayWhen(s.receivedAt) : "" }).replace(/,\s*$/, ""),
  }));
}

/**
 * What is on the post, as `{ level, id, vars, action, button }` when the file and the decision
 * disagree (an alert with its one button), or `{ level: "quiet", id }` when it is simply there, or
 * null. In order of urgency; reflections and authors' answers have their own rules. `published` is
 * null when unknown.
 */
export function publicationState(item) {
  if (item.kind === "future-suggestion" || item.source === "report") return null;
  const alert = (id, action, button, vars = {}) => ({ level: "warning", id, vars, action, button });
  const gone = (id, vars = {}) => ({ level: "danger", id, vars, action: "unpublish", button: "readers.fixUnpublishButton" });
  if (item.kind === "third-perspective") {
    if (item.published === false && item.mayBeShown === true) return alert("readers.fixPublish", "publish", "readers.fixPublishButton");
    if (item.published === true && item.mayBeShown === null) return alert("readers.fixUnknown", "unpublish", "readers.fixUnpublishButton");
    if (item.published === true && item.mayBeShown === true && item.nameNarrowed === true) return alert("readers.fixName", "publish", "readers.fixNameButton");
    if (item.published === true && item.mayBeShown === false) return item.status === "withdrawn" ? gone("readers.fixWithdrawn") : gone("readers.fixUnpublish");
    return item.published === true ? { level: "quiet", id: "readers.onPostReflection" } : null;
  }
  if (item.kind === "author-response") {
    if (item.published === false && item.mayBeShown === true && item.status === "approved") return alert("readers.fixAnswerPublish", "publish", "readers.fixAnswerButton");
    if (item.published === true && item.mayBeShown === false) return item.status === "withdrawn" ? gone("readers.fixWithdrawn") : gone("readers.fixUnpublish");
    return item.published === true ? { level: "quiet", id: "readers.onPostAnswer" } : null;
  }
  if (item.source === "comment") return null;
  if (item.status === "approved" && item.published === false) return alert("readers.fixPublish", "publish", "readers.fixPublishButton");
  if (item.status === "approved" && item.published === true && item.decisionPublished === false) return alert("readers.fixDecision", "publish-decision", "readers.fixDecisionButton");
  if (item.status === "withdrawn" && item.published === true) return gone("readers.fixWithdrawn");
  if ((item.status === "removed" || item.status === "rejected") && item.published === true) return gone("readers.fixUnpublish");
  return item.status === "approved" && item.published === true ? { level: "quiet", id: "readers.onPost" } : null;
}

/** The endpoint a publication fix calls. */
export const fixRoute = (item, action) => {
  const base = item.kind === "third-perspective" ? "engagement/third-perspectives" : item.kind === "author-response" ? "engagement/author-responses" : "engagement/feedback";
  return `${base}/${action}`;
};

// ---- Home ---------------------------------------------------------------------------------------

/** Home's line, or "" for nothing to say. `page` is one waiting page as the server sent it. */
export function waitingLine(page) {
  const items = (page?.items || []).filter((i) => i && i.id);
  const count = items.length;
  if (!count) return "";
  const comments = items.every((i) => i.source === "comment" || i.source === "report");
  if (page.next) return comments ? say("home.commentsWaitingMore", { n: count }) : say("home.readersWaitingMore", { n: count });
  if (count === 1) return comments ? say("home.commentWaiting") : say("home.readerWaiting");
  return comments ? say("home.commentsWaiting", { n: count }) : say("home.readersWaiting", { n: count });
}

// ---- failures -----------------------------------------------------------------------------------

/**
 * A failure in her words, as `{ id, vars, reload, code }`. `place` is "list" or "card". Understands the
 * engagement answers' `code` (G81) and, until every route sends one, today's statuses and sentences.
 */
export function readerProblem(error, place = "card") {
  const status = error?.status ?? 0;
  const code = String(error?.code || error?.data?.code || "");
  if (!status) return { id: "readers.noSignal", reload: false, code };
  if (code === "changed" || code === "conflict" || status === 409) return { id: "readers.changedHere", reload: true, code: code || "changed" };
  if (code === "reason-needed" || code === "reason-not-allowed" || code === "reasonNotAllowed" || (status === 422 && /reason/i.test(String(error?.message || "")))) return { id: "readers.chooseWhy", reload: false, code };
  if (code === "not-offered") return { id: "readers.notOffered", reload: true, code };
  if (code === "not-yours") return { id: "readers.notYours", reload: false, code };
  if (code === "gone") return { id: "readers.gone", reload: true, code };
  if (code === "unknown-state" || code === "unknown-kind" || code === "bad-cursor") return { id: "readers.listReset", reload: true, code };
  if (code === "service-bad-answer") return { id: "readers.listFailed", keepsHappening: true, reload: false, code };
  if (status === 502 || status === 503 || status === 504 || code === "service-down" || code === "service-slow") {
    return { id: place === "list" ? "readers.listServiceDown" : "readers.cardServiceDown", reload: false, code };
  }
  return place === "list" ? { id: "readers.listFailed", keepsHappening: true, reload: false, code } : { id: "readers.cardFailed", reload: false, code };
}

/** The words for a problem, with `common.keepsHappening` when it asks for it. */
export function problemWords(problem) {
  return `${readerWords(problem.id)}${problem.keepsHappening ? ` ${say("common.keepsHappening")}` : ""}`;
}
