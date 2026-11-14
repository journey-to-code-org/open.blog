// Taking a post off the site, and deleting it (or throwing away one never saved). Both ask first,
// both bring her latest words along, and a delete can be undone (parts/undo.js). Also what Write
// says after a publish, and leaving Write with unsaved work. Write screen only.
import { h, toast } from "./dom.js";
import { sendOut, wentOutWords } from "./publish.js";
import { statusLine } from "./post-fields.js";
import { takeOffQuestion } from "./take-off.js";

export function postActions({ api, meta, ask, kept, keptKey, doc, context, title, formTitle, isDirty, isPublished, saveNow, settle, paint, published,
  banner, form, now, schedule, read, verb, focusTitle }) {
  async function takeOff(asked = false) {
    if (!asked && (await ask(takeOffQuestion(title() || "this post"))) !== "yes") return;
    // Her latest changes come along: it's saved as a draft with what's on screen.
    if (!(await saveNow("draft", { force: true }))) return;
    const sent = await sendOut(api, `Take ${formTitle()} off the site`);
    published(sent);
    const said = wentOutWords(sent, { meta, action: "takenOff" });
    toast(said.words, { variant: said.variant });
    paint();
  }

  async function remove() {
    const name = title() || "this post";
    if (!doc.path) {
      const choice = await ask({ heading: "Throw this away?", text: "It hasn't been saved, so it can't be brought back.", choices: [{ label: "Throw it away", value: "yes", variant: "destructive" }, { label: "Keep writing", value: "no", variant: "secondary" }] });
      if (choice !== "yes") return;
      kept.clear(keptKey);
      settle();
      context.go("#/posts");
      return;
    }
    // Undo brings back what she saw, so a draft's pending changes are saved first.
    if (isDirty() && !isPublished() && !(await saveNow("draft", { quiet: true }))) return;
    const deleted = await context.undo.deletePost({
      path: doc.path, etag: doc.etag, title: name, state: doc.state, ask,
      fieldJournal: doc.fields.profile === "field-journal",
      takeOff: () => takeOff(true),
    });
    if (deleted) {
      kept.clear(doc.path);
      settle();
      context.go("#/posts");
    }
  }

  // After a publish: send the site out if Studio does that, and say only what's true.
  async function announce(wasLive = false) {
    const result = await sendOut(api, formTitle());
    published(result);
    const when = doc.state === "scheduled" ? statusLine({ state: "scheduled", date: form().date }, now()) : "";
    if (result.sent === "failed") notSentOut(result.message);
    else if (when) toast(`${when}.${schedule() === "self" ? "" : " It goes up the next time your blog is sent out after that."}`);
    else {
      const said = wentOutWords(result, { meta, action: wasLive ? "updated" : "published" });
      toast(said.words, { variant: said.variant });
    }
    paint();
  }

  function notSentOut(why) {
    toast("Published here, but it hasn't reached your readers yet.", { variant: "warning", duration: 0 });
    banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "Not sent out yet" },
      "Your post is safe. It just hasn't gone out to your readers. ", why ? h("span", { class: "studio-detail", text: why }) : null,
      h("action-button", { variant: "secondary", onClick: () => announce() }, "Send it out again")));
  }

  // Leaving with unsaved work: a new post without a title asks; a published one asks to update or
  // keep the changes here; a draft saves first.
  async function leave() {
    if (!isDirty()) return true;
    const values = read();
    if (doc.state === "new" && !values.title.trim()) {
      if (!values.body.trim() && !form().cover) { kept.clear(keptKey); return true; }
      const choice = await ask({ heading: "Leave without a title?", text: ["A post needs a title to be kept as a draft.", "If you leave, your words wait on this device for next time."], choices: [{ label: "Add a title", value: "stay" }, { label: "Leave for now", value: "go", variant: "secondary" }, { label: "Throw it away", value: "discard", variant: "destructive" }] });
      if (choice === "stay" || choice === null) { setTimeout(() => focusTitle(), 0); return false; }
      if (choice === "discard") kept.clear(keptKey);
      return true;
    }
    if (isPublished()) {
      const choice = await ask({ heading: "Your changes aren't on your site yet", text: `They stay on this device until you come back, or you can ${verb().toLowerCase()} now.`, choices: [{ label: `${verb()} now`, value: "update" }, { label: "Leave for now", value: "go", variant: "secondary" }] });
      if (choice === "update") return saveNow("publish");
      return choice === "go";
    }
    return saveNow("draft", { quiet: true });
  }

  return { takeOff, remove, announce, leave };
}
