// Cited here (Studio R11, decision 3): directly under each box of her words that holds citations,
// one chip per citation in reading order, named by its source and place. Each chip's menu has
// Change, Show me and Take it out. A key that isn't in her library says so; a citation that can't
// be read offers only Show me. The citation itself stays in her words as typed.
import { h } from "./dom.js";
import { say } from "./words.js";
import { citationLabel, citationsIn } from "./cite-rules.js";
import { innerAria } from "./inner-button.js";

/**
 * The row for one box's words, or null when it holds no citation. `text` is the box's words;
 * `sources` the library as last loaded; `on` has `change(span)`, `show(span)`, `takeOut(span)`,
 * each with offsets in `text`.
 */
export function citedHere(text, sources, on) {
  const spans = citationsIn(text);
  if (!spans.length) return null;
  const known = new Set((sources || []).map((source) => source.id));
  const chips = spans.map((span, index) => {
    const unknown = span.citation && sources?.length && !known.has(span.citation.key);
    const label = !span.citation ? say("cite.malformed") : unknown ? say("cite.unknownKey", { key: span.citation.key }) : citationLabel(span.citation, sources);
    const items = span.citation
      ? [{ value: "change", label: say("cite.change") }, { value: "show", label: say("cite.showMe") }, { value: "out", label: say("cite.takeOut") }]
      : [{ value: "show", label: say("cite.showMe") }];
    const menu = h("dropdown-menu", {
      class: "studio-cite-chip", "data-chip": String(index), "data-state": !span.citation ? "malformed" : unknown ? "unknown" : "ok", items,
      onItemselect: (event) => {
        if (event.detail === "change") on.change(span, menu);
        if (event.detail === "show") on.show(span);
        if (event.detail === "out") on.takeOut(span);
      },
    }, h("span", { slot: "label" }, unknown || !span.citation ? h("span", { "aria-hidden": "true", text: "⚠ " }) : null,
      h("span", { class: "studio-stranger", dir: "auto", text: label })));
    innerAria(menu, { "aria-label": say("cite.chipName", { label }) });
    return h("li", {}, menu);
  });
  return h("div", { class: "studio-cited-here" }, h("span", { class: "studio-label", text: say("cite.citedHere") }), h("ul", { class: "studio-cited-chips" }, chips));
}
