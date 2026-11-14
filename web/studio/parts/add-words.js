// Add something (Studio R6): what she can put in her words, in two groups, and where it goes. Pure,
// DOM-free; the sheet is add-menu.js. Every sentence is a word id a site may change.
import { say } from "./words.js";
import { splitChunks } from "./word-blocks.js";

/** @type {Record<string, { text: string, layer: "her" | "details", max?: number, bare?: string }>} */
export const WORDS = {
  "add.heading": { text: "Add something", layer: "her" },
  "add.button": { text: "Add something", layer: "her" },
  "add.buttonTo": { text: "Add something to {box}", layer: "her" },
  "add.photoTo": { text: "Put a photo in {box}", layer: "her" },
  "add.putPhoto": { text: "Put a photo in", layer: "her" },
  "add.find": { text: "Find something to add", layer: "her" },
  "add.mostUsed": { text: "Most used", layer: "her" },
  "add.moreThings": { text: "More things", layer: "her" },
  "add.never": { text: "Never mind", layer: "her" },
  "add.back": { text: "‹ Everything you can add", layer: "her" },
  "add.nothing": { text: "Nothing called “{words}”.", layer: "her" },
  "add.nothingHelp": { text: "Try another word, or close this and keep writing.", layer: "her" },
  "add.count": { text: "{count} things", layer: "her" },
  "add.countOne": { text: "1 thing", layer: "her" },
  "add.whereAfter": { text: "It goes in {box}, after “{words}”.", layer: "her" },
  "add.whereEnd": { text: "It goes at the end of {box}.", layer: "her" },
  "add.whereStart": { text: "It goes at the start of {box}.", layer: "her" },
  "add.whereIn": { text: "It goes in {box}.", layer: "her" },
  "add.yourWords": { text: "your words", layer: "her" },
  "add.slashTip": { text: "Tip: type / on an empty line to add something.", layer: "her" },
  "add.finish": { text: "Finish adding the {thing}", layer: "her" },
  "add.alreadyThere": { text: "This post already has an {thing}.", layer: "her" },
  "add.alreadyThereRefs": { text: "This post already has its {thing}.", layer: "her" },
  "add.asWritten": { text: "Show the words as written", layer: "details" },
  "add.asWrittenHelp": { text: "Everything exactly as it's saved. Turn this off to see cards again.", layer: "details" },
  "add.detailsNote": { text: "Everything here writes ordinary Markdown into content/posts/{file}. Pieces are checked and written by {product} (POST /admin/api/pieces), so the file holds exactly what the build reads.", layer: "details", max: 240 },
  "add.findAdd": { text: "Add {thing}", layer: "her" },
  "add.findSuggestions": { text: "Suggestions", layer: "her" },
  // the items
  "item.photo": { text: "A photo", layer: "her" },
  "item.photoAbout": { text: "One of your photos, with a few words about it.", layer: "her" },
  "item.tip": { text: "A tip or a note", layer: "her" },
  "item.tipAbout": { text: "A box that stands out, like “Book a week ahead.”", layer: "her" },
  "item.checklist": { text: "A checklist", layer: "her" },
  "item.checklistAbout": { text: "Things to tick off, like what to buy.", layer: "her" },
  "item.table": { text: "A table", layer: "her" },
  "item.tableAbout": { text: "Rows and columns, like sizes and prices.", layer: "her" },
  "item.video": { text: "A video", layer: "her" },
  "item.videoAbout": { text: "From YouTube or Vimeo.", layer: "her" },
  "item.link": { text: "A link", layer: "her" },
  "item.linkAbout": { text: "To one of your posts or another website.", layer: "her" },
  "item.heading": { text: "A heading", layer: "her" },
  "item.headingAbout": { text: "A short title that starts a new part of your post.", layer: "her" },
  "item.compare": { text: "Before and after photos", layer: "her" },
  "item.compareAbout": { text: "Two photos side by side, like the room before and after.", layer: "her" },
  "item.quote": { text: "A quote", layer: "her" },
  "item.quoteAbout": { text: "Someone's words, set apart.", layer: "her" },
  "item.faq": { text: "Questions and answers", layer: "her" },
  "item.faqAbout": { text: "Questions readers ask. Each opens to show your answer.", layer: "her" },
  "item.quiz": { text: "A question for readers", layer: "her" },
  "item.quizAbout": { text: "A quick quiz: readers pick an answer and find out if they're right.", layer: "her" },
  "item.button": { text: "A button", layer: "her" },
  "item.buttonAbout": { text: "Takes readers to a page, an email or a phone number.", layer: "her" },
  "item.social": { text: "Links to your other pages", layer: "her" },
  "item.socialAbout": { text: "Like your Facebook or Instagram.", layer: "her" },
  "item.map": { text: "A map", layer: "her" },
  "item.mapAbout": { text: "Shows one place.", layer: "her" },
  "item.hours": { text: "Opening hours", layer: "her" },
  "item.hoursAbout": { text: "The days and hours you're open.", layer: "her" },
  "item.contact": { text: "How to reach you", layer: "her" },
  "item.contactAbout": { text: "Your email, phone and address.", layer: "her" },
  "item.abstract": { text: "Abstract", layer: "her" },
  "item.abstractAbout": { text: "The short summary research posts start with.", layer: "her" },
  "item.references": { text: "References", layer: "her" },
  "item.referencesAbout": { text: "The list of works you cite, at the end.", layer: "her" },
  "item.code": { text: "Code", layer: "details" },
  "item.codeAbout": { text: "A code block with a language, a title and highlighted lines.", layer: "details" },
  "item.runnable": { text: "Code readers can run", layer: "details" },
  "item.runnableAbout": { text: "An example or a challenge readers edit and run.", layer: "details" },
  "item.codepen": { text: "A CodePen", layer: "details" },
  "item.codepenAbout": { text: "A pen shown in the post, by its address.", layer: "details" },
  "item.footnote": { text: "A footnote", layer: "details" },
  "item.footnoteAbout": { text: "A numbered note at the bottom of the post.", layer: "details" },
};

