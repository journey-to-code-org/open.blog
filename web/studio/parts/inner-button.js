// ARIA that a Zubra `action-button` doesn't carry itself (pressed, disabled-but-focusable,
// described-by): set on its inner <button> once it has drawn one. The component keeps attributes
// it doesn't manage, so they last across its updates.

/** Set (or with `null`, remove) attributes on the inner button of `element`, now or once it exists. */
export function innerAria(element, attributes, tries = 10) {
  const button = element?.querySelector?.("button, a");
  if (!button) {
    if (tries > 0) requestAnimationFrame(() => innerAria(element, attributes, tries - 1));
    return;
  }
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) button.removeAttribute(name);
    else button.setAttribute(name, String(value));
  }
}
