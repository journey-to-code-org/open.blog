// Moved from web/admin/capture-assistant.js (ADRs 0302 and 0304) for the old Admin's retirement: the
// pure half only. A transcript or a written-up job is untrusted text, so it is made plain before it
// reaches her words; a write-up is bounded and fills the job's four parts. Studio R4
// (docs/specs/studio/r4/ux.md).

/**
 * A transcript made safe to sit in her words, which become the post's Markdown. `<` becomes an entity,
 * so no tag can form; a line that starts a heading, quote, list, rule or fence is escaped, and a
 * bracket cannot open a link or image. It still reads as the words that were spoken.
 */
export function plainNotes(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/&(?=#?\w+;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\[/g, "\\[")
    .split("\n")
    .map((line) => line.replace(/^(\s*)([#>`~|]|[-+*](?=\s)|\d+[.)](?=\s)|={3,}|-{3,}|\*{3,}|_{3,})/, "$1\\$2"))
    .join("\n")
    .trim();
}

/** The words after a transcript is added under what she already typed, cut to the bound. */
export function appendTranscript(notes, transcript, maxChars) {
  const typed = String(notes ?? "").replace(/\s+$/, "");
  const added = plainNotes(transcript);
  const joined = typed ? `${typed}\n\n${added}` : added;
  if (joined.length <= maxChars) return { notes: joined, clipped: false };
  return { notes: joined.slice(0, maxChars).replace(/\s+$/, ""), clipped: true };
}

/** The bounds of a write-up, the same as the core's `job_draft` module enforces on the server. */
export const DRAFT_LIMITS = Object.freeze({ title: 120, description: 300, section: 1500 });
export const SECTION_KEYS = Object.freeze(["problem", "found", "did", "result"]);
export const SECTION_LABELS = Object.freeze({ problem: "Problem", found: "What we found", did: "What we did", result: "Result" });

const oneLine = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const block = (value, max) => String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);

/**
 * A write-up read defensively: from the server or from a stored record. Text is clipped to its
 * bound, never trusted to be shorter. One with no title and no words is nothing (`null`).
 */
export function normalizeDraft(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = oneLine(raw.title, DRAFT_LIMITS.title);
  const description = oneLine(raw.description, DRAFT_LIMITS.description);
  const sections = {};
  for (const key of SECTION_KEYS) sections[key] = block(raw.sections?.[key], DRAFT_LIMITS.section);
  if (!title && SECTION_KEYS.every((key) => !sections[key])) return null;
  return { title, description, sections };
}

/** The body a write-up makes: its sections under the scaffold's own headings (or the standard four). */
export function draftBody({ scaffold = "", sections }) {
  const found = String(scaffold).match(/^## .*$/gm) || [];
  const headings = SECTION_KEYS.map((key, index) => found[index] || `## ${SECTION_LABELS[key]}`);
  return headings.map((heading, index) => `${heading}\n\n${sections[SECTION_KEYS[index]] ? `${sections[SECTION_KEYS[index]]}\n\n` : ""}`).join("");
}
