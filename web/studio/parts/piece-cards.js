// One card in her words (Studio R6): a photo, a tip, a table, a piece... drawn from its Markdown with
// cardSummary (piece-words.js), with Change and Move (Move up, Move down, Take it out). Every value
// is placed as text; a picture loads only from this site or the https address in the post, without
// a referrer, and no card loads a frame. Also draws a form's "How it looks" sketch.
import { h } from "./dom.js";
import { say } from "./words.js";
import { cardSummary } from "./piece-words.js";

/** A picture address a card may load: this site's /images/, or https. */
export const safePicture = (src) => /^\/images\//.test(String(src || "")) || /^https:\/\/[^\s"'<>]+$/i.test(String(src || ""));

/** The visible part of a card or sketch, from a summary. */
export function cardBody(summary) {
  const parts = [];
  if (summary.badge) parts.push(h("status-badge", { class: "studio-piece-badge", variant: "info" }, summary.badge));
  const thumbs = summary.thumbs.filter((thumb) => safePicture(thumb.src));
  if (thumbs.length) {
    parts.push(h("div", { class: "studio-piece-thumbs" }, thumbs.map((thumb) => h("figure", { class: "studio-piece-thumb" },
      h("img", { src: thumb.src, alt: "", loading: "lazy", referrerPolicy: "no-referrer" }),
      thumb.label ? h("figcaption", { text: thumb.label }) : null))));
  }
  if (summary.table) {
    parts.push(h("table", { class: "studio-piece-table" }, h("tbody", {}, summary.table.map((row, index) =>
      h("tr", {}, row.map((cell) => h(index === 0 ? "th" : "td", { text: cell })))))));
  }
  const lines = summary.table ? summary.lines.slice(-1) : summary.lines;
  if (lines.length) parts.push(h("div", { class: summary.mono ? "studio-piece-lines studio-mono" : "studio-piece-lines" }, lines.filter((line) => line !== "").map((line) => h("p", { text: line }))));
  if (summary.more) parts.push(h("p", { class: "studio-help", text: summary.more }));
  return parts;
}

/**
 * A card for `block` (`{ kind, source }`). `form` is the form that changes it ("" when none can);
 * `on` has `change(card)`, `move(by)`, `remove()`; `extra` is something to add (a job photo's
 * Before or After); `first`/`last` say which moves make sense.
 */
export function pieceCard(block, { form, on, extra = null, first = false, last = false, summary = cardSummary(block) }) {
  const menu = h("dropdown-menu", {
    class: "studio-card-move",
    items: [
      { value: "up", label: say("card.moveUp"), disabled: first },
      { value: "down", label: say("card.moveDown"), disabled: last },
      { value: "remove", label: say("card.takeOut") },
    ],
    onItemselect: (event) => {
      if (event.detail === "up") on.move(-1);
      if (event.detail === "down") on.move(1);
      if (event.detail === "remove") on.remove();
    },
  }, h("span", { slot: "label" }, say("card.move"), h("span", { class: "studio-visually-hidden", text: `: ${summary.name}` })));
  const change = form ? h("action-button", { variant: "secondary", size: "sm", class: "studio-card-change", onClick: () => on.change(card) },
    say("card.change"), h("span", { class: "studio-visually-hidden", text: `: ${summary.name}` })) : null;
  const card = h("div", {
    role: "group", "aria-label": summary.name, tabindex: "-1",
    class: `studio-piece-card${summary.tone ? ` studio-piece-${summary.tone}` : ""}`, "data-card-kind": block.kind,
  },
  ...cardBody(summary),
  form ? null : h("p", { class: "studio-help", text: say("card.cantChange") }),
  form ? null : h("details", { class: "studio-help studio-card-source" }, h("summary", { text: say("common.forHelper") }),
    h("pre", { class: "studio-mono", text: block.source }), h("p", { text: say("card.asWritten") })),
  extra,
  h("div", { class: "studio-card-actions" }, change, menu));
  card.addEventListener("keydown", (event) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    on.move(event.key === "ArrowUp" ? -1 : 1);
  });
  return card;
}

/** "How it looks" in a form: the same drawing as the card, from a summary, without its buttons. */
export function sketch(summary) {
  return h("div", { class: `studio-piece-card studio-piece-sketch${summary.tone ? ` studio-piece-${summary.tone}` : ""}` }, ...cardBody(summary));
}
