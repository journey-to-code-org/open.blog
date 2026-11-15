// Compare (Studio R12): aligned passages read side by side, as the old Admin's comparison helpers
// (web/admin/admin.js l.5506–6300), lifted. Words are passed through exactly; nothing here
// normalizes or rewrites them. Checks return {field, id, vars}; names and keys are composed in code.
import { say } from "./words.js";
import { sourceKindWords, sourceLabel, rightsOf, rightsText, RIGHTS_NEEDING_CONFIRMATION } from "./source-rules.js";
import { formatLocatorLines, locatorText, parseLocatorLines, MAX_PASSAGE_LOCATORS } from "./notebook-rules.js";
import { languageTag } from "./draft-research-rules.js";
import {
  ATLAS_CONFIDENCE, MAX_ATLAS_SHORT_CHARS, MAX_ATLAS_UNCERTAINTY_CHARS, atlasAttributionDraft, atlasAttributionPayload, atlasPartyProblem,
  codePoints, keepUnchanged, sameLocator, textLines, validAtlasId,
} from "./atlas-rules.js";

// ---------------------------------------------------------------- comparison workspace

/** How aligned places correspond, as she reads them. The server's labels are its own, for details. */
export const ALIGNMENT_CORRESPONDENCES = Object.freeze(["corresponding", "partial", "divergent"].map((value) => Object.freeze({ value })));

/** A correspondence in her words. */
export function correspondenceWords(value) {
  return { corresponding: say("compare.corresponding"), partial: say("compare.partial"), divergent: say("compare.divergent") }[value] || say("compare.corresponding");
}

/** The notice every comparison carries (compare.notice). */
export const alignmentNotice = () => say("compare.notice");

export const MAX_ALIGNMENT_MEMBERS = 32;

export const MAX_ALIGNMENT_RATIONALE_CHARS = 4000;

export const MAX_ALIGNMENT_NORMALIZED_CHARS = 20000;

export const RTL_LANGUAGES = new Set([
  "acm", "aeb", "ajp", "apc", "ar", "arc", "ary", "arz", "azb", "bal", "ckb", "dv", "fa", "glk", "hbo", "he", "iw", "ji", "jpr", "jrb",
  "ks", "lrc", "mzn", "nqo", "ota", "phn", "pnb", "prs", "ps", "sam", "sd", "syc", "syr", "ug", "ur", "yi",
]);

export const RTL_SCRIPTS = new Set([
  "adlm", "arab", "aran", "armi", "avst", "chrs", "cprt", "elym", "hatr", "hebr", "hung", "khar", "lydi", "mand", "mani", "mend", "merc",
  "mero", "narb", "nbat", "nkoo", "ougr", "palm", "phli", "phlp", "phnx", "prti", "rohg", "samr", "sarb", "sogd", "sogo", "syrc", "thaa", "yezi",
]);

/** Script subtags known to run left to right. Any other script subtag leaves the direction to the browser. */
export const LTR_SCRIPTS = new Set([
  "ahom", "armn", "bali", "bamu", "batk", "beng", "bopo", "brah", "brai", "bugi", "buhd", "cakm", "cans", "cari", "cham", "cher", "copt",
  "cyrl", "cyrs", "deva", "dogr", "dsrt", "dupl", "egyp", "ethi", "geok", "geor", "glag", "gong", "gonm", "goth", "gran", "grek", "gujr",
  "guru", "hang", "hani", "hano", "hans", "hant", "hira", "hmng", "hrkt", "ital", "java", "jpan", "kali", "kana", "kawi", "khmr", "khoj",
  "knda", "kore", "kthi", "lana", "laoo", "latf", "latg", "latn", "lepc", "limb", "lina", "linb", "lisu", "lyci", "mahj", "maka", "marc",
  "medf", "mlym", "modi", "mong", "mroo", "mtei", "mult", "mymr", "nagm", "nand", "newa", "nshu", "ogam", "olck", "orkh", "orya", "osge",
  "osma", "perm", "phag", "plrd", "runr", "saur", "sgnw", "shaw", "shrd", "sidd", "sind", "sinh", "sora", "soyo", "sund", "sylo", "tagb",
  "takr", "tale", "talu", "taml", "tang", "tavt", "telu", "tfng", "tglg", "thai", "tibt", "tirh", "toto", "ugar", "vaii", "vith", "wara",
  "wcho", "xpeo", "xsux", "yiii", "zanb",
]);

