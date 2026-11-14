// A job's words as its four parts (Studio R4): when the body is exactly the scaffold's four `## `
// headings, Words becomes four boxes labelled with them ("Problem", "What we found", "What we did",
// "Result"), and comes back byte for byte when she changes nothing (parts/job-rules.js). Any other
// shape stays one box.
import { h } from "./dom.js";
import { jobBoxes, joinJobBoxes } from "./job-rules.js";
import { createWordBox } from "./word-box.js";

/** The four boxes for `text`, or null when it isn't the four parts. `host` is Add something's. */
export function jobEditor(text, scaffold, { host }) {
  const parts = jobBoxes(text, scaffold);
  if (!parts) return null;
  const boxes = parts.map((part, index) => createWordBox({
    label: part.heading, rows: index === 3 ? 6 : 4, value: part.words, host, data: { "data-job-part": String(index), class: "studio-job-part" },
  }));
  const element = h("div", { class: "studio-job-parts" }, ...boxes.map((box) => h("div", { class: "studio-job-part-box" }, box.element)));
  const words = (index) => boxes[index].value;
  return {
    element,
    body: () => joinJobBoxes(parts.map((part, index) => ({ ...part, words: words(index) }))),
    box: (index) => boxes[index],
    boxes: () => boxes,
    get: words,
    set(index, value) {
      boxes[index].value = value;
      host.changed?.(boxes[index]);
    },
    focus(index = 0) {
      boxes[index]?.focus();
    },
  };
}
