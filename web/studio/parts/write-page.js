// The Write screen's page: the title, the words (or recipe boxes), when it appears, tags, the
// cover photo, and the bar with See how it looks, Save draft and Publish. Built once; the screen
// fills it in and wires what each button does. Also the list of what she can do with a post, one
// list for More (her items first) and Find (all of them, with their keys).
import { h } from "./dom.js";

/** How the engine names a series from what a post says (`series: Thanksgiving` is `thanksgiving`). */
export const seriesSlug = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * The Collection choices for one post: None, every collection, and the post's own value kept as
 * written (matched by its slug, or listed as one with no page of its own yet). Pure; for tests.
 */
export function collectionOptions(series, current) {
  const options = [{ value: "", label: "None" }, ...series.map((s) => ({ value: s.slug, label: s.title || s.name || s.slug }))];
  const raw = String(current || "").trim();
  if (!raw) return { options, value: "" };
  const match = options.find((o) => o.value && o.value === seriesSlug(raw));
  if (match) { match.value = raw; return { options, value: raw }; }
  return { options: [...options, { value: raw, label: `${raw} (no page of its own yet)` }], value: raw };
}

export const crumbs = (name) => [{ label: "Home", href: "#/" }, { label: "Posts", href: "#/posts" }, { label: name, href: "" }];

export function writePage({ meta, body, on }) {
  const parts = {
    trail: h("breadcrumb-trail", { items: crumbs("New post") }),
    status: h("p", { class: "studio-status", role: "status" }),
    banner: h("div", { class: "studio-banner", "aria-live": "polite" }),
    title: h("text-field", { label: "Title", class: "studio-writing studio-writing-title", maxlength: 200 }),
    numbersHost: h("div"),
    day: h("date-field", { label: "Date" }),
    time: h("text-field", { label: "Time (your time)", type: "time" }),
    tags: h("tag-input", { label: "Tags", max: 20, suggestions: meta.tags || [] }),
    cover: h("div"),
    // A post can belong to one collection (a series). Its choices come fresh when Write opens.
    collection: h("select-field", { label: "Collection", description: "Put it with others, like all your Thanksgiving recipes.", options: [{ value: "", label: "None" }], value: "", hidden: true }),
    saveLabel: h("span", { text: "Save draft" }),
    primaryLabel: h("span", { text: "Publish" }),
    details: h("side-sheet", { label: "About this post", side: "right" }),
  };
  parts.save = h("action-button", { variant: "secondary", class: "studio-save", onClick: () => on.save() }, parts.saveLabel);
  parts.primary = h("action-button", { onClick: () => on.publish() }, parts.primaryLabel);
  parts.look = h("action-button", { variant: "secondary", onClick: (e) => on.preview(e.currentTarget) }, "See how it looks");
  parts.more = h("dropdown-menu", { label: "More", items: [], onItemselect: (e) => on.command(e.detail) });
  parts.element = h("section", { class: "studio-page studio-write", "aria-labelledby": "studio-write-h" },
    h("div", { class: "studio-write-top" }, parts.trail, parts.more),
    h("h2", { id: "studio-write-h", class: "studio-visually-hidden", tabindex: "-1", text: "Write" }),
    parts.status, parts.banner,
    h("div", { class: "studio-write-grid" },
      h("div", { class: "studio-write-main" }, parts.title, parts.numbersHost, body.element),
      h("div", { class: "studio-write-side" },
        h("fieldset", { class: "studio-when" }, h("legend", { text: "When it appears" }),
          h("cluster-layout", { gap: "0.75rem" }, parts.day, parts.time),
          h("p", { class: "studio-help", text: "Leave it empty to use the day you publish." })),
        h("div", { class: "studio-tags" }, h("p", { class: "studio-label", "aria-hidden": "true", text: "Tags" }), parts.tags,
          h("p", { class: "studio-help", text: "Type a tag and press Enter." })),
        parts.collection,
        parts.cover)),
    h("div", { class: "studio-write-bar" }, parts.look, parts.save, parts.primary),
    parts.details);
  return parts;
}

export const isMacLike = () => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || "");

/** What she can do with this post. Pure: given the post's state, the list. Exported for tests. */
export function writeCommands({ state, path, url, recipe, boxes, saveLabel, narrow, mac, job = false }) {
  const published = state === "published" || state === "scheduled";
  return [
    { id: "save", label: "Save", hint: mac ? "⌘S" : "Ctrl S", more: false },
    { id: "publish", label: "Publish or update", hint: mac ? "⌘↵" : "Ctrl Enter", more: false },
    { id: "preview", label: "See how it looks", more: false },
    { id: "takeoff", label: "Take it off my site", when: state === "published" },
    { id: "draft", label: saveLabel, when: narrow && state !== "published", palette: false },
    { id: "about", label: "More about this recipe", when: recipe },
    { id: "view", label: "See it on your site", when: Boolean(url) && published },
    // A published job can be shared where customers look (R1).
    { id: "share-job", label: "Share this job", when: job && state === "published" && Boolean(path) },
    { id: "delete", label: path ? "Delete this post" : "Throw this away" },
    { id: "plain", label: "Write it all in one box", when: recipe && boxes },
    { id: "boxes", label: "Use the recipe boxes", when: recipe && !boxes },
    { id: "details", label: "Show details" },
  ].filter((command) => command.when !== false);
}
