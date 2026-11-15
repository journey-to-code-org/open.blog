// Save a copy of your notebook, and Bring in a notebook copy (Studio R11, Notebook › More). Saving
// a copy asks once, because the file holds everything private; it is made by the server and saved
// in the page. Bringing one in is read here as text (never parsed or shown), checked first, and
// only adds: nothing here is changed or removed, so there is no Undo (decision 8).
import { fill, h } from "./dom.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { createSheet } from "./sheet.js";
import { createDidLine } from "./did-line.js";
import { notebookImportRows, notebookImportSummary } from "./notebook-rules.js";
import { researchProblem, researchWords } from "./research-rules.js";
import { forHelper, saveFile, stranger } from "./research-ui.js";

const MAX_COPY = 4 * 1024 * 1024;

/** `state()` gives `{ revision }`; `onBrought(reply)` takes the new notebook; `tell(words)` says it on the screen. */
export async function createNotebookCopies({ api, state, onBrought, tell }) {
  const sheet = await createSheet({ label: say("notebook.bringTitle") });

  async function saveCopy() {
    const choice = await ask({ heading: say("notebook.copyTitle"), text: say("notebook.copyText"),
      choices: [{ label: say("notebook.copyGo"), value: "go", variant: "secondary" }, { label: say("notebook.copyStay"), value: "stay", variant: "primary" }], focus: 1 });
    if (choice !== "go") return;
    try {
      const reply = await api.post("research/export", { includePrivate: true });
      saveFile(reply.filename, reply.content, reply.mediaType || "application/json");
      tell(say("notebook.copied", { filename: String(reply.filename), passages: Number(reply.passages) || 0, notes: Number(reply.notes) || 0 }));
    } catch (error) {
      if (error?.status === 401) throw error;
      tell(researchWords(researchProblem(error, "notebook")), { variant: "problem" });
    }
  }

  function bringIn(opener) {
    let content = "";
    let checkedFor = null;
    const said = createDidLine();
    const banner = h("div", { "aria-live": "polite" });
    const result = h("div");
    const drop = h("file-drop", { label: say("notebook.bringFile"), accept: ".json,application/json", multiple: false, "max-size": 4 });
    const check = h("action-button", { variant: "secondary", onClick: () => run(false) }, say("notebook.bringCheck"));
    const apply = h("action-button", { class: "studio-primary", hidden: true, onClick: () => run(true) }, "");
    drop.addEventListener("fileschange", async (event) => {
      const file = [].concat(event.detail || [])[0];
      if (!file) return;
      if (file.size > MAX_COPY) { fill(banner, h("alert-banner", { variant: "warning" }, say("research.tooLarge"))); return; }
      try { content = await file.text(); } catch { fill(banner, h("alert-banner", { variant: "warning" }, say("notebook.bringNotCopy"))); return; }
      fill(banner);
      if (checkedFor !== null && content !== checkedFor) { apply.hidden = true; fill(result); }
    });
    async function run(doIt) {
      if (!content) return;
      said.tell(say("sources.importChecking"));
      try {
        const reply = await api.post("research/import", { revision: state().revision, content, apply: doIt });
        said.clear();
        checkedFor = content;
        const rows = notebookImportRows(reply.plan);
        const count = reply.plan?.counts?.create || 0;
        fill(result, h("p", { role: "status", text: notebookImportSummary(reply.plan) }),
          rows.length ? h("ul", { class: "studio-research-import-rows" }, rows.map((row) => h("li", {}, stranger("bdi", row.name), row.message ? stranger("p", row.message, { className: "studio-help" }) : null))) : null);
        if (reply.plan?.counts?.conflict > 0) fill(banner, h("alert-banner", { variant: "warning" }, say("notebook.bringBlocked")));
        if (doIt && reply.applied) {
          onBrought(reply);
          apply.hidden = true;
          said.tell(say("notebook.broughtIn", { summary: notebookImportSummary(reply.plan) }));
          return;
        }
        apply.hidden = !(reply.applicable !== false && count > 0);
        fill(apply, say("notebook.bringDo", { count }));
      } catch (error) {
        if (error?.status === 401) throw error;
        said.clear();
        const problem = researchProblem(error, "bring");
        fill(banner, h("alert-banner", { variant: problem.signal ? "info" : "warning", role: "alert" }, h("p", { text: researchWords(problem) }), forHelper(problem.details)));
      }
    }
    sheet.show({ heading: say("notebook.bringTitle"), opener,
      children: [h("p", { class: "studio-lede", text: say("notebook.bringLede") }), drop, h("div", { class: "studio-row" }, check), banner, result, h("div", { class: "studio-sheet-footer" }, said.element, apply)],
      focus: () => drop.querySelector("input, button")?.focus() });
  }

  return { saveCopy, bringIn, leave: () => sheet.leave(), element: sheet.element };
}
