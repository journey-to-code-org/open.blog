// The source library's rules (Studio R11, Sources): what each kind of source has, how a record
// becomes a form and goes back to the server, and what an import or export says. Pure, DOM-free.
// Lifted from the old Admin (the old Admin's admin.js "research source library", removed in R15) with
// two changes: people and identifiers are rows, not typed lines, and every sentence is a word id
// (`{ field, id, vars }`) for the screen to say. An untouched record goes back exactly as it came:
// unknown fields, structured name parts and the order of everything are kept.
import { say } from "./words.js";

export const SOURCE_KINDS = Object.freeze(["work", "edition", "translation", "witness", "reference"]);

/** A kind's name and help, in her words. */
export function sourceKindWords(kind) {
  switch (kind) {
    case "work": return { name: say("sources.kindWork"), plural: say("sources.kindWorks"), help: say("sources.kindWorkHelp") };
    case "edition": return { name: say("sources.kindEdition"), plural: say("sources.kindEditions"), help: say("sources.kindEditionHelp") };
    case "translation": return { name: say("sources.kindTranslation"), plural: say("sources.kindTranslations"), help: say("sources.kindTranslationHelp") };
    case "witness": return { name: say("sources.kindWitness"), plural: say("sources.kindWitnesses"), help: say("sources.kindWitnessHelp") };
    case "reference": return { name: say("sources.kindReference"), plural: say("sources.kindReferences"), help: say("sources.kindReferenceHelp") };
    default: return { name: String(kind || ""), plural: String(kind || ""), help: "" };
  }
}

const SOURCE_PARENT_KINDS = Object.freeze({
  edition: ["work", "translation"],
  translation: ["work"],
  witness: ["work", "edition", "translation"],
  reference: ["work", "edition", "translation", "witness"],
});
const SOURCE_BASED_ON_KINDS = Object.freeze(["edition", "witness", "translation"]);
export const SOURCE_CREATOR_ROLES = Object.freeze(["author", "editor", "translator", "compiler", "scribe", "other"]);
export const SOURCE_LOCATION_SCHEMES = Object.freeze(["page", "folio", "line", "section", "chapter", "canonical", "timestamp"]);
/** The kinds of identifier offered first; any other scheme a record has is kept as it is. */
export const IDENTIFIER_SCHEMES = Object.freeze(["doi", "isbn", "issn", "url"]);

/** A role's name, in her words; an unknown one as it is stored. */
export function roleWords(role) {
  switch (role) {
    case "author": return say("sources.roleAuthor");
    case "editor": return say("sources.roleEditor");
    case "translator": return say("sources.roleTranslator");
    case "compiler": return say("sources.roleCompiler");
    case "scribe": return say("sources.roleScribe");
    case "other": return say("sources.roleOther");
    case "": return say("sources.roleNone");
    default: return String(role);
  }
}

/** An identifier kind's name; an unknown scheme as it is stored. */
export function schemeWords(scheme) {
  switch (scheme) {
    case "doi": return "DOI";
    case "isbn": return "ISBN";
    case "issn": return "ISSN";
    case "url": return say("sources.idUrl");
    default: return String(scheme || say("sources.idOther"));
  }
}

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

/** A source's name: its title, else its kind and key. */
export function sourceLabel(source) {
  const title = String(source?.title || "").trim();
  if (title) return title;
  return say("sources.untitled", { kind: sourceKindWords(source?.kind).name || say("sources.kindSource"), key: String(source?.id || "") });
}

/**
 * Filter and search the library in memory. The query matches the key, title, creator names and
 * identifier values, ignoring case; the archive filter defaults to hiding archived records.
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

// ---- people and identifiers as rows

/** A record's creators as rows `{ name, role }`, in order; nothing is trimmed or changed. */
export function creatorRows(creators) {
  return (Array.isArray(creators) ? creators : [])
    .filter((creator) => creator && typeof creator === "object" && !Array.isArray(creator))
    .map((creator) => ({ name: String(creator.name ?? ""), role: typeof creator.role === "string" ? creator.role : "" }));
}

/** Rows back to creators to merge: a row with no name is left out; a row's role only when chosen. */
export function rowsToCreators(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row?.name ?? "").trim())
    .map((row) => (row.role ? { name: String(row.name), role: String(row.role) } : { name: String(row.name) }));
}

/** A record's identifiers as rows `{ scheme, value }`, in order. */
export function identifierRows(identifiers) {
  return (Array.isArray(identifiers) ? identifiers : [])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({ scheme: String(entry.scheme ?? ""), value: String(entry.value ?? "") }));
}

