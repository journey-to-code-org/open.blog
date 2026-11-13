// Home: "What would you like to do?" One big way to start writing, the drafts she's in the middle
// of, and what went up lately.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { postList, postHref, sayListDate } from "../parts/post-list.js";
import { siteHealth } from "../parts/site-health.js";
import { waitingLine } from "../parts/comment-words.js";
import { homeCardLine } from "../parts/card-words.js";
import { homeQuoteLine } from "../parts/quote-words.js";

export async function createHome({ api, meta, posts }) {
  await use("action-button", "content-card", "auto-grid", "empty-state", "skeleton-block", "status-badge", "alert-banner");
  const body = h("div", { class: "studio-home", "aria-busy": "true" }, h("skeleton-block", { shape: "card" }), h("skeleton-block", { lines: 3 }));
  const health = siteHealth({ api, meta });
  // "3 comments are waiting for you", when there are: never a failure, never a nag.
  const waiting = h("div", { class: "studio-waiting" });
  // and "Ricky's birthday card goes out Sunday", when one does this week.
  async function loadWaiting() {
    const rows = [];
    if (meta.engagement === true) {
      try {
        const line = waitingLine(await api.get("engagement/moderation?state=pending"));
        if (line) rows.push(h("content-card", { heading: line, href: "#/comments" }));
      } catch {
        // Home never shows a failure here.
      }
    }
    if (meta.greetings === true) {
      try {
        const contacts = await api.get("greetings/contacts");
        const cards = await api.get("greetings/cards");
        const line = homeCardLine(cards.cards || [], contacts.contacts || []);
        if (line) rows.push(h("content-card", { heading: line, href: "#/cards" }));
      } catch {
        // Nor here.
      }
    }
    if (meta.quote === true) {
      try {
        const line = homeQuoteLine((await api.get("quote/requests")).requests);
        if (line) rows.push(h("content-card", { heading: line, href: "#/quotes" }));
      } catch {
        // Nor here.
      }
    }
    if (meta.siteUses?.reminders === true) {
      try {
        const due = ((await api.get("seasonal")).reminders || []).find((r) => r.status === "due");
        if (due) rows.push(h("content-card", { heading: `Time to write: ${due.topic}`, href: "#/reminders" }));
      } catch {
        // Nor here.
      }
    }
    waiting.replaceChildren(...rows);
  }
  const write = () => h("action-button", { href: "#/write", size: "lg", class: "studio-primary" }, "Write something new");
  const element = h("section", { class: "studio-page", "aria-labelledby": "studio-home-q" },
    h("h2", { id: "studio-home-q", class: "studio-question", tabindex: "-1", text: "What would you like to do?" }),
    body);

  async function load() {
    health.load();
    let items;
    try {
      items = await posts.list({ fresh: true });
    } catch (error) {
      body.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your posts didn't load" }, error.message));
      body.removeAttribute("aria-busy");
      return;
    }
    loadWaiting();
    const drafts = items.filter((p) => p.status === "draft").slice(0, 3);
    const published = items.filter((p) => p.status === "published").slice(0, 3);
    const coming = items.filter((p) => p.status === "scheduled").sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 3);
    body.removeAttribute("aria-busy");
    if (!items.length) {
      body.replaceChildren(h("empty-state", { heading: "Nothing written yet" },
        "Your first recipe or story starts here.",
        h("action-button", { slot: "actions", href: "#/write", size: "lg" }, "Write something new")), health.element);
      return;
    }
    fill(body,
      write(),
      health.element,
      waiting,
      drafts.length ? h("section", { class: "studio-section", "aria-labelledby": "studio-keep" },
        h("h3", { id: "studio-keep", text: "Keep going" }),
        h("auto-grid", { min: "15rem" }, drafts.map((p) => h("content-card", { heading: p.title || "Untitled", href: postHref(p.path) },
          h("p", { class: "studio-meta", text: sayListDate(p.date) ? `Draft, goes up ${sayListDate(p.date)}` : "A draft" }))))) : null,
      coming.length ? h("section", { class: "studio-section", "aria-labelledby": "studio-coming" },
        h("h3", { id: "studio-coming", text: "Coming up" }),
        postList(coming, "Coming up")) : null,
      published.length ? h("section", { class: "studio-section", "aria-labelledby": "studio-recent" },
        h("h3", { id: "studio-recent", text: "Recently published" }),
        postList(published, "Recently published"),
        h("a", { class: "studio-more-link", href: "#/posts", text: "See all posts" })) : null,
    );
  }

  return {
    title: "Home",
    element,
    load,
    focus: () => element.querySelector("h2").focus(),
    get palette() {
      return [{ id: "rebuild", label: "Rebuild the site now", group: "Your site" }, { id: "send", label: "Send out what's waiting", group: "Your site" }];
    },
    command(id) {
      if (id === "rebuild" || id === "send") health.element.querySelector(id === "rebuild" ? "details action-button" : ".studio-health-list action-button")?.click();
    },
  };
}
