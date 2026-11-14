// ARIA that a Zubra `action-button` doesn't carry itself (pressed, disabled-but-focusable,
// described-by): set on its inner <button> once it has drawn one. The component keeps attributes
// it doesn't manage, so they last across its updates.

// What each element is still waiting to have set, merged so the latest call wins: two calls made
// before the inner button exists must not land in the wrong order.
const pending = new WeakMap();
const waiting = new WeakSet();

/** Set (or with `null`, remove) attributes on the inner button of `element`, now or once it exists. */
export function innerAria(element, attributes, tries = 10) {
  if (!element) return;
  pending.set(element, { ...(pending.get(element) || {}), ...attributes });
  apply(element, tries);
}

function apply(element, tries) {
  const button = element.querySelector?.("button, a");
  if (!button) {
    if (tries > 0 && !waiting.has(element)) {
      waiting.add(element);
      requestAnimationFrame(() => { waiting.delete(element); apply(element, tries - 1); });
    }
    return;
  }
  const attributes = pending.get(element) || {};
  pending.delete(element);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) button.removeAttribute(name);
    else button.setAttribute(name, String(value));
  }
}
