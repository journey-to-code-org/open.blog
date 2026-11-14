// One side-sheet that guards her unsaved work: closing it (Escape, the ×, Cancel) or leaving the
// screen while it holds changes asks first ("Save this topic?" / Save / Leave without saving). The
// screen hands its `leave()` and `isDirty()` to the router through `guardedLeave`. Focus goes back
// to whatever opened the sheet. Used by the R1 sheets (topics, requests, shares).
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { ask } from "./dialogs.js";
import { trapFocus } from "./focus-trap.js";

/**
 * `question` is { heading, text?, save, leave } for the leave-guard; `save()` resolves true once
 * saved (the sheet is then closed by the caller or by `close()`).
 */
export async function createSheet({ label, wide = true }) {
  await use("side-sheet", "action-button");
  const element = h("side-sheet", { label, side: "right", class: wide ? "studio-wide-sheet" : "" });
  trapFocus(element, () => element.open);
  let current = null; // { dirty, save, question, opener }
  let asking = false;
  // While a close we asked for is still reaching the native dialog: its "close" event comes a task
  // later, and if the sheet were opened again before it, that late event would shut the new sheet
  // (and finish it) as soon as it showed. An open waits for this instead.
  let settling = null;

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

  /** Ask before closing a sheet with changes; staying puts focus back inside it. */
  async function askThenClose() {
    if (await confirmLeave()) close();
    else if (current) requestAnimationFrame(() => current?.focus?.());
  }

  // Escape with changes: ask before the sheet's dialog closes at all, so it stays where it is.
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !current?.dirty?.()) return;
    event.preventDefault();
    event.stopPropagation();
    if (!asking) askThenClose();
  }, true);

  // Waits for the component to settle closed, then opens it again (a write of `open` back to true
  // inside its own openchange would leave the native dialog shut while `open` says true).
  const reopen = () => new Promise((done) => requestAnimationFrame(() => {
    if (current) element.open = true;
    requestAnimationFrame(done);
  }));

  element.addEventListener("openchange", async (event) => {
    if (event.target !== element || event.detail || !current) return;
    // Closed by the × (or by the browser) with changes: open it again while she answers.
    if (current.dirty?.()) {
      await reopen();
      if (!asking) await askThenClose();
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

  /** Open with `children`; `focus` runs once it shows. Safe straight after `close()`. */
  function show({ heading, children, dirty = () => false, save = null, question = null, opener = document.activeElement, focus = null, onClose = null }) {
    const shown = { dirty, save, question, opener, focus, onClose };
    current = shown;
    element.label = heading;
    element.replaceChildren(h("span", { slot: "heading", text: heading }), ...children.flat().filter(Boolean));
    if (!element.isConnected) document.body.append(element);
    const open = () => {
      if (current !== shown) return; // closed, or replaced, while the last close settled
      element.open = true;
      requestAnimationFrame(() => focus?.());
    };
    if (settling) settling.then(open);
    else open();
  }

  /** Resolves once the native dialog has really closed (its "close" event), or at once if it isn't open. */
  function settle() {
    const dialog = element.querySelector(":scope > dialog");
    if (!dialog?.open || !element.isConnected) return null;
    const done = new Promise((resolve) => {
      const end = () => {
        clearTimeout(timer);
        dialog.removeEventListener("close", end);
        if (settling === done) settling = null;
        resolve();
      };
      // A safety net only: the close event comes within a task of the component's update.
      const timer = setTimeout(end, 1000);
      dialog.addEventListener("close", end);
    });
    return done;
  }

  /** Close without asking (after a save, or Cancel on a sheet with nothing changed). */
  function close() {
    if (!current) return;
    // Setting `open` from outside fires no openchange, so the sheet is finished here.
    element.open = false;
    settling = settle() || settling;
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
