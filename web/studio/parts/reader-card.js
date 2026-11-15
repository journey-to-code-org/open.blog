// One card of What readers sent: who, what kind, what they wrote (as text), what to know before
// deciding, what is on the post, and only the decisions the server offered. Blocks appear only when
// their data is there. Every stranger's word is placed with textContent. Studio R10;
// docs/specs/studio/r10/ux.md, "The card".
import { h } from "./dom.js";
import { say } from "./words.js";
import { sayDay, sayWhen } from "./dates.js";
import { siteLink } from "./publish.js";
import { strangerBody, strangerInline, cut80 } from "./stranger.js";
import {
  buttonsFor, cardLabel, readerWords, decisionLine, kindBadgeWords, passageView, previewWords, publicationState, quietReason, readerLine, reasonWords,
  reportReason, roleLine, similarLinks,
} from "./reader-rules.js";

const WHAT = { comment: () => say("readers.what.comment"), "third-perspective": () => say("readers.what.reflection"), "author-response": () => say("readers.what.answer") };
const whatWords = (kind) => WHAT[kind]?.() || say("readers.what.note");

/**
 * @param {object} args
 * @param {object} args.item the inbox item as the server sent it
 * @param {object} args.meta Studio's meta
 * @param {{ id: string, state: string }} args.view the view it is listed in
 * @param {object} args.on `decide(item, action, reason, line, control)`, `start(item, button, line, control)`,
 *   `fix(item, state, line, control)`, `more(item, value)` and `extras(item, line)` (what a shown note adds)
 */
