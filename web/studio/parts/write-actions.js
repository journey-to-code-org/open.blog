// Taking a post off the site, and deleting it (or throwing away one never saved). Both ask first,
// both bring her latest words along, and a delete can be undone (parts/undo.js). Write screen only.
import { toast } from "./dom.js";
import { sendOut, wentOutWords } from "./publish.js";
import { takeOffQuestion } from "./take-off.js";

export function postActions({ api, meta, ask, kept, keptKey, doc, context, title, formTitle, isDirty, isPublished, saveNow, settle, paint, published }) {
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

  return { takeOff, remove };
}
