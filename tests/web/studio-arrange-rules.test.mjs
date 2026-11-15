import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVAL_REQUIREMENTS, APPROVAL_ROLE_CHOICES, ARRANGEMENT_LAYOUTS, NEW_SERIES, NO_SERIES, TURN_LABEL_MAX_BYTES, approvalPeopleRows,
  approvalPolicyChoice, approvalPolicyPayload, approvalRuleText, arrangementDraft, arrangementPayload, keepStoredSeries, moveItem, nextRoundId,
  seriesPartText, seriesPlacementRequest, seriesPlacementText, turnWords, validateArrangement,
} from "../../web/studio/parts/arrange-rules.js";
import { OLD_PROMPTS_KEY, SYNTHESIS_KINDS, moveSynthesisItem, promptsKey, synthesisAddChange, synthesisItemText } from "../../web/studio/parts/conversation-rules.js";
import {
  MOMENT_LOCATOR_KINDS, QUOTATION_PROVENANCE, QUOTATION_RIGHTS, applySourceSuggestion, lookupSourceDetails, momentLinkText, momentLocationError,
  momentPayload, momentText, offeredMomentsText, parseMomentTimestamp, quotationNotices, rightsGuidanceText, sortMoments,
} from "../../web/studio/parts/moment-rules.js";
import { catalog, say } from "../../web/studio/parts/words.js";
import { bannedExcept } from "../../web/studio/parts/plain-words.js";

// Shaping what you write together (Studio R14b), ported from tests/web/admin-shared-drafts (the
// arrangement, approval rule, continuing conversation and moment cases) and admin-shared-series;
// the old panels' chrome is tests/browser/studio-together-shape.spec.mjs.

test("the layout is the server's five, one after another to start, and a turn names a part, never a side", () => {
  assert.deepEqual(ARRANGEMENT_LAYOUTS.map((item) => item.value), ["sequential", "sideBySide", "pointCounterpoint", "alternatingDialogue", "roundtable"]);
  for (const layout of ARRANGEMENT_LAYOUTS) assert.ok(layout.words() && layout.help(), layout.value);
  const people = [{ id: "p1", displayName: "Ann" }, { id: "p2", displayName: "Bo" }];
  const start = arrangementDraft(null, people);
  assert.equal(start.revision, 0);
  assert.equal(start.layout, "sequential");
  assert.deepEqual(start.rounds[0].turns, [{ draft: "p1", part: 0, label: "" }, { draft: "p2", part: 0, label: "" }]);
  const payload = arrangementPayload(start);
  assert.equal(payload.revision, 1);
  assert.equal(payload.rounds[0].roundPrompt, undefined, "an empty prompt is left out");
  assert.deepEqual(Object.keys(payload).sort(), ["layout", "revision", "rounds", "version"]);
  assert.deepEqual(Object.keys(payload.rounds[0].turns[0]).sort(), ["draft", "part"]);
  assert.equal(turnWords({ draft: "p2", part: 1 }, people), "Bo, part 2");
});

test("moving and checking a layout never loses or repeats a turn, and says which round", () => {
  assert.deepEqual(moveItem([1, 2, 3], 0, 1), [2, 1, 3]);
  assert.deepEqual(moveItem([1, 2, 3], 0, -1), [1, 2, 3]);
  assert.deepEqual(moveItem([1, 2, 3], 2, 1), [1, 2, 3]);
  assert.equal(nextRoundId([{ id: "round-1" }, { id: "round-3" }]), "round-4");
  const draft = arrangementDraft({ revision: 2, layout: "sideBySide", rounds: [{ id: "round-1", roundPrompt: "Why?", turns: [{ draft: "p1", part: 0 }, { draft: "p2", part: 0 }] }] }, []);
  assert.equal(validateArrangement(draft), null);
  assert.equal(arrangementPayload(draft).revision, 3);
  draft.rounds[0].turns.push({ draft: "p1", part: 0 });
  assert.deepEqual(validateArrangement(draft), { round: 0, words: say("layout.twice", { n: 1 }) });
  assert.equal(validateArrangement({ rounds: [] }).words, say("layout.noRounds"));
  assert.equal(validateArrangement({ rounds: [{ prompt: "", turns: [] }] }).words, "Round 1 has no turns. Add one or take the round out.");
  assert.equal(validateArrangement({ rounds: [{ prompt: "a\nb", turns: [{ draft: "p1", part: 0 }] }] }).words, say("layout.promptOneLine", { n: 1 }));
  assert.equal(validateArrangement({ rounds: [{ prompt: "", turns: [{ draft: "p1", part: 0, label: "a b" }] }] }).words, say("layout.labelOneLine", { n: 1 }));
  assert.equal(validateArrangement({ rounds: [{ prompt: "", turns: [{ draft: "p1", part: 0, label: "é".repeat(TURN_LABEL_MAX_BYTES) }] }] }).words, say("layout.labelLong", { n: 1 }), "counted in bytes, as the server counts");
  assert.equal(validateArrangement({ rounds: [{ prompt: "", turns: [{ draft: "p1", part: 1.5 }] }] }).words, say("layout.badPart", { n: 1 }));
});

