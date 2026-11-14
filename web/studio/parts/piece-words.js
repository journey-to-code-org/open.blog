// What a card in her words says (Studio R6): its name, its kind, the few lines it shows, and the
// words every add, change, move and take-out ends with. Pure, DOM-free; the card itself is drawn by
// piece-cards.js. Every sentence is a word id a site may change (docs/studio-words.md).
import { parseCallout, parsePieceFence, parseTable, parseTaskList, parseEmbed, tableCells } from "./block-forms.js";
import { parseQuiz } from "./quiz-rules.js";
import { parseCodeFence } from "./code-rules.js";
import { imageMarkdown } from "./image-markdown.js";
import { say } from "./words.js";

/** @type {Record<string, { text: string, layer: "her" | "details", max?: number, bare?: string }>} */
export const WORDS = {
  // the names of things, as statuses use them ("Tip added.")
  "thing.photo": { text: "Photo", layer: "her" },
  "thing.tip": { text: "Tip", layer: "her" },
  "thing.note": { text: "Note", layer: "her" },
  "thing.watchOut": { text: "Watch out", layer: "her" },
  "thing.important": { text: "Important", layer: "her" },
  "thing.caution": { text: "Caution", layer: "her" },
  "thing.checklist": { text: "Checklist", layer: "her" },
  "thing.table": { text: "Table", layer: "her" },
  "thing.video": { text: "Video", layer: "her" },
  "thing.link": { text: "Link", layer: "her" },
  "thing.heading": { text: "Heading", layer: "her" },
  "thing.compare": { text: "Before and after photos", layer: "her" },
  "thing.quote": { text: "Quote", layer: "her" },
  "thing.faq": { text: "Questions and answers", layer: "her" },
  "thing.quiz": { text: "Question for readers", layer: "her" },
  "thing.button": { text: "Button", layer: "her" },
  "thing.social": { text: "Links", layer: "her" },
  "thing.map": { text: "Map", layer: "her" },
  "thing.hours": { text: "Opening hours", layer: "her" },
  "thing.contact": { text: "How to reach you", layer: "her" },
  "thing.code": { text: "Code", layer: "details" },
  "thing.runnable": { text: "Code readers can run", layer: "details" },
  "thing.codepen": { text: "A CodePen", layer: "details" },
  "thing.footnote": { text: "Footnote", layer: "details" },
  "thing.abstract": { text: "Abstract", layer: "her" },
  "thing.references": { text: "References", layer: "her" },
  "thing.kept": { text: "Something {helper} added", layer: "her" },
  "thing.demo": { text: "A lesson demo", layer: "her" },
  "thing.quoteForm": { text: "Your quote request form", layer: "her" },
  // what happened
  "did.photoIn": { text: "Photo put in.", layer: "her" },
  "did.added": { text: "{thing} added.", layer: "her" },
  "did.changed": { text: "{thing} changed.", layer: "her" },
  "did.takenOut": { text: "{thing} taken out.", layer: "her" },
  "did.movedUp": { text: "Moved up. It's now after “{words}”.", layer: "her" },
  "did.movedTop": { text: "Moved up. It's now at the top.", layer: "her" },
  "did.movedDown": { text: "Moved down. It's now after “{words}”.", layer: "her" },
  "did.cantMoveUp": { text: "This is already at the top.", layer: "her" },
  "did.cantMoveDown": { text: "This is already at the end.", layer: "her" },
  "did.undone": { text: "Taken back.", layer: "her" },
  "did.cantUndo": { text: "This changed since, so it can't be undone here.", layer: "her" },
  "did.undoFind": { text: "Undo: {what}", layer: "her" },
  "did.fixed": { text: "Fixed.", layer: "her" },
  // cards
  "card.change": { text: "Change", layer: "her" },
  "card.move": { text: "Move", layer: "her" },
  "card.moveUp": { text: "Move up", layer: "her" },
  "card.moveDown": { text: "Move down", layer: "her" },
  "card.takeOut": { text: "Take it out", layer: "her" },
  "card.cantChange": { text: "This one can't be changed here. {helper} can.", layer: "her" },
  "card.asWritten": { text: "Change it in the words as written", layer: "details" },
  "card.photo": { text: "Photo: {words}", layer: "her" },
  "card.photoNoWords": { text: "A photo with no description", layer: "her" },
  "card.wordsUnder": { text: "Words under it: {words}", layer: "her" },
  "card.elsewhere": { text: "This photo is on another website.", layer: "her" },
  "card.checklist": { text: "Checklist, {count} things", layer: "her" },
  "card.more": { text: "+{count} more", layer: "her" },
  "card.table": { text: "Table, {columns} columns, {rows} rows", layer: "her" },
  "card.moreColumns": { text: "+{count} more columns", layer: "her" },
  "card.video": { text: "Video: {words}", layer: "her" },
  "card.fromYouTube": { text: "From YouTube", layer: "her" },
  "card.fromVimeo": { text: "From Vimeo", layer: "her" },
  "card.videoLink": { text: "Video from YouTube", layer: "her" },
  "card.compare": { text: "Before and after photos: {words}", layer: "her" },
  "card.faq": { text: "Questions and answers, {count}", layer: "her" },
  "card.quiz": { text: "Question for readers: {words}", layer: "her" },
  "card.answers": { text: "{count} answers", layer: "her" },
  "card.button": { text: "Button: {words}", layer: "her" },
  "card.goesTo": { text: "Goes to: {words}", layer: "her" },
  "card.social": { text: "Links: {words}", layer: "her" },
  "card.map": { text: "Map: {words}", layer: "her" },
  "card.code": { text: "Code, {language}, {count} lines", layer: "details" },
  "card.codepen": { text: "A CodePen: {words}", layer: "details" },
  "card.footnote": { text: "Note at the bottom, {n}: {words}", layer: "her" },
  "card.writeHere": { text: "Write here", layer: "her" },
  "card.keepWriting": { text: "Keep writing…", layer: "her" },
  "card.unclosed": { text: "Part of this post is open as written", layer: "her" },
  "card.unclosedWhy": { text: "So nothing in it gets moved around.", layer: "her" },
  "card.unclosedLine": { text: "A code block starting on line {line} never ends.", layer: "details" },
};

