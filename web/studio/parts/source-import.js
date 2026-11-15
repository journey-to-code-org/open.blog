// Import sources and Export your library (Studio R11, Sources › More). An import is read here as
// text (never parsed or shown: the preview is only the server's plan), checked first, and applied
// only when she presses Import; it never removes anything, so there is no Undo (decision 8). An
// export is made by the server and saved in the page. Nothing is looked up online (decision 10).
import { fill, h } from "./dom.js";
import { say } from "./words.js";
import { createSheet } from "./sheet.js";
import { createDidLine } from "./did-line.js";
import { sourceExportLossNotes, sourceImportRows, sourceImportSummary } from "./source-rules.js";
import { researchProblem, researchWords } from "./research-rules.js";
import { choiceGroup, forHelper, saveFile, stranger } from "./research-ui.js";

const MAX_IMPORT = 3 * 1024 * 1024;
const PAGE = 50;

/** `state()` gives `{ revision }`; `onImported(reply)` takes the new library. `{ openImport(opener), openExport(opener), leave() }`. */
export async function createSourceSheets({ api, state, onImported }) {
  const sheet = await createSheet({ label: say("sources.importTitle") });

  function openImport(opener) {
    let content = "";
    let checkedFor = null;
    let plan = null;
    let shown = PAGE;
    const said = createDidLine();
    const banner = h("div", { "aria-live": "polite" });
    const result = h("div", { class: "studio-research-import" });
    const drop = h("file-drop", { label: say("sources.importFile"), accept: ".json,application/json,application/vnd.citationstyles.csl+json", multiple: false, "max-size": 3 });
    const paste = h("text-field", { label: say("sources.importPaste"), rows: 6, class: "studio-mono-field", onValuechange: (e) => { content = String(e.detail ?? ""); stale(); } });
    const check = h("action-button", { variant: "secondary", onClick: () => run(false) }, say("sources.importCheck"));
    const apply = h("action-button", { class: "studio-primary", hidden: true, onClick: () => run(true) }, "");
    drop.addEventListener("fileschange", async (event) => {
      const file = [].concat(event.detail || [])[0];
      if (!file) return;
      if (file.size > MAX_IMPORT) { fill(banner, h("alert-banner", { variant: "warning" }, say("sources.importTooBig"))); return; }
      try { content = await file.text(); } catch { fill(banner, h("alert-banner", { variant: "warning" }, say("sources.importNotJson"))); return; }
      paste.value = content;
      stale();
    });
    function stale() {
      fill(banner);
      if (checkedFor !== null && content !== checkedFor) {
        apply.hidden = true;
        said.tell(say("sources.importAgain"));
      }
    }
    function paint() {
      const rows = sourceImportRows(plan);
      const group = (action, heading) => {
        const list = rows.filter((row) => row.action === action);
        if (!list.length) return null;
        return h("section", { class: "studio-section" }, h("h3", { text: heading }),
          h("ul", { class: "studio-research-import-rows" }, list.slice(0, shown).map((row) => h("li", {},
            stranger("bdi", row.name, { className: "studio-research-import-name" }),
            ...row.details.map((line) => stranger("p", line, { className: "studio-help" })),
            ...row.problems.map((line) => h("p", { class: "studio-field-error", text: line })),
            row.problemDetails.length ? h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), ...row.problemDetails.map((line) => stranger("p", line, { className: "studio-mono" }))) : null))));
      };
      const total = rows.length;
      fill(result,
        h("p", { role: "status", text: sourceImportSummary(plan) }),
        group("create", say("sources.importGroupNew")),
        group("update", say("sources.importGroupUpdated")),
        group("conflict", say("sources.importGroupBlocked")),
        total > shown ? h("action-button", { variant: "secondary", onClick: () => { shown += PAGE; paint(); } }, say("sources.importMore")) : null);
      const count = (plan?.counts?.create || 0) + (plan?.counts?.update || 0);
      apply.hidden = !(plan?.applicable !== false && count > 0 && !(plan?.counts?.conflict > 0));
      fill(apply, say("sources.importDo", { count }));
      if (plan?.counts?.conflict > 0) fill(banner, h("alert-banner", { variant: "warning" }, say("sources.importBlocked")));
    }
    async function run(doIt) {
      if (!content.trim()) { fill(banner, h("alert-banner", { variant: "info" }, say("sources.importNeed"))); return; }
      if (new Blob([content]).size > MAX_IMPORT) { fill(banner, h("alert-banner", { variant: "warning" }, say("sources.importTooBig"))); return; }
      fill(banner);
      said.tell(say("sources.importChecking"));
      try {
        const reply = await api.post("sources/import", { revision: state().revision, content, apply: doIt });
        said.clear();
        plan = { ...(reply.plan || {}), applicable: reply.applicable };
        checkedFor = content;
        if (doIt && reply.applied) {
          onImported(reply);
          shown = PAGE;
          paint();
          apply.hidden = true;
          said.tell(say("sources.imported", { summary: sourceImportSummary(reply.plan) }));
          return;
        }
        paint();
      } catch (error) {
        if (error?.status === 401) throw error;
        said.clear();
        if (error?.data?.plan) { plan = { ...error.data.plan, applicable: false }; checkedFor = content; paint(); return; }
        const problem = researchProblem(error, "import");
        fill(banner, h("alert-banner", { variant: problem.signal ? "info" : "warning", role: "alert" }, h("p", { text: researchWords(problem) }), forHelper(problem.details)));
      }
    }
    sheet.show({
      heading: say("sources.importTitle"), opener,
      children: [h("p", { class: "studio-lede", text: say("sources.importLede") }), drop, paste, h("div", { class: "studio-row" }, check), banner, result,
        h("div", { class: "studio-sheet-footer" }, said.element, apply)],
      focus: () => drop.querySelector("input, button")?.focus(),
    });
  }

  function openExport(opener) {
    const said = createDidLine();
    const format = choiceGroup({ legend: say("sources.exportFormat"), value: "csl-json", choices: [
      { value: "csl-json", label: say("sources.exportCsl"), help: say("sources.exportCslHelp") },
      { value: "bibtex", label: say("sources.exportBib"), help: say("sources.exportBibHelp") },
    ] });
    const go = h("action-button", { class: "studio-primary", onClick: async () => {
      go.loading = true;
      try {
        const reply = await api.get(`sources/export?format=${encodeURIComponent(format.value)}`);
        saveFile(reply.filename, reply.content, reply.mediaType || "application/json");
        const losses = sourceExportLossNotes(reply.losses);
        said.tell(`${say("sources.exported", { filename: String(reply.filename), count: Number(reply.count) || 0 })}${losses.length ? ` ${say("sources.exportLoss", { list: losses.join("; ") })}` : ""}`);
      } catch (error) {
        if (error?.status === 401) throw error;
        said.tell(researchWords(researchProblem(error, "sources")), { variant: "problem" });
      } finally {
        go.loading = false;
      }
    } }, say("sources.exportDo"));
    sheet.show({ heading: say("sources.exportTitle"), opener,
      children: [format.element, h("p", { class: "studio-help", text: say("sources.exportHelp") }), h("div", { class: "studio-sheet-footer" }, said.element, go)],
      focus: () => format.focus() });
  }

  return { openImport, openExport, leave: () => sheet.leave(), element: sheet.element };
}
