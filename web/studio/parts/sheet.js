// One side-sheet that guards her unsaved work: closing it (Escape, the ×, Cancel) or leaving the
// screen while it holds changes asks first ("Save this topic?" / Save / Leave without saving). The
// screen hands its `leave()` and `isDirty()` to the router through `guardedLeave`. Focus goes back
// to whatever opened the sheet. Used by the R1 sheets (topics, requests, shares).
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { ask } from "./dialogs.js";

/**
 * `question` is { heading, text?, save, leave } for the leave-guard; `save()` resolves true once
 * saved (the sheet is then closed by the caller or by `close()`).
 */
export async function createSheet({ label, wide = true }) {
  await use("side-sheet", "action-button");
  const element = h("side-sheet", { label, side: "right", class: wide ? "studio-wide-sheet" : "" });
  let current = null; // { dirty, save, question, opener }
  let asking = false;

  async function confirmLeave() {
    if (!current || !current.dirty?.()) return true;
    if (asking) return false;
    asking = true;
    const q = current.question || {};
    const choice = await ask({
      heading: q.heading || "Save your changes?",
      text: q.text || "You changed something here and didn't save it.",
      choices: [{ label: q.save || "Save", value: "save" }, { label: q.leave || "Leave without saving", value: "go", variant: "secondary" }],
    });
    asking = false;
    if (choice === "save") return Boolean(await current.save?.());
    return choice === "go";
  }

  element.addEventListener("openchange", async (event) => {
    if (event.target !== element || event.detail || !current) return;
    // Closed by Escape or the ×: keep it open while she answers.
    if (current.dirty?.()) {
      element.open = true;
      if (await confirmLeave()) close();
      else current?.focus?.();
      return;
    }
    finish();
  });

  function finish() {
    const opener = current?.opener;
    const after = current?.onClose;
    current = null;
    element.replaceChildren();
    after?.();
    if (opener?.isConnected) requestAnimationFrame(() => (opener.querySelector?.("button, a, input") || opener).focus?.());
  }

  /** Open with `children`; `focus` runs once it shows. */
  function show({ heading, children, dirty = () => false, save = null, question = null, opener = document.activeElement, focus = null, onClose = null }) {
    current = { dirty, save, question, opener, focus, onClose };
    element.label = heading;
    element.replaceChildren(h("span", { slot: "heading", text: heading }), ...children.flat().filter(Boolean));
    if (!element.isConnected) document.body.append(element);
    element.open = true;
    requestAnimationFrame(() => focus?.());
  }

  /** Close without asking (after a save, or Cancel on a sheet with nothing changed). */
  function close() {
    if (!current) return;
    // Setting `open` from outside fires no openchange, so the sheet is finished here.
    element.open = false;
    finish();
  }

  /** Cancel: asks first when something changed. */
  async function cancel() {
    if (await confirmLeave()) close();
  }

  return {
    element,
    show,
    close,
    cancel,
    get isOpen() { return Boolean(current); },
    /** Change what an open sheet guards (a form opened or closed inside it). */
    guard(next) { if (current) Object.assign(current, next); },
    isDirty: () => Boolean(current?.dirty?.()),
    /** For the screen's `leave()`: true when it may go. */
    async leave() {
      if (!current) return true;
      if (!(await confirmLeave())) return false;
      close();
      return true;
    },
  };
}

/** A screen's leave(): every open sheet asked in turn. */
export async function guardedLeave(...sheets) {
  for (const sheet of sheets) if (sheet && !(await sheet.leave())) return false;
  return true;
}
