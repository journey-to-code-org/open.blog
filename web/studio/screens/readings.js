// Readings side by side: the list. Each row is one comparison with whether it is a draft or on the blog, how
// many readings and explanations it has and how many AI drafts wait for approval. Unreadable files say so and
// stay listed. A delete is answered with Undo. Studio R13; docs/specs/studio/r13/ux.md. The rules are
// parts/readings-rules.js.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { listLine, countsLine, waitingLine } from "../parts/readings-rules.js";
import * as undo from "../parts/path-undo.js";
import { sendOut } from "../parts/publish.js";

const BASE = "comparisons";

export async function createReadings({ api, go }) {
  await use("action-button", "alert-banner", "breadcrumb-trail", "empty-state", "skeleton-block", "status-badge");
  const trail = h("breadcrumb-trail", { label: say("readings.title"), items: [{ label: say("readings.crumbHome"), href: "#/" }, { label: say("readings.crumbResearch") }, { label: say("readings.title") }] });
  const heading = h("h2", { id: "studio-readings-h", class: "studio-question", tabindex: "-1", text: say("readings.title") });
  const lede = h("p", { class: "studio-lede", text: say("readings.lede") });
  const apart = h("p", { class: "studio-help", text: say("readings.notCompare") });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const undoSlot = h("div", { "aria-live": "polite" });
  const make = h("action-button", { onClick: () => go("#/research/readings/new") }, say("readings.make"));
  const list = h("ul", { class: "studio-path-list", "aria-labelledby": "studio-readings-h", "aria-busy": "true" }, h("li", {}, h("skeleton-block", { lines: 3 })));
  const element = h("section", { class: "studio-page studio-readings", "aria-labelledby": "studio-readings-h" }, trail, heading, lede, apart, undoSlot, banner, make, list);

  function row(item) {
    const title = item.valid ? item.title : item.slug;
    const link = h("a", { class: "studio-path-link", href: `#/research/reading/${encodeURIComponent(item.slug)}`, "aria-label": say("readings.open", { title }), text: title });
    return h("li", { class: "studio-path-row", "data-slug": item.slug },
      h("strong", {}, link),
      h("span", { class: "studio-help", text: listLine(item) }),
      item.valid ? h("span", { class: "studio-help", text: countsLine(item) }) : null,
      item.valid && item.awaitingApproval ? h("status-badge", { variant: "warning" }, waitingLine(item.awaitingApproval)) : null,
      !item.valid && item.firstProblem ? h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: `${say("readings.unreadableDetails")} ${item.firstProblem}` })) : null);
  }

  function drawUndo(entry) {
    if (!entry || entry.what !== "delete") { undoSlot.replaceChildren(); return; }
    undoSlot.replaceChildren(undo.undoLine({
      words: say("readings.deleted", { title: entry.title }), undo: say("readings.undo"), dismiss: say("readings.dismiss"),
      onClose: () => undo.forget(),
      onUndo: async () => {
        const out = await undo.putBack(api, entry);
        if (out.reply) { toast(say("readings.undone")); sendOut(api, `Put back the comparison ${entry.title.trim()}`).catch(() => {}); await load(); } else toast(say("readings.undoFailed"), { variant: "warning", duration: 0 });
      },
    }));
    requestAnimationFrame(() => undoSlot.querySelector("action-button .action-button")?.focus());
  }

  async function load() {
    drawUndo(undo.current(BASE));
    try {
      const reply = await api.get(BASE);
      list.removeAttribute("aria-busy");
      const banners = [];
      if (reply.publish === false) {
        banners.push(h("alert-banner", { variant: "info", heading: say("readings.siteOff") },
          h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: say("readings.siteOffDetails") }))));
      }
      if (reply.researchProblem) {
        banners.push(h("alert-banner", { variant: "warning", heading: say("readings.researchTrouble") },
          h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: String(reply.researchProblem) }))));
      }
      banner.replaceChildren(...banners);
      const items = reply.items || [];
      list.replaceChildren(...(items.length ? items.map(row) : [h("li", {}, h("empty-state", { heading: say("readings.emptyTitle") }, say("readings.emptyText")))]));
    } catch {
      list.removeAttribute("aria-busy");
      list.replaceChildren();
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: say("readings.loadFailed") }, say("common.tell"),
        h("action-button", { variant: "secondary", onClick: load }, say("readings.tryAgain"))));
    }
  }

  return {
    title: say("readings.title"),
    element,
    load,
    focus: () => heading.focus(),
    get palette() {
      return [{ id: "make", label: say("readings.findMake"), group: say("readings.title") }];
    },
    command(id) {
      if (id === "make") go("#/research/readings/new");
    },
  };
}