export function createReaderCard({ item, meta, view, on }) {
  const label = cardLabel(item);
  const headingId = `studio-reader-${item.source}-${item.id}`;
  const report = item.source === "report";
  const when = sayWhen(item.receivedAt);
  const line = h("p", { class: "studio-comment-trouble", tabindex: "-1", role: "alert", hidden: true });
  const row = h("li", { class: "studio-comment studio-reader", "data-id": item.id, "data-ref": `${item.source}:${item.id}`, "data-kind": item.kind, "aria-label": label });

  // Heading, with the card's More menu.
  const name = item.reader?.name ? strangerInline(cut80(item.reader.name)).textContent : say("readers.someone");
  const heading = report ? say("readers.reportHeading", { what: whatWords(item.target?.kind), name })
    : item.kind === "author-response" ? say("readers.answerHeading", { author: item.response?.author || name })
      : name;
  const { top, more } = buttonsFor(item);
  const menuItems = [
    ...(item.post?.url ? [{ value: "see", label: say("readers.menuSee") }] : []),
    ...more.map((b) => ({ value: `do:${b.action}`, label: b.label })),
    { value: "copy-link", label: say("readers.menuCopyLink") },
  ];
  const menu = h("dropdown-menu", {
    class: "studio-row-menu", items: menuItems,
    onItemselect: (e) => {
      if (e.detail === "see") window.open(siteLink(meta, item.post.url), "_blank", "noopener");
      else if (e.detail === "copy-link") on.more(item, "copy-link", line);
      else {
        const chosen = more.find((b) => `do:${b.action}` === e.detail);
        if (chosen) on.start(item, chosen, line, null);
      }
    },
  }, h("span", { slot: "label" }, say("readers.menuMore"), h("span", { class: "studio-visually-hidden", text: say("readers.menuMoreFor", { label }) })));
  row.append(h("div", { class: "studio-comment-head" },
    on.select ? on.select(item, label) : null,
    h("h3", { id: headingId, class: "studio-comment-who studio-stranger", dir: "auto", tabindex: "-1", text: heading }),
    menu));

  // The meta line: the kind, where, when.
  const onWords = item.post?.title ? say("readers.on", { title: item.post.title }) : say("readers.onSite");
  const postLink = item.post?.url
    ? h("a", { href: siteLink(meta, item.post.url), target: "_blank", rel: "noopener", "aria-label": say("readers.openPost", { title: cut80(item.post.title) }), text: onWords })
    : onWords;
  row.append(h("p", { class: "studio-help studio-reader-meta" },
    h("status-badge", { variant: report ? "warning" : "neutral" }, kindBadgeWords(item)), postLink, when ? `, ${when}` : ""));
  if (!item.post && item.work) row.append(h("p", { class: "studio-help", text: say("readers.postGone") }));

  const role = roleLine(item.role);
  if (role) row.append(h("p", { class: "studio-help", text: role }));
  if (item.clarification?.askedAboutThisText) row.append(h("p", { class: "studio-help", text: say("readers.askedText") }));

  // The words they wrote about.
  const passage = passageView(item.passage);
  if (passage) {
    row.append(h("div", { class: "studio-reader-passage" },
      h("p", { class: "studio-help", text: say("readers.passageLabel") }),
      passage.quoted ? strangerBody(passage.quoted) : null,
      passage.line ? h("p", { class: passage.stale ? "studio-comment-trouble" : "studio-help", text: `${passage.stale ? "⚠ " : ""}${passage.line}` }) : null));
  }

  // What they sent.
  if (item.purged || (item.body == null && !report)) {
    row.append(h("p", { class: "studio-help", text: say("readers.erased") }));
  } else if (item.body) {
    row.append(strangerBody(item.body));
  }
  if (report) {
    if (item.report?.groundLabel) row.append(h("p", { class: "studio-stranger", dir: "auto", text: say("readers.reportWhy", { ground: item.report.groundLabel }) }));
    const target = item.target;
    row.append(h("blockquote", { class: "studio-comment-quote" },
      h("p", { class: "studio-help studio-stranger", dir: "auto", text: say("readers.reportWrote", { name: target?.authorName || say("readers.someone"), on: item.post?.title ? ` “${item.post.title}”` : "" }) }),
      target ? (target.body ? strangerBody(target.body) : h("p", { class: "studio-help", text: say("readers.erased") })) : h("p", { class: "studio-help", text: say("readers.reportGone") })));
    if (target?.status && target.status !== "approved" && target.statusLabel) {
      row.append(h("p", { class: "studio-help studio-stranger", dir: "auto", text: say("readers.reportNow", { state: target.statusLabel.toLowerCase() }) }));
    }
  }
  on.details?.(item, row);

  const who = readerLine(item.reader, item.source, item.kind);
  if (who) row.append(h("p", { class: "studio-help", text: who }));
  const preview = previewWords(item.publicPreview);
  if (preview) row.append(h("p", { class: "studio-help studio-stranger", dir: "auto", text: preview }));
  if (item.perspectivePreview?.heading) row.append(h("p", { class: "studio-help studio-stranger", dir: "auto", text: say("readers.reflectionPreview", { heading: item.perspectivePreview.heading }) }));

  const similar = similarLinks(item, (iso) => sayWhen(iso));
  if (similar.length) {
    row.append(h("p", { class: "studio-help" }, say("readers.similar"), " ",
      ...similar.flatMap((s, i) => [i ? " · " : "", h("a", { href: `#/readers?item=${encodeURIComponent(s.ref)}`, onClick: (e) => { e.preventDefault(); on.focusRef(s.ref); }, text: s.label })])));
  }

  const decided = decisionLine(item, (iso) => sayDay(iso));
  if (decided && view.state !== "pending") row.append(h("p", { class: "studio-help studio-comment-decided", text: decided }));

  // What is on the post.
  const pub = publicationState(item);
  if (pub?.level === "quiet") row.append(h("p", { class: "studio-help", text: readerWords(pub.id) }));
  else if (pub) {
    const fixButton = h("action-button", { size: "sm", onClick: (e) => on.fix(item, pub, line, e.currentTarget) }, readerWords(pub.button));
    row.append(h("alert-banner", { class: "studio-reader-fix", variant: pub.level === "danger" ? "danger" : "warning", heading: readerWords(pub.id) }, fixButton));
  }

  // Decisions: only what the server offered.
  const buttons = top.map((b) => decisionButton(item, b, line, on, label));
  if (buttons.length && !(item.purged && !report)) row.append(h("div", { class: "studio-comment-actions" }, ...buttons));
  row.append(line);
  on.extras?.(item, row, line);
  on.cardDetails?.(item, row);
  return row;
}

function decisionButton(item, b, line, on, label) {
  if (!b.asks) {
    return h("action-button", { variant: b.primary ? "primary" : "secondary", label: `${b.label}: ${label}`, "data-action": b.action, onClick: (e) => on.start(item, b, line, e.currentTarget) }, b.label);
  }
  const reasons = b.offer.reasons.map((r) => ({ value: r.id, label: reasonWords(r, { report: item.source === "report" }) }));
  return h("dropdown-menu", {
    class: "studio-why", "data-action": b.action, items: reasons,
    onItemselect: (e) => on.decide(item, b.action, e.detail, line, e.currentTarget),
  }, h("span", { slot: "label" }, b.label, h("span", { class: "studio-visually-hidden", text: say("readers.whyFor", { label }) })));
}

export { quietReason, reportReason };
