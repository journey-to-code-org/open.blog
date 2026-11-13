// A form drawn from a field spec: the landing sections' and theme components' settings, business
// facts, anything described as `{ kind, name, label, hint, required, options, fields, ... }`
// (the spec shape of parts/landing-rules.js). Every field is a labelled Zubra field; nothing typed is
// ever markup. `value()` returns the data in the spec's shape; `onChange()` after every edit.
// Studio slice 6.
import { h } from "./dom.js";

let count = 0;
const plain = (spec) => spec.hint ? { description: spec.hint } : {};

/** The value a field starts with when the data has none. Exported for tests. */
export function startValue(spec) {
  if (spec.kind === "toggle") return spec.default === true;
  if (spec.kind === "list") return [];
  if (spec.kind === "group") return spec.fixed ? (spec.blank?.() || {}) : null;
  if (spec.default !== undefined) return spec.default;
  return "";
}

/** One field. Returns { element, value(), focus() }. */
function field(spec, start, ctx) {
  const id = `field-${++count}`;
  const on = () => ctx.onChange?.();
  switch (spec.kind) {
    case "toggle": {
      const el = h("toggle-switch", { label: spec.label, checked: start === true, ...plain(spec), onCheckedchange: on });
      return { element: el, value: () => el.checked === true };
    }
    case "select": {
      const options = (spec.options || []).map(([value, label]) => ({ value: String(value), label }));
      const el = h("select-field", { label: spec.label, options, value: String(start ?? spec.default ?? options[0]?.value ?? ""), ...plain(spec), onValuechange: on });
      return { element: el, value: () => el.value };
    }
    case "post": {
      const options = [{ value: "", label: spec.optional ? "None" : "Choose a post" }, ...(ctx.posts || []).map((p) => ({ value: p.slug, label: p.title || p.slug }))];
      const el = h("select-field", { label: spec.label, options, value: String(start || ""), ...plain(spec), onValuechange: on });
      return { element: el, value: () => el.value || (spec.optional ? null : "") };
    }
    case "date": {
      const el = h("date-field", { label: spec.label, value: String(start || ""), ...plain(spec), onValuechange: on });
      return { element: el, value: () => el.value || "" };
    }
    case "number": {
      const el = h("text-field", { label: spec.label, type: "number", value: start === null || start === undefined ? "" : String(start), ...(spec.min !== undefined ? { min: spec.min } : {}), ...(spec.max !== undefined ? { max: spec.max } : {}), ...plain(spec), onValuechange: on });
      return { element: el, value: () => { const v = String(el.value ?? "").trim(); if (!v) return null; const n = Number(v); return Number.isFinite(n) ? n : v; } };
    }
    case "group":
      return group(spec, start, ctx);
    case "list":
      return list(spec, start, ctx);
    default: {
      const long = spec.kind === "textarea" || spec.kind === "richtext";
      const type = { email: "email", tel: "tel", url: "url" }[spec.kind] || "text";
      const el = h("text-field", { label: spec.label, ...(long ? { rows: spec.kind === "richtext" ? 8 : 4 } : { type }), value: String(start ?? ""), ...(spec.max ? { maxlength: spec.max } : {}), ...plain(spec), onValuechange: on });
      const parts = [el];
      if (spec.picture && ctx.pickPicture) {
        parts.push(h("action-button", { variant: "secondary", size: "sm", onClick: async (e) => { const url = await ctx.pickPicture(e.currentTarget); if (url) { el.value = url; on(); } } }, "Choose one of your photos"));
      }
      return { element: parts.length > 1 ? h("div", { class: "studio-field-with" }, ...parts) : el, value: () => String(el.value ?? ""), id };
    }
  }
}