test("whose agreement counts round-trips and never sends an empty list", () => {
  assert.deepEqual(APPROVAL_REQUIREMENTS.map((item) => item.value), ["allAuthors", "contributingAuthors", "namedAuthors", "authorsWithRoles"]);
  assert.deepEqual(APPROVAL_ROLE_CHOICES.map((item) => item.value), ["siteOwner", "coordinator", "contributor"]);
  assert.deepEqual(approvalPolicyChoice({ requirement: { namedAuthors: ["p2"] }, scope: "wholePiece" }), { kind: "namedAuthors", named: ["p2"], roles: [], scope: "wholePiece" });
  assert.deepEqual(approvalPolicyChoice({ requirement: { authorsWithRoles: ["coordinator"] } }).roles, ["coordinator"]);
  assert.equal(approvalPolicyChoice({ requirement: "nonsense" }).kind, "allAuthors");
  assert.equal(approvalPolicyChoice(undefined).scope, "ownSections");
  assert.deepEqual(approvalPolicyPayload({ kind: "namedAuthors", named: ["p1", "p1"], scope: "ownSections" }), { policy: { requirement: { namedAuthors: ["p1"] }, scope: "ownSections" } });
  assert.equal(approvalPolicyPayload({ kind: "namedAuthors", named: [] }).error, say("rules.needPeople"));
  assert.equal(approvalPolicyPayload({ kind: "authorsWithRoles", roles: [] }).error, say("rules.needRoles"));
  assert.deepEqual(approvalPolicyPayload({ kind: "contributingAuthors", scope: "wholePiece" }), { policy: { requirement: "contributingAuthors", scope: "wholePiece" } });
});

test("what keeps a rule from being met says who can fix it, in her words", () => {
  assert.deepEqual(approvalRuleText({ unmetNamed: ["Grace"] }), ["It can't be met as things stand: Grace can't agree any more.", say("rules.fixNamed")]);
  assert.deepEqual(approvalRuleText({ unmetRoles: ["editor"] }), [say("rules.cantMeetRole"), say("rules.fixRole")]);
  assert.deepEqual(approvalRuleText({}), []);
  const rows = approvalPeopleRows({ approvers: [{ participantId: "p1", displayName: "Ann" }, { participantId: "p2", displayName: "Bo" }], formerApprovers: [{ participantId: "p9", displayName: "Grace" }, { participantId: "p2", displayName: "Bo" }] });
  assert.deepEqual(rows, [
    { participantId: "p1", displayName: "Ann", canApprove: true },
    { participantId: "p2", displayName: "Bo", canApprove: true },
    { participantId: "p9", displayName: "Grace (isn't in it any more)", canApprove: false },
  ]);
  assert.deepEqual(approvalPeopleRows({}), []);
});

test("a collection and a place are said in words, with or without a number", () => {
  assert.equal(seriesPlacementText("Letters", 2), "Letters, number 2");
  assert.equal(seriesPlacementText("Letters", 0), "Letters, number 0");
  assert.equal(seriesPlacementText("Letters", null), "Letters, after the numbered ones, by date");
  assert.equal(seriesPlacementText(""), say("collection.placementNone"));
  assert.equal(seriesPartText({ title: "First", order: 1 }, 0), "1. First (number 1)");
  assert.equal(seriesPartText({ title: "Loose", order: null }, 2), "3. Loose (no number)");
  assert.equal(seriesPartText({ thisPublication: true, order: 2 }, 1), "2. This one (not on your blog yet, number 2)");
});

