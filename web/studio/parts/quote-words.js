// Quote requests in her words: the three lists, what a status change says, the email trouble line,
// when an archived request goes, and Home's line. Customers' words are never handled here: they're
// set as text where they're shown. DOM-free, tested. Studio slice 10b;
// docs/specs/studio/slice-10bc/ux.md.

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
  if (!notifyEnabled) return { heading, text: "Emails to you are turned off. Tell the person who set up your site.", retry: false };
  if (stuck.every((r) => (r.notifyAttempts || 0) >= MAX_NOTIFY_ATTEMPTS)) return { heading, text: `They were tried ${MAX_NOTIFY_ATTEMPTS} times. Tell the person who set up your site.`, retry: false };
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
  if (!status) return "Studio couldn't reach your site's server. Check your connection, then try again.";
  if (status === 404 || status === 401) return "The quote form isn't connected properly. Tell the person who set up your site.";
  if (status === 502 || status === 503 || status === 504) return "Your quote requests aren't answering right now. Try again in a minute.";
  return "That didn't go through. Try again.";
}