export const firstWords = (text, count = 6) => {
  const words = String(text || "").replace(/[#>*_`[\]!()|-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length > count ? `${words.slice(0, count).join(" ")}…` : words.join(" ");
};

const CALLOUT_THING = { NOTE: () => say("thing.note"), TIP: () => say("thing.tip"), WARNING: () => say("thing.watchOut"), IMPORTANT: () => say("thing.important"), CAUTION: () => say("thing.caution") };

/** The name statuses use for an item or form ("Tip", "Table"). */
export function thingName(kind, extra = "") {
  switch (kind) {
    case "photo": return say("thing.photo");
    case "tip": return (CALLOUT_THING[extra] || CALLOUT_THING.TIP)();
    case "checklist": return say("thing.checklist");
    case "table": return say("thing.table");
    case "video": return say("thing.video");
    case "link": return say("thing.link");
    case "heading": return say("thing.heading");
    case "compare": return say("thing.compare");
    case "quote": return say("thing.quote");
    case "faq": return say("thing.faq");
    case "quiz": return say("thing.quiz");
    case "button": return say("thing.button");
    case "social": return say("thing.social");
    case "map": return say("thing.map");
    case "hours": return say("thing.hours");
    case "contact": return say("thing.contact");
    case "code": return say("thing.code");
    case "runnable": return say("thing.runnable");
    case "codepen": return say("thing.codepen");
    case "footnote": return say("thing.footnote");
    case "abstract": return say("thing.abstract");
    case "references": return say("thing.references");
    default: return say("thing.kept");
  }
}

/** The name of what a card is, for "Tip taken out." */
export function blockThing(block) {
  const kind = { photo: "photo", "photo-web": "photo", callout: "tip", tasklist: "checklist", table: "table", "video-link": "video", "codepen-link": "codepen",
    quiz: "quiz", code: "code", runnable: "runnable", footnote: "footnote", compare: "compare" }[block.kind];
  if (kind) return thingName(kind, /\[!([A-Za-z]+)\]/.exec(block.source)?.[1]?.toUpperCase());
  if (block.kind === "piece") {
    const piece = /^\s*`{3,}piece[ \t]+([a-z]+)/.exec(block.source)?.[1];
    return thingName(piece === "image" ? "photo" : piece === "callout" ? "tip" : piece || "");
  }
  return thingName("");
}

const PHOTO = /^!\[((?:\\.|[^\]\\])*)\]\(<?([^\s)<>]+)>?(?:\s+"[^"]*")?\)[ \t]*$/;

/** A photo line as `{ alt, url }`, or null. */
export function parsePhoto(source) {
  const match = PHOTO.exec(String(source).trim());
  return match ? { alt: match[1].replace(/\\(.)/g, "$1"), url: match[2] } : null;
}

const value = (values, name) => values.find(([n]) => n === name)?.[1] || "";
const all = (values, name) => values.filter(([n]) => n === name).map(([, v]) => v);

/**
 * Which form changes a card, or "" when none can write it back exactly. `pieces` is `meta.pieces`.
 */
export function cardForm(block, pieces = []) {
  const source = block.source;
  switch (block.kind) {
    case "photo": {
      const photo = parsePhoto(source);
      if (!photo || !photo.url.startsWith("/images/uploads/")) return "";
      try { return imageMarkdown(photo.url, photo.alt) === source.trim() ? "photo" : ""; } catch { return ""; }
    }
    case "callout": return parseCallout(source) ? "tip" : "";
    case "tasklist": return parseTaskList(source) ? "checklist" : "";
    case "table": return parseTable(source) ? "table" : "";
    case "video-link": return parseEmbed(source) ? "video" : "";
    case "codepen-link": return parseEmbed(source) ? "codepen" : "";
    case "quiz": return parseQuiz(source) ? "quiz" : "";
    case "code":
    case "runnable": return parseCodeFence(source) ? "code" : "";
    case "footnote": return /^\[\^\d+\]: [^\n]+$/.test(source.trim()) ? "footnote" : "";
    case "compare":
    case "piece": {
      const parsed = parsePieceFence(source);
      if (!parsed) return "";
      if (parsed.kind === "compare") return "compare";
      const schema = pieces.find((piece) => piece.kind === parsed.kind);
      if (!schema || !parsePieceFence(source, schema)) return "";
      return { image: "photo", video: "video", button: "button", social: "social", faq: "faq", map: "map", hours: "hours", contact: "contact" }[parsed.kind] || "";
    }
    default: return "";
  }
}

/**
 * What a card shows: `{ name, badge, lines, thumbs, more, tone, mono }`. `name` is its accessible
 * name; `lines` are short texts; `thumbs` are `{ src, alt, label }` pictures (only on this site or
 * an https address). Text only: the card places each with textContent.
 */
export function cardSummary(block) {
  const source = block.source;
  const out = { name: "", badge: "", lines: [], thumbs: [], more: "", tone: "", mono: false };
  switch (block.kind) {
    case "photo":
    case "photo-web": {
      const photo = parsePhoto(source) || { alt: "", url: "" };
      out.name = photo.alt ? say("card.photo", { words: photo.alt }) : say("card.photoNoWords");
      out.thumbs.push({ src: photo.url, alt: "", label: "" });
      out.lines.push(photo.alt || say("card.photoNoWords"));
      if (block.kind === "photo-web") out.lines.push(say("card.elsewhere"));
      return out;
    }
    case "callout": {
      const parsed = parseCallout(source);
      const kind = parsed?.kind || (/\[!([A-Za-z]+)\]/.exec(source)?.[1] || "NOTE").toUpperCase();
      out.badge = (CALLOUT_THING[kind] || CALLOUT_THING.NOTE)();
      out.tone = kind.toLowerCase();
      const body = parsed ? parsed.text : source.split("\n").slice(1).map((line) => line.replace(/^ {0,3}> ?/, "")).join("\n");
      const title = parsed?.title || "";
      out.name = `${out.badge}: ${title || firstWords(body)}`;
      if (title) out.lines.push(title);
      out.lines.push(...body.split("\n").filter((line) => line.trim()).slice(0, 3));
      return out;
    }
    case "tasklist": {
      const items = source.split("\n").map((line) => /^[-*+] \[([ xX])\] (.*)$/.exec(line)).filter(Boolean);
      out.name = say("card.checklist", { count: items.length });
      out.lines.push(...items.slice(0, 4).map((m) => `${m[1] === " " ? "☐" : "☑"} ${m[2]}`));
      if (items.length > 4) out.more = say("card.more", { count: items.length - 4 });
      return out;
    }
    case "table": {
      const cells = tableCells(source) || { header: [], rows: [] };
      const columns = cells.header.length;
      out.name = say("card.table", { columns, rows: cells.rows.length });
      out.table = [cells.header.slice(0, 3), ...cells.rows.slice(0, 2).map((row) => row.slice(0, 3))];
      out.lines.push(out.name);
      if (columns > 3) out.more = say("card.moreColumns", { count: columns - 3 });
      return out;
    }
    case "video-link":
      out.name = say("card.videoLink");
      out.badge = say("thing.video");
      out.lines.push(source.trim());
      return out;
    case "codepen-link":
      out.name = say("card.codepen", { words: source.trim() });
      out.lines.push(source.trim());
      out.mono = true;
      return out;
    case "compare":
    case "piece":
      return pieceSummary(source, out);
    case "quiz": {
      const lines = source.split("\n");
      const answers = lines.filter((line) => /^- \[[ xX]\] /.test(line)).length;
      out.name = say("card.quiz", { words: lines[1] || "" });
      out.lines.push(lines[1] || "", say("card.answers", { count: answers }));
      return out;
    }
    case "code":
    case "runnable": {
      const lines = source.split("\n");
      const info = lines[0].replace(/^[`~]+/, "").trim();
      const language = info.split(/\s/)[0] || "text";
      const body = lines.slice(1, -1);
      if (block.kind === "runnable") {
        out.name = `${say("thing.runnable")}: ${/title="([^"]*)"/.exec(info)?.[1] || language}`;
      } else {
        out.name = say("card.code", { language, count: body.length });
      }
      out.badge = block.kind === "runnable" ? say("thing.runnable") : say("thing.code");
      out.lines.push(...body.slice(0, 3));
      out.mono = true;
      return out;
    }
    case "footnote": {
      const match = /^\[\^([^\]]+)\]:\s*(.*)$/s.exec(source.trim());
      out.name = say("card.footnote", { n: match?.[1] || "", words: firstWords(match?.[2] || "", 8) });
      out.lines.push(match?.[2]?.split("\n")[0] || "");
      return out;
    }
    case "demo": out.name = say("thing.demo"); return out;
    case "quote-form": out.name = say("thing.quoteForm"); return out;
    default:
      // Only its name: what it holds is shown as written in the card's details, for {helper}.
      out.name = say("thing.kept");
      return out;
  }
}

