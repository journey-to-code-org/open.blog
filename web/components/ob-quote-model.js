// The pure part of <ob-quote>: field checks and photo bounds that mirror the hosted function
// (netlify/lib/quote-intake.mjs). The server checks everything again; these only save a round trip.
// No DOM, no network.

export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 900 * 1024;
export const MAX_TOTAL_PHOTO_BYTES = 4 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const PHONE = /^\+?[0-9 ().-]{7,30}$/;
const EMAIL = /^[^\s@<>]{1,100}@[^\s@<>]{1,100}\.[^\s@<>]{2,30}$/;

const LIMITS = { name: 100, phone: 30, email: 200, town: 100, service: 100, description: 2000 };

/** The sentence under a field, or "" when it is fine. */
export function fieldError(name, raw) {
  const value = String(raw ?? "").trim();
  switch (name) {
    case "name": return value ? (value.length > LIMITS.name ? "Use at most 100 characters." : "") : "Enter your name.";
    case "phone":
      if (!value) return "Enter a phone number we can call.";
      return PHONE.test(value) ? "" : "Enter a phone number with digits, spaces, dashes or brackets, such as 360 555 0142.";
    case "email": return !value || EMAIL.test(value) ? "" : "Enter an email address such as name@example.com, or leave it empty.";
    case "town": return value ? "" : "Choose or enter your town.";
    case "service": return value ? "" : "Choose or enter the service you need.";
    case "description":
      if (value.length < 10) return "Write at least a sentence about what you need.";
      if (value.length > LIMITS.description) return "Use at most 2,000 characters.";
      return (value.match(/https?:\/\/|www\./gi) || []).length > 2 ? "Please leave out the links." : "";
    default: return "";
  }
}

/** { name: sentence } for every field that needs fixing, in form order. */
export function fieldErrors(values) {
  const errors = {};
  for (const name of ["name", "phone", "email", "town", "service", "description"]) {
    const message = fieldError(name, values[name]);
    if (message) errors[name] = message;
  }
  return errors;
}

/** The sentence about the chosen photos, or "". `files` are { type, size } as a browser reports them. */
export function photoError(files) {
  if (files.length > MAX_PHOTOS) return `Choose at most ${MAX_PHOTOS} photos.`;
  if (files.some((file) => !IMAGE_TYPES.includes(file.type))) return "Photos must be JPEG, PNG or WebP.";
  return "";
}

/** After shrinking: whether every photo, and all together, fit what the server takes. */
export function photosFit(sizes) {
  return sizes.every((size) => size <= MAX_PHOTO_BYTES) && sizes.reduce((sum, size) => sum + size, 0) <= MAX_TOTAL_PHOTO_BYTES;
}

/** The size a picture is scaled to so its longest edge is `edge` pixels, never enlarged. */
export function fitSize(width, height, edge) {
  const longest = Math.max(width, height);
  if (!(longest > 0) || longest <= edge) return { width, height };
  const scale = edge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The edges a photo is tried at, largest first, until it fits. */
export const SHRINK_STEPS = [2000, 1600, 1280, 1024, 800];

/** What the visitor reads for a server answer: { status, code } from the hosted function. */
export function serverMessage(status, code) {
  if (status === 429 && code === "token") return "That was sent very quickly. Wait a moment and press Send again.";
  if (status === 429 || code === "rate-limited") return "Too many requests were sent just now. Please try again later, or call us.";
  if (status === 413 || code === "too-large") return "Your photos are too large. Send fewer or smaller photos.";
  if ((status === 422 && code === "token") || status === 409) return "Please press Send once more.";
  if (status === 422) return "Some details need fixing. Check the fields marked below.";
  // A time-out or a lost connection says nothing about whether the request was saved: the
  // function may still finish it (ADR 0388). Sending again could make a second copy.
  if (status === 504 || code === "timeout" || code === "unconfirmed" || status === 0) return "We could not confirm that your request arrived. It may have been saved, so please call us before you send it again.";
  if (status >= 500) return "We could not save your request, and nothing was sent. Please try again later, or call us.";
  return "This request could not be accepted.";
}
