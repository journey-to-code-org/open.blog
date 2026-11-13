// Home: "What would you like to do?" One big way to start writing, the drafts she's in the middle
// of, and what went up lately.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { postList, postHref, sayListDate } from "../parts/post-list.js";

export async function createHome({ api }) {
  await use("action-button", "content-card", "auto-grid", "empty-state", "skeleton-block", "status-badge", "alert-banner");
  const body = h("div", { class: "studio-home", "aria-busy": "true" }, h("skeleton-block", { shape: "card" }), h("skeleton-block", { lines: 3 }));
  const write = () => h("action-button", { href: "#/write", size: "lg", class: "studio-primary" }, "Write something new");
  const element = h("section", { class: "studio-page", "aria-labelledby": "studio-home-q" },
    h("h2", { id: "studio-home-q", class: "studio-question", tabindex: "-1", text: "What would you like to do?" }),
    body);

  async function load() {
    let items;
    try {
      items = (await api.get("documents?kind=posts")).items || [];
    } catch (error) {
      body.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your posts didn't load" }, error.message));
      body.removeAttribute("aria-busy");
      return;
    }
    const drafts = items.filter((p) => p.status === "draft").slice(0, 3);
    const published = items.filter((p) => p.status === "published").slice(0, 3);
    const coming = items.filter((p) => p.status === "scheduled").sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 3);
    body.removeAttribute("aria-busy");
    if (!items.length) {
      body.replaceChildren(h("empty-state", { heading: "Nothing written yet" },
        "Your first recipe or story starts here.",
        h("action-button", { slot: "actions", href: "#/write", size: "lg" }, "Write something new")));
      return;
    }
    fill(body,
      write(),
      drafts.length ? h("section", { class: "studio-section", "aria-labelledby": "studio-keep" },
        h("h3", { id: "studio-keep", text: "Keep going" }),
        h("auto-grid", { min: "15rem" }, drafts.map((p) => h("content-card", { heading: p.title || "Untitled", href: postHref(p.path) },
          h("p", { class: "studio-meta", text: p.date ? `Draft for ${sayListDate(p.date)}` : "A draft" }))))) : null,
      coming.length ? h("section", { class: "studio-section", "aria-labelledby": "studio-coming" },
        h("h3", { id: "studio-coming", text: "Coming up" }),
        postList(coming, "Coming up")) : null,
      published.length ? h("section", { class: "studio-section", "aria-labelledby": "studio-recent" },
        h("h3", { id: "studio-recent", text: "Recently published" }),
        postList(published, "Recently published"),
        h("a", { class: "studio-more-link", href: "#/posts", text: "See all posts" })) : null,
    );
  }

  return { title: "Home", element, load, focus: () => element.querySelector("h2").focus() };
}
