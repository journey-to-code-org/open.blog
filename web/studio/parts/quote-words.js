// Quote requests in her words: the three lists, what a status change says, the email trouble line,
// when an archived request goes, and Home's line. Customers' words are never handled here: they're
// set as text where they're shown. DOM-free, tested. Studio slice 10b;
// docs/specs/studio/slice-10bc/ux.md.
import { say } from "./words.js";

/** Word ids a site may change (docs/studio-words.md). */
export const WORDS = {
  "quote.hostChose": { text: "{helper} chose this, so it can't be changed here.", layer: "her" },
};

const DAY = 24 * 60 * 60 * 1000;
const STALE_PENDING_MS = 10 * 60 * 1000;
export const MAX_NOTIFY_ATTEMPTS = 5;

export const LISTS = [
  { id: "new", label: "New", empty: ["No new requests", "When someone fills in your quote form, it shows up here."] },
  { id: "handled", label: "Handled", empty: ["Nothing here yet", "Requests you've called back go here."] },
  { id: "archived", label: "Archived", empty: ["Nothing here yet", "Requests you're done with go here."] },
];

const REASONS = {
  "refused-key": "the email service didn't accept its key",
  rejected: "the email service turned it down; the sender address may need checking",
  "rate-limited": "the email service was too busy",
  "provider-error": "the email service had a problem",
  timeout: "the email service didn't answer in time",
  network: "the email service couldn't be reached",
};

/** "New 3", for the list picker. */
export const listLabel = (list, requests) => `${list.label} ${requests.filter((r) => r.status === list.id).length}`;

/** "failed", "late" or "": whether the email telling her about this request went out. */
export function emailTrouble(request, now = Date.now()) {
  if (request.notify === "failed") return "failed";
  if (request.notify === "pending" && now - Date.parse(request.createdAt) > STALE_PENDING_MS) return "late";
  return "";
}

/** The card's line about that email, or "". */
export function emailLine(request, now = Date.now()) {
  const trouble = emailTrouble(request, now);
  if (!trouble) return "";
  if (trouble === "late") return "The email about this request hasn't gone out yet. The request is safe here.";
  const reason = REASONS[request.notifyError];
  return `The email about this request didn't reach you${reason ? `: ${reason}` : ""}. The request is safe here.`;
}

/** The banner about emails that didn't reach her, and whether trying again can help. */
export function troubleBanner(requests, notifyEnabled, now = Date.now()) {
  const stuck = requests.filter((r) => emailTrouble(r, now));
  if (!stuck.length) return null;
  const heading = stuck.length === 1 ? "The email about 1 request didn't reach you." : `The email about ${stuck.length} requests didn't reach you.`;
  if (!notifyEnabled) return { heading, text: `Emails to you are turned off. ${say("common.tell")}`, retry: false };
  if (stuck.every((r) => (r.notifyAttempts || 0) >= MAX_NOTIFY_ATTEMPTS)) return { heading, text: `They were tried ${MAX_NOTIFY_ATTEMPTS} times. ${say("common.tell")}`, retry: false };
  return { heading, text: "The requests are safe here.", retry: true };
}

/** "Erased automatically in 12 days.", for an archived request. `sayDay` says a date. */
export function eraseLine(eraseAfter, now = Date.now()) {
  if (!eraseAfter) return "";
  const left = Math.ceil((Date.parse(eraseAfter) - now) / DAY);
  if (Number.isNaN(left)) return "";
  if (left <= 0) return "Erased automatically within a day.";
  return `Erased automatically in ${left === 1 ? "1 day" : `${left} days`}.`;
}

/** What a status change says. */
export function statusWords(request, to, retentionDays) {
  if (to === "handled") return `${request.name}: handled.`;
  if (to === "archived") return `Archived. It's under Archived.${retentionDays ? ` It's erased automatically ${retentionDays} days after you archive it.` : ""}`;
  return `${request.name} is back under New.`;
}