/** Rows back to identifiers: a row with no value is left out; the scheme as chosen, in lower case. */
export function rowsToIdentifiers(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row?.value ?? "").trim())
    .map((row) => ({ scheme: String(row.scheme ?? "").trim().toLowerCase(), value: String(row.value) }));
}

/** A key from a title: lowercase letters, numbers and dashes, at most 64, never one already taken. */
export function suggestKey(title, taken = []) {
  const used = new Set(Array.isArray(taken) ? taken : []);
  const base = String(title ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56).replace(/-+$/, "") || "source";
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const key = `${base}-${n}`;
    if (!used.has(key)) return key;
  }
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
    creators: creatorRows(source.creators),
    identifiers: identifierRows(source.identifiers),
    locationScheme: typeof source.location?.scheme === "string" ? source.location.scheme : "",
    locationValue: typeof source.location?.value === "string" ? source.location.value : "",
    locationVolume: typeof source.location?.volume === "string" ? source.location.volume : "",
  };
}

// An entry she did not change keeps its stored object, so fields this release does not
// understand survive a round trip through the rows.
function keepUnchanged(parsed, original, same) {
  return parsed.map((entry, index) => (Array.isArray(original) && original[index] && same(original[index], entry) ? original[index] : entry));
}

// CSL name parts describe the stored display name, so they no longer apply once it changes.
const SOURCE_CREATOR_NAME_PARTS = Object.freeze(["family", "given", "dropping-particle", "non-dropping-particle", "suffix"]);

/**
 * Creators from the rows, each built on the stored creator it edits: the one with the same name,
 * otherwise the one at the same position. A row edits only the name and role, so attribution,
 * note and unknown fields carry over; a role taken off is removed, and CSL name parts are dropped
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
 * The reference location from the form, built on the stored one so its volume and unknown fields
 * survive an edit; a volume she cleared is removed.
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
  // An untouched title or date goes back as it was stored, spaces and all.
  const same = (name, value) => typeof original[name] === "string" && String(value ?? "").trim() === original[name].trim();
  const put = (name, value) => { if (same(name, value)) record[name] = original[name]; else set(name, value); };
  put("title", draft.title);
  if (fields.of) put("of", draft.of);
  if (fields.basedOn) put("basedOn", draft.basedOn);
  put("language", draft.language);
  put("issued", draft.issued);
  const creators = mergeSourceCreators(rowsToCreators(draft.creators), original.creators);
  if (creators.length) record.creators = creators;
  const identifiers = keepUnchanged(rowsToIdentifiers(draft.identifiers), original.identifiers, (a, b) => a.scheme === b.scheme && a.value === b.value);
  if (identifiers.length) record.identifiers = identifiers;
  if (fields.location) {
    const location = mergeSourceLocation(draft, original.location);
    if (location) record.location = location;
  }
  // Keys in the order they were stored, then any new ones, so an unchanged record is the same JSON.
  const order = [...Object.keys(original).filter((key) => key in record), ...Object.keys(record).filter((key) => !(key in original))];
  return Object.fromEntries(order.map((key) => [key, record[key]]));
}

/** Whether a draft would send exactly the record it came from. */
export function sourceUnchanged(draft) {
  return Boolean(draft.original) && JSON.stringify(sourceDraftPayload(draft)) === JSON.stringify(draft.original);
}

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A quick check before sending, as `{ field, id, vars }` or null; the server stays authoritative. */
export function validateSourceDraft(draft, sources = []) {
  const id = String(draft.id || "").trim();
  if (!KEY.test(id) || id.length > 64) return { field: "id", id: "sources.badKey" };
  if (!draft.original && sources.some((source) => source.id === id)) return { field: "id", id: "sources.keyTaken" };
  const fields = sourceFieldsForKind(draft.kind);
  if (fields.titleRequired && !String(draft.title || "").trim()) return { field: "title", id: "sources.needTitle" };
  if (fields.of && !draft.of) return { field: "of", id: "sources.badOf" };
  if (fields.languageRequired && !String(draft.language || "").trim()) return { field: "language", id: "research.fill" };
  if (fields.location && Boolean(draft.locationScheme) !== Boolean(String(draft.locationValue || "").trim())) return { field: "locationValue", id: "research.fill" };
  if (fields.location && !draft.locationScheme && String(draft.locationVolume || "").trim()) return { field: "locationValue", id: "research.fill" };
  return null;
}