function pieceSummary(source, out) {
  const parsed = parsePieceFence(source) || { kind: "", values: [] };
  const v = parsed.values;
  switch (parsed.kind) {
    case "compare": {
      const sides = ["before", "after"].map((side) => ({ src: value(v, side), alt: "", label: value(v, `${side}-label`) || value(v, `${side}-alt`) }));
      out.name = say("card.compare", { words: sides.map((side) => side.label).join(", ") });
      out.thumbs.push(...sides);
      return out;
    }
    case "image":
      out.name = say("card.photo", { words: value(v, "alt") });
      out.thumbs.push({ src: value(v, "src"), alt: "", label: "" });
      out.lines.push(value(v, "alt"));
      if (value(v, "caption")) out.lines.push(say("card.wordsUnder", { words: value(v, "caption") }));
      if (/^https:\/\//i.test(value(v, "src"))) out.lines.push(say("card.elsewhere"));
      return out;
    case "video":
      out.name = say("card.video", { words: value(v, "title") });
      out.badge = say("thing.video");
      out.lines.push(value(v, "title"), value(v, "provider") === "vimeo" ? say("card.fromVimeo") : say("card.fromYouTube"));
      return out;
    case "faq": {
      const questions = all(v, "question");
      out.name = say("card.faq", { count: questions.length });
      out.lines.push(...questions.slice(0, 3));
      if (questions.length > 3) out.more = say("card.more", { count: questions.length - 3 });
      return out;
    }
    case "button":
      out.name = say("card.button", { words: value(v, "label") });
      out.lines.push(value(v, "label"), say("card.goesTo", { words: value(v, "href") }));
      return out;
    case "social": {
      const names = all(v, "label");
      out.name = say("card.social", { words: names.join(", ") });
      out.lines.push(names.join(" · "));
      return out;
    }
    case "map":
      out.name = say("card.map", { words: value(v, "label") });
      out.lines.push(out.name);
      return out;
    case "hours": {
      const days = all(v, "days");
      const hours = all(v, "hours");
      out.name = say("thing.hours");
      out.lines.push(...days.slice(0, 4).map((day, index) => `${day}: ${hours[index] || ""}`));
      if (value(v, "note")) out.lines.push(value(v, "note"));
      return out;
    }
    case "contact":
      out.name = say("thing.contact");
      out.lines.push(...["email", "phone", "address"].map((name) => value(v, name)).filter(Boolean));
      return out;
    default:
      // Only its name: what it holds is shown as written in the card's details, for {helper}.
      out.name = say("thing.kept");
      return out;
  }
}
