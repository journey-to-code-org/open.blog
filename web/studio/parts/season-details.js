// Decorations' details sheet, for the person who set up the site: what's stored in openblog.json,
// what's up today (UTC), the next change, how the file is written, and the last build and send-out.
import { h, toast } from "./dom.js";
import { toStored } from "./season-windows.js";
import { say } from "./words.js";

export function seasonDetails(details, { saved, label, lastBuildError, lastPublish }) {
  const row = (name, value) => [h("dt", { text: name }), h("dd", { class: "studio-mono", text: value })];
  details.replaceChildren(
    h("span", { slot: "heading", text: say("common.forHelper") }),
    h("dl", { class: "studio-details" },
      ...row("File", "openblog.json (members theme and seasons)"),
      ...row("Between seasons", saved.theme),
      ...row("Up early", saved.seasons?.upNow ? JSON.stringify(saved.seasons.upNow) : "none"),
      ...row("Today (UTC)", `${saved.today}, wearing ${saved.wearing}`),
      ...row("Next change", saved.next ? `${saved.next.day} ${saved.next.theme} (first build after ${saved.next.day}T00:00Z)` : "none"),
      ...row("How it's written", "Only members that changed are written. A changed seasons block is written in its documented key order (version, enabled, windows, upNow), so one written in another order is reordered on its first change."),
      ...row("Last build", lastBuildError || "Fine"),
      ...row("Last send-out", lastPublish ? [lastPublish.message, lastPublish.commit ? `commit ${String(lastPublish.commit).slice(0, 12)}` : ""].filter(Boolean).join(" · ") : "Not in this visit")),
    h("table", { class: "studio-season-table" },
      h("thead", {}, h("tr", {}, ...["#", "Look", "Theme", "Start", "End"].map((text) => h("th", { text })))),
      h("tbody", {}, ...(saved.seasons?.windows || []).map((w, i) => h("tr", {}, ...[String(i + 1), label(w.theme), w.theme, w.start, w.end].map((text) => h("td", { text })))))),
    h("action-button", { variant: "secondary", onClick: async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(toStored(saved.seasons), null, 2)); toast("Copied the stored seasons."); } catch { toast("Couldn't copy here.", { variant: "warning" }); }
    } }, "Copy the stored seasons"));
  details.open = true;
}
