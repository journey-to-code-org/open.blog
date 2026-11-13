// Pages and Collections: the writing that isn't posts, one list each. Open one to change it, add a
// new one, or delete one (with Undo). Studio slice 4.
import { h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { editHref } from "../parts/doc-kinds.js";

export async function createDocuments({ api, undo, go }, k) {
  await use("action-button", "dropdown-menu", "empty-state", "skeleton-block", "alert-banner");
  let items = [];
  const lede = h("p", { class: "studio-lede", role: "status" });
  const list = h("div", { class: "studio-list", "aria-busy": "true" }, h("skeleton-block", { lines: 4 }));
  const heading = h("h2", { id: `studio-${k.list}-h`, class: "studio-visually-hidden", tabindex: "-1", text: k.heading });
  const element = h("section", { class: "studio-page", "aria-labelledby": `studio-${k.list}-h` },
    heading,
    h("div", { class: "studio-posts-top" }, lede, h("action-button", { href: editHref(k, "") }, k.add)),
    h("p", { class: "studio-help", text: k.about }),
    list);

  function row(item) {
    const menu = h("dropdown-menu", {
      class: "studio-row-menu",
      items: [{ value: "open", label: "Open it" }, { value: "delete", label: "Delete" }],
      onItemselect: (e) => (e.detail === "open" ? go(editHref(k, item.path)) : remove(item)),
    }, h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: ` for ${item.title || `this ${k.one}`}` })));
    return h("li", { class: "studio-post-row" },
      h("a", { class: "studio-post-link", href: editHref(k, item.path) },
        h("span", { class: "studio-post-title", text: item.title || "Untitled" }),
        item.status === "error" ? h("span", { class: "studio-post-when", text: `Something's wrong with this ${k.one}. Ask the person who set up your site.` }) : null),
      menu);
  }

  function draw() {
    list.removeAttribute("aria-busy");
    lede.textContent = k.lede(items.length);
    if (!items.length) {
      list.replaceChildren(h("empty-state", { heading: `No ${k.many} yet` }, k.empty, h("action-button", { slot: "actions", href: editHref(k, "") }, k.add)));
      return;
    }
    list.replaceChildren(h("ul", { class: "studio-post-list", "aria-label": k.heading }, items.map(row)));
  }

  async function remove(item) {
    const done = await undo.deletePost({ path: item.path, etag: "", title: item.title || `this ${k.one}`, state: "published", ask, list: k.many, one: k.one,
      note: k.kind === "series" ? "Its posts stay; they just aren't gathered on one page." : "" });
    if (done) await load();
  }

  async function load() {
    try {
      const reply = await api.get(`documents?kind=${k.kind}`);
      items = (reply?.items || []).slice().sort((a, b) => String(a.title).localeCompare(String(b.title)));
      draw();
    } catch (error) {
      list.removeAttribute("aria-busy");
      list.replaceChildren(h("alert-banner", { variant: "danger", heading: `Your ${k.many} didn't load` }, "Check your connection and try again.",
        h("action-button", { variant: "secondary", onClick: load }, "Try again")));
    }
  }

  return {
    title: k.heading.replace(/^Your /, "").replace(/^./, (c) => c.toUpperCase()),
    element,
    load,
    reload: load,
    focus: () => heading.focus(),
    get palette() {
      return [{ id: "add", label: k.add, group: k.heading }, ...items.map((item) => ({ id: `open:${item.path}`, label: `Open ${item.title}`, group: k.heading }))];
    },
    command(id) {
      if (id === "add") go(editHref(k, ""));
      if (id.startsWith("open:")) go(editHref(k, id.slice(5)));
    },
  };
}
