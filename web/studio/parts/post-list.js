// A list of posts as links: title, the date in words, and a status badge (words, not colour alone).
// Used by Home ("Recently published") and Posts. Rows, not cards: posts are a record.
import { h } from "./dom.js";
import { sayWhen } from "./dates.js";

const BADGE = {
  draft: { variant: "neutral", text: "Draft" },
  scheduled: { variant: "warning", text: "Scheduled" },
  published: { variant: "success", text: "Published" },
  error: { variant: "danger", text: "Needs fixing" },
};

export function postHref(path) {
  return `#/write/${encodeURIComponent(path)}`;
}

export function postRow(post) {
  const badge = BADGE[post.status] || BADGE.draft;
  const when = post.status === "error" ? "This file can't be read; open it in the old Admin." : post.date ? sayWhen(post.date) : "No date yet";
  return h("li", { class: "studio-post-row", "data-status": post.status },
    h("a", { class: "studio-post-link", href: postHref(post.path) },
      h("span", { class: "studio-post-title", text: post.title || "Untitled" }),
      h("span", { class: "studio-post-when", text: when })),
    h("status-badge", { variant: badge.variant, dot: true }, badge.text));
}

export function postList(posts, label) {
  return h("ul", { class: "studio-post-list", "aria-label": label }, posts.map(postRow));
}
