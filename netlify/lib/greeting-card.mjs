// Greeting cards (ADR 0411): what a card is, how it is checked, when it goes out, and the email it
// becomes. Pure functions only, so the admin API, the hourly sender and the tests share them.
//
// A card is addressed to one person in the owner's private address book, uses one of a few fixed
// designs, and carries the owner's own words as plain text (never markup). It goes out once, on a
// day and hour in the owner's time zone, or every year on that day (a birthday). `{name}` and
// `{age}` in the subject or message are filled in when it is sent.

export const DESIGNS = Object.freeze({
  birthday: { label: "Birthday", band: "#f6b8c8", ink: "#9e2a4f", paper: "#fff8fb", motif: "🎂 🎈 🎁 🎈 🎂", subject: "Happy birthday, {name}!" },
  christmas: { label: "Christmas", band: "#2f6b3f", ink: "#a3172b", paper: "#fffdf7", motif: "🎄 ⭐ 🎁 ⭐ 🎄", subject: "Merry Christmas, {name}!" },
  thanksgiving: { label: "Thanksgiving", band: "#c4561c", ink: "#7a2a14", paper: "#fffaf0", motif: "🍂 🥧 🦃 🥧 🍂", subject: "Happy Thanksgiving, {name}!" },
  easter: { label: "Easter", band: "#b9a4e0", ink: "#5b3a8a", paper: "#fdfbff", motif: "🌷 🐣 🥚 🐣 🌷", subject: "Happy Easter, {name}!" },
  valentine: { label: "Valentine", band: "#e0567a", ink: "#a3172b", paper: "#fff7f8", motif: "💕 🌹 💌 🌹 💕", subject: "Happy Valentine's Day, {name}!" },
  anniversary: { label: "Anniversary", band: "#c9a24a", ink: "#6b4a12", paper: "#fffcf3", motif: "💐 💍 🥂 💍 💐", subject: "Happy anniversary, {name}!" },
  congratulations: { label: "Congratulations", band: "#3f8fc4", ink: "#1f4e7a", paper: "#f7fbff", motif: "🎉 🌟 🏆 🌟 🎉", subject: "Congratulations, {name}!" },
  "thinking-of-you": { label: "Thinking of you", band: "#8fb86a", ink: "#3f6b2e", paper: "#fbfdf6", motif: "🌼 ☕ 💛 ☕ 🌼", subject: "Thinking of you, {name}" },
  "just-because": { label: "Just because", band: "#f2b632", ink: "#7a4a12", paper: "#fffcf0", motif: "☀️ 🌻 💌 🌻 ☀️", subject: "A note for you, {name}" },
});

export const LIMITS = Object.freeze({ name: 80, email: 254, subject: 150, message: 4000, signOff: 80, contacts: 500, cards: 1000 });
export const STATUSES = Object.freeze(["scheduled", "sending", "sent", "failed", "cancelled"]);

const ADDRESS = /^[^\s@<>",;()\[\]\\]{1,64}@[^\s@<>",;()\[\]\\]{1,190}\.[A-Za-z]{2,24}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class CardError extends Error {
  constructor(status, code, field = null) {
    super(code);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

const text = (value) => String(value ?? "");
// One line: control and line-separator characters become spaces.
export const oneLine = (value, max) => text(value).replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, " ").trim().slice(0, max);
// A message keeps its line breaks; every other control character goes.
const paragraphs = (value, max) => text(value).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F\u2028\u2029]+/g, " ").trim().slice(0, max);

export const isUuid = (value) => UUID.test(text(value));
export const isEmail = (value) => ADDRESS.test(text(value));

/** `YYYY-MM-DD` naming a real day, or null. */
export function calendarDay(value) {
  const match = DAY.exec(text(value));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? { year, month, day } : null;
}

export function isTimeZone(zone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: text(zone) });
    return text(zone).length > 0 && text(zone).length <= 64;
  } catch {
    return false;
  }
}

/** The instant when the wall clock in `zone` reads `year-month-day hour:00`. */
export function zonedInstant({ year, month, day }, hour, zone) {
  const guess = Date.UTC(year, month - 1, day, hour);
  const offset = (at) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(at)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - at;
  };
  // Two passes settle the offset, daylight saving changes included.
  let at = guess - offset(guess);
  at = guess - offset(at);
  return new Date(at);
}

/** The same month and day in `year`; February 29 falls on the 28th in other years. */
export function inYear({ month, day }, year) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(day, last) };
}

/**
 * When a card next goes out after `now`: its own day for a one-time card (even if past, so it goes
 * at once), or the next time its month and day come round for a yearly one.
 */
export function nextSendAt({ sendOn, hour, zone, yearly, after = null }, now) {
  const day = calendarDay(sendOn);
  if (!day) throw new CardError(400, "invalid-day", "sendOn");
  if (!yearly) return zonedInstant(day, hour, zone);
  const floor = Math.max(now, after ?? -Infinity);
  const nowYear = Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric" }).format(new Date(now)));
  for (let year = Math.max(day.year, nowYear - 1); year <= nowYear + 2; year++) {
    const at = zonedInstant(inYear(day, year), hour, zone);
    if (at.getTime() > floor) return at;
  }
  throw new CardError(400, "invalid-day", "sendOn");
}

