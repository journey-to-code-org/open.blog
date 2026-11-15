// The rules of Your voice guide (Studio R9): which pieces are ticked for her, what goes to the
// company, how the proposal's changes are chosen and joined, and where Save writes. The merge
// rules are lifted from the old Admin (ADR 0282, 0288) with their behaviour and tests. Pure: no
// page, no network. What a helper returns is untrusted text; nothing here acts on it.
import { say } from "./words.js";
import { wordsAbout } from "./helper-rules.js";

/** The most one request carries (the server's limits, `voice_assistant.rs`). */
export const GUIDE_BUDGET = Object.freeze({ samples: 8, characters: 120_000 });

/** The context id of a piece's file, as `assistant/voice-guide` takes it. */
export const sampleContextId = (sample) => `voice:${sample.visibility}:${sample.file}`;

/** The budget in effect: the catalog's (`voiceBudget`) when it gives one, else the built-in. */
export function guideBudget(catalog = {}) {
  const given = catalog?.voiceBudget || {};
  return { samples: Number(given.samples) > 0 ? Number(given.samples) : GUIDE_BUDGET.samples, characters: Number(given.characters) > 0 ? Number(given.characters) : GUIDE_BUDGET.characters };
}

/**
 * The pieces she may learn from, newest first, rough drafts before polished copies of the same
 * day: `[{ id, title, stage, words, characters, date }]`. `samples` is `voice/samples`' list;
 * `catalog` the light context catalog (for each file's letters). Unreadable files are left out.
 */
