// Reading paths: the list. Each row is a path with whether it is a draft or published, how many steps
// it has and whether readers can see it yet; unreadable files say so and stay listed. Studio R13;
// docs/specs/studio/r13/ux.md. The rules are parts/path-rules.js.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { listLine, notShown } from "../parts/path-rules.js";
import * as undo from "../parts/path-undo.js";
import { sendOut } from "../parts/publish.js";

export async function createPaths({ api, meta, go }) {
  await use("action-button", "alert-banner", "breadcrumb-trail", "empty-state", "skeleton-block", "status-badge");
  const trail = h("breadcrumb-trail", { label: say("paths.nav"), items: [{ label: say("paths.crumbHome"), href: "#/" }, { label: say("paths.nav") }] });
  const heading = h("h2", { id: "studio-paths-h", class: "studio-question", tabindex: "-1", text: say("paths.title") });
  const lede = h("p", { class: "studio-lede", text: say("paths.lede") });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const make = h("action-button", { onClick: () => go("#/paths/new") }, say("paths.make"));
  const undoSlot = h("div", { "aria-live": "polite" });
  const list = h("ul", { class: "studio-path-list", "aria-labelledby": "studio-paths-h", "aria-busy": "true" }, h("li", {}, h("skeleton-block", { lines: 3 })));
  const element = h("section", { class: "studio-page studio-paths", "aria-labelledby": "studio-paths-h" }, trail, heading, lede, undoSlot, banner, make, list);

  function row(item) {
    const title = item.valid ? item.title : item.slug;
    const link = h("a", { class: "studio-path-link", href: `#/path/${encodeURIComponent(item.slug)}`, "aria-label": say("paths.open", { title }), text: title });
    return h("li", { class: "studio-path-row", "data-slug": item.slug },
      h("strong", {}, link),
      h("span", { class: "studio-help", text: listLine(item) }),
      item.valid && item.listed === false ? h("status-badge", { variant: "neutral" }, say("paths.rowUnlisted")) : null,
      notShown(item) ? h("status-badge", { variant: "warning" }, say("paths.rowNotShown")) : null,
      !item.valid ? h("status-badge", { variant: "danger" }, say("paths.rowCantRead")) : null,
      !item.valid && item.firstProblem ? h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: `${say("paths.unreadableDetails")} ${item.firstProblem}` })) : null);
  }

  // After a delete: the line that puts it back (G97). Gone when dismissed or once something else is saved.
  function drawUndo(entry) {
    if (!entry || entry.what !== "delete") { undoSlot.replaceChildren(); return; }
    undoSlot.replaceChildren(undo.undoLine({
      words: say("paths.deleted", { title: entry.title }), undo: say("paths.undo"), dismiss: say("paths.dismiss"),
      onClose: () => undo.forget(),
      onUndo: async () => {
        const out = await undo.putBack(api, entry);
        if (out.reply) { toast(say("paths.undone")); sendOut(api, `Put back the reading path ${entry.title.trim()}`).catch(() => {}); await load(); } else toast(say("paths.undoFailed"), { variant: "warning", duration: 0 });
      },
    }));
    requestAnimationFrame(() => undoSlot.querySelector("action-button .action-button")?.focus());
  }

  async function load() {
    drawUndo(undo.current("reading-paths"));
    try {
      const reply = await api.get("reading-paths");
      list.removeAttribute("aria-busy");
      const banners = [];
      if (reply.publish === false) {
        banners.push(h("alert-banner", { variant: "info", heading: say("paths.siteOffTitle") }, say("paths.siteOffText"),
          h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: say("paths.siteOffDetails") }))));
      }
      if (reply.targetsProblem) {
        banners.push(h("alert-banner", { variant: "warning", heading: say("paths.targetsTrouble") }, say("common.tell"),
          h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: String(reply.targetsProblem) }))));
      }
      banner.replaceChildren(...banners);
      const items = reply.items || [];
      list.replaceChildren(...(items.length ? items.map(row) : [h("li", {}, h("empty-state", { heading: say("paths.emptyTitle") }, say("paths.emptyText"), h("p", { class: "studio-help", text: say("paths.notCollection") })))]));
    } catch (error) {
      list.removeAttribute("aria-busy");
      list.replaceChildren();
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: say("paths.loadFailed") }, say("common.tell"),
        h("action-button", { variant: "secondary", onClick: load }, say("paths.tryAgain"))));
    }
  }

  return {
    title: say("paths.nav"),
    element,
    load,
    focus: () => heading.focus(),
    get palette() {
      return [{ id: "make", label: say("paths.findMake"), group: say("paths.nav") }];
    },
    command(id) {
      if (id === "make") go("#/paths/new");
    },
  };
}