/** A person in the address book, checked. */
export function checkContact(input) {
  const name = oneLine(input?.name, LIMITS.name);
  const email = oneLine(input?.email, LIMITS.email).toLowerCase();
  if (!name) throw new CardError(400, "name-required", "name");
  if (!isEmail(email)) throw new CardError(400, "invalid-email", "email");
  let birthday = null;
  if (input?.birthday !== undefined && input?.birthday !== null && text(input.birthday) !== "") {
    if (!calendarDay(input.birthday)) throw new CardError(400, "invalid-day", "birthday");
    birthday = text(input.birthday);
  }
  return { name, email, birthday };
}

/** A card, checked. `zone` is the owner's time zone when the card doesn't name one. */
export function checkCard(input, zone) {
  const design = text(input?.design);
  if (!Object.hasOwn(DESIGNS, design)) throw new CardError(400, "invalid-design", "design");
  if (!isUuid(input?.contactId)) throw new CardError(400, "contact-required", "contactId");
  const subject = oneLine(input?.subject, LIMITS.subject) || DESIGNS[design].subject;
  const message = paragraphs(input?.message, LIMITS.message);
  if (!message) throw new CardError(400, "message-required", "message");
  const signOff = oneLine(input?.signOff, LIMITS.signOff);
  if (!calendarDay(input?.sendOn)) throw new CardError(400, "invalid-day", "sendOn");
  const hour = Number(input?.hour ?? 8);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new CardError(400, "invalid-hour", "hour");
  const timeZone = text(input?.timeZone || zone || "UTC");
  if (!isTimeZone(timeZone)) throw new CardError(400, "invalid-time-zone", "timeZone");
  return { design, contactId: text(input.contactId), subject, message, signOff, sendOn: text(input.sendOn), hour, timeZone, yearly: input?.yearly === true };
}

const escapeHtml = (value) => text(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** How old someone born on `birthday` is on `on` (both `YYYY-MM-DD`), or null. */
export function ageOn(birthday, on) {
  const born = calendarDay(birthday);
  const day = calendarDay(on);
  if (!born || !day) return null;
  let age = day.year - born.year;
  if (day.month < born.month || (day.month === born.month && day.day < born.day)) age -= 1;
  return age > 0 && age < 130 ? age : null;
}

/** `{name}` and `{age}` filled in; `{age}` with no birthday on file is left out. */
export function personalize(words, { name, age }) {
  return text(words).replace(/\{name\}/g, name).replace(/\{age\}/g, age === null || age === undefined ? "" : String(age)).replace(/ {2,}/g, " ");
}

/**
 * The email for a card: subject, HTML and plain text. Everything the owner wrote is escaped and set
 * as text; the layout is tables and inline styles, which every mail program shows the same way.
 */
export function renderCard(card, { contact, from, siteUrl = "", siteName = "", sendDay }) {
  const design = DESIGNS[card.design] || DESIGNS["just-because"];
  const first = text(contact.name).split(/\s+/)[0] || text(contact.name);
  const facts = { name: first, age: ageOn(contact.birthday, sendDay) };
  const subject = oneLine(personalize(card.subject || design.subject, facts), LIMITS.subject);
  const message = personalize(card.message, facts);
  const signOff = personalize(card.signOff || "", facts);
  const heading = subject;
  const body = message.split(/\n{2,}/).map((para) => `<p style="margin:0 0 16px;font-size:18px;line-height:1.6;color:#2b2420">${escapeHtml(para).replace(/\n/g, "<br>")}</p>`).join("");
  const link = siteUrl ? `<p style="margin:24px 0 0;font-size:14px;color:#6b5e55">From <a href="${escapeHtml(siteUrl)}" style="color:${design.ink}">${escapeHtml(siteName || siteUrl)}</a></p>` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>`
    + `<body style="margin:0;padding:0;background:#efe9e1">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe9e1"><tr><td align="center" style="padding:24px 12px">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${design.paper};border-radius:14px;overflow:hidden;border:1px solid #e2d8cc">`
    + `<tr><td align="center" style="background:${design.band};padding:22px 12px;font-size:34px;line-height:1.2;letter-spacing:6px">${design.motif}</td></tr>`
    + `<tr><td style="padding:30px 32px 8px;font-family:Georgia,'Times New Roman',serif">`
    + `<h1 style="margin:0 0 20px;font-size:30px;line-height:1.2;font-weight:700;color:${design.ink}">${escapeHtml(heading)}</h1>`
    + body
    + (signOff ? `<p style="margin:24px 0 0;font-size:22px;font-style:italic;color:${design.ink}">${escapeHtml(signOff)}</p>` : "")
    + link
    + `</td></tr><tr><td style="height:28px"></td></tr></table></td></tr></table></body></html>`;
  const plain = [subject, "", message, signOff ? `\n${signOff}` : "", siteUrl ? `\nFrom ${siteName || siteUrl}: ${siteUrl}` : ""].join("\n").trim();
  return { subject, html, text: plain, from, to: { email: contact.email, name: contact.name } };
}
