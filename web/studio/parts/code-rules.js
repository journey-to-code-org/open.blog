// Code in a post (Studio R6, for the person who set up the site): a code block with its options,
// written exactly as POST pieces (G45) writes it and read back only when it would be written the
// same, and runnable code as the old Admin wrote it (`codeInteractionMarkdown`, lifted byte for
// byte). Pure, DOM-free.

/**
 * One code-runner language name, or null. The same rule as `web/components/ob-code-runner-language.js`
 * and `openblog_core::config::normalize_code_runner_language` (a test keeps them in step); copied
 * here because Studio loads nothing from outside its own folder.
 */
export function normalizeCodeRunnerLanguage(value) {
  const normalized = String(value || "")
    .replace(/^[\t-\r ]+|[\t-\r ]+$/g, "")
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  return /^[a-z][a-z0-9_+#.-]{0,31}$/.test(normalized) ? normalized : null;
}

const HIGHLIGHT = /^\d{1,6}(?:-\d{1,6})?(?:,\d{1,6}(?:-\d{1,6})?)*$/;

/**
 * A code block: `{ language, title, highlight, lineNumbers ("" | "on" | "off" | a number), runnable,
 * body }` as a fence one backtick longer than any run inside (no newline at the end).
 */
export function codeFenceMarkdown({ language = "", title = "", highlight = "", lineNumbers = "", runnable = false, body = "" }) {
  const lang = String(language).trim().toLowerCase();
  const name = String(title).trim();
  const lines = String(highlight).replace(/\s+/g, "");
  let info = !lang && (runnable || name || lines) ? "text" : lang;
  if (runnable) info += " runnable";
  if (name) info += ` title="${name}"`;
  if (lines) info += ` {${lines}}`;
  const numbers = String(lineNumbers).trim();
  if (numbers === "on") info += " showLineNumbers";
  else if (numbers === "off") info += " showLineNumbers=false";
  else if (/^\d+$/.test(numbers)) info += ` showLineNumbers=${Number(numbers)}`;
  const code = String(body).replace(/[\r\n]+$/, "");
  const longest = Math.max(2, ...(code.match(/`+/g) || []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${info.trim()}\n${code}\n${fence}`;
}

/** A code fence as the Code form holds it, or null when the form couldn't write it back exactly. */
export function parseCodeFence(source) {
  const text = String(source ?? "").replace(/\n+$/, "");
  const open = /^(`{3,})([^`\n]*)\n([\s\S]*)\n(`{3,})$/.exec(text);
  if (!open || open[4] !== open[1]) return null;
  const info = open[2];
  const words = info.match(/title="[^"]*"|\S+/g) || [];
  const values = { language: "", title: "", highlight: "", lineNumbers: "", runnable: false, body: open[3] };
  words.forEach((word, index) => {
    if (word === "runnable") values.runnable = true;
    else if (word.startsWith('title="')) values.title = word.slice(7, -1);
    else if (/^\{[\d,-]+\}$/.test(word)) values.highlight = word.slice(1, -1);
    else if (word === "showLineNumbers") values.lineNumbers = "on";
    else if (word === "showLineNumbers=false") values.lineNumbers = "off";
    else if (/^showLineNumbers=\d+$/.test(word)) values.lineNumbers = word.slice(16);
    else if (index === 0) values.language = word;
    else values.unknown = true;
  });
  if (values.unknown) return null;
  if (values.language === "text" && (values.runnable || values.title || values.highlight)) values.language = "";
  return codeFenceMarkdown(values) === text ? values : null;
}

/** What stops a code block going in: `[{ field, code }]` (codes match POST pieces). */
export function codeFenceProblems({ language = "", title = "", highlight = "", lineNumbers = "", body = "" }) {
  const problems = [];
  if (String(language).trim() && !normalizeCodeRunnerLanguage(language)) problems.push({ field: "language", code: "bad-choice" });
  if (/["']/.test(title)) problems.push({ field: "title", code: "bad-choice" });
  if (String(title).trim().length > 120) problems.push({ field: "title", code: "too-long", max: 120 });
  const lines = String(highlight).replace(/\s+/g, "");
  if (lines && !HIGHLIGHT.test(lines)) problems.push({ field: "highlight", code: "bad-lines" });
  if (!["", "on", "off"].includes(String(lineNumbers)) && !/^\d+$/.test(String(lineNumbers))) problems.push({ field: "lineNumbers", code: "bad-choice" });
  if (!String(body).trim()) problems.push({ field: "body", code: "required" });
  return problems;
}

/** Runnable code as the old Admin wrote it (ADR 0288): a label, what to try, the fence, then hint and explanation. */
export function codeInteractionMarkdown({ kind, language = "rust", title, instructions, code, expectedOutput = "", hint = "", explanation = "" }) {
  const escapeText = (value) => String(value || "").trim().replace(/([\\`*_[\]{}<>#+\-.!|])/g, "\\$1");
  const safeTitle = String(title || "").trim().replace(/["'\r\n]/g, "").slice(0, 120);
  const safeLanguage = normalizeCodeRunnerLanguage(language) || "rust";
  const label = kind === "challenge" ? "Coding challenge" : "Runnable example";
  const lines = [`**${label}: ${escapeText(title)}**`, "", escapeText(instructions)];
  if (kind === "challenge") lines.push("", `**Expected result:** ${escapeText(expectedOutput)}`);
  lines.push("", `\`\`\`${safeLanguage} runnable title="${safeTitle}"`, String(code || "").trim(), "```");
  if (hint.trim()) lines.push("", "> [!TIP]", ...hint.trim().split(/\r?\n/).map((line) => `> ${escapeText(line)}`));
  if (explanation.trim()) lines.push("", escapeText(explanation));
  return lines.join("\n");
}

/** The languages runnable code offers: rust, web, then the site's. */
export function runnableLanguages(meta) {
  return [...new Set(["rust", "web", ...(meta?.codeRunnerLanguages || [])].map(normalizeCodeRunnerLanguage).filter(Boolean))];
}

/**
 * What stops runnable code going in, as codes: `required` (title, what to try, code), `expected`
 * (a challenge without its result), `web-parts`, `todo` (a challenge's starter), `backticks`.
 */
export function codeInteractionProblems({ kind, language, title, instructions, code, expectedOutput = "", hint = "", explanation = "" }) {
  const problems = [];
  if (![title, instructions, code].every((value) => String(value || "").trim())) problems.push({ field: ["title", "instructions", "code"].find((name, index) => !String([title, instructions, code][index] || "").trim()), code: "required" });
  if (kind === "challenge" && !String(expectedOutput).trim()) problems.push({ field: "expectedOutput", code: "expected" });
  if ([title, instructions, code, expectedOutput, hint, explanation].some((value) => String(value || "").includes("```"))) problems.push({ field: "code", code: "backticks" });
  if (language === "web" && (!/^\s*---(?:html|css|js)\s*$/m.test(code) || !String(code).split(/^\s*---(?:html|css|js)\s*$/m).some((section) => section.trim()))) problems.push({ field: "code", code: "web-parts" });
  if (kind === "challenge" && !/^\s*(?:\/\/|#|--|;|\/\*|<!--).*\bTODO\b/im.test(code)) problems.push({ field: "code", code: "todo" });
  return problems;
}
