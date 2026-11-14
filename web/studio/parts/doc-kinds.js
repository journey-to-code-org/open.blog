// The two kinds of writing that aren't posts, in her words: pages (About, Contact) and collections
// (a series of posts on one topic). One description each, so the list and the editor say the same
// things. On disk they are `pages/*.md` and `series/*.md`. Sentences a site may change are word ids
// (kind-words.js), read when used.
import { say } from "./words.js";

export const KINDS = {
  pages: {
    kind: "pages",
    list: "pages",
    edit: "page",
    one: "page",
    many: "pages",
    heading: "Your pages",
    lede: (n) => (n === 1 ? "1 page on your site" : `${n} pages on your site`),
    get about() { return say("kinds.pagesAbout"); },
    add: "Add a page",
    empty: "Pages are for things that stay put, like a page about you.",
    nameKey: "title",
    nameLabel: "Title",
    describe: "One line about the page, shown in search results and when it's shared.",
    menu: true,
    bodyHelp: "What the page says.",
    newTitle: "New page",
  },
  series: {
    kind: "series",
    list: "collections",
    edit: "collection",
    one: "collection",
    many: "collections",
    heading: "Your collections",
    lede: (n) => (n === 1 ? "1 collection" : `${n} collections`),
    get about() { return say("kinds.collectionsAbout"); },
    add: "Add a collection",
    get empty() { return say("kinds.collectionsEmpty"); },
    nameKey: "name",
    nameLabel: "Name",
    describe: "One line about the collection, shown on its page and in search results.",
    menu: false,
    bodyHelp: "The words at the top of the collection's page, above its posts.",
    newTitle: "New collection",
  },
};

export const kindForRoute = (route) => Object.values(KINDS).find((k) => k.list === route || k.edit === route) || null;
export const editHref = (k, path) => `#/${k.edit}/${encodeURIComponent(path || "new")}`;

/** Whether a front matter value means "on", the way the engine reads it (true, yes, on). */
export const isOn = (value) => value === true || /^(true|yes|on)$/i.test(String(value ?? "").trim());

/** Which key a file names itself under: the one it already uses, else the kind's own. */
export const nameKeyOf = (k, fields = {}) => (fields.name !== undefined ? "name" : fields.title !== undefined ? "title" : k.nameKey);

/**
 * The fields a save sends for this kind, from what's on screen. The menu switch is sent only when
 * she changed it, so `nav: yes` written by hand is never rewritten or dropped. Pure; for tests.
 */
export function kindFields(k, { name, description, inMenu, look }, { nameKey = k.nameKey, menuWas } = {}) {
  const fields = { [nameKey]: name.trim(), description: description.trim(), theme: look || "" };
  if (k.menu && inMenu !== menuWas) fields.nav = inMenu ? true : null;
  return fields;
}
