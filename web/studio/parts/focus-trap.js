// Keeps Tab inside an open sheet or dialog: past the last control it goes to the first, and
// Shift+Tab from the first goes to the last. A native modal stops the page behind from taking
// focus but lets Tab leave the page altogether (to the browser's own bar), which a keyboard user
// then has to find their way back from.
const TABBABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";

const shown = (node) => (typeof node.checkVisibility === "function" ? node.checkVisibility() : node.getClientRects().length > 0);

/** The controls Tab stops at inside `root`, in order. */
export function tabStops(root) {
  return [...root.querySelectorAll(TABBABLE)].filter((node) => node.tabIndex >= 0 && !node.closest("[inert]") && shown(node));
}

/** Wrap Tab within `root` while `active()` says it is open. */
export function trapFocus(root, active = () => true) {
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.defaultPrevented || !active()) return;
    const stops = tabStops(root);
    if (!stops.length) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    const here = document.activeElement;
    const outside = !root.contains(here);
    if (event.shiftKey && (here === first || outside)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (here === last || outside)) { event.preventDefault(); first.focus(); }
  });
}
