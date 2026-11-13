// A recipe body as Studio's boxes: the story, the ingredient rows, the step rows, the notes, and
// every other part kept byte for byte. It reads the shape the site already understands (the
// engine's `recipe::classify_heading` and `markdown.rs` recipe sections) and only accepts bodies it
// can write back exactly; anything else falls back to the plain Words box with a reason. DOM-free.

/** The headings the engine treats as ingredients, from `recipe.rs` `classify_heading`. */
const INGREDIENT_WORDS = [
  "ingredient", "ingrédient", "ingrediente", "ingredienti", "ingrediënten", "zutaten",
  "what you need", "you will need", "you'll need",
];
/** The headings the engine treats as steps. */
const STEP_WORDS = [
  "step", "method", "instruction", "direction", "preparation", "how to make", "étapes",
  "préparation", "instrucciones", "preparación", "pasos", "elaboración", "procedimiento",
  "procedimento", "preparazione", "zubereitung", "anleitung", "bereiding",
];
const ALNUM = /^[\p{L}\p{N}]/u;

/**
 * What a heading's text introduces, as the engine decides it: "ingredients", "steps" or null.
 * Whole words only: "Steps" and "Method:" count, "Stephanie's story" and "Methodology" do not.
 * @param {string} text the heading's text, without the #s
 * @returns {"ingredients"|"steps"|null}
 */
export function classifyHeading(text) {
  const t = String(text ?? "").trim().replace(/:+$/, "").trim().toLowerCase().replace(/’/g, "'");
  const matches = (word) => {
    if (!t.startsWith(word)) return false;
    let rest = t.slice(word.length);
    for (const suffix of ["es", "s", "en", "i"]) {
      if (rest.startsWith(suffix)) {
        const after = rest.slice(suffix.length);
        if (!ALNUM.test(after)) rest = after;
        break;
      }
    }
    return !ALNUM.test(rest);
  };
  if (INGREDIENT_WORDS.some(matches)) return "ingredients";
  if (STEP_WORDS.some(matches)) return "steps";
  return null;
}

/** A heading's words as the engine reads them: text and code, without emphasis or link targets. */
function headingWords(raw) {
  return raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1");
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const BLANK = /^[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const HTML_RAW = /^ {0,3}<(pre|script|style|textarea)(?:[\s>]|$)/i;
const HTML_BLOCK = /^ {0,3}<\/?(address|article|aside|blockquote|body|caption|center|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)(?:[\s/>]|$)/i;
const HTML_ANY = /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?\/?>[ \t]*$/;
const LIST_START = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

/**
 * Every line's role for finding sections: headings outside code fences, comments and HTML
 * blocks, and setext headings (which the boxes don't handle).
 */
function scanLines(lines) {
  const out = [];
  let fence = null;
  let html = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      out.push({ kind: "code" });
      continue;
    }
    if (html) {
      if (html === "blank" ? BLANK.test(line) : line.toLowerCase().includes(html)) html = null;
      out.push({ kind: html === null && BLANK.test(line) ? "blank" : "html" });
      continue;
    }
    if (BLANK.test(line)) { out.push({ kind: "blank" }); continue; }
    const open = line.match(FENCE);
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      fence = open[1];
      out.push({ kind: "code" });
      continue;
    }
    if (/^ {0,3}<!--/.test(line)) {
      if (!line.includes("-->", line.indexOf("<!--") + 4)) html = "-->";
      out.push({ kind: "html" });
      continue;
    }
    const raw = line.match(HTML_RAW);
    if (raw) {
      if (!line.toLowerCase().includes(`</${raw[1].toLowerCase()}>`)) html = `</${raw[1].toLowerCase()}>`;
      out.push({ kind: "html" });
      continue;
    }
    const previous = out[i - 1];
    const afterBlank = !previous || previous.kind === "blank";
    if (HTML_BLOCK.test(line) || (afterBlank && HTML_ANY.test(line))) {
      html = "blank";
      out.push({ kind: "html" });
      continue;
    }
    const atx = line.match(ATX);
    if (atx) {
      const text = headingWords(atx[2] ?? "");
      out.push({ kind: "heading", level: atx[1].length, text: (atx[2] ?? "").trim(), section: classifyHeading(text) });
      continue;
    }
    if (SETEXT.test(line) && previous?.kind === "text" && !previous.list) {
      previous.kind = "setext";
      out.push({ kind: "setext" });
      continue;
    }
    out.push({ kind: "text", list: LIST_START.test(line) });
  }
  return out;
}

const fail = (reason, line) => ({ ok: false, reason, line });