export const VERSION_MAKERS = Object.freeze({ edition: "editor", translation: "translator", witness: "scribe" });



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

export const certaintyText = (name, certainty, note) => `${name}${certainty || note ? ` (${[certainty, note].filter(Boolean).join(": ")})` : ""}`;

/** Who made a version, in its maker role ("Made by: Slings"); says so when nobody is named. */
export function versionMakerText(source) {
  const role = VERSION_MAKERS[source?.kind];
  if (!role) return "";
  const creators = (Array.isArray(source.creators) ? source.creators : []).filter((creator) => creator && creator.role === role && typeof creator.name === "string");
  if (creators.length) return say("compare.madeBy", { names: creators.map((creator) => certaintyText(creator.name, creator.attribution, creator.note)).join("; ") });
  return say("compare.anonymous");
}

/** Who made an interpretation, with each name's attribution certainty. */
export function interpretersText(interpretation) {
  const interpreters = Array.isArray(interpretation?.interpreters) ? interpretation.interpreters : [];
  if (!interpreters.length) return say("compare.anonymous");
  return say("compare.madeBy", { names: interpreters.map((person) => certaintyText(String(person?.display || person?.name || person?.contributor || ""), person?.attribution)).filter((name) => name.trim()).join("; ") });
}

export const kindLanguage = (kind, language) => [sourceKindWords(kind) || say("compare.aSource"), languageTag(language) ? `(${languageTag(language)})` : ""].filter(Boolean).join(" ");

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
    return source ? sourceLabel(source) : [String(id), say("atlas.missingMark")].join(" ");
  };
  const columns = [];
  const sourceColumn = (id) => {
    const source = sourceById(id);
    const facts = [];
    if (source) {
      const chain = list(source.chain);
      if (chain.length) facts.push({ label: say("compare.factOf"), parts: chain.map((link) => ({ text: String(link.title || link.id) })) });
      if (source.basedOn) facts.push({ label: say("compare.factMadeFrom"), parts: [{ text: named(source.basedOn) }] });
      if (source.revises) facts.push({ label: say("compare.factRevises"), parts: [{ text: named(source.revises) }] });
      if (source.repository || source.shelfmark) facts.push({ label: say("compare.factHeldAt"), parts: [{ text: [source.repository, source.shelfmark].filter(Boolean).join(", ") }] });
      if (Number.isInteger(source.volumes)) facts.push({ label: say("compare.factVolumes"), parts: [String(source.volumes)] });
      if (source.issued) facts.push({ label: say("compare.factIssued"), parts: [{ text: String(source.issued) }] });
      if (source.archived) facts.push({ label: say("compare.factLibrary"), parts: [say("compare.archived")] });
    }
    return {
      key: `source:${id}`,
      type: "source",
      id,
      missing: !source,
      title: source ? sourceLabel(source) : [String(id), say("atlas.missingMark")].join(" "),
      kindText: source ? kindLanguage(source.kind, source.language) : say("compare.notInLibrary"),
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
      facts.push({ label: say("compare.factInterprets"), parts: [{ text: named(interpretation.source) }] });
      if (interpretation.uncertainty) facts.push({ label: say("compare.factUncertain"), parts: [{ text: interpretation.uncertainty }] });
    }
    const kind = interpretation?.kind === "rendering" ? say("compare.rendering") : say("compare.reading");
    return {
      key: `interpretation:${id}`,
      type: "interpretation",
      id,
      missing: !interpretation,
      title: interpretation ? [kind, String(id)].join(" ") : [String(id), say("atlas.missingMark")].join(" "),
      kindText: interpretation ? [say("compare.interpretation"), languageTag(interpretation.language) ? `(${languageTag(interpretation.language)})` : ""].filter(Boolean).join(" ") : say("compare.notInLibrary"),
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
    if (passage && typeof passage.excerpt?.text === "string") original = { text: passage.excerpt.text, language: languageTag(passage.excerpt.language), from: say("compare.fromPassage") };
    else if (isInterpretation && column.interpretation) original = { text: String(column.interpretation.text ?? ""), language: languageTag(column.interpretation.language), from: say("compare.fromInterpretation") };
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
 * Plain text for the places she selected, each named by version, maker, place and rights, with the
 * exact words as kept. Her normalization only when asked for, and labelled; her notes on places
 * only when `notes` is set (they are private).
 */
export function comparisonExportText(alignment, columns, selected, { normalized = false, notes = false, correspondence = "", notice = alignmentNotice() } = {}) {
  const lines = [[say("compare.exportName"), String(alignment?.label || alignment?.id || "")].join(" ")];
  if (correspondence) lines.push(correspondence);
  lines.push(notice, "");
  for (const column of Array.isArray(columns) ? columns : []) {
    for (const place of column.places.filter((item) => selected.has(item.index))) {
      lines.push(`${column.title} (${column.kindText})`);
      if (column.maker) lines.push(column.maker);
      lines.push([say("compare.exportPlace"), place.locator || say("compare.exportNoPlace")].join(" "));
      lines.push(say("compare.rights", { label: rightsText(column.rights) }));
      if (place.absent) lines.push(say("compare.absent"));
      else if (place.original) lines.push(say("compare.exportWords", { from: place.original.from }), place.original.text);
      else lines.push(say("compare.locatedOnly"));
      if (normalized && place.normalized) {
        lines.push(say("compare.normalized"), place.normalized.text);
        if (place.normalized.note) lines.push(say("compare.placeNote", { note: place.normalized.note }));
      }
      if (notes && place.note) lines.push(say("compare.placeNote", { note: place.note }));
      lines.push("");
    }
  }
  lines.push(say("compare.exportFooter"));
  return `${lines.join("\n")}\n`;
}

/** Copy the parts of an alignments response that describe the stored file into the view state. */
export function applyAlignmentState(state, result) {
  for (const key of ["revision", "file", "stored", "alignments", "sources", "passages", "interpretations", "notices", "notice", "correspondences", "publication", "staleApprovals"]) {
    if (result && result[key] !== undefined) state[key] = result[key];
  }
  for (const key of ["alignments", "sources", "passages", "interpretations", "notices"]) if (!Array.isArray(state[key])) state[key] = [];
  if (!Array.isArray(state.correspondences) || !state.correspondences.length) state.correspondences = ALIGNMENT_CORRESPONDENCES.map((item) => ({ ...item }));
  if (typeof state.notice !== "string" || !state.notice) state.notice = "";
  if (!state.staleApprovals || typeof state.staleApprovals !== "object" || Array.isArray(state.staleApprovals)) state.staleApprovals = {};
  if (!state.publication || typeof state.publication !== "object") state.publication = {};
  if (!state.publication.places || typeof state.publication.places !== "object") state.publication.places = {};
  state.publication.publish = state.publication.publish === true;
  if (typeof state.publication.url !== "string") state.publication.url = "/comparisons/";
  if (!Number.isInteger(state.publication.maxExcerptChars)) state.publication.maxExcerptChars = 1000;
  return state;
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

/** What a published comparison page shows for one place, as the server previews it; never a judgement of what is permitted. */
export function publicPlaceText(status, maxChars = 1000) {
  switch (status) {
    case "shown": return say("compare.placeShown");
    case "withheld-rights": return say("compare.placeHeldRights");
    case "withheld-length": return say("compare.placeHeldLength", { max: maxChars });
    case "unquoted": return say("compare.placeUnquoted");
    case "absent": return say("compare.placeAbsent");
    default: return "";
  }
}

/** What a save did to the published comparisons, as a word id: "" when the site doesn't publish them. */
export function comparisonBuildText(build) {
  if (!build || typeof build !== "object" || build.pending) return "";
  return build.ok ? "compare.rebuilt" : "compare.rebuildFailed";
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
    if (!validAtlasId(draft.id)) return { field: "id", id: "sources.badKey" };
    if (used.includes(draft.id)) return { field: "id", id: "compare.keyTaken" };
  }
  if (codePoints(draft.label) > MAX_ATLAS_SHORT_CHARS) return { field: "label", id: "research.tooLong", vars: { max: MAX_ATLAS_SHORT_CHARS } };
  if (draft.members.length > MAX_ALIGNMENT_MEMBERS) return { field: "members", id: "compare.tooManyPlaces", vars: { max: MAX_ALIGNMENT_MEMBERS } };
  for (const [index, member] of draft.members.entries()) {
    if (member.type === "interpretation") {
      if (!member.interpretation) return { field: `member-${index}-interpretation`, id: "compare.chooseInterpretation", vars: { n: index + 1 } };
      if (!interpretations.some((item) => item.id === member.interpretation)) return { field: `member-${index}-interpretation`, id: "compare.interpretationGone", vars: { n: index + 1 } };
    } else {
      if (!member.source) return { field: `member-${index}-source`, id: "compare.chooseVersion", vars: { n: index + 1 } };
      if (!alignableSources(sources).some((source) => source.id === member.source)) return { field: `member-${index}-source`, id: "compare.notAWork", vars: { n: index + 1 } };
      const locators = member.absent ? [] : parseLocatorLines(member.locators);
      if (locators.length > MAX_PASSAGE_LOCATORS) return { field: `member-${index}-locators`, id: "atlas.tooManyPlaces", vars: { max: MAX_PASSAGE_LOCATORS } };
      const bad = locators.findIndex((locator) => !locator.kind || !locator.value);
      if (bad >= 0) return { field: `member-${index}-locators`, id: "notebook.badPlace", vars: { n: bad + 1 } };
      if (!member.absent && !member.passage && !textLines(member.locators).length) return { field: `member-${index}-locators`, id: "compare.sayWhere", vars: { n: index + 1 } };
      if (!member.absent && member.passage && !passages.some((passage) => passage.id === member.passage && passage.source === member.source)) return { field: `member-${index}-passage`, id: "atlas.passageOtherSource", vars: { n: index + 1 } };
    }
    if (codePoints(member.normalized) > MAX_ALIGNMENT_NORMALIZED_CHARS) return { field: `member-${index}-normalized`, id: "research.tooLong", vars: { max: MAX_ALIGNMENT_NORMALIZED_CHARS } };
    if (codePoints(member.note) > MAX_ATLAS_SHORT_CHARS) return { field: `member-${index}-note`, id: "research.tooLong", vars: { max: MAX_ATLAS_SHORT_CHARS } };
  }
  const versions = new Set(draft.members.map((member) => (member.type === "interpretation" ? `i:${member.interpretation}` : `s:${member.source}`)));
  const present = draft.members.some((member) => member.type === "interpretation" || !member.absent);
  if (versions.size < 2 || !present) return { field: "members", id: "compare.needTwo" };
  if (codePoints(draft.rationale) > MAX_ALIGNMENT_RATIONALE_CHARS) return { field: "rationale", id: "research.tooLong", vars: { max: MAX_ALIGNMENT_RATIONALE_CHARS } };
  if (codePoints(draft.uncertainty) > MAX_ATLAS_UNCERTAINTY_CHARS) return { field: "uncertainty", id: "research.tooLong", vars: { max: MAX_ATLAS_UNCERTAINTY_CHARS } };
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

/** The server's own sentences, for the details under For {helper}. */
export function alignmentErrorMessage(error) {
  const diagnostics = Array.isArray(error?.data?.diagnostics) ? error.data.diagnostics : [];
  if (!diagnostics.length) return String(error?.data?.error || error?.message || "");
  return diagnostics.map((item) => `${item.code ? `${item.code} ` : ""}${item.field ? `${item.field}: ` : ""}${item.message || ""}`).join(" ");
}

