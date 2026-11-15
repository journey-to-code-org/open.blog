// The controls of About this post, each bound to one value by Studio's name: a text field, a
// choice of a few (native radios in a fieldset: radio-group isn't vendored, as in R2), or a
// select. Each can show a problem beside itself and take focus. Values are only ever text.
import { h } from "./dom.js";

let uid = 0;

/**
 * `values` is the sheet's live map (changed in place); `onChange(name)` after every edit.
 * Returns { text, choice, select, get(name), all(), error(name, words), clear() }.
 */
export function createControls({ values, onChange }) {
  const controls = new Map();
  const changed = (name, value) => { values[name] = value; control(name)?.error(""); onChange?.(name); };
  const control = (name) => controls.get(name);

  function text(name, { label, help = "", rows = 0, maxlength, inputmode, type = "text", mono = false, readonly = false, live = null } = {}) {
    const field = h("text-field", {
      label, description: help, value: values[name] ?? "", rows: rows || undefined, maxlength, inputmode, type, readonly,
      class: mono ? "studio-mono-field" : null, "data-about": name,
      onValuechange: (e) => { changed(name, String(e.detail ?? "")); live?.(String(e.detail ?? "")); },
    });
    controls.set(name, {
      element: field,
      set(value) { field.value = value ?? ""; },
      focus() { (field.querySelector("input, textarea") || field).focus?.(); },
      error(words) { field.error = words || ""; },
    });
    return field;
  }

  function choice(name, { legend, choices, help = "", start = "", confirm = null } = {}) {
    const id = `studio-about-choice-${++uid}`;
    const say = h("p", { id: `${id}-error`, class: "studio-field-error", hidden: true });
    const helpLine = help ? h("p", { id: `${id}-help`, class: "studio-help", text: help }) : null;
    const current = () => values[name] || start;
    const inputs = [];
    const rows = Object.entries(choices).map(([value, said], index) => {
      const inputId = `${id}-${index}`;
      const words = typeof said === "string" ? said : said.label;
      const more = typeof said === "string" ? "" : said.help || "";
      const input = h("input", { type: "radio", name: id, id: inputId, value, class: "studio-radio", "data-about": name,
        onChange: async () => {
          if (confirm && !(await confirm(value))) { draw(); return; }
          changed(name, value);
        } });
      inputs.push(input);
      if (more) input.setAttribute("aria-describedby", `${inputId}-help`);
      return h("div", { class: "studio-choice" }, input, h("label", { for: inputId, text: words }), more ? h("p", { id: `${inputId}-help`, class: "studio-help", text: more }) : null);
    });
    // A value the post has that isn't one of these stays, shown as written.
    const draw = () => {
      for (const input of inputs) input.checked = input.value === current();
    };
    const box = h("fieldset", { class: "studio-field-group studio-choices", "aria-describedby": [helpLine ? `${id}-help` : "", `${id}-error`].filter(Boolean).join(" ") },
      h("legend", { text: legend }), ...rows, helpLine, say);
    draw();
    controls.set(name, {
      element: box,
      set(value) { values[name] = value ?? ""; draw(); },
      focus() { (inputs.find((i) => i.checked) || inputs[0])?.focus(); },
      error(words) {
        say.textContent = words || "";
        say.hidden = !words;
        if (words) box.setAttribute("aria-invalid", "true"); else box.removeAttribute("aria-invalid");
      },
    });
    return box;
  }

  function select(name, { label, options, help = "" } = {}) {
    const known = options.some((o) => o.value === (values[name] ?? ""));
    const all = known ? options : [...options, { value: values[name], label: `${values[name]} (as written)` }];
    const field = h("select-field", { label, description: help, options: all, value: values[name] ?? "", "data-about": name,
      onValuechange: (e) => changed(name, String(e.detail ?? "")) });
    controls.set(name, {
      element: field,
      set(value) { field.value = value ?? ""; },
      focus() { field.querySelector("select")?.focus(); },
      error() {},
    });
    return field;
  }

  return {
    text, choice, select,
    get: control,
    /** Put every control back to the values (after Undo or a restored copy). */
    sync() { for (const [name, c] of controls) c.set(values[name] ?? ""); },
    error(name, words) { control(name)?.error(words); },
    clear() { for (const c of controls.values()) c.error(""); },
    /** Drop the controls of a group that was redrawn. */
    forget(names) { for (const name of names) controls.delete(name); },
  };
}
