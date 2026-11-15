// What only the person who set the site up reads: a card's ids, versions, roles and the actions the
// server offered with its guidance; and the list's own state and the keys. Under "For {helper}", never
// on her layer. Studio R10.
import { h } from "./dom.js";
import { say } from "./words.js";

const items = (lines) => h("ul", { class: "studio-mono" }, ...lines.filter(Boolean).map((t) => h("li", { class: "studio-stranger", dir: "auto", text: t })));

/** A card's details. */
export function cardDetails(item) {
  const offered = (item.actions || []).map((a) => `${a.action}: ${a.label}${a.guidance ? ` (${a.guidance})` : ""}${a.confirm ? ` [confirm: ${a.confirm}]` : ""}`);
  const decisions = Array.isArray(item.decisions) && item.decisions.length ? h("details", { class: "studio-help" },
    h("summary", { text: say("readers.decidedBefore", { n: item.decisions.length }) }),
    items(item.decisions.map((d) => `${d.label || d.outcome || ""}${d.decided ? `, ${d.decided}` : ""}`))) : null;
  return h("details", { class: "studio-help studio-comment-details" },
    h("summary", { text: say("common.forHelper") }),
    items([
      `id ${item.id}`, `source ${item.source}, kind ${item.kind} (${item.kindLabel || ""})`, `status ${item.status}, version ${item.version}`,
      item.role ? `role ${item.role}` : null, item.reason ? `reason ${item.reason} (${item.reasonLabel || ""})` : null,
      `received ${item.receivedAt}${item.moderatedAt ? `, decided ${item.moderatedAt}` : ""}`,
      item.post?.source ? `post ${item.post.source}` : null, `work ${item.work}`, `public ${item.public}`,
      item.purged ? "purged" : null, item.reader?.private ? "reader name private" : null,
      item.perspective?.consent ? `consent record ${item.perspective.consent.number}` : null,
      item.published !== undefined ? `published file: ${item.published}` : null,
      ...offered,
    ]), decisions);
}

/** The list's details: state, paging, the settings, and the keys. */
export function screenDetails({ view, kind, page, next, settings }) {
  return [
    h("summary", { text: say("common.forHelper") }),
    items([
      say("readers.detailsState", { state: view.state, kind: kind ? `, kind ${kind}` : "", protocol: page?.protocol || "?", invalid: page?.invalid || 0, next: next || "none" }),
      settings ? `endpoint ${settings.endpoint}, comments ${settings.comments}` : null,
      `${say("readers.keysHeading")}: ${say("readers.keysText")}`,
    ]),
  ];
}
