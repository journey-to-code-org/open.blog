// Posts: everything she's written, newest first. Find by title, show drafts, scheduled or
// published, and open one to change it.
import { h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { postList } from "../parts/post-list.js";
import { countByStatus, matchPosts, summary } from "../parts/search.js";
import { parseRoute, routeHash } from "../router.js";
import { ask } from "../parts/dialogs.js";
import { postHref } from "../parts/post-list.js";
import { takeOffQuestion, takeOffSite } from "../parts/take-off.js";
import { wentOutWords } from "../parts/publish.js";
import { toast } from "../parts/dom.js";

const STATUSES = ["all", "draft", "scheduled", "published"];

export async function createPosts({ api, meta, posts, replaceRoute, undo, go }) {
  await use("dropdown-menu", "action-button", "text-field", "segmented-control", "empty-state", "skeleton-block", "status-badge", "alert-banner");
  let items = [];
  // Search and filter live in the address, so Back and a reload come back to the same list.
  const asked = parseRoute(location.hash).query;
  let query = asked.q || "";
  let status = STATUSES.includes(asked.status) ? asked.status : "all";
  const remember = () => replaceRoute?.(routeHash("posts", "", { q: query.trim(), status: status === "all" ? "" : status }));
  const lede = h("p", { class: "studio-lede", role: "status" });
  const find = h("text-field", { label: "Find a post", type: "search", placeholder: "A title or a tag", value: query, onValuechange: (e) => { query = e.detail; remember(); draw(); } });
  const filter = h("segmented-control", { label: "Show", value: status, options: [], onValuechange: (e) => { status = e.detail; remember(); draw(); } });
  const list = h("div", { class: "studio-list", "aria-busy": "true" }, h("skeleton-block", { lines: 6 }));
  const element = h("section", { class: "studio-page", "aria-labelledby": "studio-posts-h" },
    h("h2", { id: "studio-posts-h", class: "studio-visually-hidden", tabindex: "-1", text: "Your posts" }),
    h("div", { class: "studio-posts-top" }, lede, h("action-button", { href: "#/write" }, "Write something new")),
    h("div", { class: "studio-tools" }, find, filter), list);

  function draw() {
    const counts = countByStatus(items);
    lede.textContent = summary(counts);
    filter.options = [
      { value: "all", label: `All (${counts.all})` },
      { value: "draft", label: `Drafts (${counts.draft})` },
      { value: "scheduled", label: `Scheduled (${counts.scheduled})` },
      { value: "published", label: `Published (${counts.published})` },
    ];
    const shown = matchPosts(items, { query, status });
    list.removeAttribute("aria-busy");
    if (!items.length) {
      list.replaceChildren(h("empty-state", { heading: "No posts yet" }, "Write your first recipe or story.",
        h("action-button", { slot: "actions", href: "#/write" }, "Write something new")));
    } else if (!shown.length) {
      list.replaceChildren(h("empty-state", { heading: "Nothing matches" }, query ? `No posts match “${query}”.` : "No posts here yet.",
        h("action-button", { slot: "actions", variant: "secondary", onClick: () => { query = ""; status = "all"; find.value = ""; filter.value = "all"; remember(); draw(); } }, "Show all posts")));
    } else {
      list.replaceChildren(postList(shown, "Posts", rowMenu));
    }
  }

  // Each row ends with More: open it, take it off the site, or delete it (with Undo).
  function rowMenu(post) {
    const items = [{ value: "open", label: "Open it" }];
    if (post.status === "published" || post.status === "scheduled") items.push({ value: "takeoff", label: "Take it off my site" });
    items.push({ value: "delete", label: "Delete" });
    return h("dropdown-menu", { class: "studio-row-menu", items, onItemselect: (e) => rowChoice(post, e.detail) },
      h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: ` for ${post.title || "this post"}` })));
  }

  async function rowChoice(post, value) {
    const title = post.title || "this post";
    if (value === "open") go(postHref(post.path));
    if (value === "takeoff") await takeOff(post);
    if (value === "delete") {
      const deleted = await undo.deletePost({ path: post.path, title, state: post.status, ask, takeOff: () => takeOff(post, true) });
      if (deleted) load();
    }
  }

  async function takeOff(post, asked = false) {
    if (!asked && (await ask(takeOffQuestion(post.title || "this post"))) !== "yes") return;
    try {
      const { sent } = await takeOffSite(api, post.path);
      posts.stale();
      const said = wentOutWords(sent, { meta, action: "takenOff" });
      toast(said.words, { variant: said.variant });
      load();
    } catch (error) {
      toast(error.message, { variant: "warning" });
    }
  }

  async function load() {
    try {
      items = await posts.list({ fresh: true });
      draw();
    } catch (error) {
      list.removeAttribute("aria-busy");
      list.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your posts didn't load" }, error.message));
    }
  }

  return { title: "Posts", element, load, reload: load };
}
