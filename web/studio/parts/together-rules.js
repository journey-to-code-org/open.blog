// Writing together's rules (Studio R14a), lifted from the old Admin's shared reflection helpers and
// given her words: what started it, the start form's checks and request, who does what, the
// invitation's words, the next step for each state (`togetherStep`), each person's row, and every
// refusal in her words (`togetherProblem`). Pure and DOM-free; words come from say().
import { say, theirs } from "./words.js";
import { isAbsoluteHttpUrl } from "./people-rules.js";
import { sayDay, sayWhen } from "./dates.js";

/** What started it, in her words, with an example placeholder for its title. */
export const SHARED_SOURCE_KINDS = Object.freeze([
  { value: "video", words: () => say("together.kindVideo"), example: () => say("together.kindExampleVideo") },
  { value: "article", words: () => say("together.kindArticle"), example: () => say("together.kindExampleArticle") },
  { value: "podcast", words: () => say("together.kindPodcast"), example: () => say("together.kindExamplePodcast") },
  { value: "book", words: () => say("together.kindBook"), example: () => say("together.kindExampleBook") },
  { value: "other", words: () => say("together.kindOther"), example: () => say("together.kindExampleOther") },
]);

/** Matches the record's source limit, so the form never offers a source the server would refuse. */
export const MAX_SHARED_SOURCES = 20;

export function emptySharedSource(kind = "video") {
  return { kind, title: "", url: "", creator: "", publisher: "", published: "", isbn: "" };
}

/** "A video" for a stored kind; an unknown kind reads as "Something else". */
export function kindWords(kind) {
  return (SHARED_SOURCE_KINDS.find((item) => item.value === kind) || SHARED_SOURCE_KINDS[4]).words();
}

// Functions below that put someone's name or words in a sentence take `speak = say`; a screen passes
// `isolating` (parts/words.js) to get parts with those words apart, placed with `partsNodes()`.

/** "A video: How to Listen" for a stored source. */
export function sourceWords(source, speak = say) {
  return speak("together.sourceLine", { kind: kindWords(source?.kind), title: String(source?.title || "") }, ["title"]);
}

function validIsbnShape(value) {
  if (!/^[0-9X\- ]+$/i.test(value)) return false;
  const symbols = value.replace(/[- ]/g, "");
  return /^\d{9}[\dX]$/i.test(symbols) || /^\d{13}$/.test(symbols);
}

/**
 * The first problem in the start form, in its reading order: `{ field, words }` with the server's
 * field names (`sources.0.title`, `title`, `contributorId`), or null.
 */
export function validateSharedReflectionDraft(draft = {}) {
  const text = (value) => String(value ?? "").trim();
  const sources = Array.isArray(draft.sources) ? draft.sources : [];
  if (!sources.length) return { field: "sources", words: say("together.needSource") };
  for (const [index, source] of sources.entries()) {
    if (!text(source?.title)) return { field: `sources.${index}.title`, words: say("together.needSourceTitle") };
    const url = text(source.url);
    if (url && !isAbsoluteHttpUrl(url)) return { field: `sources.${index}.url`, words: say("together.badLink") };
    if (source.kind === "book" && text(source.isbn) && !validIsbnShape(text(source.isbn))) return { field: `sources.${index}.isbn`, words: say("together.badIsbn") };
  }
  if (!text(draft.title) && !text(draft.guidingQuestion)) return { field: "title", words: say("together.needQuestion") };
  if (!text(draft.contributorId)) return { field: "contributorId", words: say("together.needYourName") };
  return null;
}

/**
 * A layout that can't be read because it names a part its writer took out (#705): the server
 * answers `GET collaboration/reflection` with 409 and only the layout's revision. `{ revision }`,
 * or null for any other answer.
 */
export function staleArrangement(error) {
  const revision = error?.data?.revision;
  return error?.status === 409 && Number.isInteger(revision) && revision >= 0 ? { revision } : null;
}

