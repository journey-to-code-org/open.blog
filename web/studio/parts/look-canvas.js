// The canvas: her real front page in one look, always on screen beside what she is changing
// (What's hanging's switches, a new look's colours and pieces), redrawn after each change. Built
// by the site's own theme in memory (POST seasons/preview unless the caller asks its own way);
// nothing is written. The page runs in a sandboxed frame with no access to
// Studio, as in See how it looks.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";

/** The width a page is laid out at before it is scaled to fit, in CSS pixels. */
const WIDTHS = { computer: 1100, phone: 390 };

/**
 * `{ element, show(look, label, key, { request }) }`: `key` changes when what the page would show
 * changes; `request()` answers `{ previewUrl }` (a saved look by default).
 */
export async function createLookCanvas({ api }) {
  await use("segmented-control", "alert-banner", "action-button");
  // On a phone the switch is hidden and the page is shown as a phone shows it.
  const small = globalThis.matchMedia?.("(max-width: 40rem)").matches === true;
  const fit = h("div", { class: "studio-canvas-fit" });
  const stage = h("div", { class: "studio-canvas-stage", "data-device": small ? "phone" : "computer" }, fit);
  // The page is laid out at a real screen's width and scaled down to the room there is, so
  // "Computer" shows what a computer shows, not a squeezed page.
  const resize = () => {
    const width = WIDTHS[stage.getAttribute("data-device")] || WIDTHS.computer;
    // In steps of 5%, as an attribute the stylesheet reads: Studio's code sets no styles.
    const scale = Math.min(1, (fit.clientWidth || width) / width);
    fit.setAttribute("data-scale", String(Math.max(25, Math.floor(scale * 20) * 5)));
  };
  if (globalThis.ResizeObserver) new ResizeObserver(resize).observe(fit);
  const device = h("segmented-control", { label: say("decorations.canvasShowOn"), value: stage.getAttribute("data-device"), class: "studio-canvas-device",
    options: [{ value: "computer", label: say("decorations.canvasComputer") }, { value: "phone", label: say("decorations.canvasPhone") }],
    onValuechange: (e) => { stage.setAttribute("data-device", e.detail); resize(); } });
  const element = h("div", { class: "studio-canvas" }, device, stage, h("p", { class: "studio-help", text: say("decorations.canvasNote") }));
  let shown = null; // the key on screen
  let asked = 0; // only the latest request draws

  async function show(look, label, key = look, { again = false, request = () => api.post("seasons/preview", { look }) } = {}) {
    if (!look || (!again && key === shown)) return;
    shown = key;
    const mine = ++asked;
    // The page on screen stays until the new one is ready, so a switch never blanks the canvas.
    // A cue for the eye only: the status line beside the switches already says what changed.
    const waiting = h("p", { class: "studio-canvas-wait", "aria-hidden": "true", text: say("decorations.canvasWait") });
    stage.querySelector(".studio-canvas-wait, alert-banner")?.remove();
    stage.prepend(waiting);
    try {
      const reply = await request();
      if (mine !== asked) return;
      const frame = h("iframe", { class: "studio-canvas-frame", title: say("decorations.canvasTitle", { look: label || look }) });
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("src", reply.previewUrl);
      fit.replaceChildren(frame);
      stage.querySelector(".studio-canvas-wait")?.remove();
      resize();
    } catch {
      if (mine !== asked) return;
      shown = null;
      stage.querySelector(".studio-canvas-wait")?.remove();
      fit.replaceChildren(h("alert-banner", { variant: "danger", heading: say("decorations.canvasFailed") }, say("decorations.canvasFailedHelp"),
        h("action-button", { variant: "secondary", onClick: () => show(look, label, key, { again: true, request }) }, say("decorations.canvasRetry"))));
    }
  }

  return { element, show };
}
