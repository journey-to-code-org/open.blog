// Comments in her words: the four views, each decision's button and what it says afterwards, the
// reasons, and Home's waiting line. The server sends each item's actions and reasons; Studio only
// renames the ones it knows, so a new server action or reason still shows (under its own label).
// DOM-free, tested. Studio slice 8.
import { say } from "./words.js";

/** The views, in the order the picker lists them. `state` is the server's moderation state. */
export const VIEWS = [
  { id: "", state: "pending", label: "Waiting", lede: "New comments wait here until you choose. Nobody else sees them yet.",
    empty: ["Nothing waiting", "When someone leaves a comment, it waits here for you to say yes."], other: "shown" },
  { id: "shown", state: "approved", label: "Shown", lede: "These are on your posts for everyone to read.",
    empty: ["No comments up yet", "Comments you show appear under your posts, and here."], other: "" },
  { id: "not-shown", state: "rejected", label: "Not shown", lede: "You chose not to show these. Only you can see them.",
    empty: ["Nothing here", "Comments you choose not to show stay here, out of sight, in case you change your mind."], other: "" },
  { id: "taken-down", state: "removed", label: "Taken down", lede: "These were shown, then you took them down. Only you can see them.",
    empty: ["Nothing taken down", "If you take a comment down, it waits here in case you want it back."], other: "shown" },
];

/** The view an address names ("" and anything unknown are Waiting). */
export const viewOf = (arg) => VIEWS.find((v) => v.id === arg) || VIEWS[0];

/** The empty-state button: where it goes and what it says. */
export const otherViewWords = (view) => (view.other === "shown" ? "See what's shown" : "See what's waiting");

const REASONS = {
  spam: "It's spam",
  abusive: "It's unkind",
  "personal-data": "It shares something private",
  "off-topic": "It's not about this post",
  duplicate: "They said it twice",
  rights: "It copies someone else's work",
  "no-action": "The comment is fine",
  other: "Another reason",
};
const REPORT_REASONS = { ...REASONS, duplicate: "It was already reported", spam: "The report is spam" };

/** One reason in her words, or the server's label for one Studio doesn't know. */
export function reasonWords(reason, { report = false } = {}) {
  const words = (report ? REPORT_REASONS : REASONS)[reason.id];
  return words || reason.label || reason.id;
}

/** Studio handles comments and reports; every other kind is the full inbox's. */
export const handled = (item) => item.source === "comment" || item.source === "report";

/** Whose it is: "Aunt Sue's comment on Pecan pie", for the card's label and its menus. */
export function cardLabel(item) {
  const on = item.post?.title ? ` on ${item.post.title}` : "";
  if (item.source === "report") return `${item.reader?.name || "Someone"}'s report${on}`;
  if (!handled(item)) return `A note${on}`;
  return `${item.reader?.name || "Someone"}'s comment${on}`;
}

const where = (item) => (item.post?.title ? `“${item.post.title}”` : "your site");

/**
 * The buttons a card shows on top, in order, from the actions the server offered: each
 * `{ action, label, primary, asks }` where `asks` means it opens the Why menu. Anything else the
 * server offered goes to the More menu (`more`), under the server's label; `erase` is always there.
 */
export function buttonsFor(item) {
  const offered = new Map((item.actions || []).map((a) => [a.action, a]));
  const top = [];
  const take = (action, label, primary, asks) => {
    const offer = offered.get(action);
    if (!offer) return;
    top.push({ action, label, primary, asks: asks && (offer.reasons || []).length > 0, offer });
    offered.delete(action);
  };
  if (item.source === "report") {
    // The reader already said why; ask again only when that reason isn't one the server takes.
    take("uphold-report", "Take the comment down", true, !reportReason(item));
    take("reject", "Keep the comment", false, !quietReason(offered.get("reject")));
    take("reopen", "Decide again", false, false);
  } else if (item.source === "comment") {
    take("approve", "Show it", true, false);
    take("reject", "Don't show", false, true);
    take("remove", "Take it down", false, true);
    take("reopen", "Put it back in Waiting", false, false);
  }
  // Studio never asks a reader to clarify a comment: that's for scholarly notes.
  offered.delete("request-clarification");
  const more = [...offered.values()].map((offer) => ({
    action: offer.action,
    label: offer.action === "erase" ? "Erase it for good" : offer.label,
    asks: offer.action !== "erase" && (offer.reasons || []).length > 0,
    offer,
  }));
  return { top, more };
}

