// When a save on the Write screen doesn't go through: the same title as another post, a problem
// the server named, a signed-out session, or the post changed on another device while she had it
// open. Her words always stay on screen; on a conflict she chooses which version to keep, and the
// other is kept beside it to copy from. An autosave never springs a question on her: it says so,
// and she chooses when she's ready.
//
// The Write screen hands over what this needs: its `doc` (path, etag, fields, state; changed here),
// how to read and repaint the form, and how to save or take the other device's version.
import { h, toast } from "./dom.js";
import { postState } from "./post-fields.js";
import { mineAside } from "./post-details.js";
import { askWhichToKeep, busyBanner, chooseLaterBanner } from "./conflict.js";

export function createTrouble({ api, banner, title, doc, read, now, paint, notSaved, saveNow, markDirty, takeTheirs }) {
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("Copied. Paste it wherever you need it."); } catch { toast("Select the words and copy them yourself.", { variant: "warning" }); }
  }

  async function resolveConflict(theirs, later) {
    const mine = read();
    const theirState = postState(theirs, now());
    const choice = await askWhichToKeep({ name: mine.title.trim() || "This post", theirState, myState: doc.state });
    if (choice === null) return later();
    doc.etag = theirs.etag;
    doc.fields = { ...theirs.fields };
    doc.state = theirState;
    if (choice === "mine") {
      markDirty();
      await saveNow(theirState === "draft" ? "draft" : "publish", { force: true });
      return;
    }
    banner.replaceChildren(mineAside(mine, copy));
    await takeTheirs(theirs);
  }

  // Someone else (or another device) changed the file while she had it open.
  async function conflict(quiet) {
    let theirs;
    notSaved("Not saved yet");
    try {
      theirs = await api.get(`document?path=${encodeURIComponent(doc.path)}`);
    } catch (error) {
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Not saved" }, error.message));
      paint();
      return;
    }
    paint();
    if (theirs.etag === doc.etag) return banner.replaceChildren(busyBanner());
    const later = () => banner.replaceChildren(chooseLaterBanner(() => resolveConflict(theirs, later)));
    if (quiet) return later();
    await resolveConflict(theirs, later);
  }

  /** A save that failed: say why in her words and keep everything she wrote. */
  async function problem(error, intent, quiet) {
    if (error.status === 409 && doc.path) return conflict(quiet);
    notSaved("Not saved yet");
    if (error.status === 409) {
      const name = read().title.trim();
      title.error = "There's already a post with this title. Change it a little and it will save.";
      toast(`Not saved yet: there's already a post called “${name}”. Change the title a little.`, { variant: "warning", duration: 0 });
      paint();
      return;
    }
    const lines = Array.isArray(error.data?.problems) ? error.data.problems : [];
    banner.replaceChildren(h("alert-banner", { variant: "danger", heading: intent === "publish" ? "Not published" : "Not saved" },
      error.message, lines.length ? h("ul", {}, lines.map((line) => h("li", { text: String(line) }))) : null,
      error.status === 401 ? h("action-button", { variant: "secondary", onClick: () => saveNow(intent) }, "Sign in and try again") : null));
    if (quiet && error.status !== 401) toast("Not saved yet. Your words are still here.", { variant: "warning" });
    paint();
  }

  return { problem, conflict, copy };
}
