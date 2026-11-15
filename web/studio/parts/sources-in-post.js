// Sources in this post (Studio R11, About this post, decision 5): how sources show (numbered
// notes, a list of works, or not yet), the language of the notes, how many citations of how many
// works the last look found, and the works it cites to download. These save with the post, like
// everything in About this post. Shown on research posts, posts that chose how citations show, and
// posts that hold a citation.
import { fill, h } from "./dom.js";
import { say } from "./words.js";
import { citationsIn } from "./cite-rules.js";
import { sourceExportLossNotes } from "./source-rules.js";
import { choiceGroup, saveFile } from "./research-ui.js";

const LOCALES = [["en", "English"], ["de", "Deutsch"], ["fr", "Français"], ["es", "Español"]];

/** The style choice a stored `citations` value shows as. */
export function styleChoice(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v || ["false", "no", "off", "none"].includes(v)) return "";
  if (v === "bibliography" || v === "references") return "bibliography";
  return "notes";
}

/** `post()` → `{ kind, body }`; `value(name)` / `setValue(name, v)` are About's; `changed()` after a change. */
export function createSourcesInPost({ post, value, setValue, changed }) {
  let preview = null;
  const counts = h("p", { class: "studio-help", role: "status" });
  const downloads = h("div", { class: "studio-row" });
  const said = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const style = choiceGroup({
    legend: say("cite.style"), help: say("cite.styleHelp"), value: "",
    choices: [{ value: "notes", label: say("cite.styleNotes") }, { value: "bibliography", label: say("cite.styleList") }, { value: "", label: say("cite.styleOff") }],
    onChange: (next) => {
      // A value she didn't change stays as written ("true" stays "true").
      if (styleChoice(value("citations")) === next) return;
      setValue("citations", next);
      changed();
    },
  });
  // Values are read when About this post draws (it is still being made now).
  const locale = h("select-field", { label: say("cite.locale"), value: "",
    options: [{ value: "", label: say("cite.localeSite") }, ...LOCALES.map(([tag, name]) => ({ value: tag, label: name }))],
    onValuechange: (e) => { setValue("citationLocale", String(e.detail ?? "")); changed(); } });
  const element = h("section", { class: "studio-about-group studio-sources-in-post", "aria-labelledby": "studio-about-sources-h", hidden: true },
    h("h3", { id: "studio-about-sources-h", tabindex: "-1", text: say("cite.sourcesGroup") }), style.element, locale, counts, downloads, said);

  function applies() {
    const p = post();
    return p.kind === "research" || styleChoice(value("citations")) !== "" || String(value("citations") || "").trim() !== "" || citationsIn(p.body || "").length > 0;
  }

  function paintCounts() {
    const found = preview?.citations;
    if (!found) {
      counts.textContent = say("cite.previewFirst");
      fill(downloads);
      return;
    }
    const citations = Number(found.citations) || 0;
    const works = Number(found.references) || 0;
    counts.textContent = citations === 1 && works === 1 ? say("cite.countOneCitation") : works === 1 ? say("cite.countOneWork", { citations }) : say("cite.countLine", { citations, works });
    const exports = found.exports || {};
    const button = (format, label) => (exports[format] ? h("action-button", { variant: "secondary", size: "sm", onClick: () => {
      const file = exports[format];
      saveFile(file.filename, file.content, file.mediaType);
      const losses = sourceExportLossNotes(file.losses);
      said.textContent = `${say("cite.downloaded", { filename: String(file.filename), count: Number(file.count) || 0 })}${losses.length ? ` ${say("sources.exportLoss", { list: losses.join("; ") })}` : ""}`;
    } }, label) : null);
    fill(downloads, h("span", { class: "studio-label", text: say("cite.download") }), button("csl-json", say("cite.downloadCsl")), button("bibtex", say("cite.downloadBib")));
  }

  return {
    element,
    /** Redraw from About's values (it opened, or the post changed). */
    draw() {
      element.hidden = !applies();
      style.set(styleChoice(value("citations")));
      locale.value = String(value("citationLocale") || "");
      paintCounts();
    },
    /** What the last See how it looks found. */
    previewed(reply) { preview = reply || null; paintCounts(); },
  };
}