/** The first and last non-blank line in [from, to), or null when all are blank. */
function trimRange(lines, from, to) {
  let start = from;
  let end = to - 1;
  while (start <= end && BLANK.test(lines[start])) start += 1;
  while (end >= start && BLANK.test(lines[end])) end -= 1;
  return start <= end ? [start, end] : null;
}

/**
 * The rows of an ingredients or steps list, from its lines [start, end] (non-blank at both ends).
 * Only a tight list in the site's own shape is accepted: "- " rows, or "1. 2. 3." rows whose
 * wrapped lines line up under the text.
 */
function readList(lines, start, end, kind) {
  const items = [];
  const one = kind === "ingredients" ? "ingredient" : "step";
  let width = 0;
  for (let i = start; i <= end; i += 1) {
    const line = lines[i];
    const n = i + 1;
    if (BLANK.test(line)) {
      const next = lines.slice(i + 1, end + 1).findIndex((l) => !BLANK.test(l)) + i + 1;
      const nextLine = lines[next];
      if (kind === "ingredients" ? /^- /.test(nextLine) : /^\d{1,9}[.)] /.test(nextLine)) {
        return fail(`The ${kind} have an empty line between them (line ${n}), so Studio can't keep them as rows.`, n);
      }
      if (/^[ \t]+\S/.test(nextLine) && items.length) {
        return fail(`${one === "step" ? "Step" : "Ingredient"} ${items.length} has more than one paragraph (line ${next + 1}).`, next + 1);
      }
      return fail(`There are words under ${kind === "ingredients" ? "Ingredients" : "Steps"} that aren't in the list (line ${next + 1}).`, next + 1);
    }
    if (kind === "ingredients") {
      const item = line.match(/^-(?:[ \t](.*))?$/);
      if (item) {
        if (!item[1]?.trim()) return fail(`Ingredient ${items.length + 1} is empty (line ${n}).`, n);
        if (/^\s/.test(item[1]) || line[1] === "\t") return fail(`Ingredient ${items.length + 1} has extra spaces after the dash (line ${n}).`, n);
        items.push(item[1]);
        continue;
      }
    } else {
      const item = line.match(/^(\d{1,9})\.(?:[ \t](.*))?$/);
      if (item) {
        const number = Number(item[1]);
        if (number !== items.length + 1 || item[1] !== String(number)) {
          return fail(`The steps aren't numbered 1, 2, 3 in order (line ${n} says ${item[1]}).`, n);
        }
        if (!item[2]?.trim()) return fail(`Step ${number} is empty (line ${n}).`, n);
        if (/^\s/.test(item[2]) || line[item[1].length + 1] === "\t") return fail(`Step ${number} has extra spaces after its number (line ${n}).`, n);
        items.push(item[2]);
        width = item[1].length + 2;
        continue;
      }
    }
    // A line lined up under a step's text belongs to that step.
    if (kind === "steps" && items.length && line.startsWith(" ".repeat(width))) {
      const rest = line.slice(width);
      if (/^[ \t]/.test(rest)) return fail(`Step ${items.length} goes onto a line that doesn't line up under it (line ${n}).`, n);
      if (/^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)|^#|^>|^`{3}|^~{3}/.test(rest)) {
        return fail(`Step ${items.length} has a list, heading, quote or code inside it (line ${n}).`, n);
      }
      items[items.length - 1] += `\n${rest}`;
      continue;
    }
    // Not a row of its own: say why.
    if (/^ {0,3}[*+][ \t]/.test(line)) {
      return fail(`The ${kind} use * or + for bullets (line ${n}). Studio writes them with a dash.`, n);
    }
    if (/^ {0,3}\d{1,9}\)/.test(line)) return fail(`The ${kind} are numbered like 1) (line ${n}). Studio writes 1. instead.`, n);
    if (kind === "ingredients" && /^ {0,3}\d{1,9}\.[ \t]/.test(line)) return fail(`The ingredients are a numbered list (line ${n}).`, n);
    if (kind === "steps" && /^ {0,3}-[ \t]/.test(line)) return fail(`The steps are a bulleted list, not a numbered one (line ${n}).`, n);
    if (/^ {1,3}(?:-|\d{1,9}\.)[ \t]/.test(line)) return fail(`A ${one} on line ${n} starts with spaces before its ${kind === "ingredients" ? "dash" : "number"}.`, n);
    if (!items.length) return fail(`There are words under ${kind === "ingredients" ? "Ingredients" : "Steps"} that aren't in the list (line ${n}).`, n);
    if (kind === "ingredients") return fail(`Ingredient ${items.length} runs onto a second line (line ${n}).`, n);
    return fail(`Step ${items.length} goes onto a line that doesn't line up under it (line ${n}).`, n);
  }
  return { ok: true, items };
}