/** Taking a reported comment down sends the report's own reason, when the server takes it. */
export function reportReason(item) {
  const ground = item.report?.ground;
  const offer = (item.actions || []).find((a) => a.action === "uphold-report");
  return ground && (offer?.reasons || []).some((r) => r.id === ground) ? ground : null;
}

/** "Keep the comment" sends this reason without asking, when the server offers it. */
export function quietReason(offer) {
  return (offer?.reasons || []).some((r) => r.id === "no-action") ? "no-action" : null;
}

/** What a decision did, for the status line and the toast. */
export function decidedWords(item, action) {
  const report = item.source === "report";
  if (action === "approve") return `Shown under ${where(item)}. Visitors can see it now. Changed your mind? It's under Shown, with Take it down.`;
  if (action === "reject" && report) return "Kept. The comment stays where it is.";
  if (action === "reject") return "Not shown. Nobody else sees it.";
  if (action === "remove") return `Taken down from ${where(item)}. Visitors don't see it any more.`;
  if (action === "uphold-report") return `Taken down from ${where(item)}. Visitors don't see it any more. To bring it back, find it under Taken down.`;
  if (action === "reopen") return report ? "Back in Waiting." : "Back in Waiting. Choose Show it when you're ready.";
  if (action === "erase") return "Erased. Its words and the name are gone for good.";
  return "Done.";
}

/** Which decisions can be undone (sent back to Waiting with `reopen`), and the banner's words. */
export function undoWords(item, action) {
  const label = cardLabel(item);
  if (action === "reject" && item.source === "report") return `Kept: ${label}.`;
  if (action === "reject") return `Not shown: ${label}.`;
  if (action === "remove") return `Taken down: ${label}.`;
  return null;
}

/** The line a decided card adds: "Not shown: it's spam. You decided Tuesday, November 10." */
export function decisionLine(item, sayDay) {
  const day = item.moderatedAt ? ` You decided ${sayDay(item.moderatedAt)}.` : "";
  if (item.source === "report") {
    if (item.status === "approved") return `You took the comment down.${day}`;
    if (item.status === "rejected") return `You kept the comment.${day}`;
    return "";
  }
  const why = item.reason ? `: ${reasonWords({ id: item.reason, label: item.reasonLabel }).replace(/^./, (c) => c.toLowerCase())}` : "";
  if (item.status === "approved") return `Shown.${day}`;
  if (item.status === "rejected") return `Not shown${why}.${day}`;
  if (item.status === "removed") return `Taken down${why}.${day}`;
  return "";
}

/** Home's line, or "" for nothing to say. `page` is one pending page as the server sent it. */
export function waitingLine(page) {
  const count = (page?.items || []).filter(handled).length;
  if (!count) return "";
  if (page.next) return `More than ${count} comments are waiting for you`;
  return count === 1 ? "1 comment is waiting for you" : `${count} comments are waiting for you`;
}

/** A failure in her words. `where` is "list" or "card". */
export function troubleWords(error, place) {
  const status = error?.status ?? 0;
  if (!status) return "Studio couldn't reach your site's server. Check your connection, then try again.";
  if (status === 502 || status === 503 || status === 504) {
    return place === "list"
      ? "Your comments service isn't answering right now, so Studio can't show your comments. Try again in a few minutes."
      : "That didn't go through: your comments service isn't answering. Nothing changed. Try again in a few minutes.";
  }
  return place === "list"
    ? `Your comments didn't load. ${say("common.keepsHappening")}`
    : "That didn't go through. Nothing changed. Try again.";
}

/** The body of a decision (the server knows who is acting). */
export function decisionRequest(item, action, reason) {
  const body = { source: item.source, id: item.id, action, from: item.status, version: item.version };
  if (reason) body.reason = reason;
  return body;
}
