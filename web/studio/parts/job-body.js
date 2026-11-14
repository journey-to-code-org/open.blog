// A job's words as its four parts (Studio R4): when the body is exactly the scaffold's four `## `
// headings, Words becomes four boxes labelled with them ("Problem", "What we found", "What we did",
// "Result"), and comes back byte for byte when she changes nothing (parts/job-rules.js). Any other
// shape stays one box.
import { h } from "./dom.js";
import { jobBoxes, joinJobBoxes } from "./job-rules.js";

/** The four boxes for `text`, or null when it isn't the four parts. */
export function jobEditor(text, scaffold, { onChange, onPutPhoto }) {
  const parts = jobBoxes(text, scaffold);
  if (!parts) return null;
  const fields = parts.map((part, index) => h("text-field", {
    label: part.heading, class: "studio-writing studio-job-part", rows: index === 3 ? 6 : 4, value: part.words, "data-job-part": String(index),
    onValuechange: () => onChange(),
  }));
  const element = h("div", { class: "studio-job-parts" },
    ...fields.map((field, index) => h("div", { class: "studio-job-part-box" }, field,
      h("action-button", { variant: "secondary", size: "sm", class: "studio-put-photo", label: `Put a photo in ${parts[index].heading}`, onClick: (event) => onPutPhoto(`job:${index}`, event.currentTarget) }, "Put a photo in"))));
  const words = (index) => String(fields[index].value || "");
  return {
    element,
    body: () => joinJobBoxes(parts.map((part, index) => ({ ...part, words: words(index) }))),
    box: (index) => fields[index],
    get: words,
    set(index, value) {
      fields[index].value = value;
      onChange();
    },
    focus(index = 0) {
      fields[index]?.querySelector("textarea")?.focus();
    },
  };
}