const joinRange = (lines, start, end) => lines.slice(start, end + 1).join("\n");

/**
 * Read a body into Studio's recipe boxes.
 *
 * Accepted: the story (everything before the first recipe heading), one `## Ingredients` heading
 * (any wording the engine classifies as ingredients) with a tight "- " list, one `## Steps`
 * heading (or Method, Directions, …) with a tight "1. 2. 3." list, an optional notes section (the
 * first `##` heading after them whose text contains "note"), and any other sections after
 * Ingredients, kept as written. A body with no recipe heading is all story.
 *
 * Anything that can't be written back exactly gives `{ ok: false, reason, line }`: a plain
 * sentence and the 1-based line of the body it is about. Never guesses.
 *
 * `others[i].text` is the whole part as written, its heading line included. `order` and `layout`
 * record where each part sits and the blank lines between them, for `writeRecipeBody`.
 *
 * @param {string} body
 * @returns {{ ok: true, story: string, ingredients: string[], steps: string[],
 *   notes: { heading: string, text: string } | null,
 *   others: { heading: string, text: string, line: number }[], order: string[], layout: object }
 *   | { ok: false, reason: string, line: number }}
 */
export function parseRecipeBody(body) {
  const source = String(body ?? "");
  const crlf = source.includes("\r\n");
  if (crlf && /(^|[^\r])\n/.test(source)) {
    const at = source.split("\n").findIndex((line, i, all) => i < all.length - 1 && !line.endsWith("\r"));
    return fail(`The lines end in two different ways (line ${at + 1}), so Studio can't keep the file exactly.`, at + 1);
  }
  const text = crlf ? source.replace(/\r\n/g, "\n") : source;
  const lines = text.split("\n");
  const roles = scanLines(lines);

  const headings = [];
  for (let i = 0; i < roles.length; i += 1) {
    if (roles[i].kind === "heading") headings.push({ ...roles[i], index: i });
  }
  const first = headings.find((h) => h.section);
  const firstAt = first ? first.index : lines.length;

  // The story may hold its own # and ## headings, but nothing the boxes would move or hide.
  for (let i = 0; i < firstAt; i += 1) {
    const role = roles[i];
    if (role.kind === "heading" && role.level >= 3) {
      return fail(`Your story has a small heading (line ${i + 1}). Studio's story box can't keep it in place.`, i + 1);
    }
    // An underlined heading the engine reads as a recipe part (i is its words, i + 1 the line under).
    if (role.kind === "setext" && roles[i + 1]?.kind === "setext" && classifyHeading(headingWords(lines[i]))) {
      return fail(`The heading on line ${i + 1} is underlined with --- or ===, so Studio can't find the recipe.`, i + 1);
    }
  }

  const layout = { eol: crlf ? "\r\n" : "\n", head: "", tail: null, seps: {}, headings: {} };
  const parsed = { ok: true, story: "", ingredients: [], steps: [], notes: null, others: [], order: [], layout };
  const chunks = [];
  const story = trimRange(lines, 0, firstAt);
  if (story) {
    parsed.story = joinRange(lines, story[0], story[1]);
    parsed.order.push("story");
    chunks.push({ id: "story", start: story[0], end: story[1] });
  }

  if (first) {
    if (first.level !== 2) {
      return fail(`The ${first.text} heading (line ${first.index + 1}) isn't a ## heading, so Studio can't use the recipe boxes.`, first.index + 1);
    }
    if (first.section === "steps") {
      return fail(`Steps come before Ingredients (line ${first.index + 1}). Studio puts Ingredients first.`, first.index + 1);
    }
    // The parts: each ## (or #) heading from the first recipe heading on, to the next one.
    const tops = headings.filter((h) => h.index >= first.index && h.level <= 2);
    for (let i = firstAt; i < roles.length; i += 1) {
      if (roles[i].kind === "setext") {
        const at = roles[i - 1]?.kind === "setext" ? i - 1 : i;
        return fail(`The heading on line ${at + 1} is underlined with --- or ===. Studio can't keep it in place.`, at + 1);
      }
    }
    const hasSteps = tops.some((h) => h.section === "steps");
    const seen = {};
    let notesTaken = false;
    let recipeDone = false;
    for (let t = 0; t < tops.length; t += 1) {
      const heading = tops[t];
      const until = t + 1 < tops.length ? tops[t + 1].index : lines.length;
      const inner = headings.filter((h) => h.index > heading.index && h.index < until);
      const content = trimRange(lines, heading.index + 1, until);
      const at = heading.index + 1;
      if (heading.section) {
        const kind = heading.section;
        const name = kind === "ingredients" ? "Ingredients" : "Steps";
        if (seen[kind] !== undefined) {
          return fail(`${name} appears twice (lines ${seen[kind]} and ${at}).`, at);
        }
        if (heading.level !== 2) return fail(`The ${heading.text} heading (line ${at}) isn't a ## heading.`, at);
        if (kind === "steps" && seen.ingredients === undefined) {
          return fail(`Steps come before Ingredients (line ${at}). Studio puts Ingredients first.`, at);
        }
        if (inner.length) {
          const sub = inner[0].index + 1;
          return kind === "ingredients"
            ? fail(`The ingredients are split into groups (line ${sub}). Studio keeps groups as written, so this recipe opens in one box.`, sub)
            : fail(`The steps have a heading inside them (line ${sub}).`, sub);
        }
        seen[kind] = at;
        parsed.order.push(kind);
        layout.headings[kind] = lines[heading.index];
        chunks.push({ id: kind, start: heading.index, end: heading.index });
        if (content) {
          const list = readList(lines, content[0], content[1], kind);
          if (!list.ok) return list;
          parsed[kind] = list.items;
          chunks.push({ id: `${kind}-list`, start: content[0], end: content[1] });
        }
        continue;
      }
      // A recipe heading tucked inside another part would start a recipe section of its own.
      const hidden = inner.find((h) => h.section);
      if (hidden) {
        const kind = hidden.section === "ingredients" ? "Ingredients" : "Steps";
        const was = seen[hidden.section];
        return was !== undefined
          ? fail(`${kind} appears twice (lines ${was} and ${hidden.index + 1}).`, hidden.index + 1)
          : fail(`The ${hidden.text} heading (line ${hidden.index + 1}) is inside another part of the post.`, hidden.index + 1);
      }
      if (seen.steps !== undefined || !hasSteps) recipeDone = true;
      if (!notesTaken && recipeDone && heading.level === 2 && /note/i.test(heading.text)) {
        notesTaken = true;
        parsed.notes = { heading: heading.text, text: content ? joinRange(lines, content[0], content[1]) : "" };
        parsed.order.push("notes");
        layout.headings.notes = { line: lines[heading.index], text: heading.text };
        chunks.push({ id: "notes", start: heading.index, end: heading.index });
        if (content) chunks.push({ id: "notes-text", start: content[0], end: content[1] });
        continue;
      }
      const index = parsed.others.length;
      const end = content ? content[1] : heading.index;
      parsed.others.push({ heading: heading.text, text: joinRange(lines, heading.index, end), line: at });
      parsed.order.push(`other:${index}`);
      chunks.push({ id: `other:${index}`, start: heading.index, end });
    }
  }

  // The blank lines around and between the parts.
  if (chunks.length) {
    layout.head = lines.slice(0, chunks[0].start).map((l) => `${l}\n`).join("");
    const last = chunks[chunks.length - 1].end;
    layout.tail = last === lines.length - 1 ? "" : `\n${lines.slice(last + 1).join("\n")}`;
    for (let c = 1; c < chunks.length; c += 1) {
      const a = chunks[c - 1];
      const b = chunks[c];
      layout.seps[`${a.id}|${b.id}`] = `\n${lines.slice(a.end + 1, b.start).map((l) => `${l}\n`).join("")}`;
    }
  } else {
    layout.blank = text;
  }

  // The last word: what Studio would write must be exactly what is there.
  const again = writeRecipeBody(parsed);
  if (again !== source) {
    let i = 0;
    while (i < again.length && again[i] === source[i]) i += 1;
    const line = source.slice(0, i).split("\n").length;
    return fail(`Studio couldn't write this recipe back exactly as it is (line ${line}).`, line);
  }
  return parsed;
}

