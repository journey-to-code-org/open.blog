// Moved from web/admin/job-share.js (the old Admin's Share this job, story #488, ADRs 0393 to 0397)
// for the old Admin's retirement: the pure half only, so Studio loads nothing from /admin/. One
// finished job for Google Business Profile, a Facebook Page and Nextdoor; a connected Facebook Page
// is posted to through the announcements, everything else by hand. Where a place stands is said
// in Studio's words (rewritten on share-words in R1); docs/specs/studio/r1/ux.md.
import { deliveryOf, newKey } from "./announcements-rules.js";

export { newKey };

/** The newest announcement of this job on a Facebook Page, or null. */
export function facebookAnnouncement(announcements, work) {
  const mine = (Array.isArray(announcements) ? announcements : [])
    .filter((item) => item?.work === work && item?.destination?.provider === "facebook")
    .sort((a, b) => String(b.createdAt || b.scheduledFor || "").localeCompare(String(a.createdAt || a.scheduledFor || "")));
  return mine[0] || null;
}

/**
 * How the owner gets this place done: `facebook-page` when open.blog can post it through her
 * connected Page, otherwise `by-hand`. Google is never sent from here.
 */
export function wayFor(destination, { pages = [], announcements = false } = {}) {
  if (destination?.destination === "facebook" && destination.route === "adapter" && announcements && pages.length) return "facebook-page";
  return "by-hand";
}

/**
 * Whether the job may be scheduled on the Facebook Page again: only when it has no announcement
 * there, or its newest one failed or was canceled. A scheduled, sending, published or unsettled
 * one is never doubled, even from a screen opened later with a new key (ADR 0397).
 */
export function pageOpen(announcement) {
  if (!announcement) return true;
  const state = deliveryOf(announcement);
  return state === "failed" || state === "canceled";
}

/** The time a Facebook announcement is scheduled for: five minutes from now, as a UTC instant. */
export function soon(now = Date.now()) {
  return new Date(now + 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ---- Studio's words (R1) --------------------------------------------------------------------

/** The badge for a Page post, by delivery (share-words' states). */
const PAGE_BADGES = Object.freeze({
  pending: { text: "Going out", variant: "info" },
  processing: { text: "Going out", variant: "info" },
  retrying: { text: "Going out", variant: "info" },
  published: { text: "Done", variant: "success" },
  unknown: { text: "Check this", variant: "warning" },
  failed: { text: "Didn't go out", variant: "danger" },
  canceled: { text: "Not yet", variant: "neutral" },
});

const RECORD_BADGES = Object.freeze({
  posted: { text: "Done", variant: "success" },
  "posted-by-hand": { text: "You posted it", variant: "success" },
  unknown: { text: "Check this", variant: "warning" },
  "not-posted": { text: "Didn't go out", variant: "danger" },
  "kit-made": { text: "Not yet", variant: "neutral" },
});

/**
 * Where one place stands: { text, variant, done, changed }. A Page post that failed or was
 * canceled gives way to her own "I posted it" mark (ADR 0397).
 */
export function standing(destination, announcement = null) {
  const byHand = destination?.record?.status === "posted-by-hand";
  if (announcement && !(byHand && pageOpen(announcement))) {
    const badge = PAGE_BADGES[deliveryOf(announcement)] || PAGE_BADGES.unknown;
    return { ...badge, done: badge.text === "Done", changed: false };
  }
  const badge = RECORD_BADGES[destination?.record?.status] || { text: "Not yet", variant: "neutral" };
  const done = badge.text === "Done" || badge.text === "You posted it";
  return { ...badge, done, changed: done && destination?.changedSince === true };
}

/** Whether a place offers Copy, Open and I posted it: not done yet, or the job changed since. */
export const offersPosting = (now) => !now?.done || now?.changed === true;

/** One line under the badge, or "". */
export function standingText(destination, announcement = null) {
  const now = standing(destination, announcement);
  if (now.changed) return "You changed the job since. Post the new words if you like.";
  if (now.text === "Check this") return "Your site may have posted it. Look there first before posting again.";
  return "";
}

/** A blocking problem, by its code, in her words; the server's message goes in details. */
export const JOB_PROBLEMS = Object.freeze({
  "no-photo": "Add a photo of the finished work to the job.",
  "link-not-public": "Publish the job first, so the link works.",
  "photo-location": "The first photo may show where your customer lives. Use a copy without location.",
});

export function problemWords(code) {
  if (Object.hasOwn(JOB_PROBLEMS, code)) return JOB_PROBLEMS[code];
  if (/^photo-/.test(String(code || ""))) return "The first after photo can't be used. Pick another in Write.";
  return "Something about the job needs a look in Write.";
}

/** The one key per job and words, so pressing the button twice schedules the post once. */
export const keyFor = (work, digest) => `${work}\n${digest}`;

/** A refusal from the share routes, in her words. */
export function jobShareTrouble(error, label = "there") {
  const code = error?.data?.code;
  if (code === "not-found") return "Studio couldn't find this job. It may have been deleted or renamed.";
  if (code === "marked-again") return `You marked ${label} again since, so that newer mark stays.`;
  if (code === "not-shareable" || error?.status === 422) return "This isn't a published job, so there's nothing to share.";
  if (code === "changed") return "The job changed while you looked. Here are the new words.";
  if (code === "sent") return `Your site already sent this, or may have. Look on ${label} first.`;
  if (!error?.status) return "Studio couldn't reach your site's server. Check your connection, then try again.";
  return "That didn't go through. Try again.";
}

/** What a job that didn't open offers: "write" (open it to fix), "retry", or null (it isn't there). */
export function troubleAction(error) {
  if (error?.data?.code === "not-found") return null;
  if (error?.data?.code === "not-shareable" || error?.status === 422) return "write";
  return "retry";
}
