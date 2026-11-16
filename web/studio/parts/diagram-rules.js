// A diagram in her words (#566, #646): a ` ```mermaid ` fence whose info carries its title,
// description and the words under it (`title="…" description="…" caption="…"`), and the lines of
// the diagram between the fences. Pure: what the form writes, what it reads back from a card, and
// what is wrong, by field. The server draws it with the build's own renderer (POST diagram/preview).

/** The most the lines of a diagram may be, in bytes (the build's limit). */
export const DIAGRAM_MAX_SOURCE_BYTES = 16 * 1024;
/** The most a title, description or the words under it may be, in bytes (the build's limit). */
export const DIAGRAM_MAX_OPTION_BYTES = 1024;

const OPTIONS = ["title", "description", "caption"];
const bytes = (text) => new TextEncoder().encode(text).length;

/**
 * What is wrong with these values, as `{ field, code, max? }` problems (none when it can be written).
 * `values` is `{ source, title, description, caption }`.
 */
export function diagramProblems(values = {}) {
  const problems = [];
  const source = String(values.source ?? "");
  if (!source.trim()) problems.push({ field: "source", code: "required" });
  else if (bytes(source) > DIAGRAM_MAX_SOURCE_BYTES) problems.push({ field: "source", code: "too-long", max: DIAGRAM_MAX_SOURCE_BYTES });
  for (const name of OPTIONS) {
    const value = String(values[name] ?? "").trim();
    if (!value) {
      // The build needs a title and a description for people who can't see the drawing; the words
      // under it are optional. A title or description written in the diagram itself counts too.
      if (name !== "caption" && !inSource(source, name)) problems.push({ field: name, code: name === "title" ? "diagram-title" : "diagram-describe" });
      continue;
    }
    if (/[\r\n\u0000-\u001f]/.test(value)) problems.push({ field: name, code: "one-line" });
    else if (bytes(value) > DIAGRAM_MAX_OPTION_BYTES) problems.push({ field: name, code: "too-long", max: DIAGRAM_MAX_OPTION_BYTES });
    else if (value.includes('"') && value.includes("'")) problems.push({ field: name, code: "diagram-quotes" });
  }
  return problems;
}

/** Whether the diagram's own lines give its title (`accTitle:`) or description (`accDescr`). */
function inSource(source, name) {
  return name === "title" ? /^\s*accTitle\s*:/m.test(source) : /^\s*accDescr\s*[:{]/m.test(source);
}

/** The fence's info string for these values: `mermaid title="…" description="…"`. */
export function diagramInfo(values = {}) {
  const options = [];
  for (const name of OPTIONS) {
    const value = String(values[name] ?? "").trim();
    if (!value) continue;
    const quote = value.includes('"') ? "'" : '"';
    options.push(`${name}=${quote}${value}${quote}`);
  }
  return ["mermaid", ...options].join(" ");
}

/** The Markdown for these values (check `diagramProblems` first): a fence longer than any run of backticks inside. */
export function diagramMarkdown(values = {}) {
  const source = String(values.source ?? "").replace(/\r\n?/g, "\n").replace(/\n*$/, "");
  const longest = Math.max(2, ...Array.from(source.matchAll(/`+/g), (match) => match[0].length));
  const marker = "`".repeat(longest + 1);
  return `${marker}${diagramInfo(values)}\n${source}\n${marker}`;
}

/**
 * A diagram card's values, or null when it isn't one this form can write back exactly (another
 * option, an unquoted value, a tilde fence): then the card keeps its words as written.
 */
export function parseDiagramFence(markdown) {
  const text = String(markdown ?? "").replace(/\n+$/, "");
  const lines = text.split("\n");
  const open = /^(`{3,})mermaid((?:[ \t].*)?)$/.exec(lines[0] || "");
  if (!open || lines.length < 2 || lines[lines.length - 1] !== open[1]) return null;
  const values = { source: lines.slice(1, -1).join("\n"), title: "", description: "", caption: "" };
  let rest = open[2].trim();
  while (rest) {
    const option = /^(title|description|caption)=(["'])(.*?)\2(?:\s+|$)/.exec(rest);
    if (!option || values[option[1]]) return null;
    values[option[1]] = option[3];
    rest = rest.slice(option[0].length);
  }
  return diagramMarkdown(values) === text ? values : null;
}

/** A diagram card's first line: its title, or the first line of the diagram. */
export function diagramTitle(markdown) {
  const parsed = parseDiagramFence(markdown);
  if (parsed?.title) return parsed.title;
  const source = parsed?.source ?? String(markdown ?? "").split("\n").slice(1, -1).join("\n");
  return /^\s*accTitle\s*:\s*(.+)$/m.exec(source)?.[1]?.trim() || source.split("\n").find((line) => line.trim())?.trim() || "";
}