/** An optional group (a picture, a button): Add / Remove. A fixed group (a component's settings) is always there. */
function group(spec, start, ctx) {
  let inner = null;
  const host = h("div", { class: "studio-field-group-body" });
  const box = h("fieldset", { class: "studio-field-group" }, h("legend", { text: spec.label }), host);
  const toggle = spec.fixed ? null : h("action-button", { variant: "secondary", size: "sm", onClick: () => { inner ? drop() : make(spec.blank?.() || {}); ctx.onChange?.(); } });
  if (toggle) box.append(toggle);
  function make(data) {
    inner = form(spec.fields || [], data, ctx);
    host.replaceChildren(inner.element);
    if (toggle) toggle.textContent = spec.removeLabel || "Remove";
  }
  function drop() {
    inner = null;
    host.replaceChildren();
    if (toggle) toggle.textContent = spec.addLabel || `Add ${spec.label.toLowerCase()}`;
  }
  if (start && typeof start === "object") make(start); else if (spec.fixed) make({}); else drop();
  return { element: box, value: () => (inner ? inner.value() : null) };
}

/** A list of items (buttons, hours, questions): each with its fields, Move up, Move down, Remove; and Add. */
function list(spec, start, ctx) {
  const items = [];
  const ul = h("ol", { class: "studio-field-list" });
  const say = h("p", { class: "studio-visually-hidden", "aria-live": "polite" });
  const add = h("action-button", { variant: "secondary", size: "sm", onClick: () => { push(spec.blank?.() || {}); draw(); ctx.onChange?.(); ul.lastElementChild?.querySelector("input, textarea, select")?.focus(); } }, spec.addLabel || "Add one");
  const box = h("fieldset", { class: "studio-field-group" }, h("legend", { text: spec.label }), ul, add, say);
  const max = spec.max || 50;
  function push(data) { items.push(form(spec.fields || [], data, ctx)); }
  function move(index, by) {
    const [item] = items.splice(index, 1);
    items.splice(index + by, 0, item);
    draw();
    ctx.onChange?.();
    say.textContent = `Moved to number ${index + by + 1} of ${items.length}.`;
    ul.children[index + by]?.querySelector(by < 0 ? ".studio-move-up" : ".studio-move-down")?.querySelector("button")?.focus();
  }
  function remove(index) {
    items.splice(index, 1);
    draw();
    ctx.onChange?.();
    say.textContent = `Removed. ${items.length} left.`;
    (ul.children[Math.min(index, items.length - 1)]?.querySelector("input, textarea, select") || add.querySelector("button"))?.focus();
  }
  function draw() {
    ul.replaceChildren(...items.map((item, index) => h("li", { class: "studio-field-item" },
      item.element,
      h("div", { class: "studio-field-item-tools" },
        h("action-button", { variant: "ghost", size: "sm", class: "studio-move-up", disabled: index === 0, onClick: () => move(index, -1) }, `Move up`),
        h("action-button", { variant: "ghost", size: "sm", class: "studio-move-down", disabled: index === items.length - 1, onClick: () => move(index, 1) }, `Move down`),
        h("action-button", { variant: "ghost", size: "sm", onClick: () => remove(index) }, "Remove")))));
    add.hidden = items.length >= max;
  }
  for (const data of Array.isArray(start) ? start : []) push(data);
  draw();
  return { element: box, value: () => items.map((item) => item.value()) };
}

/** The whole form for `specs` filled from `data`. Keys the form doesn't know are kept as they were. */
export function form(specs, data = {}, ctx = {}) {
  const fields = specs.map((spec) => [spec, field(spec, data?.[spec.name] ?? startValue(spec), ctx)]);
  const element = h("div", { class: "studio-field-form" }, ...fields.map(([, f]) => f.element));
  return {
    element,
    value() {
      const out = { ...(data || {}) };
      for (const [spec, f] of fields) {
        const v = f.value();
        if (v === null || v === "" || (Array.isArray(v) && !v.length && !spec.keepEmpty)) delete out[spec.name];
        else out[spec.name] = v;
      }
      return out;
    },
    focus: () => element.querySelector("input, textarea, select, button")?.focus(),
  };
}
