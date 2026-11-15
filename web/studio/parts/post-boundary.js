// What readers will see from this post (Studio R12, in Before you publish › Research checks): the
// server's preview of what this post would publish from her research, from its unsaved words and
// fields (`POST research/boundary`, the post scope of What readers see). Read-only; each part says
// what's shown and why the rest stays private.
import { h } from "./dom.js";
import { say } from "./words.js";
import { boundaryCountsText, boundaryGroups, boundaryItemHash, boundaryReasonWords, boundaryStoreWords } from "./boundary-rules.js";

/** The section for `manifest`, or a line saying the preview didn't come. */
export function postBoundary(manifest, { failed = false } = {}) {
  const parts = [h("h3", { text: say("public.fromPost") })];
  if (failed || !manifest) {
    parts.push(h("p", { class: "studio-help", text: say("public.fromPostFailed") }));
    return h("section", { class: "studio-ready-group studio-post-boundary" }, ...parts);
  }
  parts.push(h("p", { class: "studio-help", text: boundaryCountsText(manifest) }));
  for (const group of boundaryGroups(manifest).filter((g) => g.published.length || g.withheld.length)) {
    parts.push(h("h4", { text: boundaryStoreWords(group.projection) }),
      h("ul", { class: "studio-research-also" },
        ...group.published.map((item) => h("li", { "data-state": "shown" }, h("status-badge", { variant: "success" }, say("public.shownBadge")), " ", h("bdi", { text: String(item.label || item.id || "") }))),
        ...group.withheld.map((item) => {
          const hash = boundaryItemHash(item);
          return h("li", { "data-state": "held" }, h("bdi", { text: String(item.label || item.id || "") }), " — ", boundaryReasonWords(item.reason),
            hash ? [" ", h("a", { class: "studio-more-link", href: hash, text: say("research.openIt") })] : null);
        })));
  }
  return h("section", { class: "studio-ready-group studio-post-boundary", "aria-live": "polite" }, ...parts);
}