const stripBlankEnds = (value) => String(value ?? "").replace(/\r\n?/g, "\n").replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, "");

/** An ingredient row as one line, or "" when it says nothing. */
function ingredientLine(row) {
  const text = String(row ?? "").replace(/\r\n?/g, "\n");
  if (!text.trim()) return "";
  return text.replace(/^\s+/, "").replace(/[ \t]*\n\s*/g, " ");
}

/** A step's lines with the wrapped ones indented under the text, or "" when it says nothing. */
function stepLines(row, number) {
  const text = stripBlankEnds(row).replace(/^\s+/, "");
  if (!text.trim()) return "";
  const indent = " ".repeat(String(number).length + 2);
  const [firstLine, ...rest] = text.split("\n").filter((line) => !BLANK.test(line));
  return [`${number}. ${firstLine}`, ...rest.map((line) => `${indent}${line.trimStart()}`)].join("\n");
}

/**
 * Write the boxes back as a body. For a parsed body that nobody changed, this is exactly the body
 * that was read. Empty ingredient and step rows are dropped, steps are numbered 1. to n., and
 * every part Studio doesn't edit is written as it came, with the blank lines it had.
 *
 * Without `order` (a new recipe) it writes the story, `## Ingredients`, `## Steps` and, when it
 * has words, the notes under their own heading ("Notes" when none is given); empty parts are left
 * out except the Ingredients and Steps headings. A body that was all story gets those parts after
 * the story once a row or a note is filled in.
 *
 * @param {{ story?: string, ingredients?: string[], steps?: string[],
 *   notes?: { heading?: string, text?: string } | null, others?: { text: string }[],
 *   order?: string[], layout?: object }} parsed
 * @returns {string}
 */
