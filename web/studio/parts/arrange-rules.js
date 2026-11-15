// Shaping what you write together (Studio R14b), lifted from the old Admin's arrangement, approval
// rule and series helpers and given her words: the layout and its rounds and turns, whose
// agreement counts, and which collection it joins. Pure and DOM-free; words come from say().
import { say } from "./words.js";
import { joinNames } from "./together-rules.js";

// ---- Layout (ADR 0031)

/** The layouts whoever runs it can choose. The server decides which exist. */
export const ARRANGEMENT_LAYOUTS = Object.freeze([
  { value: "sequential", words: () => say("layout.sequential"), help: () => say("layout.sequentialHelp") },
  { value: "sideBySide", words: () => say("layout.sideBySide"), help: () => say("layout.sideBySideHelp") },
  { value: "pointCounterpoint", words: () => say("layout.pointCounterpoint"), help: () => say("layout.pointCounterpointHelp") },
  { value: "alternatingDialogue", words: () => say("layout.alternatingDialogue"), help: () => say("layout.alternatingDialogueHelp") },
  { value: "roundtable", words: () => say("layout.roundtable"), help: () => say("layout.roundtableHelp") },
]);

/** The longest label a turn may carry, in UTF-8 bytes like the server's limit. */
export const TURN_LABEL_MAX_BYTES = 80;

/**
 * An editable copy of the stored layout, or a starting one: one round holding the first part of
 * everyone's words, in the order they joined. Nothing here reads anyone's words.
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
  return { revision: 0, layout: "sequential", rounds: [{ id: "round-1", prompt: "", turns: (participants || []).map((person) => ({ draft: person.id, part: 0, label: "" })) }] };
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

/** The next round id no round uses yet. */
export function nextRoundId(rounds) {
  const used = new Set(rounds.map((round) => String(round.id).toLowerCase()));
  for (let n = rounds.length + 1; n < rounds.length + 1000; n += 1) if (!used.has(`round-${n}`)) return `round-${n}`;
  return `round-${rounds.length + 1000}`;
}

/** The structure to save: the edited draft, one revision after the stored one. */
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
      }) };
    }),
  };
}

/** A mistake the server would refuse anyway, found first so the words can say where: `{ round, words }` or null. */
export function validateArrangement(draft) {
  if (!draft.rounds.length) return { round: -1, words: say("layout.noRounds") };
  const seen = new Set();
  for (const [r, round] of draft.rounds.entries()) {
    const n = r + 1;
    if (!round.turns.length) return { round: r, words: say("layout.emptyRound", { n }) };
    if (String(round.prompt || "").includes("\n")) return { round: r, words: say("layout.promptOneLine", { n }) };
    for (const turn of round.turns) {
      const part = Number(turn.part);
      if (!Number.isInteger(part) || part < 0 || part > 999) return { round: r, words: say("layout.badPart", { n }) };
      const label = String(turn.label || "");
      if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(label)) return { round: r, words: say("layout.labelOneLine", { n }) };
      if (new TextEncoder().encode(label.trim()).length > TURN_LABEL_MAX_BYTES) return { round: r, words: say("layout.labelLong", { n }) };
      const key = `${String(turn.draft).toLowerCase()}:${part}`;
      if (seen.has(key)) return { round: r, words: say("layout.twice", { n }) };
      seen.add(key);
    }
  }
  return null;
}

/** "Ann Owner, part 2" for a turn, with the person's name from the participants. */
export function turnWords(turn, participants) {
  const name = (participants || []).find((p) => p.id === turn.draft)?.displayName || "";
  return say("layout.turn", { name, part: Number(turn.part) + 1 });
}

// ---- Whose agreement counts (ADR 0052)

/** Whose agreement publishing needs. Everyone who wrote agrees under every rule. */
export const APPROVAL_REQUIREMENTS = Object.freeze([
  { value: "allAuthors", words: () => say("rules.allAuthors"), help: () => say("rules.allAuthorsHelp") },
  { value: "contributingAuthors", words: () => say("rules.contributingAuthors"), help: () => say("rules.contributingAuthorsHelp") },
  { value: "namedAuthors", words: () => say("rules.namedAuthors"), help: () => say("rules.namedAuthorsHelp") },
  { value: "authorsWithRoles", words: () => say("rules.authorsWithRoles"), help: () => say("rules.authorsWithRolesHelp") },
]);

/** The jobs a job-based rule can list. Only readers and editors can't agree, so they aren't offered. */
export const APPROVAL_ROLE_CHOICES = Object.freeze([
  { value: "siteOwner", words: () => say("rules.roleInCharge") },
  { value: "coordinator", words: () => say("rules.roleRuns") },
  { value: "contributor", words: () => say("rules.roleWrites") },
]);