test("the placement names an existing collection by its address and checks the place", () => {
  assert.deepEqual(seriesPlacementRequest("guides", "", "3"), { placement: { series: "guides", order: 3 } });
  assert.deepEqual(seriesPlacementRequest("guides", "ignored", " "), { placement: { series: "guides", order: null } });
  assert.deepEqual(seriesPlacementRequest(NEW_SERIES, "  Letters  ", ""), { placement: { series: "Letters", order: null } });
  assert.deepEqual(seriesPlacementRequest(NO_SERIES, "", ""), { placement: null });
  for (const bad of ["-1", "1.5", "two", "4294967296"]) assert.equal(seriesPlacementRequest("guides", "", bad).field, "order", bad);
  assert.equal(seriesPlacementRequest(NEW_SERIES, "   ", "").field, "title");
  assert.doesNotMatch(NEW_SERIES, /^[\p{L}\p{N}-]+$/u, "the new-collection choice can never be an address");
});

test("an unchanged choice keeps the stored reference, so saving it asks no one to agree again", () => {
  const stored = { series: "Letters Across Time", order: 2 };
  assert.deepEqual(keepStoredSeries({ series: "letters-across-time", order: 2 }, stored, "letters-across-time"), stored);
  assert.deepEqual(keepStoredSeries({ series: "letters-across-time", order: 2 }, stored, undefined), stored);
  assert.deepEqual(keepStoredSeries({ series: "letters-across-time", order: null }, { series: "Letters Across Time" }, "letters-across-time"), { series: "Letters Across Time", order: null });
  assert.deepEqual(keepStoredSeries({ series: "letters-across-time", order: 3 }, stored, "letters-across-time"), { series: "letters-across-time", order: 3 });
  assert.deepEqual(keepStoredSeries({ series: "guides", order: 2 }, stored, "letters-across-time"), { series: "guides", order: 2 });
  assert.equal(keepStoredSeries(null, stored, "letters-across-time"), null);
});

// ---- What we say together

const ME = { id: "p1", displayName: "Ann" };
const OTHER = { id: "p2", displayName: "Bo" };