/** Map a server diagnostic's field path (`identifiers[0]`) to the form control that edits it. */
export function sourceDiagnosticControl(field) {
  if (String(field || "") === "location.volume") return "locationVolume";
  const name = String(field || "").replace(/\[\d+\].*$/, "").split(".")[0];
  return { creators: "creators", identifiers: "identifiers", location: "locationValue", id: "id", kind: "kind-field", title: "title", of: "of", basedOn: "basedOn", language: "language", issued: "issued" }[name] || "";
}

/** The row a diagnostic names (`identifiers[2]` → 2), or -1. */
export function diagnosticRow(field) {
  const match = /\[(\d+)\]/.exec(String(field || ""));
  return match ? Number(match[1]) : -1;
}

// ---- import and export

/** One line saying what an import preview would do, in her words. */
export function sourceImportSummary(plan) {
  const counts = plan?.counts || {};
  const parts = [[counts.create, "sources.importNew"], [counts.update, "sources.importUpdated"], [counts.unchanged, "sources.importSame"], [counts.conflict, "sources.importConflicts"]]
    .filter(([number]) => number > 0)
    .map(([number, id]) => {
      switch (id) {
        case "sources.importNew": return say("sources.importNew", { count: number });
        case "sources.importUpdated": return say("sources.importUpdated", { count: number });
        case "sources.importSame": return say("sources.importSame", { count: number });
        default: return say("sources.importConflicts", { count: number });
      }
    });
  return parts.length ? say("sources.importSummary", { parts: parts.join(", ") }) : say("sources.importNothing");
}

/** Preview rows by group: what happens to each item, what is kept, and what is not carried. */
/** One import problem in her words, by its code (lower case: it follows "Can't be imported:"). */
function importProblemWords(code) {
  switch (code) {
    case "missing-field": return say("sources.importWhyMissing");
    case "duplicate-id": return say("sources.importWhyTwice");
    case "kind-changed": return say("sources.importWhyKind");
    case "conflicting-attribution": return say("sources.importWhyWho");
    case "invalid-id": return say("sources.importWhyName");
    case "unknown-kind": return say("sources.importWhyUnknownKind");
    default: return say("sources.importWhyUnusable");
  }
}

export function sourceImportRows(plan) {
  return (Array.isArray(plan?.entries) ? plan.entries : []).map((entry) => {
    const details = [];
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) details.push(say("sources.importChanges", { field: String(change.field) }));
    if (Array.isArray(entry.kept) && entry.kept.length) details.push(say("sources.importKeeps", { fields: entry.kept.join(", ") }));
    for (const loss of Array.isArray(entry.unsupported) ? entry.unsupported : []) details.push(say("sources.importLoss", { field: String(loss.field), reason: String(loss.reason) }));
    // Her layer says what's wrong by the code; the server's own sentence goes to the helper.
    const diagnostics = Array.isArray(entry.diagnostics) ? entry.diagnostics : [];
    const problems = diagnostics.map((diagnostic) => say("sources.importProblem", { problem: importProblemWords(diagnostic.code) }));
    const problemDetails = diagnostics.map((d) => [d.code, d.field, d.message].filter(Boolean).join(": "));
    const id = entry.sourceId || "";
    // A key is shown as it is, so it never starts a sentence (where its first letter would be a capital).
    const name = id ? (entry.cslId && entry.cslId !== id ? `${id} (${say("sources.importFrom", { cslId: String(entry.cslId) })})` : id) : say("sources.importItem", { n: Number(entry.index) + 1 });
    return { action: entry.action, name, details, problems, problemDetails };
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

/** The rights statement of a version, as `{ status, label, note, license }`, or null when none. */
export function rightsOf(value) {
  return value && typeof value === "object" && typeof value.status === "string" ? value : null;
}

/** A rights status in her words. */
export function rightsWords(rights) {
  const value = rightsOf(rights);
  switch (value?.status) {
    case "rightsReserved": return say("rights.reserved");
    case "permission": return say("rights.permission");
    case "openLicense": return say("rights.openLicense");
    case "publicDomain": return say("rights.publicDomain");
    case "ownWork": return say("rights.ownWork");
    default: return say("rights.unknown");
  }
}

/** One line for a rights statement: her words for it, then the licence and note as stored. */
export function rightsText(rights) {
  const value = rightsOf(rights);
  const words = rightsWords(rights);
  return `${words}${value?.license ? ` (${value.license})` : ""}${value?.note ? `. ${value.note}` : ""}`;
}

/** Rights that ask once before their words go anywhere. */
export const RIGHTS_NEEDING_CONFIRMATION = Object.freeze(["unknown", "rightsReserved"]);