export function writeRecipeBody(parsed) {
  const layout = parsed?.layout || {};
  const eol = layout.eol || "\n";
  const headings = layout.headings || {};
  const ingredients = (parsed?.ingredients || []).map(ingredientLine).filter(Boolean);
  const steps = (parsed?.steps || []).filter((row) => String(row ?? "").trim()).map((row, i) => stepLines(row, i + 1));
  const notesRaw = parsed?.notes ? stripBlankEnds(parsed.notes.text) : "";
  const notesText = notesRaw.trim() ? notesRaw : "";
  const notesHeading = String(parsed?.notes?.heading ?? "").trim() || "Notes";

  let order = Array.isArray(parsed?.order) ? [...parsed.order] : null;
  if (!order) {
    order = ["story", "ingredients", "steps"];
    if (notesText) order.push("notes");
  } else if (!order.includes("ingredients")) {
    if (ingredients.length || steps.length || notesText) {
      const at = order.includes("story") ? order.indexOf("story") + 1 : 0;
      order.splice(at, 0, "ingredients", "steps", ...(notesText ? ["notes"] : []));
    }
  } else {
    if (!order.includes("steps") && steps.length) order.splice(order.indexOf("ingredients") + 1, 0, "steps");
    if (!order.includes("notes") && notesText) {
      const after = order.includes("steps") ? "steps" : "ingredients";
      order.splice(order.indexOf(after) + 1, 0, "notes");
    }
  }
  if (!order.includes("story")) order.unshift("story");

  const chunks = [];
  const add = (id, text) => chunks.push({ id, text });
  for (const part of order) {
    if (part === "story") {
      const story = stripBlankEnds(parsed?.story);
      if (story) add("story", story);
    } else if (part === "ingredients") {
      add("ingredients", headings.ingredients ?? "## Ingredients");
      if (ingredients.length) add("ingredients-list", ingredients.map((line) => `- ${line}`).join("\n"));
    } else if (part === "steps") {
      add("steps", headings.steps ?? "## Steps");
      if (steps.length) add("steps-list", steps.join("\n"));
    } else if (part === "notes") {
      if (!parsed?.notes) continue;
      const kept = headings.notes && headings.notes.text === String(parsed?.notes?.heading ?? "");
      add("notes", kept ? headings.notes.line : `## ${notesHeading}`);
      if (notesText) add("notes-text", notesText);
    } else if (part.startsWith("other:")) {
      const other = parsed?.others?.[Number(part.slice(6))];
      if (other && String(other.text ?? "").trim()) add(part, String(other.text).replace(/\r\n?/g, "\n"));
    }
  }

  let out;
  if (!chunks.length) {
    out = layout.blank ?? "";
  } else {
    out = layout.head ?? "";
    chunks.forEach((chunk, i) => {
      if (i > 0) out += layout.seps?.[`${chunks[i - 1].id}|${chunk.id}`] ?? "\n\n";
      out += chunk.text;
    });
    out += layout.tail ?? "\n";
  }
  return eol === "\n" ? out : out.replace(/\n/g, eol);
}

/**
 * Pasted lines as rows: one row per non-empty line, trimmed. Ingredients lose a leading "- ";
 * steps lose a leading "1. " only when a space follows the dot, so "1.5 cups" stays.
 * @param {string} text
 * @param {"ingredients"|"steps"} kind
 * @returns {string[]}
 */
export function splitPasted(text, kind) {
  const marker = kind === "steps" ? /^\d+\. +/ : /^- +/;
  return String(text ?? "")
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim().replace(marker, "").trim())
    .filter(Boolean);
}