/** "tel:+13045550101" from what the customer typed: only digits and a leading +. */
export function telHref(phone) {
  const raw = String(phone || "").trim();
  const digits = raw.replace(/[^0-9]/g, "");
  return digits ? `tel:${raw.startsWith("+") ? "+" : ""}${digits}` : "";
}

/** Home's line, or "". */
export function homeQuoteLine(requests) {
  const n = (requests || []).filter((r) => r.status === "new").length;
  if (!n) return "";
  return n === 1 ? "1 new quote request" : `${n} new quote requests`;
}

/** A failure in her words; the server's text (which may name settings) goes in details. */
export function quoteTrouble(error) {
  const status = error?.status ?? 0;
  if (!status) return "Your site's server couldn't be reached. Check your connection, then try again.";
  if (status === 404 || status === 401) return `The quote form isn't connected properly. ${say("common.tell")}`;
  if (status === 502 || status === 503 || status === 504) return "Your quote requests aren't answering right now. Try again in a minute.";
  return "That didn't go through. Try again.";
}

/** A refusal while cleaning up archived requests; an older requests service is said plainly. */
export function cleanupTrouble(error) {
  if (error?.data?.code === "hosted-too-old") return `Your requests service needs updating before your blog can clean up. ${say("common.tell")}`;
  return quoteTrouble(error);
}

// ---- R1: the spreadsheet and auto-erase sheets (docs/specs/studio/r1/ux.md) ----------------

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "November 1" for "2026-11-01"; "" when it isn't a day. */
export function dayWords(ymd) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  return match && MONTH_NAMES[Number(match[2]) - 1] ? `${MONTH_NAMES[Number(match[2]) - 1]} ${Number(match[3])}` : "";
}

/** The To field's problem, or "": To before From. */
export function exportDayProblem(from, to) {
  return from && to && to < from ? `Pick a day on or after ${dayWords(from)}.` : "";
}

/** What a download says. `count` 0 means nothing was downloaded. */
export function exportWords(count, from, to) {
  if (!count) return "No requests in those days, so there's nothing to download.";
  if (!from && !to) return count === 1 ? "Downloaded the 1 request." : `Downloaded all ${count} requests.`;
  const days = from && to ? `from ${dayWords(from)} to ${dayWords(to)}` : from ? `from ${dayWords(from)} on` : `up to ${dayWords(to)}`;
  return `Downloaded ${plural(count, "request", "requests")} ${days}.`;
}

/** How long archived requests stay, in her words. `source` "host" means where the site runs chose it. */
export function retentionWords(days, source) {
  if (!days) return "Archived requests stay until you erase them.";
  const said = `Archived requests are erased ${plural(days, "day", "days")} after you archive them.`;
  return source === "host" ? `${said} ${say("common.chose")}` : said;
}

/** The days field's problem, or "" (a whole number from 1 to 3650). */
export function retentionDaysProblem(text) {
  const value = String(text ?? "").trim();
  return /^\d{1,4}$/.test(value) && Number(value) >= 1 && Number(value) <= 3650 ? "" : "Write a number of days from 1 to 3650.";
}

/** The question before erasing old requests now, from the dry run. */
export function eraseOldQuestion({ wouldErase, photos }, days) {
  const one = wouldErase === 1;
  const what = photos ? `${one ? "It" : "They"} and ${photos === 1 ? `${one ? "its" : "their"} 1 photo` : `${one ? "its" : "their"} ${photos} photos`}` : one ? "It" : "They";
  return {
    heading: `Erase ${plural(wouldErase, "old request", "old requests")} now?`,
    text: `${one ? "It was" : "They were"} archived more than ${plural(days, "day", "days")} ago. ${what} ${one && !photos ? "goes" : "go"} for good; this can't be undone.`,
  };
}

/** What erasing old requests now says. */
export function erasedOldWords({ erased, photosPending }) {
  const said = `Erased ${plural(erased || 0, "old request", "old requests")}.`;
  return photosPending ? `${said} ${plural(photosPending, "photo is", "photos are")} still being removed; nothing points to ${photosPending === 1 ? "it" : "them"}.` : said;
}
