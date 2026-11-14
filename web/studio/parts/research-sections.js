// A research post's Abstract and References headings (Studio R6), lifted from the old Admin's
// `insertResearchSection` and `researchSectionIsPresent`, plus a check by heading line for when
// there's no signal to ask the server. Pure, DOM-free.

export function researchSectionIsPresent(findings, research, section) {
  if (!research) return null;
  const missingCode = section === "abstract" ? "abstract-missing" : section === "references" ? "references-missing" : null;
  if (!missingCode) return null;
  return !(Array.isArray(findings) ? findings : []).some((finding) => finding?.code === missingCode);
}

export function insertResearchSection(value, section, alreadyPresent = false) {
  const title = section === "abstract" ? "Abstract" : section === "references" ? "References" : "";
  if (!title) return { value, start: value.length, end: value.length, inserted: false };
  if (alreadyPresent) return { value, start: value.length, end: value.length, inserted: false };
  const separator = value.length === 0 ? "" : value.endsWith("\n\n") ? "" : value.endsWith("\n") ? "\n" : "\n\n";
  const next = `${value}${separator}## ${title}\n\n`;
  return { value: next, start: next.length, end: next.length, inserted: true };
}

/**
 * The Abstract goes at the start of the post (References at the end, as `insertResearchSection`).
 * The caret goes on the empty line under the heading.
 */
export function insertAbstract(value, alreadyPresent = false) {
  if (alreadyPresent) return { value, start: 0, end: 0, inserted: false };
  const text = String(value ?? "");
  const lead = /^\s*/.exec(text)[0];
  const rest = text.slice(lead.length);
  const head = `${lead}## Abstract\n\n`;
  const next = rest ? `${head}\n\n${rest}` : head;
  return { value: next, start: head.length, end: head.length, inserted: true };
}

/** With no signal: is there a `## Abstract` / `## References` heading line (outside code)? */
export function sectionHeadingIn(text, section) {
  const title = section === "abstract" ? "abstract" : "references";
  let fence = null;
  for (const line of String(text ?? "").split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) { if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null; continue; }
    if (marker) { fence = marker; continue; }
    if (new RegExp(`^ {0,3}#{1,6}[ \\t]+${title}[ \\t#]*$`, "i").test(line.trim())) return true;
  }
  return false;
}
