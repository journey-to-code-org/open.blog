// What a reader's note brings with it, as rules (lifted from the old Admin's inbox, admin.js
// l.607-1092, with her words): what it's about, what they point to, what featuring and linking
// offer, the request bodies, the decision form's fields and problems, and the banners about what's
// on the posts. Functions that put a reader's words in a sentence take `speak = say` and give parts
// with `isolating` (parts/words.js). DOM-free, tested. Studio R10; docs/specs/studio/r10/ux.md.
import { say, theirs } from "./words.js";

export const NOTE_MAX = 280;
export const ANSWER_MAX = 4000;
export const RATIONALE_MAX = 2000;
export const CHANGE_MAX = 200;

const pad = (n) => String(n).padStart(2, "0");
/** Her local day, `YYYY-MM-DD`, as a decision or a note is dated. */
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Only http and https are links; anything else is text. */
export function openableLink(url) {
  try {
    return ["http:", "https:"].includes(new URL(String(url)).protocol);
  } catch {
    return false;
  }
}

/** Their link and wording, from `details`: `{ link, wording }`, each "" when there is none. */
export function theirOffer(item) {
  const d = item?.details || {};
  return { link: typeof d.sourceUrl === "string" ? d.sourceUrl : typeof item?.suggestion?.url === "string" ? item.suggestion.url : "", wording: typeof d.suggestedText === "string" ? d.suggestedText : "" };
}

/** Which "About this…" block a card has, as its heading id, or "". */
export function aboutHeading(item) {
  if (item?.perspective) return "readers.aboutReflection";
  if (item?.suggestion) return "readers.aboutIdea";
  if (item?.response) return "readers.aboutAnswer";
  return "";
}

/** The "About this…" lines (strings, or parts from `isolating`). */
export function aboutLines(item, speak = say) {
  const lines = [];
  const p = item?.perspective;
  if (p) {
    const author = p.attributed?.author;
    if (p.about === "work") lines.push(speak("readers.aboutWhole"));
    else if (p.attributed) lines.push(author ? speak("readers.aboutSection", { author }, ["author"]) : speak("readers.aboutOnePart"));
    else if (p.section) lines.push(speak("readers.aboutOnePart"));
    else lines.push(speak("readers.aboutOpening"));
    if (p.check === "stale") lines.push(p.attributed?.standing?.reason === "author-absent" ? speak("readers.aboutGone") : speak("readers.aboutChanged"));
    lines.push(item.details?.prompt ? speak("readers.prompt", { question: String(item.details.prompt) }, ["question"]) : speak("readers.noPrompt"));
    const consent = p.consent || {};
    lines.push(!consent.publish ? speak("readers.consentWithdrawn") : consent.showName ? speak("readers.consentName") : speak("readers.consentNoName"));
    if (p.nameMatchesCredit) lines.push(speak("readers.nameMatches"));
  }
  const s = item?.suggestion;
  if (s) {
    if (s.typeLabel) lines.push(speak("readers.ideaKind", { type: String(s.typeLabel) }));
    const hints = s.hints || {};
    const hint = (labelId, value) => { if (value) lines.push(speak("readers.ideaHint", { label: labelId, value: String(value) }, ["value"])); };
    hint(say("readers.hintTitle"), hints.title);
    hint(say("readers.hintCreators"), (hints.creators || []).join("; "));
    hint(say("readers.hintYear"), hints.year);
    hint(say("readers.hintPublisher"), hints.publisher);
    for (const id of hints.identifiers || []) hint(say("readers.hintNumber", { scheme: String(id.scheme || "").toUpperCase() }), id.value);
    hint(say("readers.hintSeries"), s.about?.series);
    hint(say("readers.hintArticle"), s.about?.article);
    if (s.missing?.length) lines.push(speak("readers.ideaMissing", { list: s.missing.join(", ") }));
    if (s.standing?.label) lines.push(speak("readers.ideaStands", { label: String(s.standing.label) }));
    if (s.outcome?.label) lines.push(speak("readers.ideaOutcome", { label: String(s.outcome.label) }));
    for (const link of s.conversions || []) lines.push(speak("readers.ideaLinkedTo", { what: madeWords(link.kind), day: String(link.at || "").slice(0, 10) }));
  }
  const r = item?.response;
  if (r) {
    if (r.author) lines.push(speak("readers.answerAbout", { author: String(r.author) }, ["author"]));
    lines.push(r.standing?.state === "stale" ? speak("readers.answerSectionChanged") : r.standing?.moved ? speak("readers.answerSectionMoved") : speak("readers.answerSectionStands"));
    if (r.mine) lines.push(speak("readers.answerMine"));
  }
  return lines;
}