/** The stored rule as form choices: one kind, the named people, the jobs and what it covers. */
export function approvalPolicyChoice(policy) {
  const requirement = policy?.requirement ?? "allAuthors";
  const choice = { kind: "allAuthors", named: [], roles: [], scope: policy?.scope === "wholePiece" ? "wholePiece" : "ownSections" };
  if (typeof requirement === "string") choice.kind = APPROVAL_REQUIREMENTS.some((item) => item.value === requirement) ? requirement : "allAuthors";
  else if (Array.isArray(requirement?.namedAuthors)) Object.assign(choice, { kind: "namedAuthors", named: [...requirement.namedAuthors] });
  else if (Array.isArray(requirement?.authorsWithRoles)) Object.assign(choice, { kind: "authorsWithRoles", roles: [...requirement.authorsWithRoles] });
  return choice;
}

/**
 * Everyone a named rule can list: people who can agree now, then anyone the rule names who no
 * longer can (they left, or lost the job). Those stay chosen, so nothing is kept unseen.
 */
export function approvalPeopleRows(rule) {
  const rows = (rule?.approvers || []).map((person) => ({ participantId: person.participantId, displayName: person.displayName, canApprove: true }));
  for (const person of rule?.formerApprovers || []) {
    if (!rows.some((row) => row.participantId === person.participantId)) rows.push({ participantId: person.participantId, displayName: say("rules.left", { name: person.displayName || "" }), canApprove: false });
  }
  return rows;
}

/** The rule the server expects for these choices, or what is missing (`{ error, field }`). */
export function approvalPolicyPayload(choice) {
  const scope = choice?.scope === "wholePiece" ? "wholePiece" : "ownSections";
  if (choice?.kind === "namedAuthors") {
    const named = [...new Set(choice.named || [])];
    if (!named.length) return { error: say("rules.needPeople"), field: "named" };
    return { policy: { requirement: { namedAuthors: named }, scope } };
  }
  if (choice?.kind === "authorsWithRoles") {
    const roles = [...new Set(choice.roles || [])];
    if (!roles.length) return { error: say("rules.needRoles"), field: "roles" };
    return { policy: { requirement: { authorsWithRoles: roles }, scope } };
  }
  return { policy: { requirement: choice?.kind === "contributingAuthors" ? "contributingAuthors" : "allAuthors", scope } };
}

/** What keeps the rule from being met, in her words, with who can fix it. Empty when nothing does. */
export function approvalRuleText(rule) {
  const lines = [];
  if (rule?.unmetNamed?.length) lines.push(say("rules.cantMeet", { names: joinNames(rule.unmetNamed) }), say("rules.fixNamed"));
  if (rule?.unmetRoles?.length) lines.push(say("rules.cantMeetRole"), say("rules.fixRole"));
  return lines;
}

// ---- Which collection

/** The choice for "a new collection". A collection's address can never hold brackets. */
export const NEW_SERIES = "(new)";
/** The choice for "not in a collection". */
export const NO_SERIES = "";
const MAX_SERIES_ORDER = 4294967295;

/** A placement in words: "Letters, number 2", or after the numbered ones. */
export function seriesPlacementText(name, order) {
  if (!name) return say("collection.placementNone");
  return order === null || order === undefined ? say("collection.placementEnd", { name }) : say("collection.placementAt", { name, n: order });
}

/** One part of a previewed reading order, in words. */
export function seriesPartText(part, index, speak = say) {
  const place = part?.order === null || part?.order === undefined ? say("collection.orderNoNumber") : say("collection.orderNumber", { n: part.order });
  if (part?.thisPublication) return speak("collection.orderThis", { n: index + 1, place });
  return speak("collection.orderPart", { n: index + 1, title: part?.title || say("collection.untitledPart"), place }, part?.title ? ["title"] : []);
}

/** The placement to send for the chosen collection, or what to fix (`{ error, field }`). */
export function seriesPlacementRequest(choice, title, order) {
  const text = String(order ?? "").trim();
  if (text && (!/^\d+$/.test(text) || Number(text) > MAX_SERIES_ORDER)) return { error: say("collection.badPlace"), field: "order" };
  const position = text ? Number(text) : null;
  if (choice === NO_SERIES) return { placement: null };
  if (choice === NEW_SERIES) {
    const name = String(title ?? "").trim();
    if (!name) return { error: say("collection.needName"), field: "title" };
    return { placement: { series: name, order: position } };
  }
  return { placement: { series: choice, order: position } };
}

/** A collection's address from its name, as the server makes it (near enough to match a stored name). */
export const seriesSlug = (value) => String(value).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * The placement to send, keeping the stored one when nothing really changed: a stored typed title
 * ("Letters Home") shows as the collection it resolves to ("letters-home"), and sending that address
 * back would look like a change and ask everyone to agree again.
 */
export function keepStoredSeries(placement, stored, storedSlug) {
  if (!placement || !stored) return placement;
  const slug = storedSlug || seriesSlug(String(stored.series ?? ""));
  const sameOrder = (placement.order ?? null) === (stored.order ?? null);
  return placement.series === slug && sameOrder ? { series: stored.series, order: stored.order ?? null } : placement;
}