export function guidePieces(samples = [], catalog = {}) {
  const letters = new Map((catalog?.voiceSamples || []).map((doc) => [doc.id, Number(doc.characters) || 0]));
  return samples
    .filter((sample) => sample?.valid && (sample.stage === "rough" || sample.stage === "polished"))
    .map((sample) => {
      const id = sampleContextId(sample);
      const words = Number(sample.words) || 0;
      // Before the catalog answers, a piece's letters are guessed from its words (about 6 each).
      return { id, title: String(sample.promptTitle || sample.title || sample.prompt || ""), stage: sample.stage, words, characters: letters.get(id) ?? words * 6, date: String(sample.date || ""), by: sample.by || "" };
    })
    .sort((a, b) => b.date.slice(0, 10).localeCompare(a.date.slice(0, 10)) || (a.stage === b.stage ? 0 : a.stage === "rough" ? -1 : 1) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/**
 * The pieces ticked for her: rough drafts first (they show best how she really writes), newest
 * first, then polished copies, never more than the budget's pieces or letters. Returns ids.
 */
export function defaultGuidePieces(pieces = [], budget = GUIDE_BUDGET) {
  const ordered = [...pieces.filter((p) => p.stage === "rough"), ...pieces.filter((p) => p.stage !== "rough")];
  const ids = [];
  let letters = 0;
  for (const piece of ordered) {
    if (ids.length >= budget.samples) break;
    if (letters + piece.characters > budget.characters) continue;
    ids.push(piece.id);
    letters += piece.characters;
  }
  return ids;
}

/** Her ticks against the budget: `{ count, words, characters, over, none }`. */
export function guideSelection(pieces = [], ticked = [], budget = GUIDE_BUDGET) {
  const chosen = pieces.filter((piece) => ticked.includes(piece.id));
  const characters = chosen.reduce((sum, piece) => sum + piece.characters, 0);
  return {
    ids: chosen.map((piece) => piece.id), count: chosen.length, words: chosen.reduce((sum, piece) => sum + piece.words, 0), characters,
    over: chosen.length > budget.samples || characters > budget.characters, none: chosen.length === 0,
  };
}

/**
 * The "what goes" box for a guide request, from her ticks only: `{ heading, lines, never }`.
 * `current` is true when a guide exists (it goes too, to be compared).
 */
export function guideWhatGoes(selection, current, company) {
  return {
    heading: say("common.whatGoes", { company }),
    lines: [say("voice.guideGoesPieces", { count: wordsAbout(selection?.words || 0) }), ...(current ? [say("voice.guideGoesGuide")] : [])],
    never: say("voice.guideGoesNot", { company }),
  };
}

/**
 * Classify the lines of a unified diff for display. The server writes the diff; this only decides
 * how each line is drawn, so an added or removed line is never colour alone (it keeps its + or -).
 */
export function voiceGuideDiffLines(diff = "") {
  if (!diff) return [];
  return String(diff)
    .split("\n")
    .filter((line, index, lines) => line !== "" || index < lines.length - 1)
    .map((text) => {
      if (text.startsWith("+++") || text.startsWith("---") || text.startsWith("@@")) return { kind: "header", text };
      if (text.startsWith("+")) return { kind: "add", text };
      if (text.startsWith("-")) return { kind: "remove", text };
      return { kind: "context", text };
    });
}

/** Why a guide can't be saved portable, or "" when it can. */
export function voiceGuidePortableNote(proposal = {}) {
  return proposal.portableAllowed === false ? say("voice.guidePortableBlocked") : "";
}

/**
 * Join a merged guide's lines (ADR 0288). The server wrote every line: each is fixed text, or a
 * changed trait with both texts. This only picks one per change, so the result is the server's
 * rendering byte for byte. Null until every change has a choice.
 */
export function voiceGuideAssemble(lines = [], choices = {}) {
  const out = [];
  for (const line of lines) {
    if (typeof line === "string") {
      out.push(line);
      continue;
    }
    const choice = choices[line?.change];
    if (choice !== "current" && choice !== "proposed") return null;
    out.push(choice === "current" ? line.current : line.proposed);
  }
  return `${out.join("\n")}\n`;
}

/** How many changes in a merged guide still need her choice. */
export function voiceGuidePendingChanges(merge = {}, choices = {}) {
  let pending = 0;
  for (let change = 0; change < (merge.changes || 0); change += 1) {
    if (choices[change] !== "current" && choices[change] !== "proposed") pending += 1;
  }
  return pending;
}

/** A trait in parts, each placed as text: `{ statement, quote, piece, oneSample }`. */
export function voiceGuideTraitParts(item = {}) {
  return { statement: String(item.statement ?? ""), quote: String(item.quote ?? ""), piece: String(item.sample ?? ""), oneSample: item.oneSample === true };
}

/** What a saved trait's quote check means: a word id's text, or "" when the quote was found again. */
export function voiceGuideCheckNote(check) {
  if (check === "sample-missing") return say("voice.checkGone");
  if (check === "not-in-sample") return say("voice.checkMoved");
  return "";
}

/**
 * The body of the save for an approved guide, or null when it can't go there. The revision is the
 * one the proposal was made against, so a guide changed elsewhere meanwhile is a conflict and not
 * an overwrite.
 */
export function voiceGuideSaveRequest(proposal = {}, visibility, content) {
  const target = proposal.targets?.[visibility];
  if (!target || !["portable", "private"].includes(visibility)) return null;
  if (target.valid === false) return null;
  if (visibility === "portable" && proposal.portableAllowed === false) return null;
  if (typeof content !== "string" || !content.trim()) return null;
  return { contextType: "voice", visibility, content, etag: target.exists ? target.etag : null };
}

/**
 * Where her Save writes (R9 decision 5): where the guide already is, when that file is usable and
 * allowed; otherwise private. Never portable when the guide quotes private pieces.
 */
export function guideSaveTarget(proposal = {}) {
  const where = proposal.current?.exists ? proposal.current.visibility : null;
  if (where === "portable" && proposal.portableAllowed !== false && proposal.targets?.portable?.valid !== false) return "portable";
  return "private";
}

/** The text to save: {helper}'s own edit when there is one (hand edits win), else her choices joined. */
export function guideContent(proposal = {}, choices = {}, edited = null) {
  if (typeof edited === "string") return edited;
  const merge = proposal.merge;
  if (merge?.lines) return voiceGuideAssemble(merge.lines, choices);
  return typeof proposal.markdown === "string" ? proposal.markdown : null;
}

/** Whether the proposal changes anything from the saved guide. */
export function guideHasNews(proposal = {}) {
  const merge = proposal.merge || {};
  const traits = (merge.sections || []).flatMap((section) => section.traits || []);
  return Boolean(merge.changes) || traits.some((t) => t.status === "added") || (merge.unknown || []).some((u) => u.status === "added") || !proposal.current?.exists;
}

/** One failed guide call beyond R8's `helperProblem`: her words for the guide's own codes, or "". */
export function guideProblem(error = {}) {
  const data = error?.data && typeof error.data === "object" ? error.data : {};
  const status = Number(error?.status) || 0;
  const text = String(data.error || "");
  if (data.code === "over-budget" || data.code === "too-many" || /at most|too many/i.test(text) && status === 400) return say("voice.guideOver");
  if (data.code === "no-pieces" || status === 400 && /at least one/i.test(text)) return say("voice.guideNoneTicked");
  if (status === 409) return say("voice.guideCantNow");
  return "";
}
