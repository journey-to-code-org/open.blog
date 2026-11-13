// Deleting a post, and the Undo that stays until she's done with it. The banner lives in the shell
// (above every screen) and in sessionStorage, so moving between screens or reloading keeps it;
// it goes when she closes it, deletes something else, signs out or closes Studio.
import { h, toast } from "./dom.js";
import { use } from "../zubra.js";
import { howItGoesOut } from "./publish.js";

const KEY = "studio:undo";

function remember(value) {
  try {
    if (value) sessionStorage.setItem(KEY, JSON.stringify(value));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Without storage, Undo lasts as long as this page.
  }
}

function remembered() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

/** The shell's Undo slot. `deletePost` and `restore` are what screens call. */
export async function createUndo({ api, posts, slot, onRestored }) {
  await use("alert-banner", "action-button");
  let last = remembered();
  let wantsFocus = false; // the next screen to open gives focus to Undo, not its heading

  function draw() {
    if (!last) { slot.replaceChildren(); return; }
    const undo = h("action-button", { onClick: () => restore() }, "Undo");
    const detail = h("details", { class: "studio-undo-details" },
      h("summary", { text: "For the person who set up your site" }),
      h("p", { class: "studio-mono", text: `Moved content/${last.path} to .openblog/trash/${last.trashedTo}` }));
    const banner = h("alert-banner", { variant: "info", dismissible: true, heading: `Deleted “${last.title}”.` },
      last.wasLive && last.sendsOut ? "Readers stop seeing it in about a minute. " : "",
      "You can bring it back. ", h("cluster-layout", { gap: "0.5rem" }, undo), detail);
    banner.addEventListener("close", () => { last = null; remember(null); draw(); });
    slot.replaceChildren(banner);
    return undo;
  }

  async function restore() {
    if (!last) return;
    const what = last;
    try {
      const reply = await api.post("document/restore", {
        path: what.path, trashedTo: what.trashedTo, trashedCreditsTo: what.trashedCreditsTo ?? null, trashedContextTo: what.trashedContextTo || [],
      });
      last = null;
      remember(null);
      draw();
      posts.stale();
      const live = reply.status === "published" && what.sendsOut;
      toast(live ? `“${what.title}” is back. It's on your site again in about a minute.` : reply.status === "scheduled" ? `“${what.title}” is back, still scheduled.` : `“${what.title}” is back.`);
      onRestored?.(reply);
      requestAnimationFrame(() => document.querySelector("#studio-main h2")?.focus());
    } catch (error) {
      const words = error.status === 404 ? `“${what.title}” can't come back from here. The person who set up your site may still find it.`
        : error.status === 409 ? "There's a new post with that name now. Ask the person who set up your site to help bring this one back."
          : error.message;
      toast(words, { variant: "warning", duration: 0 });
    }
  }

  /**
   * Delete a post (asking first when it's on her site), then show Undo. `takeOff` is offered
   * instead for a published post. Resolves true when it was deleted.
   */
  async function deletePost({ path, etag, title, state, fieldJournal = false, ask, takeOff, list = "posts" }) {
    const wasLive = state === "published";
    if (wasLive || fieldJournal) {
      const choices = wasLive && takeOff
        ? [{ label: "Take it off my site instead", value: "takeoff" }, { label: "Delete it", value: "delete", variant: "destructive" }, { label: "Keep it", value: "keep", variant: "secondary" }]
        : [{ label: "Delete it", value: "delete", variant: "destructive" }, { label: "Keep it", value: "keep", variant: "secondary" }];
      const text = [wasLive
        ? `It's on your site now. Deleting takes it off your site and out of your ${list}.${takeOff ? " If you only want it off your site for now, take it off and keep it as a draft." : " Undo brings it back."}`
        : `Deleting it moves it out of your ${list}.`];
      if (fieldJournal) text.push("This one has a map track, so it can't be brought back from Studio.");
      const choice = await ask({ heading: `Delete “${title}”?`, text, choices });
      if (choice === "takeoff") { await takeOff(); return false; }
      if (choice !== "delete") return false;
    }
    let reply;
    try {
      reply = await api.call("DELETE", `document?path=${encodeURIComponent(path)}${etag ? `&etag=${encodeURIComponent(etag)}` : ""}`);
    } catch (error) {
      toast(error.status === 409 ? "This post changed since you opened it, so it wasn't deleted. Open it again first." : error.message, { variant: "warning", duration: 0 });
      return false;
    }
    posts.stale();
    if (reply.trashedTrackTo) {
      last = null;
      remember(null);
      draw();
      toast(`Deleted “${title}”.`);
      return true;
    }
    const goes = await howItGoesOut(api);
    last = { path, title, wasLive, sendsOut: goes.kind !== "none", trashedTo: reply.trashedTo, trashedCreditsTo: reply.trashedCreditsTo, trashedContextTo: reply.trashedContextTo };
    remember(last);
    draw();
    wantsFocus = true;
    requestAnimationFrame(() => focusUndo());
    return true;
  }

  function focusUndo() {
    const button = slot.querySelector("action-button .action-button");
    button?.focus();
    return Boolean(button);
  }

  draw();
  return {
    deletePost,
    restore,
    has: () => Boolean(last),
    /** Called by the shell when a screen opens: Undo keeps focus right after a delete. */
    takeFocus() {
      if (!wantsFocus) return false;
      wantsFocus = false;
      return focusUndo();
    },
    forget: () => { last = null; remember(null); draw(); },
  };
}