/** What she made, in words. */
export function madeWords(kind) {
  if (kind === "draft") return say("readers.madeDraft");
  if (kind === "series") return say("readers.madeSeries");
  if (kind === "library-source") return say("readers.madeSource");
  return say("readers.madeWork");
}

/** What they point to, as lines; a thing this post no longer publishes says so. */
export function evidenceLines(evidence, speak = say) {
  if (!evidence) return [];
  const label = (entry, fallback) => String(entry?.label ?? fallback ?? entry?.id ?? "");
  const lines = [];
  if (evidence.claim) lines.push(speak("readers.evidenceClaim", { label: evidence.claim.statement ? `${label(evidence.claim)}, “${evidence.claim.statement}”` : label(evidence.claim) }, ["label"]));
  if (evidence.evidenceLink) lines.push(speak("readers.evidenceLink", { label: label(evidence.evidenceLink) }, ["label"]));
  if (evidence.citation) lines.push(speak("readers.evidenceCitation", { label: label(evidence.citation) }, ["label"]));
  if (evidence.source) lines.push(speak("readers.evidenceSource", { label: label(evidence.source) }, ["label"]));
  const gone = evidence.stale || [evidence.claim, evidence.evidenceLink, evidence.citation, evidence.source].some((e) => e && e.published === false);
  if (gone) lines.push(speak("readers.evidenceGone"));
  return lines;
}

/** What the reader agreed about featuring. */
export function featureConsentLine(consent) {
  if (consent === "agreed") return say("readers.featureAgreed");
  if (consent === "earlier-text") return say("readers.featureEarlier");
  return say("readers.featureNo");
}

/** What featuring offers on a card: null (no place), `featured`, `choose`, or `unavailable`. */
export function featureCardState(item, feature) {
  if (item?.kind !== "third-perspective" || item.source !== "feedback" || item.role !== "site-admin") return null;
  if (feature) return { kind: "featured", feature };
  if (item.status !== "approved" || item.purged) return null;
  if (item.featureConsent === "agreed") return { kind: "choose" };
  return { kind: "unavailable", words: featureConsentLine(item.featureConsent) };
}

export const featureRequest = (item, note) => ({ id: item.id, context: String(note ?? "").trim(), expectedVersion: item.version });

/** How a feature stands, in her words. */
export function featureStandingText(feature) {
  if (feature?.standing === "covered") return say("readers.featureStands");
  if (feature?.standing === "hidden") return say("readers.featureStandHidden");
  if (feature?.standing === "mustComeOff") return say("readers.featureStandMustGo");
  return say("readers.featureStandUnknown");
}

/** Whether a card offers a link to a later post: the site's owner, a shown reflection or idea whose words are kept. */
export function continuationCardState(item) {
  if (item?.source !== "feedback" || item.role !== "site-admin") return false;
  if (item.kind !== "third-perspective" && item.kind !== "future-suggestion" && item.kind !== "question") return false;
  return item.status === "approved" && !item.purged;
}

export const continuationRequest = (item, form) => ({
  id: item.id, to: String(form.to ?? ""), relation: String(form.relation || "takes-up"), note: String(form.note ?? "").trim() || null, expectedVersion: item.version,
});

/** The relations a link may say, for this kind. */
export function relations(item) {
  return [
    { value: "takes-up", label: say("readers.relTakesUp") },
    { value: "revisits", label: say("readers.relRevisits") },
    ...(item?.kind === "future-suggestion" ? [{ value: "uses-source", label: say("readers.relUsesSource") }] : []),
  ];
}

/** How a link stands, in her words. */
export function continuationStandingText(link) {
  if (link?.standing === "notApproved") return say("readers.linkNotApproved");
  if (link?.hidden === "to-not-published") return say("readers.linkToHidden");
  if (link?.hidden === "from-not-published") return say("readers.linkFromHidden");
  if (link?.standing === "unknown") return say("readers.linkUnknown");
  return say("readers.linkShown");
}

/** One link in a list. */
export function linkLine(link) {
  const relation = relations({ kind: "future-suggestion" }).find((r) => r.value === link?.relation)?.label || String(link?.relation || "");
  return say("readers.linkLine", { from: String(link?.from || ""), to: String(link?.to || ""), relation: relation.charAt(0).toLowerCase() + relation.slice(1), day: String(link?.linked || "").slice(0, 10) });
}

