// Research checks in Before you publish (Studio R7, ADR 0123): the research review of a research
// post, grouped by what blocks and by outcome, each finding with its place in her words, Show me
// where it is in this post, and Mark as checked where the contract allows it. A mark keeps the
// finding listed and counted. Every server value is text; messages and next steps sit in <bdi>.
import { h } from "./dom.js";
import { say } from "./words.js";
import { innerAria } from "./inner-button.js";
import {
  acknowledgementRequest, gateWords, groupWords, markProblem, markWords, publicationReviewCountsText, publicationReviewPlace, reviewCountsWords,
  reviewGroups, reviewPlaceWords, reviewTarget,
} from "./review-rules.js";
import { openItHash } from "./research-rules.js";

let made = 0;

/**
 * `context()` → { post, firstBodyLine, body }; `show(target)` goes to a place in this post;
 * `reload()` asks for the review again; `tell(words, undo?)` says what happened in the sheet.
 */
export function createResearchReview({ api, context, show, reload, tell, site = false }) {
  const prefix = `studio-review-${++made}`;
  const element = h("section", { class: "studio-ready-group studio-review", "aria-labelledby": `${prefix}-h` });
  let review = null;
  let revision = null;
  let saving = false;

  function draw() {
    const ctx = { ...context(), post: review?.post || context().post, firstBodyLine: Number(review?.firstBodyLine) || context().firstBodyLine || 1 };
    const parts = [h("h3", { id: `${prefix}-h`, text: say("review.heading") }), h("p", { class: "studio-help", text: say("review.intro") })];
    if (review?.applies === false) { element.hidden = true; return; }
    element.hidden = false;
    parts.push(h("p", { class: "studio-review-counts", text: reviewCountsWords(review) }));
    for (const item of Array.isArray(review?.notReviewed) ? review.notReviewed : []) {
      parts.push(h("p", { class: "studio-help" }, say("review.notChecked", { reason: "" }), h("bdi", { text: String(item?.message || "") })));
    }
    const marks = review?.acknowledgements || {};
    if (marks.error) parts.push(h("p", { class: "studio-help", text: say("review.marksUnreadable") }));
    const groups = reviewGroups(review);
    if (!groups.length) parts.push(h("p", { class: "studio-help", text: say("review.nothing") }));
    groups.forEach((group, g) => {
      const words = groupWords(group.name, group.findings.length);
      const id = `${prefix}-g${g}`;
      parts.push(h("section", { class: `studio-review-group${group.name === "blocking" ? " studio-review-blocking" : ""}`, "aria-labelledby": id },
        h("h4", { id, text: words.heading }),
        h("p", { class: "studio-help", text: words.help }),
        h("ul", { class: "studio-ready-list" }, ...group.findings.map((finding, i) => findingView(finding, `${id}-f${i}`, ctx)))));
    });
    parts.push(details(ctx));
    element.replaceChildren(...parts);
  }

  function findingView(finding, id, ctx) {
    const place = reviewPlaceWords(finding, ctx);
    // On What readers see (R12) the report is the whole site's: nothing is "in this post".
    const target = site ? null : reviewTarget(finding, ctx);
    const message = h("p", { id: `${id}-m` }, h("bdi", { text: String(finding.message || "") }));
    const state = h("p", { class: "studio-help", hidden: !finding.acknowledgement, text: markWords(finding.acknowledgement) });
    const error = h("p", { class: "studio-field-error", role: "alert", hidden: true });
    const buttons = [];
    if (target) buttons.push(h("action-button", { variant: "secondary", size: "sm", label: say("review.showMeLabel", { what: place }), onClick: () => show(target) }, say("review.showMe")));
    // R11: a finding in her research opens it there.
    const openIt = openItHash({ ...finding.scope, related: finding.related }, { post: site ? "" : ctx.post, site });
    if (openIt) buttons.push(h("action-button", { variant: "secondary", size: "sm", href: openIt }, say("research.openIt")));
    if (finding.gate === "advisory") {
      const mark = h("action-button", { variant: "secondary", size: "sm", label: say("review.markLabel", { what: String(finding.message || finding.code || "") }), disabled: !revision,
        onClick: () => toggle(finding, mark, state, error) }, say("review.mark"));
      innerAria(mark, { "aria-pressed": String(finding.acknowledgement === "current"), "aria-describedby": `${id}-m` });
      buttons.push(mark);
    }
    const gate = gateWords(finding.gate);
    return h("li", { class: "studio-ready-item", "data-review-finding": String(finding.code || "") },
      message,
      finding.repair ? h("p", {}, `${say("review.next")} `, h("bdi", { text: String(finding.repair) })) : null,
      h("p", { class: "studio-help", text: place }),
      gate ? h("p", { class: "studio-help", text: gate }) : null,
      buttons.length ? h("div", { class: "studio-ready-actions" }, ...buttons) : null,
      state, error);
  }

  async function toggle(finding, button, state, error, { undoing = false } = {}) {
    if (saving || !revision) return;
    const add = finding.acknowledgement !== "current";
    saving = true;
    button.disabled = true;
    error.hidden = true;
    try {
      const reply = await api.call(add ? "PUT" : "DELETE", "research/review/acknowledgements", { json: acknowledgementRequest(finding, revision) });
      revision = typeof reply?.revision === "string" ? reply.revision : revision;
      const key = finding.outcome === "needs-review" ? "needsReview" : finding.outcome;
      const counts = (review.counts ||= {});
      const count = (counts[key] ||= { found: 0, acknowledged: 0 });
      const was = finding.acknowledgement === "current";
      finding.acknowledgement = add ? "current" : null;
      if (add && !was) count.acknowledged = (Number(count.acknowledged) || 0) + 1;
      if (!add && was) count.acknowledged = Math.max(0, (Number(count.acknowledged) || 0) - 1);
      innerAria(button, { "aria-pressed": String(add) });
      state.textContent = markWords(finding.acknowledgement);
      state.hidden = !finding.acknowledgement;
      element.querySelector(".studio-review-counts").textContent = reviewCountsWords(review);
      tell(add ? say("review.didMark") : say("review.didUnmark"), undoing ? null : () => toggle(finding, button, state, error, { undoing: true }));
    } catch (failure) {
      if (failure?.status === 401) throw failure;
      error.textContent = markProblem(failure);
      error.hidden = false;
      if (failure?.status === 409 || failure?.data?.code === "changed") {
        if (typeof failure?.data?.revision === "string") revision = failure.data.revision;
        reload();
      }
    } finally {
      saving = false;
      button.disabled = !revision;
    }
  }

  function details(ctx) {
    const rows = (Array.isArray(review?.findings) ? review.findings : []).map((finding) => h("li", { class: "studio-mono" },
      `${finding.validator || ""}: ${finding.code || ""} · ${finding.gate || ""} · ${publicationReviewPlace(finding, ctx)}`));
    const marks = review?.acknowledgements || {};
    return h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }),
      h("p", { class: "studio-mono", text: `${say("review.heading")}: ${publicationReviewCountsText({ ...review, scope: "post" })}` }),
      marks.error ? h("p", { class: "studio-mono", text: say("review.detailsMarksFile", { file: String(marks.file || ""), error: String(marks.error || "") }) }) : null,
      rows.length ? h("ul", {}, ...rows) : null);
  }

  return {
    element,
    /** Show a review as `POST research/review` answered it. */
    show(next) {
      review = next;
      revision = typeof next?.acknowledgements?.revision === "string" && !next.acknowledgements.error ? next.acknowledgements.revision : null;
      draw();
    },
    /** The checks didn't run: "offline", "server" or "unreadable" (422). */
    failed(kind, onAgain) {
      review = null;
      element.hidden = false;
      element.replaceChildren(h("h3", { id: `${prefix}-h`, text: say("review.heading") }),
        h("p", { class: "studio-help", text: say("review.intro") }),
        h("p", { role: "alert", text: kind === "unreadable" ? say("review.cantRead") : say("review.didntRun") }),
        kind === "unreadable" ? null : h("action-button", { variant: "secondary", size: "sm", onClick: () => onAgain?.() }, say("ready.checkAgain")));
    },
    /** Waiting for the first answer. */
    waiting() {
      element.hidden = false;
      element.replaceChildren(h("h3", { id: `${prefix}-h`, text: say("review.heading") }), h("p", { class: "studio-help", text: say("review.waiting") }));
    },
    hide() { element.hidden = true; },
    get review() { return review; },
  };
}
