// When a save on the Write screen doesn't go through: the same title as another post, a problem
// the server named, a signed-out session, or the post changed on another device while she had it
// open. Her words always stay on screen; on a conflict she chooses which version to keep, and the
// other is kept beside it to copy from. An autosave never springs a question on her: it says so,
// and she chooses when she's ready.
//
// The Write screen hands over what this needs: its `doc` (path, etag, fields, state; changed here),
// how to read and repaint the form, and how to save or take the other device's version. R5: every
// refusal the server names by code (G36) is said in her words beside its field (`saveProblem`).
import { h, toast } from "./dom.js";
import { ask } from "./dialogs.js";
import { postState } from "./post-fields.js";
import { mineAside } from "./post-details.js";
import { askWhichToKeep, busyBanner, chooseLaterBanner } from "./conflict.js";
import { saveProblem } from "./about-rules.js";

export function createTrouble({ api, banner, title, day, doc, read, now, paint, notSaved, saveNow, markDirty, takeTheirs, about, aboutProblem, saveAsNew }) {
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
    creditsWaiting = null;
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

  // Who wrote it changed on another computer: use theirs, or keep hers against their version.
  // Until she chooses, nothing about who wrote it is sent (her other changes still save) and a
  // banner keeps the question in reach; closing the question is not a choice. An autosave never
  // springs it on her. What she pressed (Publish, Save) is what happens once she has chosen.
  let creditsWaiting = null; // { theirs, intent } while she hasn't chosen

  const waitingWords = (intent) => `${intent === "publish" ? "Not published yet" : "Not saved yet"}: choose which list of who wrote it to keep.`;

  function creditsBanner() {
    banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "Who wrote this post was changed on another computer." },
      "Your list is still here. Nothing about who wrote it is saved until you choose.",
      h("action-button", { variant: "secondary", class: "studio-credits-choose", onClick: () => chooseCredits() }, "Choose which list to keep")));
  }

  async function creditsChanged(intent, quiet) {
    let theirs;
    try { theirs = await api.get(`document?path=${encodeURIComponent(doc.path)}`); } catch { return; }
    creditsWaiting = { theirs, intent: creditsWaiting?.intent === "publish" ? "publish" : intent };
    notSaved(waitingWords(creditsWaiting.intent));
    creditsBanner();
    paint();
    if (!quiet) await chooseCredits();
  }

  async function chooseCredits() {
    if (!creditsWaiting) return;
    const { theirs, intent } = creditsWaiting;
    const choice = await ask({ heading: "Who wrote this post was changed on another computer.", text: "Keep the list from there, or the one you made here?",
      choices: [{ label: "Use that list", value: "theirs" }, { label: "Keep mine", value: "mine", variant: "secondary" }] });
    if (choice !== "theirs" && choice !== "mine") return banner.querySelector(".studio-credits-choose button")?.focus();
    creditsWaiting = null;
    banner.replaceChildren();
    // Only her answer takes their version's tag: "Keep mine" now replaces it on purpose.
    doc.creditEtag = theirs.creditEtag ?? null;
    if (choice === "theirs") about.takeCredits(theirs);
    markDirty();
    await saveNow(intent, { force: true, quiet: intent !== "publish" });
  }

  // The server's own sentences, for the person who set up the site.
  const serverDetail = (error) => {
    const lines = Array.isArray(error.data?.problems) ? error.data.problems : [];
    return h("details", { class: "studio-help" }, h("summary", { text: "For the person who set up your site" }),
      h("p", { class: "studio-detail", text: error.message || "" }), lines.length ? h("ul", {}, lines.map((line) => h("li", { class: "studio-detail", text: String(line) }))) : null);
  };

  /** A save that failed: say why in her words, beside its field, and keep everything she wrote. */
  async function problem(error, intent, quiet) {
    const said = saveProblem(error);
    if (said.where === "conflict" && doc.path) return conflict(quiet);
    notSaved("Not saved yet");
    if (said.where === "credits" && error.data?.code === "credits-changed" && doc.path) return creditsChanged(intent, quiet);
    if (said.where === "title") {
      const name = read().title.trim();
      title.error = said.words;
      toast(`Not saved yet: there's already a post called “${name}”. Change the title a little.`, { variant: "warning", duration: 0 });
    } else if (said.where === "about" || said.where === "credits") {
      aboutProblem(said.field, said.words, quiet);
    } else if (said.where === "date") {
      day.error = said.words;
      if (!quiet) day.querySelector("input")?.focus();
    } else if (said.where === "gone") {
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "This post isn't on your blog any more" },
        "It may have been deleted on another computer. Your words are still here.",
        h("action-button", { onClick: () => saveAsNew() }, "Save it as a new post"),
        h("action-button", { variant: "secondary", href: "#/posts" }, "Back to your posts")));
    } else if (said.where === "status") {
      // Said once: the status says it isn't saved, the banner says why and offers Try again.
      banner.replaceChildren(h("alert-banner", { variant: "warning" }, said.words,
        h("action-button", { variant: "secondary", onClick: () => saveNow(intent) }, "Try again")));
    } else if (said.where === "signin") {
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: intent === "publish" ? "Not published" : "Not saved" },
        "Sign in again to save. Your words are kept.", h("action-button", { variant: "secondary", onClick: () => saveNow(intent) }, "Sign in and try again")));
    } else {
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: intent === "publish" ? "Not published" : "Not saved" },
        said.words || error.message, serverDetail(error)));
    }
    if (quiet && said.where === "banner") toast("Not saved yet. Your words are still here.", { variant: "warning" });
    paint();
  }

  return {
    problem, conflict, copy,
    /** While she hasn't chosen whose list to keep, a save leaves who wrote it alone. */
    creditsWaiting: () => Boolean(creditsWaiting),
    /** After a save that went through: the question about who wrote it stays in reach. */
    afterSave() { if (creditsWaiting) { notSaved(waitingWords(creditsWaiting.intent)); creditsBanner(); } },
    /** The post was reloaded from the other computer: nothing is waiting any more. */
    forgetCredits() { creditsWaiting = null; },
  };
}

/** A post that didn't open at all: why, and the way back. */
export function cantOpen(banner, error) {
  banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "This post didn't open" }, error.message,
    h("action-button", { variant: "secondary", href: "#/posts" }, "Back to your posts")));
}

/** A post whose settings at the top can't be read: the server's reason and the file, so it can be fixed. */
export function unreadable(banner, path, reply) {
  banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "This post can't be changed here" },
    "Something at the top of its file needs fixing first. Tell the person who set up your site.",
    h("details", { class: "studio-help" }, h("summary", { text: "For the person who set up your site" }),
      h("p", { class: "studio-mono", text: `content/${path || ""}${reply.error ? `: ${reply.error}` : ""}` }),
      h("text-field", { label: "The file as it is", rows: 12, readonly: true, value: String(reply.raw || "") }))));
}