/** The body of an author's answer, and of taking it back. */
export const answerRequest = (item, text) => ({ parent: item.id, parentVersion: item.version, body: String(text ?? "") });
export const withdrawAnswerRequest = (item) => ({ id: item.id, version: item.version });

/** What an author reads before answering: `{ author, helpId }`, or null when not offered. */
export function answerOffer(item) {
  const offer = item?.answerAs;
  if (!offer) return null;
  return { author: String(offer.author || ""), help: offer.standing?.state === "stale" ? say("readers.answerAsHelpChanged") : say("readers.answerAsHelp") };
}

/** Linking an idea to what she made: `{ ok, body }` or `{ ok: false, id, field }`. */
export function linkRequest(item, kind, target) {
  const id = String(target ?? "").trim();
  if (!["draft", "series", "library-source"].includes(kind)) return { ok: false, id: "readers.ideaLinkNeedWhat", field: "kind" };
  if (!id) return { ok: false, id: "readers.ideaLinkNeedWhich", field: "target" };
  return { ok: true, body: { id: item.id, version: item.version, conversion: { kind, id } } };
}

/** The reader's details about a source, as lines (their words, not checked). */
export function libraryCandidateLines(candidate) {
  if (!candidate) return [];
  return [candidate.url, candidate.title, (candidate.creators || []).join("; "), candidate.year, candidate.publisher, ...(candidate.identifiers || []).map((i) => `${String(i.scheme).toUpperCase()} ${i.value}`)]
    .filter(Boolean).map(String);
}

// ---- Record what you decided

/** The form's fields, in order, each shown only when the outcome needs it. */
export function decisionFields(offer, values = {}) {
  const outcome = (offer?.outcomes || []).find((o) => o.id === values.outcome);
  const fields = ["outcome"];
  if (outcome?.accepted) fields.push("extent");
  if (values.outcome === "declined") fields.push("declineReason");
  if (outcome) fields.push("rationale");
  if (outcome && values.outcome !== "declined") fields.push("revisionNote");
  if (values.outcome === "accepted-as-evidence") fields.push("claimEvidence");
  if (values.outcome === "already-addressed") fields.push("addressedBy");
  if (outcome) fields.push("decided");
  if (outcome && offer?.confirmCheck) fields.push("confirmed");
  return fields;
}

/** What is missing before a decision can be sent, as `{ field, id }`, or null. */
export function decisionProblem(item, values = {}) {
  const offer = item?.recordDecision || {};
  const outcome = (offer.outcomes || []).find((o) => o.id === values.outcome);
  if (!outcome) return { field: "outcome", id: "readers.decideNeedOutcome" };
  if (outcome.accepted && !values.extent) return { field: "extent", id: "readers.decideNeedExtent" };
  if (values.outcome === "declined" && !values.declineReason) return { field: "declineReason", id: "readers.decideNeedWhy" };
  if ((values.outcome === "declined" || values.extent === "partial") && !String(values.rationale || "").trim()) {
    return { field: "rationale", id: values.outcome === "declined" ? "readers.decideNeedWords" : "readers.decideNeedWordsPart" };
  }
  if (outcome.accepted && !values.revisionNote) return { field: "revisionNote", id: "readers.decideNeedNote" };
  if (values.outcome === "accepted-as-evidence" && !values.claimEvidence) return { field: "claimEvidence", id: "readers.decideNeedEvidence" };
  if (values.outcome === "already-addressed" && !values.revisionNote && !String(values.addressedBy || "").trim()) return { field: "addressedBy", id: "readers.decideNeedAddressed" };
  if (offer.confirmCheck && !values.confirmed) return { field: "confirmed", id: "readers.decideNeedConfirm" };
  return null;
}

/** The body of a decision: only the fields its outcome takes. */
export function outcomeRequest(item, values = {}) {
  const offer = item?.recordDecision || {};
  const outcome = (offer.outcomes || []).find((o) => o.id === values.outcome);
  const request = { id: item.id, expectedDecisions: offer.expectedDecisions ?? 0, itemRevision: offer.itemRevision ?? 1, outcome: values.outcome, decided: values.decided || localDay() };
  if (outcome?.accepted && values.extent) request.extent = values.extent;
  if (values.outcome === "declined" && values.declineReason) request.declineReason = values.declineReason;
  if (String(values.rationale || "").trim()) request.rationale = values.rationale;
  if (values.outcome !== "declined" && values.revisionNote && offer.post) request.revisionNote = { post: offer.post, note: values.revisionNote };
  if (values.outcome !== "declined" && values.claimEvidence) {
    const [claim, link] = String(values.claimEvidence).split(" ");
    if (claim && link) request.claimEvidence = { claim, link };
  }
  if (values.outcome === "already-addressed" && String(values.addressedBy || "").trim()) request.addressedBy = String(values.addressedBy).trim();
  if (offer.confirmCheck && values.confirmed) request.confirmCheck = offer.confirmCheck;
  return request;
}

