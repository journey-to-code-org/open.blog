// Greeting cards in her words: how the list is grouped, what each card is called, what Home says
// about the week ahead, the editor's starting values, and failures. DOM-free, tested. Studio slice 9;
// docs/specs/studio/slice-9/ux.md.

const DAY = 24 * 60 * 60 * 1000;

/** Why a card didn't go out (the sender's fixed codes), as the old Admin says it. */
export const REASONS = Object.freeze({
  "refused-key": "the email service didn't accept its key",
  rejected: "the email service turned it down; the address may be wrong",
  "rate-limited": "the email service was too busy",
  "provider-error": "the email service had a problem",
  timeout: "the email service didn't answer in time",
  network: "the email service couldn't be reached",
  "no-contact": "the person it was for was removed",
});

/** "Birthday", or the design id in words when the server's list doesn't name it. */
export function designLabel(id, designs = []) {
  const known = designs.find((d) => d.id === id)?.label;
  if (known) return known;
  const words = String(id || "card").replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "Ricky's birthday card", the way Cards and Home both say it. */
export function cardTitle(card, person, designs = []) {
  const who = person?.name ? `${person.name}'s` : "A";
  return `${who} ${designLabel(card.design, designs).toLowerCase()} card`;
}

/** The list's sections, in order, each only when it has cards. Cancelled cards never show. */
export function sections(cards) {
  const by = (key) => (a, b) => String(a[key] || "").localeCompare(String(b[key] || ""));
  const failed = cards.filter((c) => c.status === "failed").sort(by("nextSendAt"));
  const coming = cards.filter((c) => c.status === "scheduled" || c.status === "sending").sort(by("nextSendAt"));
  const sent = cards.filter((c) => c.status === "sent").sort(by("lastSentAt")).reverse();
  return [
    { id: "failed", heading: "Didn't go out", cards: failed },
    { id: "coming", heading: "Coming up", cards: coming },
    { id: "sent", heading: "Sent", cards: sent },
  ].filter((s) => s.cards.length);
}

/** The line under a card's heading. `when(iso)` says an instant in her zone. */
export function cardLine(card, when) {
  if (card.status === "failed") return `Didn't go out: ${REASONS[card.error] || "something went wrong"}. Open it and schedule it again.`;
  if (card.status === "sending") return "It's on its way.";
  if (card.status === "sent") return `Went out ${when(card.lastSentAt)}.`;
  const last = card.yearly && card.lastSentAt ? ` Last went out ${when(card.lastSentAt)}.` : "";
  return `Goes out ${when(card.nextSendAt)}.${last}`;
}

/** The day word for Home: "today", "tomorrow", or the weekday. `today` is YYYY-MM-DD in her zone. */
function dayWord(iso, today, timeZone) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const gap = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
  if (gap <= 0) return "today";
  if (gap === 1) return "tomorrow";
  return `on ${new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(new Date(iso))}`;
}

/**
 * Home's one line about cards, or "" for nothing to say: a card that didn't go out first, else
 * what goes out in the next 7 days.
 */
export function homeCardLine(cards, contacts, { now = Date.now(), designs = [] } = {}) {
  const person = (id) => contacts.find((c) => c.id === id) || null;
  const failed = cards.filter((c) => c.status === "failed");
  if (failed.length === 1) return `${cardTitle(failed[0], person(failed[0].contactId), designs)} didn't go out`;
  if (failed.length > 1) return `${failed.length} cards didn't go out`;
  const soon = cards
    .filter((c) => c.status === "scheduled" && c.nextSendAt && Date.parse(c.nextSendAt) >= now - DAY && Date.parse(c.nextSendAt) <= now + 7 * DAY)
    .sort((a, b) => a.nextSendAt.localeCompare(b.nextSendAt));
  if (!soon.length) return "";
  const first = soon[0];
  const zone = first.timeZone || "UTC";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const when = dayWord(first.nextSendAt, today, zone);
  const title = cardTitle(first, person(first.contactId), designs);
  if (soon.length === 1) return `${title} goes out ${when}`;
  const name = person(first.contactId)?.name;
  return `${soon.length} cards go out this week${name ? `, ${name}'s first, ${when}` : ""}`;
}

/** Today as YYYY-MM-DD in a zone. */
export function todayIn(timeZone, now = Date.now()) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

/** The next time a yearly day comes round, as YYYY-MM-DD, from `today`. */
export function nextYearly(day, today) {
  const [, month, date] = String(day).split("-");
  const year = Number(today.slice(0, 4));
  const thisYear = `${year}-${month}-${date}`;
  return thisYear >= today ? thisYear : `${year + 1}-${month}-${date}`;
}

/** A new card's starting values. */
export function newCard({ contacts, designs, forId, today, signOff }) {
  const person = contacts.find((c) => c.id === forId) || contacts[0] || null;
  const has = (id) => designs.some((d) => d.id === id);
  const birthday = Boolean(person?.birthday) && has("birthday");
  return {
    contactId: person?.id || "",
    design: birthday ? "birthday" : has("just-because") ? "just-because" : designs[0]?.id || "",
    subject: "",
    message: "",
    signOff: signOff || "Love, Grammi",
    sendOn: birthday ? person.birthday : today,
    hour: 8,
    yearly: birthday,
  };
}

/** The editable fields of a card the server sent. */
export const cardForm = (card) => ({
  contactId: card.contactId, design: card.design, subject: card.subject, message: card.message,
  signOff: card.signOff, sendOn: card.sendOn, hour: card.hour, yearly: card.yearly,
});

/** "6 AM" … "9 PM". */
export const hourLabel = (hour) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
export const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

/** A failure in her words. `doing` is what she was doing: "load", "save", "test", "person". */
export function cardTrouble(error, doing = "save") {
  const status = error?.status ?? 0;
  const code = error?.data?.code || error?.data?.error;
  if (!status) return "Studio couldn't reach your site's server. Check your connection, then try again.";
  if (status === 400 && error?.data?.field && error.message) return error.message;
  if (code === "invalid-time-zone") return "Studio couldn't work out your time zone. Tell the person who set up your site.";
  if (status === 404) return "That card isn't there any more. Here's your list as it is now.";
  if (code === "too-many") return doing === "person" ? "Your address book is full." : "Your card list is full. Stop one you don't need, then try again.";
  if (code === "busy") return "That card is going out right now. Try again in a minute.";
  if (doing === "test" && (code === "send-failed" || status === 502)) return "The test didn't go out: the email service turned it down. Check the address, then try again.";
  if (status === 502 || status === 503 || status === 504) return "Your cards service isn't answering right now. Nothing changed. Try again in a few minutes.";
  if (status === 400 && error.message) return error.message;
  return "That didn't go through. Nothing changed. Try again.";
}
