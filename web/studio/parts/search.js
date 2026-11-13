// Title search, status filter and the summary words for the posts list and the palette. DOM-free.

const STATUSES = ["draft", "scheduled", "published"];

/** Lower case with accents removed, so "creme brulee" finds "Crème Brûlée". */
function fold(text) {
  return String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/['’]/g, "").toLowerCase();
}

/**
 * The items whose title or tags contain every word of the query (case- and accent-insensitive) and
 * whose status matches, in their original order.
 * @template {{ title?: string, status?: string }} T
 * @param {T[]} items posts-list items
 * @param {{ query?: string, status?: "all"|"draft"|"scheduled"|"published" }} [options]
 * @returns {T[]}
 */
export function matchPosts(items, { query = "", status = "all" } = {}) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return (items || []).filter((item) => {
    if (status !== "all" && item?.status !== status) return false;
    const text = fold([item?.title, ...(Array.isArray(item?.tags) ? item.tags : [])].join(" "));
    return words.every((word) => text.includes(word));
  });
}

/**
 * How many posts there are of each status. `all` counts every item, including ones the server
 * could not read.
 * @param {{ status?: string }[]} items
 * @returns {{ all: number, draft: number, scheduled: number, published: number }}
 */
export function countByStatus(items) {
  const counts = { all: 0, draft: 0, scheduled: 0, published: 0 };
  for (const item of items || []) {
    counts.all += 1;
    if (STATUSES.includes(item?.status)) counts[item.status] += 1;
  }
  return counts;
}

/**
 * The posts summary in words: "No posts yet", "1 post", "24 posts, 2 waiting as drafts",
 * "3 posts, 1 waiting as a draft, 1 scheduled".
 * @param {{ all?: number, draft?: number, scheduled?: number }} counts
 */
export function summary({ all = 0, draft = 0, scheduled = 0 } = {}) {
  if (!all) return "No posts yet";
  const parts = [`${all} post${all === 1 ? "" : "s"}`];
  if (draft) parts.push(draft === 1 ? "1 waiting as a draft" : `${draft} waiting as drafts`);
  if (scheduled) parts.push(`${scheduled} scheduled`);
  return parts.join(", ");
}
