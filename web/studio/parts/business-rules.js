// Moved from web/admin/business.js (the old Admin's model) for the old Admin's retirement: the
// pure rules only, so Studio loads nothing from /admin/. Studio draws its own screen.
// The Business facts screen (ADR 0307, #508): your name, phone, hours, license and insurance, set once
// under Site and used by the footer, the home page and search engines. One column from 320px, every
// control at least 44px tall, a native control for every choice (a select for each day, real time
// inputs, checkboxes), and every problem said beside the field it is about in plain words. The server
// judges the block again and answers with the same kind of problem, so a rule can never pass here and
// fail there.
//
// The pure functions at the top are the contract and are tested without a page.


export const WEEKDAYS = Object.freeze([
  ["monday", "Monday"],
  ["tuesday", "Tuesday"],
  ["wednesday", "Wednesday"],
  ["thursday", "Thursday"],
  ["friday", "Friday"],
  ["saturday", "Saturday"],
  ["sunday", "Sunday"],
]);

export const PAYMENT_METHODS = Object.freeze([
  ["cash", "Cash"],
  ["check", "Check"],
  ["credit-card", "Credit card"],
  ["debit-card", "Debit card"],
  ["bank-transfer", "Bank transfer"],
  ["mobile-payment", "Mobile payment"],
  ["financing", "Financing"],
]);

export const DAY_MODES = Object.freeze([
  ["unset", "Not shown"],
  ["open", "Open"],
  ["allday", "Open 24 hours"],
  ["closed", "Closed"],
]);

export const FIRST_YEAR = 1800;
export const LAST_YEAR = 2100;
const TEXT_FIELDS = ["displayName", "legalName", "trade", "phone", "email", "licenseNumber", "licenseIssuer"];
const MAX_LINE = 120;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clean = (value) => (typeof value === "string" ? value.trim() : "");

/** The form for a stored block: everything the owner can see and change, and nothing else. */
export function formFromBusiness(business) {
  const stored = isObject(business) ? business : {};
  const hours = {};
  for (const [day] of WEEKDAYS) {
    const value = isObject(stored.hours) ? stored.hours[day] : null;
    if (isObject(value) && value.closed === true) hours[day] = { mode: "closed", open: "08:00", close: "17:00" };
    else if (isObject(value) && value.open === "00:00" && value.close === "24:00") hours[day] = { mode: "allday", open: "08:00", close: "17:00" };
    else if (isObject(value) && typeof value.open === "string" && typeof value.close === "string") hours[day] = { mode: "open", open: value.open, close: value.close };
    else hours[day] = { mode: "unset", open: "08:00", close: "17:00" };
  }
  const form = { insured: stored.insured === true, foundedYear: Number.isInteger(stored.foundedYear) ? String(stored.foundedYear) : "", paymentMethods: Array.isArray(stored.paymentMethods) ? stored.paymentMethods.filter((id) => PAYMENT_METHODS.some(([known]) => known === id)) : [], hours };
  for (const field of TEXT_FIELDS) form[field] = clean(stored[field]);
  return form;
}

/** Turns what a person types into the stored phone form: separators dropped, ten digits read as a US or Canada number. */
export function normalizePhone(input) {
  const trimmed = clean(input);
  if (!trimmed) return "";
  if (!/^[0-9+\s().-]+$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed;
}

/** `(360) 555-0142` for a US or Canada number, the stored form otherwise: what the site will show. */
export function formatPhone(phone) {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : phone;
}

/** The block to send: only what is stated, in the stored shape. */
export function businessFromForm(form) {
  const business = {};
  for (const field of TEXT_FIELDS) {
    const value = field === "phone" ? normalizePhone(form[field]) : clean(form[field]);
    if (value) business[field] = field === "trade" ? value.toLowerCase() : value;
  }
  if (form.insured) business.insured = true;
  const year = clean(form.foundedYear);
  if (year) business.foundedYear = /^\d+$/.test(year) ? Number(year) : year;
  if (form.paymentMethods?.length) business.paymentMethods = PAYMENT_METHODS.map(([id]) => id).filter((id) => form.paymentMethods.includes(id));
  const hours = {};
  for (const [day] of WEEKDAYS) {
    const row = form.hours?.[day];
    if (!row) continue;
    if (row.mode === "closed") hours[day] = { closed: true };
    else if (row.mode === "allday") hours[day] = { open: "00:00", close: "24:00" };
    else if (row.mode === "open") hours[day] = { open: row.open, close: row.close };
  }
  if (Object.keys(hours).length) business.hours = hours;
  return business;
}

export function sameBusiness(a, b) {
  return JSON.stringify(businessFromForm(a)) === JSON.stringify(businessFromForm(b));
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** Every problem with the form, each with the field (and day) it belongs to, in words an owner can act on. */
export function validateForm(form) {
  const problems = [];
  const add = (field, message, day) => problems.push({ field, message, ...(day ? { day } : {}) });
  for (const field of ["displayName", "legalName"]) {
    if (clean(form[field]).length > MAX_LINE) add(field, `Keep this to ${MAX_LINE} characters or fewer.`);
  }
  const phone = normalizePhone(form.phone);
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) add("phone", "Add the country code and the digits, like +1 360 555 0142. A US or Canada number with its area code works too.");
  const email = clean(form.email);
  if (email && (email.length > 254 || !EMAIL.test(email) || email.includes(".."))) add("email", "Type one email address, like office@example.com.");
  if (clean(form.licenseNumber).length > 40) add("licenseNumber", "Keep the license number to 40 characters or fewer.");
  if (clean(form.licenseIssuer).length > 80) add("licenseIssuer", "Keep this to 80 characters or fewer.");
  if (clean(form.licenseIssuer) && !clean(form.licenseNumber)) add("licenseIssuer", "Add the license number that goes with this issuer, or clear the issuer.");
  const year = clean(form.foundedYear);
  if (year && (!/^\d{4}$/.test(year) || Number(year) < FIRST_YEAR || Number(year) > LAST_YEAR)) add("foundedYear", `Type a four-digit year between ${FIRST_YEAR} and ${LAST_YEAR}.`);
  for (const [day, label] of WEEKDAYS) {
    const row = form.hours?.[day];
    if (row?.mode !== "open") continue;
    if (!CLOCK.test(row.open || "") || !CLOCK.test(row.close || "")) add("hours", `${label}: choose both an opening and a closing time.`, day);
    else if (row.close <= row.open) add("hours", `${label}: closing time must be after the opening time. For a day that runs all night, choose Open 24 hours.`, day);
  }
  return problems;
}

/** Copy one day's setting onto other days, as a new form. */
export function copyDay(form, from, to) {
  const source = form.hours?.[from];
  if (!source) return form;
  const hours = { ...form.hours };
  for (const day of to) hours[day] = { ...source };
  return { ...form, hours };
}

const ERROR_TEXT = Object.freeze({
  413: "That is too much to save. Shorten the longest entries and try again.",
  401: "You were signed out. Sign in again, then save.",
});

export function businessErrorText(error) {
  const status = error?.status;
  if (ERROR_TEXT[status]) return ERROR_TEXT[status];
  if (status === 409) return "These facts changed in another window or by someone else. Reload them, then make your changes again.";
  const detail = String(error?.data?.error || error?.message || "").trim();
  return detail ? `The facts were not saved. ${detail}` : "The facts were not saved. Check your connection and try again.";
}

let uid = 0;

