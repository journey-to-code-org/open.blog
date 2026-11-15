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

/** The posts list sends a date-only post as "YYYY-MM-DDT00:00:00Z": that's a day, not a moment. */
export function sayListDate(date) {
  // A post with no date comes back as the start of 1970: say so instead of a date nobody wrote.
  if (!date || /^1970-01-01T00:00:00(?:\.0+)?Z$/.test(String(date))) return "";
  const plain = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?Z$/.exec(String(date || ""));
  return sayWhen(plain ? plain[1] : date);
}

export function postHref(path) {
  return `#/write/${encodeURIComponent(path)}`;
}

/** One row. `menu(post)` may return a node (a "More" menu) to end the row with. */
export function postRow(post, menu, sameTitle = false) {
  const badge = BADGE[post.status] || BADGE.draft;
  const when = post.status === "error" ? "This file can't be read. Open it to see why." : sayListDate(post.date) || "No date yet";
  return h("li", { class: "studio-post-row", "data-status": post.status },
    h("a", { class: "studio-post-link", href: postHref(post.path) },
      h("span", { class: "studio-post-title", text: post.title || "Untitled" }),
      // R4: a job says so (its profile, G15).
      post.profile === "job" ? h("status-badge", { variant: "outline", class: "studio-post-kind" }, "Job") : null,
      h("span", { class: "studio-post-when", text: when }),
      sameTitle ? h("span", { class: "studio-post-file", text: `File: ${post.path.split("/").pop()}` }) : null),
    h("status-badge", { variant: badge.variant, dot: true }, badge.text),
    menu ? menu(post) : null);
}

export function postList(posts, label, menu) {
  // Two posts with the same title get their file names, so she can tell which is which.
  const seen = new Map();
  for (const post of posts) seen.set(post.title || "", (seen.get(post.title || "") || 0) + 1);
  return h("ul", { class: "studio-post-list", "aria-label": label }, posts.map((post) => postRow(post, menu, seen.get(post.title || "") > 1)));
}
