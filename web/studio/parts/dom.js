// h(): build an element in one call. Zubra UI elements must be defined first (see zubra.js `use`),
// so their props land on the element's own setters instead of shadowing them.
//
//   h("action-button", { variant: "secondary", onClick: save }, "Save draft")
//
// - `onName`: a listener for the "name" event (lower-cased): onClick, onValuechange, onSelect.
// - `class`, `id`, `slot`, `role`, `for`, `hidden`, and any `aria-*` or `data-*`: attributes.
// - `text`: textContent. Anything else the element has as a property is set as a property (arrays,
//   objects, booleans for Zubra UI props), otherwise as an attribute.
// - Children: nodes, strings (as text, never markup), arrays, and null/false (skipped).

const ATTRIBUTES = new Set(["class", "id", "slot", "role", "for", "tabindex", "title", "lang", "hidden", "href", "type", "name", "autocomplete"]);

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false && (ATTRIBUTES.has(key) || key.startsWith("aria-") || key.startsWith("data-"))) continue;
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "text") {
      node.textContent = String(value);
    } else if (ATTRIBUTES.has(key) || key.startsWith("aria-") || key.startsWith("data-")) {
      node.setAttribute(key, value === true ? "" : String(value));
    } else if (key in node) {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Replace a node's children, skipping null/false like h() does. */
export function fill(node, ...children) {
  node.replaceChildren();
  return append(node, children);
}

/** Tell the person something in a toast (Zubra UI's toast-region listens on the document). */
export function toast(message, { variant = "success", duration, heading, action } = {}) {
  document.dispatchEvent(new CustomEvent("toast", { detail: { message, variant, duration, heading, action } }));
}