test("what you say together says who it speaks for and who has agreed", () => {
  assert.equal(synthesisItemText({ kind: "difference", contributors: [ME, OTHER], approved: [ME], awaiting: [OTHER] }), "Difference, for Ann and Bo. Agreed by Ann. Waiting for Bo.");
  assert.equal(synthesisItemText({ kind: "question", contributors: [ME], approved: [], awaiting: [ME] }), "Question, for Ann. Agreed by no one yet. Waiting for Ann.");
  assert.equal(synthesisItemText({ kind: "mystery" }), "Something said, for no one. Agreed by no one yet. Waiting for no one.");
  assert.deepEqual(SYNTHESIS_KINDS.map((k) => k.value), ["agreement", "difference", "question", "application", "uncertainty"]);
  assert.ok(SYNTHESIS_KINDS.every((kind) => kind.prompt().length > 0 && kind.words().length > 0));
  assert.equal(SYNTHESIS_KINDS[3].words(), "Something to try");
  assert.deepEqual(moveSynthesisItem(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.equal(moveSynthesisItem(["a", "b"], "a", -1), null);
  assert.equal(moveSynthesisItem(["a", "b"], "b", 1), null);
  assert.deepEqual(synthesisAddChange({ kind: "question", markdown: "Why?", others: ["p2", "p2"] }), { change: { action: "add", kind: "question", markdown: "Why?", others: ["p2"] } });
  assert.equal(synthesisAddChange({ kind: "question", markdown: "  " }).error, say("talk.needWords"));
  assert.equal(synthesisAddChange({ kind: "nonsense", markdown: "x" }).change.kind, "agreement");
  assert.equal(promptsKey("lee"), "studio:together:lee:promptsHidden");
  assert.equal(OLD_PROMPTS_KEY, "ob-admin-synthesis-prompts-dismissed", "read once, never written");
});

// ---- Moments

const SOURCES = [{ id: "source-1", title: "A talk on video" }, { id: "source-2", title: "A book" }, { id: "source-3", title: "A podcast" }];
const GUIDE = { briefQuotationChars: 300, notices: { noSpeaker: "No one is named.", long: "It's long.", longForBriefQuotation: "Long for a short quotation." }, rights: [{ value: "permission", guidance: "Say who agreed and when." }] };

test("typed times are read exactly as the server reads them", () => {
  assert.deepEqual(parseMomentTimestamp("75"), { seconds: 75, fraction: "" });
  assert.deepEqual(parseMomentTimestamp("1:02"), { seconds: 62, fraction: "" });
  assert.deepEqual(parseMomentTimestamp("1:02:03.50"), { seconds: 3723, fraction: "5" });
  assert.deepEqual(parseMomentTimestamp("100:00"), { seconds: 6000, fraction: "" });
  for (const bad of ["", " 1", "1 ", "1:2", "1:60", "1:02:03:04", "-5", "+5", "1h2m", "1:02.", ".5", "1,5", "١٢", "99999999999999999999"]) assert.equal(parseMomentTimestamp(bad), null, bad);
  assert.equal(momentLocationError("timestamp", "1:60", ""), say("moments.badTime"));
  assert.equal(momentLocationError("timestamp", "1:10", "1:02"), say("moments.endBefore"));
  assert.equal(momentLocationError("timestamp", "1:10", "1:10.0"), say("moments.endBefore"));
  assert.equal(momentLocationError("timestamp", "1:10", "1:10.5"), "");
  assert.equal(momentLocationError("page", "", ""), say("moments.needWhere"));
  assert.equal(momentLocationError("page", "3]", ""), say("moments.badWhere"));
  assert.equal(momentLocationError("chapter", "Two", ""), "");
  assert.ok(MOMENT_LOCATOR_KINDS.every((kind) => kind.value !== "folio"));
});

test("a moment has explicit rights and where the words came from, keeps what the form doesn't edit, and says something", () => {
  const base = { source: "source-1", kind: "timestamp", value: "1:02", to: "", quote: "", speaker: "", rights: "", provenance: "", observation: "", publish: false };
  assert.equal(momentPayload({ ...base, source: "" }).field, "source");
  assert.equal(momentPayload({ ...base, value: "1:2" }).field, "value");
  assert.equal(momentPayload({ ...base, to: "1:00" }).field, "to");
  assert.equal(momentPayload(base).field, "quote");
  assert.equal(momentPayload({ ...base, quote: "Words" }).field, "rights", "rights have no default");
  assert.equal(momentPayload({ ...base, quote: "Words", rights: "briefQuotation" }).field, "provenance");
  assert.equal(momentPayload({ ...base, quote: "Words", rights: "unknown", provenance: "copied", publish: true }).error, say("moments.uncheckedPrivate"));
  const kept = momentPayload({ ...base, quote: "Words", speaker: "  The host ", rights: "unknown", provenance: "copied", observation: "  " }, { locators: [{ kind: "chapter", value: "2" }], language: "en" });
  assert.deepEqual(kept.moment, { source: "source-1", locators: [{ kind: "timestamp", value: "1:02" }, { kind: "chapter", value: "2" }], intent: "private",
    quotation: { text: "Words", rights: "unknown", provenance: "copied", speaker: "The host", language: "en" } });
  assert.deepEqual(momentPayload({ ...base, observation: "Mine", publish: true, to: "1:10" }).moment, { source: "source-1", locators: [{ kind: "timestamp", value: "1:02", to: "1:10" }], intent: "publication", observation: "Mine" });
  const noted = momentPayload({ ...base, quote: "Line one\nLine two", speaker: "Ada", rights: "permission", rightsNote: "  By email  ", provenance: "supplied", publish: true });
  assert.equal(noted.moment.quotation.rightsNote, "By email");
  assert.equal(noted.moment.quotation.text, "Line one\nLine two");
  assert.deepEqual(QUOTATION_RIGHTS.map((r) => r.value), ["unknown", "briefQuotation", "permission", "openLicense", "publicDomain", "ownWords"]);
  assert.equal(QUOTATION_PROVENANCE.length, 3);
});

test("moments read by source, then by time, then as made; links and notices are the server's", () => {
  const moments = [
    { id: "moment-1", source: "source-3", locators: [{ kind: "timestamp", value: "10" }] },
    { id: "moment-2", source: "source-1", locators: [{ kind: "timestamp", value: "1:00:00" }] },
    { id: "moment-3", source: "source-1", locators: [{ kind: "timestamp", value: "59:59.5" }] },
    { id: "moment-4", source: "source-2", locators: [{ kind: "page", value: "9" }] },
    { id: "moment-5", source: "source-gone", locators: [{ kind: "timestamp", value: "1" }] },
    { id: "moment-6", source: "source-2", locators: [{ kind: "page", value: "2" }] },
  ];
  assert.deepEqual(sortMoments(moments, SOURCES).map((m) => m.id), ["moment-3", "moment-2", "moment-4", "moment-6", "moment-1", "moment-5"]);
  assert.equal(momentText({ source: "source-gone", location: "at 1", intent: "private" }, SOURCES), "Something no longer listed, at 1. Only you can see it.");
  assert.equal(momentText({ source: "source-1", location: "at 1:02", intent: "publication" }, SOURCES), "A talk on video, at 1:02. Goes with your part.");
  assert.equal(momentLinkText({ link: { href: "https://www.youtube.com/watch?v=abcdefghijk&t=62s", atTime: true }, locators: [{ kind: "timestamp", value: "1:02" }] }), "Open it at 1:02");
  assert.equal(momentLinkText({ link: { href: "https://podcasts.example/12", atTime: false }, locators: [{ kind: "timestamp", value: "5" }] }), say("moments.openSource"));
  assert.equal(momentLinkText({ link: null }), "");
  assert.equal(offeredMomentsText({ momentsShared: true }), "");
  assert.equal(offeredMomentsText({ momentsShared: false }), say("moments.changedAfter"));
  assert.equal(offeredMomentsText({ momentsShared: null }), say("moments.notShared"));
  assert.equal(offeredMomentsText({}), "");
});

test("quotation notices count characters as the server does and say nothing without its guide", () => {
  const at = "a".repeat(300);
  assert.deepEqual(quotationNotices({ quote: "Listen first.", speaker: "Ada", rights: "briefQuotation" }, GUIDE), []);
  assert.deepEqual(quotationNotices({ quote: "Listen first.", speaker: "  ", rights: "briefQuotation" }, GUIDE).map((n) => n.code), ["noSpeaker"]);
  assert.deepEqual(quotationNotices({ quote: at, speaker: "Ada", rights: "briefQuotation" }, GUIDE), []);
  assert.deepEqual(quotationNotices({ quote: `${at}x`, speaker: "Ada", rights: "briefQuotation" }, GUIDE).map((n) => n.code), ["longForBriefQuotation"]);
  assert.deepEqual(quotationNotices({ quote: `${at}x`, speaker: "", rights: "permission" }, GUIDE).map((n) => n.code), ["noSpeaker", "long"]);
  const astral = "🎙".repeat(150) + "\n".repeat(150);
  assert.deepEqual(quotationNotices({ quote: astral, speaker: "Ada", rights: "briefQuotation" }, GUIDE), []);
  assert.deepEqual(quotationNotices({ quote: `${at}x`, speaker: "" }, undefined), [], "no guide, no guess");
  assert.equal(rightsGuidanceText("permission", GUIDE), `Say who agreed and when. ${say("moments.statement")}`);
  assert.equal(rightsGuidanceText("", GUIDE), say("moments.statement"));
});

test("filling in from the link fills empty boxes only and never stops her writing", async () => {
  const source = { title: "Mine", url: "https://www.youtube.com/watch?v=abc", creator: "", publisher: "" };
  const found = { status: "found", suggestion: { provenance: "provider", title: "Theirs", creator: "A channel", publisher: "YouTube" } };
  const result = await lookupSourceDetails(source, async () => found);
  assert.deepEqual(result.applied, ["creator", "publisher"]);
  assert.equal(source.title, "Mine", "what she typed stays");
  assert.equal(result.message, "Filled in from YouTube: who made it, who published it. Check them; they're yours to change.");
  assert.equal((await lookupSourceDetails({ url: "" }, async () => found)).message, say("moments.fillPasteFirst"));
  assert.equal((await lookupSourceDetails({ url: "https://x.example" }, async () => { throw new Error("down"); })).message, say("moments.fillFailed"));
  assert.equal((await lookupSourceDetails({ url: "https://x.example" }, async () => ({ status: "unsupported" }))).message, say("moments.fillUnsupported"));
  const moving = { url: "https://a.example" };
  assert.equal((await lookupSourceDetails(moving, async () => { moving.url = "https://b.example"; return found; })).stale, true);
  assert.deepEqual(applySourceSuggestion({ title: "" }, { provenance: "author", title: "No" }), [], "only a provider's suggestion");
});

test("shaping words are plain and her own", () => {
  const ids = Object.keys(catalog()).filter((id) => /^(layout|rules|collection|talk|moments)\./.test(id));
  assert.ok(ids.length > 150, String(ids.length));
  for (const id of ids) {
    const entry = catalog()[id];
    assert.doesNotMatch(entry.text, /Grammi|Mikey|\bRuth\b|\bDana\b|\bElkins\b|Pumpkin/, id);
    if (entry.layer !== "her") continue;
    assert.equal(bannedExcept(entry.text, entry.allows), "", id);
    assert.doesNotMatch(entry.text, /\b(synthesis|arrangement|revision|reveal|coordinator|site owner|contributor|participant|approval rule|series)\b/i, id);
  }
});
