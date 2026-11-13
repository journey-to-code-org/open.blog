// More tools: the old Admin's tools that Studio leaves where they are, for the person who set up the
// site. Each opens in the old Admin at its own address. Reached from the account menu and Find, not
// the main navigation. Studio slice 4 (docs/specs/studio/parity-audit.md).
import { h } from "../parts/dom.js";
import { use } from "../zubra.js";

/** Every tool, by group: what it is in a few words and its old Admin address. Exported for tests. */
export const TOOLS = [
  { group: "Your site", items: [
    ["Every reader note", "The full inbox, for kinds of note Studio doesn't handle", "#/moderation"],
    ["Visitors and comments setup", "How many people read what, and where comments are kept", "#/analytics"],
    ["Greeting cards", "Cards sent by email on the day", "#/greetings"],
  ] },
  { group: "Business", items: [
    ["Business facts", "Name, phone, hours and license, for a trade site", "#/business", "studio"],
    ["Quote requests", "Requests from your quote form", "#/quotes"],
    ["Reminders", "Seasonal reminders for customers", "#/reminders"],
    ["Social accounts", "Accounts posts are shared to", "#/social"],
    ["Announcements", "Share a post to your accounts", "#/announcements"],
  ] },
  { group: "Research and writing tools", items: [
    ["Research", "Sources, notes and the atlas", "#/research/overview"],
    ["Comparisons", "Passages side by side", "#/comparisons"],
    ["Reading paths", "Posts in a suggested order", "#/paths"],
    ["Shared reflections", "Writing with others", "#/shared"],
    ["Contributors", "Who wrote what", "#/contributors"],
    ["Voice", "Writing by talking", "#/voice"],
    ["Design a theme", "Make a new look by describing it", "#/design"],
  ] },
];

export async function createTools() {
  await use("action-button");
  const heading = h("h2", { id: "studio-tools-h", class: "studio-question", tabindex: "-1", text: "More tools" });
  const element = h("section", { class: "studio-page", "aria-labelledby": "studio-tools-h" },
    heading,
    h("p", { class: "studio-lede", text: "These are in the old Admin for now. Each opens in a new tab; you stay signed in." }),
    ...TOOLS.map(({ group, items }) => h("section", { class: "studio-section", "aria-label": group },
      h("h3", { text: group }),
      h("ul", { class: "studio-tool-list" }, items.map(([name, what, hash, where]) => h("li", {},
        // A Studio screen opens here; the old Admin's open in a new tab.
        h("a", where === "studio" ? { href: hash } : { href: `/admin/${hash}`, target: "_blank", rel: "noopener" }, h("strong", { text: name }), " ", h("span", { class: "studio-help", text: what }))))))));
  return {
    title: "More tools",
    element,
    load: async () => {},
    focus: () => heading.focus(),
    get palette() {
      return TOOLS.flatMap(({ items }) => items.map(([name, , hash, where]) => ({ id: `${where === "studio" ? "go" : "tool"}:${hash}`, label: where === "studio" ? name : `${name} (old Admin)`, group: "More tools" })));
    },
    command(id) {
      if (id.startsWith("tool:")) open(`/admin/${id.slice(5)}`, "_blank", "noopener");
      if (id.startsWith("go:")) location.hash = id.slice(3);
    },
  };
}