export const REVEAL_POLICIES = Object.freeze([
  { value: "allReady", words: () => say("together.policyAllReady"), help: () => say("together.policyAllReadyHelp") },
  { value: "voluntary", words: () => say("together.policyVoluntary"), help: () => say("together.policyVoluntaryHelp") },
  { value: "namedRecipients", words: () => say("together.policyNamed"), help: () => say("together.policyNamedHelp") },
]);

/** The request body. Identity beyond the chosen name comes from the session. New ones start "when everyone's ready". */
export function sharedReflectionPayload(draft = {}) {
  const text = (value) => String(value ?? "").trim();
  return {
    title: text(draft.title),
    guidingQuestion: text(draft.guidingQuestion),
    contributorId: text(draft.contributorId),
    revealPolicy: REVEAL_POLICIES.some((policy) => policy.value === draft.revealPolicy) ? draft.revealPolicy : "allReady",
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

/** The server's field name as the start form's own: `{ field, index }` (`sources.2.url` → url of number 3). */
export function sharedReflectionFieldId(field) {
  const fixed = { title: "title", guidingQuestion: "question", contributorId: "yourName", sources: "addAnother", revealPolicy: "whenRead" };
  if (Object.hasOwn(fixed, field)) return { field: fixed[field], index: -1 };
  const match = /^sources\.(\d{1,2})\.(title|url|creator|publisher|published|isbn)$/.exec(String(field ?? ""));
  return match ? { field: match[2], index: Number(match[1]) } : { field: "", index: -1 };
}

/** A source link that may be a link: http(s) only, with no name or password in it. */
export function sharedSourceHref(value) {
  const text = String(value ?? "").trim();
  return isAbsoluteHttpUrl(text) ? new URL(text).href : "";
}

// ---- who does what

/**
 * What she chooses for someone (her words), and the roles each stands for. "Editor" is not
 * offered (no route lets an editor change another's part); it is kept as stored and shown in
 * details. ⚑ 9.
 */
export const ROLE_CHOICES = Object.freeze([
  { value: "writes", roles: ["contributor"], words: () => say("people.roleWrites") },
  { value: "writesRuns", roles: ["contributor", "coordinator"], words: () => say("people.roleWritesRuns") },
  { value: "reads", roles: ["reader"], words: () => say("people.roleReads") },
  { value: "inCharge", roles: ["siteOwner", "contributor"], words: () => say("people.roleInCharge"), ownerOnly: true },
]);

const ROLE_ORDER = ["siteOwner", "coordinator", "contributor", "editor", "reader"];
const rank = (role) => (ROLE_ORDER.includes(role) ? ROLE_ORDER.indexOf(role) : ROLE_ORDER.length);
const sameRoles = (a, b) => a.length === b.length && a.every((role) => b.includes(role));

/** The choice that is exactly these roles, or null (another stored combination). */
export function roleChoice(roles = []) {
  const set = [...new Set(roles)];
  return ROLE_CHOICES.find((choice) => sameRoles(choice.roles, set)) || null;
}

/** Roles as her words: a choice's own words, else each role's joined ("Helps run it, only reads"). Unknown roles are kept, as "Something else". */
export function roleWords(roles = []) {
  const choice = roleChoice(roles);
  if (choice) return choice.words();
  const one = { siteOwner: () => say("people.roleInCharge"), coordinator: () => say("people.roleRuns"), contributor: () => say("people.roleWrites"), editor: () => say("people.roleEditor"), reader: () => say("people.roleReads") };
  const words = [...new Set(roles)]
    .sort((a, b) => rank(a) - rank(b))
    .map((role) => (one[role] ? one[role]() : say("people.roleOther")));
  const text = words.join(", ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : say("people.roleOther");
}

/**
 * Whether this sign-in may invite someone to do `target.choice`: only with the invite grant (in
 * charge or helping run it); "in charge" only by someone in charge; a co-writer never invites
 * someone new or an owner account (the server holds the same line, G110).
 */
export function canInvite({ coWriter = false, roles = [] } = {}, { choice = "writes", newAccount = false } = {}) {
  const runs = roles.includes("siteOwner") || roles.includes("coordinator");
  if (!runs) return false;
  if (choice === "inCharge" && !roles.includes("siteOwner")) return false;
  if (coWriter && newAccount) return false;
  return ROLE_CHOICES.some((item) => item.value === choice);
}

/** The invitation request body; with `newAccount`, the server makes the sign-in (owners only). */
export function invitationPayload(publicationId, draft = {}) {
  const choice = ROLE_CHOICES.find((item) => item.value === draft.choice) || ROLE_CHOICES[0];
  const payload = { publicationId, contributorId: String(draft.contributorId || ""), roles: [...choice.roles] };
  const signIn = String(draft.signInName || "").trim();
  if (draft.newAccount) payload.newAccount = { signInName: signIn };
  else payload.adminUser = signIn;
  const days = Number(draft.lifetimeDays);
  if (Number.isInteger(days) && days > 0) payload.lifetimeDays = days;
  return payload;
}

const SIGN_IN = /^[a-z0-9._-]{1,32}$/;

/** The first problem in an invitation, as `{ field, words }`, or null. */
export function validateInvitationDraft(draft = {}) {
  if (!draft.contributorId) return { field: "name", words: say("people.chooseName") };
  const signIn = String(draft.signInName || "").trim();
  if (!signIn) return { field: "signIn", words: draft.newAccount ? say("people.signInNameBad") : say("people.needSignInName") };
  if (!SIGN_IN.test(signIn)) return { field: "signIn", words: say("people.signInNameBad") };
  if (draft.lifetimeDays !== undefined && draft.lifetimeDays !== "") {
    const days = Number(draft.lifetimeDays);
    if (!Number.isInteger(days) || days < 1 || days > 30) return { field: "days", words: say("people.daysBad") };
  }
  return null;
}

/**
 * A sign-in name suggested from a person's name: lowercase letters and digits, joined ("Lee Park"
 * → "leepark"), at most 32, a number added when it is taken. Editable; the server decides.
 */
export function suggestSignInName(name, taken = []) {
  const base = String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "").slice(0, 30) || "writer";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}${n}`)) return `${base}${n}`;
}

/** An absolute link to copy, only ever for a join address inside this blog's Studio (or the old form). */
export function invitationShareLink(origin, link) {
  const ok = typeof link === "string" && (link.startsWith("/admin/studio/#/together/join/") || link.startsWith("/admin/#/shared/accept/"));
  return ok ? `${origin}${link}` : "";
}

/** Problems with a member's sign-in, in her words. */
export function memberWarnings(member, speak = say) {
  return member?.bindingCurrent === false ? [speak("people.signInGone", { name: member.displayName || member.adminUser || "" }, ["name"])] : [];
}

/** What stopping someone's access does, in her words. */
export function removalImpact(member) {
  return member?.hasContributions ? say("people.stopText") : say("people.stopTextNothing");
}

/** What a change to what someone does takes away, as sentences; empty when it only adds. */
export function roleChangeImpact(member, nextRoles, speak = say) {
  const current = new Set(member?.roles || []);
  const next = new Set(nextRoles || []);
  const name = member?.displayName || "";
  const lines = [];
  if (current.has("siteOwner") && !next.has("siteOwner")) lines.push(speak("people.loseCharge", { name }, ["name"]));
  if ((current.has("coordinator") || current.has("siteOwner")) && !next.has("coordinator") && !next.has("siteOwner")) lines.push(speak("people.loseRun", { name }, ["name"]));
  if (current.has("contributor") && !next.has("contributor")) lines.push(speak("people.loseWrite", { name }, ["name"]));
  if (lines.length && member?.hasContributions) lines.push(speak("people.keepsWords"));
  return lines;
}

/** An invitation's state in words, so it never depends on colour. `expiresAt` is seconds. */
export function invitationStatusText(invitation, name = "", { now = new Date(), timeZone } = {}, speak = say) {
  const when = invitation?.expiresAt ? sayDay(new Date(invitation.expiresAt * 1000).toISOString(), { now, timeZone }) : "";
  switch (invitation?.state) {
    case "pending": return speak("people.inviteStatePending", { name, when }, ["name"]);
    case "accepted": return speak("people.inviteStateAccepted", { name }, ["name"]);
    case "declined": return speak("people.inviteStateDeclined", { name }, ["name"]);
    case "revoked": return speak("people.inviteStateRevoked");
    default: return speak("people.inviteStateExpired", { name }, ["name"]);
  }
}

// ---- reading and agreeing

/** One person's part on Everyone's parts: whose it is, and whether it can be read. */
export function revealSlotText(slot, speak = say) {
  const name = slot?.displayName || "";
  if (slot?.kind === "own") return speak("read.yourPart");
  if (slot?.kind === "revealed") return theirs(name, speak);
  return speak("read.notShared", { name }, ["name"]);
}

/** One author's line under the preview: where their agreement stands. */
export function previewSectionText(section, speak = say) {
  const name = section?.displayName || "";
  if (!section?.shown) return speak("read.linePrivate", { name }, ["name"]);
  if (section?.required === false) return speak("read.lineNotNeeded", { name }, ["name"]);
  if (section?.approval === "approved") return speak("read.lineAgreed", { name }, ["name"]);
  if (section?.approval === "stale") return speak("read.lineEarlier", { name }, ["name"]);
  return speak("read.lineWaiting", { name }, ["name"]);
}

/** One conversation item's line (R14b shows these); kept so the preview's items are words too. */
export function previewItemText(item, speak = say) {
  const names = joinNames(item?.awaiting || [], speak);
  return names.length ? speak("read.missing", { names }, ["names"]) : speak("read.allAgreed");
}

/** The one line for the whole preview. */
export function previewStateText(preview, speak = say) {
  if (preview?.ready) return speak("read.allAgreed");
  if (preview?.complete) {
    const names = joinNames((preview.sections || []).filter((s) => s.required !== false && s.approval !== "approved").map((s) => s.displayName), speak);
    return speak("read.missing", { names }, ["names"]);
  }
  return speak("read.incomplete");
}

/** "Ruth", "Ruth and Sam", "Ruth, Sam and Lee"; from `isolating`, parts with each name apart ([] for none). */
export function joinNames(names, speak = say) {
  const list = [...new Set((names || []).map((name) => String(name || "").trim()).filter(Boolean))];
  if (speak?.parts) {
    return list.flatMap((name, i) => [i === 0 ? "" : i === list.length - 1 ? ` ${say("together.and")} ` : ", ", { isolate: name }]).filter((part) => part !== "");
  }
  if (list.length <= 1) return list[0] || "";
  return `${list.slice(0, -1).join(", ")} ${say("together.and")} ${list[list.length - 1]}`;
}

// ---- where it stands

const WHERE = {
  writing: () => say("together.whereWriting"), notStarted: () => say("together.whereNotStarted"),
  notReady: () => say("together.whereNotReady"), ready: () => say("together.whereReady"),
  agreed: () => say("together.whereAgreed"), agreedEarlier: () => say("together.whereAgreedEarlier"),
  left: () => say("together.whereLeft"), reads: () => say("together.whereReads"),
  naming: () => say("name.whereNaming"),
};

// ---- your name on it (#650)

/** The most a typed name may be, in bytes (the server's display-name limit). */
export const NAME_MAX_BYTES = 200;

/**
 * The request for "Your name on it": `kind` is "profile", "displayName" or "uncredited"; `name` is
 * what she typed for a name. `{ choice }` to send, or `{ error, field }` in her words.
 */
export function nameChoice(kind, name = "") {
  if (kind === "profile") return { choice: { kind: "profile" } };
  if (kind === "uncredited") return { choice: { kind: "uncredited" } };
  if (kind !== "displayName") return { error: say("name.needChoice"), field: "kind" };
  const typed = String(name || "").replace(/\s+/g, " ").trim();
  if (!typed) return { error: say("name.needName"), field: "name" };
  if (new TextEncoder().encode(typed).length > NAME_MAX_BYTES) return { error: say("name.tooLong"), field: "name" };
  return { choice: { kind: "displayName", name: typed } };
}

/** "Readers will see: Sam" for a stored choice (`GET collaboration/credit-choice`'s `choice`). */
export function nameSaid(choice) {
  if (!choice) return say("name.notYet");
  if (choice.kind === "profile") return say("name.now", { said: say("name.saidPeople") });
  if (choice.kind === "displayName") return say("name.now", { said: say("name.saidTyped", { name: String(choice.name || "") }) });
  return say("name.now", { said: say("name.saidOff") });
}

/** One row per person, as text ("You · writing"), then each invitation waiting for an answer. */
export function togetherPeopleRows(summary, { now = new Date(), timeZone } = {}, speak = say) {
  const rows = (summary?.people || []).map((person) => {
    const name = person.you ? say("together.you") : String(person.displayName || "");
    const where = (person.credit === "notChosen" && person.where === "ready" ? WHERE.naming : WHERE[person.where] || WHERE.notReady)();
    return { name, where, you: Boolean(person.you), text: speak("together.personRow", { name, where }, person.you ? [] : ["name"]) };
  });
  for (const invited of summary?.invited || []) {
    const when = invited.expiresAt ? sayDay(new Date(invited.expiresAt * 1000).toISOString(), { now, timeZone }) : "";
    rows.push({ name: String(invited.forName || ""), where: "", invited: true, text: speak("together.invitedRow", { name: String(invited.forName || ""), when }, ["name"]) });
  }
  if (!(summary?.invited || []).length && summary?.invitationsWaiting > 0) {
    rows.push({ name: "", where: "", invited: true, text: speak("together.invitedCount", { n: summary.invitationsWaiting }) });
  }
  return rows;
}

/** "You, Ruth and Sam" for a card. */
export function peopleWords(summary, speak = say) {
  const names = (summary?.people || []).filter((p) => p.where !== "left").map((p) => (p.you ? say("together.you") : p.displayName));
  return speak("together.peopleList", { names: joinNames(names, speak) }, ["names"]);
}

const others = (summary, where) => (summary?.people || []).filter((p) => !p.you && where.includes(p.where)).map((p) => p.displayName);

/**
 * Where a reflection stands for this sign-in, from its summary (G115): the badge, the one
 * sentence, and the one next step. `primary` is an action name the screen turns into a button:
 * invite, write, share, read, publish, open, unschedule, bringBack, change, or null. One primary
 * per state; `secondary` only where the spec has one.
 * @returns {{ state: string, badge: string, step: string, primary: string|null, secondary: string|null, variant: string }}
 */
export function togetherStep(summary, { now = new Date(), timeZone, coWriter = false } = {}) {
  const you = summary?.you || {};
  const out = (state, badge, step, primary = null, secondary = null, variant = "neutral") => ({ state, badge, step, primary, secondary, variant });
  if (summary?.archived) return out("putAway", say("together.statePutAway"), "", you.inCharge && !coWriter ? "bringBack" : null);
  switch (summary?.state) {
    case "published":
      return out("published", say("together.statePublished"), say("together.stepPublished"), coWriter ? null : "open", null, "success");
    case "scheduled": {
      const when = sayWhen(summary.publishAt, { now, timeZone });
      return out("scheduled", say("together.stateScheduled", { when }), say("together.stepScheduled", { when }), null, you.canPublish ? "unschedule" : null, "info");
    }
    case "privateParts":
      return out("privateParts", say("together.statePrivate"), say("together.stepPrivate"), you.runsIt ? "change" : null, null, "warning");
    case "stuck": {
      const names = joinNames(summary.unmetNamed || []);
      return out("stuck", say("together.stateStuck"), names ? say("together.stuck", { names }) : say("together.stuckRole"), null, null, "warning");
    }
    case "naming": {
      if (you.drafter && you.credit === "notChosen") return out("onYou", say("together.stateOnYou"), say("together.stepName"), "name", null, "warning");
      const names = joinNames((summary.people || []).filter((p) => !p.you && p.credit === "notChosen").map((p) => p.displayName));
      return out("onOthers", say("together.stateOnOthers"), names ? say("together.stepWaitingName", { names }) : say("together.stepWaitingOthersName"), null);
    }
    case "ready":
      if (you.canPublish) return out("ready", say("together.stateReady"), say("together.stepEveryoneAgreed"), "publish", "schedule", "success");
      return out("ready", say("together.stateReady"), summary.publisherName ? say("together.waitingPublish", { name: summary.publisherName }) : say("together.waitingPublishAnyone"), null, null, "success");
    default:
      break;
  }
  const alone = (summary?.people || []).filter((p) => p.where !== "left").length <= 1;
  if (alone && !summary?.invitationsWaiting) {
    return out("started", say("together.stateStarted"), say("together.stepInvite"), you.canInvite ? "invite" : "write");
  }
  if (alone) {
    const names = joinNames((summary.invited || []).map((i) => i.forName));
    return out("waitingHear", say("together.stateWaitingHear"), names ? say("together.stepWaitingYes", { names }) : say("together.invitedCount", { n: summary.invitationsWaiting }), you.drafter ? "write" : null);
  }
  if (!you.drafter) return out("reads", say("together.stateOnOthers"), say("together.stepReads"), null);
  if (!you.wrote) return out("onYou", say("together.stateOnYou"), say("together.stepWrite"), "write", null, "warning");
  if (!you.shared) return out("onYou", say("together.stateOnYou"), say("together.stepShare"), "share", null, "warning");
  if (you.changedSinceShared) return out("onYou", say("together.stateOnYou"), say("together.stepShareChanges"), "share", null, "warning");
  if (you.needsReshare) return out("onYou", say("together.stateOnYou"), say("together.stepReshare"), "share", null, "warning");
  if (summary.complete && you.agreedStale) return out("onYou", say("together.stateOnYou"), say("together.stepReadAgain"), "read", null, "warning");
  if (summary.complete && !you.agreed) return out("onYou", say("together.stateOnYou"), say("together.stepRead"), "read", null, "warning");
  if (summary.complete) {
    const names = joinNames(others(summary, ["ready", "notReady", "agreedEarlier", "writing", "notStarted"]));
    return out("onOthers", say("together.stateOnOthers"), names ? say("together.stepWaitingAgree", { names }) : say("together.stepWaitingOthersReady"), null);
  }
  const names = joinNames(others(summary, ["notReady", "writing", "notStarted"]));
  return out("onOthers", say("together.stateOnOthers"), names ? say("together.stepWaitingReady", { names }) : say("together.stepWaitingOthersReady"), "read");
}

/** Which word each action's button says. */
export function stepButtonWords(action) {
  const words = {
    invite: () => say("together.doInvite"), write: () => say("together.doWrite"), share: () => say("together.doShare"),
    read: () => say("together.doRead"), publish: () => say("together.doPublish"), open: () => say("together.doOpen"),
    unschedule: () => say("together.doUnschedule"), bringBack: () => say("together.doBringBack"), change: () => say("together.doChange"),
    name: () => say("together.doName"),
    schedule: () => say("together.publishOnDay"),
  };
  return words[action] ? words[action]() : "";
}

// ---- refusals

/** Every code a collaboration answer can carry (G117), in the server's order (together.rs CODES). */
export const TOGETHER_CODES = Object.freeze([
  "not-found", "changed", "busy", "published", "unapproved", "rule-unmet", "occupied", "too-large", "revision-limit",
  "unsafe-markup", "reserved-heading", "layout-mismatch", "moment-unresolved", "moment-unsafe", "invalid", "affirmed",
  "account-taken", "name-taken", "already-invited", "owner-only", "invalid-invitation", "password", "too-many-tries",
  "storage", "build",
]);

const FIELD_WORDS = {
  title: () => say("together.needQuestion"), guidingQuestion: () => say("together.tooLongLine"),
  contributorId: () => say("together.needYourName"), sources: () => say("together.needSource"),
  signInName: () => say("people.signInNameBad"), lifetimeDays: () => say("people.daysBad"),
  markdown: () => say("part.tooLong"), affirmed: () => say("read.readFirst"), password: () => say("join.passwordShort"),
};

function fieldWords(field) {
  if (FIELD_WORDS[field]) return FIELD_WORDS[field]();
  const match = /^sources\.\d{1,2}\.(title|url|isbn|creator|publisher|published)$/.exec(String(field || ""));
  if (!match) return "";
  return { title: say("together.needSourceTitle"), url: say("together.badLink"), isbn: say("together.badIsbn") }[match[1]] || say("together.tooLongLine");
}

/**
 * Any answer from a collaboration call as `{ code, field, words, reload }` in her words. `place` is
 * where it happened: "start", "part", "read", "publish", "invite", "join", "page". The server's
 * sentence stays in details; it is never shown on her layer.
 */
export function togetherProblem(error, place = "page") {
  const status = error?.status;
  const data = error?.data || {};
  const field = typeof data.field === "string" ? data.field : "";
  const code = typeof data.code === "string" ? data.code : status === 0 ? "offline" : "";
  const said = (words, extra = {}) => ({ code, field, words, reload: false, ...extra });
  if (status === 0) return said(place === "join" ? say("join.noSignal") : say("together.needsSignal"));
  switch (code) {
    case "not-found": return said(say("together.accessChanged"), { reload: true });
    case "changed": return said(place === "part" ? say("part.conflict") : say("together.changedElsewhere", { what: say("together.whenReadShort") }), { reload: place !== "part" });
    case "busy": return said(say("together.serverDown"));
    case "published": return said(say("together.alreadyPublished"), { reload: true });
    case "unapproved": return said(say("together.notAgreed", { names: joinNames(data.missing || []) }), { reload: true });
    case "rule-unmet": {
      const names = joinNames(data.unmetNamed || []);
      return said(names ? say("together.stuck", { names }) : say("together.stuckRole"), { reload: true });
    }
    case "occupied": return said(`${say("together.placeTaken")} ${say("common.tell")}`);
    case "too-large": return said(say("part.tooLong"));
    case "revision-limit": return said(say("part.full"));
    case "unsafe-markup": return said(data.name ? say("together.unsafeWords", { name: data.name }) : say("together.unsafeSomeone"));
    case "reserved-heading": return said(say("together.reservedHeading"));
    case "layout-mismatch": return said(say("together.layoutOld"));
    case "moment-unresolved":
    case "moment-unsafe":
    case "build": return said(say("together.cantBuild"));
    case "affirmed": return said(say("read.readFirst"));
    case "account-taken":
    case "name-taken": return said(say("people.nameTaken"));
    case "already-invited": return said(say("people.alreadyIn", { name: data.name || "" }));
    case "owner-only": return said(place === "invite" && field === "adminUser" ? say("people.coWriterOnly") : say("together.ownerOnly"));
    case "invalid-invitation": return said(say("join.notWorking"));
    case "password": return said(say("join.passwordShort"));
    case "too-many-tries": return said(place === "join" ? say("join.tooMany") : say("together.tooMany"));
    case "storage": return said(say("together.serverDown"));
    case "invalid": return said(fieldWords(field) || `${say("together.failed")} ${say("common.tell")}`);
    default:
      if (status === 404) return said(say("together.accessChanged"), { code: "not-found", reload: true });
      if (status === 409 && place === "part") return said(say("part.conflict"), { code: "changed" });
      if (status === 413) return said(say("part.tooLong"), { code: "too-large" });
      if (status === 429) return said(say("together.tooMany"), { code: "too-many-tries" });
      if (status >= 500) return said(say("together.serverDown"), { code: "storage" });
      return said(`${say("together.failed")} ${say("common.tell")}`);
  }
}
