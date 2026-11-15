// Banners above What readers sent about what's on the posts (Studio R10, "Banners above the list"):
// reflections and answers that must come off, names a reader has since hidden, what can't be
// checked, featured reflections that must go, and a check that failed (never silent). Each entry has
// its one button. docs/specs/studio/r10/ux.md.
import { h } from "./dom.js";
import { say, sayParts } from "./words.js";
import { partsNodes } from "./stranger.js";
import { bannerWords } from "./reader-notes-rules.js";

const BUTTONS = {
  "readers.fixUnpublishButton": () => say("readers.fixUnpublishButton"),
  "readers.fixNameButton": () => say("readers.fixNameButton"),
  "readers.featureOff": () => say("readers.featureOff"),
};

/** Draw `banners` (from `auditBanners`) into `host`. `onFix(entry, button)` runs an entry's button; `onRetry()` checks again. */
export function drawBanners(host, banners, { onFix, onRetry }) {
  host.replaceChildren(...banners.map((banner) => h("alert-banner", { variant: banner.level === "danger" ? "danger" : "info", "data-audit": banner.id, role: banner.level === "danger" ? "alert" : null },
    h("p", { text: bannerWords(banner) }),
    banner.entries.length ? h("ul", { class: "studio-reader-lines" }, ...banner.entries.map((entry) => h("li", {},
      ...partsNodes(sayParts("readers.auditEntry", { title: entry.title }, ["title"])), " ",
      h("action-button", { size: "sm", variant: "secondary", onClick: (e) => onFix(entry, e.currentTarget) }, (BUTTONS[entry.button] || BUTTONS["readers.fixUnpublishButton"])())))) : null,
    banner.retry ? h("action-button", { size: "sm", variant: "secondary", onClick: () => onRetry() }, say("readers.tryAgain")) : null)));
}