/** What a recorded decision says after. */
export function outcomeWords(result) {
  return result?.outcomePublished ? `${say("readers.decided")} ${say("readers.decidedOnPost")}` : say("readers.decided");
}

/** The body of a revision note, or the problem with it as `{ field, id, vars }`. */
export function changeRequest(post, values = {}) {
  const note = String(values.note ?? "").trim();
  if (!note) return { ok: false, field: "note", id: "readers.changeEmpty" };
  if ([...note].length > CHANGE_MAX) return { ok: false, field: "note", id: "readers.changeLong", vars: { max: CHANGE_MAX } };
  const claim = String(values.claim ?? "").trim();
  if (claim && !/^[a-z0-9-]+$/.test(claim)) return { ok: false, field: "claim", id: "readers.changeBadClaim" };
  return { ok: true, body: { post, date: values.date || localDay(), claim, note } };
}

// ---- Banners about what's on the posts

/**
 * The banners from the two checks: `[{ level, id, vars, entries: [{ id, title, route, operation, button }] }]`.
 * `perspectiveAudit` / `featureAudit` are the servers' answers, or `{ failed: error }` when one failed
 * (a 403 says nothing: not the site's owner).
 */
export function auditBanners(perspectiveAudit, featureAudit) {
  const out = [];
  const entries = (list, route, operation, button) => (Array.isArray(list) ? list : []).map((e) => ({ id: e.id, title: String(e.post || e.title || ""), route, operation, button }));
  const p = perspectiveAudit;
  if (p?.failed) {
    if (p.failed.status !== 403) out.push({ level: "info", id: "readers.auditFailed", vars: {}, entries: [], retry: true });
  } else if (p) {
    const count = (list) => (Array.isArray(list) ? list.length : 0);
    if (count(p.answersMustComeOff)) out.push({ level: "danger", id: "readers.auditAnswers", vars: { n: count(p.answersMustComeOff) }, entries: entries(p.answersMustComeOff, "author-responses", "unpublish", "readers.fixUnpublishButton") });
    if (count(p.mustComeOff)) out.push({ level: "danger", id: "readers.auditMustGo", vars: { n: count(p.mustComeOff) }, entries: entries(p.mustComeOff, "third-perspectives", "unpublish", "readers.fixUnpublishButton") });
    if (count(p.nameNarrowed)) out.push({ level: "info", id: "readers.auditName", vars: { n: count(p.nameNarrowed) }, entries: entries(p.nameNarrowed, "third-perspectives", "publish", "readers.fixNameButton") });
    if (count(p.unknown)) out.push({ level: "info", id: "readers.auditUnknown", vars: { n: count(p.unknown) }, entries: entries(p.unknown, "third-perspectives", "unpublish", "readers.fixUnpublishButton") });
    if (p.truncated) out.push({ level: "info", id: "readers.auditTruncated", vars: {}, entries: [] });
  }
  const f = featureAudit;
  if (f?.failed) {
    if (f.failed.status !== 403 && !out.some((b) => b.id === "readers.auditFailed")) out.push({ level: "info", id: "readers.auditFailed", vars: {}, entries: [], retry: true });
  } else if (f) {
    const of = (standing) => (f.features || []).filter((e) => e.standing === standing);
    const add = (standing, id, level) => { const list = of(standing); if (list.length) out.push({ level, id, vars: { n: list.length }, entries: entries(list, "community", "unfeature", "readers.featureOff") }); };
    add("mustComeOff", "readers.featureAuditMustGo", "danger");
    add("hidden", "readers.featureAuditHidden", "info");
    add("unknown", "readers.featureAuditUnknown", "info");
    if (f.truncated && !out.some((b) => b.id === "readers.auditTruncated")) out.push({ level: "info", id: "readers.auditTruncated", vars: {}, entries: [] });
  }
  return out;
}

