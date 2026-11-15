// The Readers area's header: the breadcrumb and the three places (what readers sent, visitors, how
// readers reach you), as links so each is its own address. Studio R10.
import { h } from "./dom.js";
import { say } from "./words.js";

/** `tab`: "sent", "visitors" or "setup"; `visitors` and `sent` say whether those two apply on this site. */
export function readerHeader({ tab, last = "", sent = true, visitors = true }) {
  const labels = { sent: say("readers.tabSent"), visitors: say("readers.tabVisitors"), setup: say("readers.tabSetup") };
  const trail = h("breadcrumb-trail", { items: [
    { label: say("readers.home"), href: "#/" },
    { label: say("readers.crumb"), href: last ? "#/readers" : "" },
    ...(last ? [{ label: last, href: "" }] : []),
  ] });
  const links = [
    ...(sent ? [["sent", "#/readers"]] : []),
    ...(visitors ? [["visitors", "#/readers/visitors"]] : []),
    ["setup", "#/readers/setup"],
  ];
  const tabs = h("nav", { class: "studio-area-tabs", "aria-label": say("readers.tabsLabel") },
    h("ul", {}, ...links.map(([id, href]) => h("li", {}, h("a", { href, text: labels[id], ...(id === tab ? { "aria-current": "page" } : {}) })))));
  return { trail, tabs };
}