/** Every item: its id, the piece kind it needs from `meta.pieces` (if any), and its words. */
export const ADD_ITEMS = [
  { id: "photo", name: () => say("item.photo"), about: () => say("item.photoAbout") },
  { id: "tip", name: () => say("item.tip"), about: () => say("item.tipAbout") },
  { id: "checklist", name: () => say("item.checklist"), about: () => say("item.checklistAbout") },
  { id: "table", name: () => say("item.table"), about: () => say("item.tableAbout") },
  { id: "video", needs: "video", name: () => say("item.video"), about: () => say("item.videoAbout") },
  { id: "link", name: () => say("item.link"), about: () => say("item.linkAbout") },
  { id: "heading", name: () => say("item.heading"), about: () => say("item.headingAbout") },
  { id: "compare", needs: "compare", name: () => say("item.compare"), about: () => say("item.compareAbout") },
  { id: "quote", name: () => say("item.quote"), about: () => say("item.quoteAbout") },
  { id: "faq", needs: "faq", name: () => say("item.faq"), about: () => say("item.faqAbout") },
  { id: "quiz", name: () => say("item.quiz"), about: () => say("item.quizAbout") },
  { id: "button", needs: "button", name: () => say("item.button"), about: () => say("item.buttonAbout") },
  { id: "social", needs: "social", name: () => say("item.social"), about: () => say("item.socialAbout") },
  { id: "map", needs: "map", name: () => say("item.map"), about: () => say("item.mapAbout") },
  { id: "hours", needs: "hours", name: () => say("item.hours"), about: () => say("item.hoursAbout") },
  { id: "contact", needs: "contact", name: () => say("item.contact"), about: () => say("item.contactAbout") },
  { id: "abstract", name: () => say("item.abstract"), about: () => say("item.abstractAbout") },
  { id: "references", name: () => say("item.references"), about: () => say("item.referencesAbout") },
  { id: "code", name: () => say("item.code"), about: () => say("item.codeAbout") },
  { id: "runnable", name: () => say("item.runnable"), about: () => say("item.runnableAbout") },
  { id: "codepen", name: () => say("item.codepen"), about: () => say("item.codepenAbout") },
  { id: "footnote", name: () => say("item.footnote"), about: () => say("item.footnoteAbout") },
];

const MOST = ["photo", "tip", "checklist", "table", "video", "link", "heading"];
const MORE = ["compare", "quote", "faq", "quiz", "button", "social", "map"];
const DETAILS = ["code", "runnable", "codepen", "footnote"];

/**
 * What this post can have added, in groups: `{ most, more, details }`, each a list of
 * `{ id, name, about }`. `post` is `{ kind: "job" | "recipe" | "research" | "" }`. An item whose piece
 * the server doesn't know (an older one) is left out.
 */
export function addItems(meta, post = {}) {
  const known = new Set((meta?.pieces || []).map((piece) => piece.kind));
  const has = (item) => !item.needs || (item.needs === "compare" ? Boolean(meta?.compare) : known.has(item.needs));
  const byId = (id) => ADD_ITEMS.find((item) => item.id === id);
  const trade = Boolean(meta?.siteUses?.trade);
  const most = [...MOST];
  const more = [...MORE];
  const details = [...DETAILS];
  if (post.kind === "job") { more.splice(more.indexOf("compare"), 1); most.unshift("compare"); }
  if (trade) most.push("hours", "contact"); else details.push("hours", "contact");
  if (post.kind === "research") most.push("abstract", "references");
  const list = (ids) => ids.map(byId).filter(has).map((item) => ({ id: item.id, name: item.name(), about: item.about() }));
  return { most: list(most), more: list(more), details: list(details) };
}

/** The items matching what she typed (in the name or the words about it). */
export function filterItems(items, query) {
  const words = String(query || "").replace(/^\//, "").trim().toLowerCase();
  if (!words) return items;
  return items.filter((item) => `${item.name} ${item.about}`.toLowerCase().includes(words));
}

const shortWords = (text, count = 5) => {
  const words = String(text || "").replace(/[#>*_`[\]!()|]+/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length > count ? `${words.slice(0, count).join(" ")}…` : words.join(" ");
};

/**
 * Where something goes, in words: after the paragraph holding the caret ("It goes in Your story,
 * after “My mother made this every…”."), at the start or end of the box, or in an empty box.
 */
export function whereItGoes(box, text, caret) {
  const value = String(text || "");
  if (!value.trim()) return say("add.whereIn", { box });
  const at = Number.isFinite(caret) ? caret : value.length;
  const { chunks } = splitChunks(value);
  const before = chunks.filter((chunk) => chunk.start <= at && !(chunk.source.trim() === "/"));
  const last = before[before.length - 1];
  if (!last) return say("add.whereStart", { box });
  if (last === chunks[chunks.length - 1] && at >= last.start + last.source.length) return say("add.whereEnd", { box });
  return say("add.whereAfter", { box, words: shortWords(last.source) });
}

/** "6 things" for the filter's polite count. */
export const countWords = (count) => (count === 1 ? say("add.countOne") : say("add.count", { count }));