/** The words of a banner (its id said with its vars). */
export function bannerWords(banner) {
  switch (banner.id) {
    case "readers.auditAnswers": return say("readers.auditAnswers", banner.vars);
    case "readers.auditMustGo": return say("readers.auditMustGo", banner.vars);
    case "readers.auditName": return say("readers.auditName", banner.vars);
    case "readers.auditUnknown": return say("readers.auditUnknown", banner.vars);
    case "readers.auditTruncated": return say("readers.auditTruncated");
    case "readers.auditFailed": return say("readers.auditFailed");
    case "readers.featureAuditMustGo": return say("readers.featureAuditMustGo", banner.vars);
    case "readers.featureAuditHidden": return say("readers.featureAuditHidden", banner.vars);
    case "readers.featureAuditUnknown": return say("readers.featureAuditUnknown", banner.vars);
    default: return "";
  }
}

/** A fix's opposite, for Undo: publish ↔ unpublish; "update the decision" has none. */
export function fixOpposite(action) {
  if (action === "publish") return "unpublish";
  if (action === "unpublish") return "publish";
  return "";
}

/** The words a problem with a note's extra says, by the server's code (her layer; the sentence goes to details). */
export function extrasProblem(error, place) {
  const code = error?.data?.code || "";
  if (!error?.status) return { id: "readers.noSignal" };
  if (place === "answer" && (error.status === 409 || code === "changed")) return { id: "readers.answerChanged" };
  if (place === "answer" && code === "too-long") return { id: "readers.answerLong", vars: { max: ANSWER_MAX } };
  if (place === "answerAs" && (code === "empty")) return { id: "readers.answerAsEmpty" };
  if (place === "answerAs" && (error.status === 409 || code === "parent-unavailable" || code === "changed")) return { id: "readers.answerAsGone" };
  if (code === "note-refused") return { id: "readers.noteRefused" };
  if (code === "not-published") return { id: "readers.linkNotPublished" };
  if (code === "already-linked" || code === "alreadyLinked") return { id: "readers.alreadyLinked" };
  if (code === "full") return { id: "readers.ideaLinkFull" };
  if (place === "decide" && error.status === 409) return { id: "readers.decideChanged" };
  if (error.status === 409) return { id: "readers.changedHere" };
  if (error.status === 403) return { id: "readers.notYours" };
  if (error.status === 404) return { id: "readers.gone" };
  if (error.status >= 500) return { id: "readers.cardServiceDown" };
  return { id: "readers.fixFailed" };
}

/** A problem's words, from its id (the ids `decisionProblem`, `changeRequest`, `linkRequest` and `extrasProblem` give). */
export function noteWords(problem) {
  const vars = problem?.vars || {};
  switch (problem?.id) {
    case "readers.noSignal": return say("readers.noSignal");
    case "readers.answerChanged": return say("readers.answerChanged");
    case "readers.answerLong": return say("readers.answerLong", vars);
    case "readers.answerEmpty": return say("readers.answerEmpty");
    case "readers.answerAsEmpty": return say("readers.answerAsEmpty");
    case "readers.answerAsGone": return say("readers.answerAsGone");
    case "readers.noteRefused": return say("readers.noteRefused");
    case "readers.linkNotPublished": return say("readers.linkNotPublished");
    case "readers.linkNeedPost": return say("readers.linkNeedPost");
    case "readers.alreadyLinked": return say("readers.alreadyLinked");
    case "readers.ideaLinkFull": return say("readers.ideaLinkFull");
    case "readers.ideaLinkNeedWhat": return say("readers.ideaLinkNeedWhat");
    case "readers.ideaLinkNeedWhich": return say("readers.ideaLinkNeedWhich");
    case "readers.decideChanged": return say("readers.decideChanged");
    case "readers.decideNeedOutcome": return say("readers.decideNeedOutcome");
    case "readers.decideNeedExtent": return say("readers.decideNeedExtent");
    case "readers.decideNeedWhy": return say("readers.decideNeedWhy");
    case "readers.decideNeedWords": return say("readers.decideNeedWords");
    case "readers.decideNeedWordsPart": return say("readers.decideNeedWordsPart");
    case "readers.decideNeedNote": return say("readers.decideNeedNote");
    case "readers.decideNeedEvidence": return say("readers.decideNeedEvidence");
    case "readers.decideNeedAddressed": return say("readers.decideNeedAddressed");
    case "readers.decideNeedConfirm": return say("readers.decideNeedConfirm");
    case "readers.changeEmpty": return say("readers.changeEmpty");
    case "readers.changeLong": return say("readers.changeLong", vars);
    case "readers.changeBadClaim": return say("readers.changeBadClaim");
    case "readers.changedHere": return say("readers.changedHere");
    case "readers.notYours": return say("readers.notYours");
    case "readers.gone": return say("readers.gone");
    case "readers.cardServiceDown": return say("readers.cardServiceDown");
    default: return say("readers.fixFailed");
  }
}

export { theirs };
