// Notifications' rules (Studio R3; the pure half of the old Admin's notifications.js): what the
// phone in her hand is and can do, which state its card is in, the switches the site offers and the
// kinds kept when she changes them, every sentence the screen says, the denied steps for this phone
// only, and the worker's address rule (a copy of studioAddress in web/studio/sw.js; a test keeps
// them the same). Pure data and functions: no page. docs/specs/studio/r3/ux.md.

/** What each kind of news is called, as a switch and inside a sentence. Studio's words, not the server's labels. */
export const KIND_WORDS = Object.freeze({
  comment: { switch: "Someone leaves a comment", summary: "comments" },
  feedback: { switch: "A reader sends you a note about a post", summary: "notes from readers" },
  quote: { switch: "Someone asks for a quote", summary: "quote requests" },
  app: { switch: "Your other apps have news, like a gift or a game", summary: "news from your other apps" },
});
const ORDER = Object.keys(KIND_WORDS);
const byOrder = (list) => [...new Set(list)].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));

const version = (ua, pattern) => {
  const m = pattern.exec(ua);
  return m ? Number(m[1]) + Number(m[2] || 0) / 100 : null;
};

/**
 * The phone (or computer) in her hand. `{ navigator, window }` are passed in, so this stays pure.
 * `ios` is a number like 16.04 for iOS 16.4 (minor in hundredths), or null.
 */
export function herePhone({ navigator: nav = {}, window: win = {} } = {}) {
  const ua = String(nav?.userAgent || "");
  const desktopIpad = nav?.platform === "MacIntel" && Number(nav?.maxTouchPoints) > 1;
  const apple = /iphone|ipad|ipod/i.test(ua) || desktopIpad;
  const ipad = /ipad/i.test(ua) || desktopIpad;
  const android = /android/i.test(ua);
  const tablet = ipad || (android && !/mobile/i.test(ua));
  const ios = apple ? (version(ua, /OS (\d+)[_.](\d+)/) ?? version(ua, /Version\/(\d+)\.(\d+)/)) : null;
  const standalone = Boolean(win?.matchMedia?.("(display-mode: standalone)")?.matches) || nav?.standalone === true;
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Snapchat|Line\/|MicroMessenger|; wv\)/.test(ua);
  const browser = /EdgiOS|Edg\//.test(ua) ? "edge"
    : /FxiOS|Firefox\//.test(ua) ? "firefox"
      : /SamsungBrowser/.test(ua) ? "samsung"
        : /CriOS|Chrome\/|Chromium\//.test(ua) ? "chrome"
          : /Safari\//.test(ua) || apple ? "safari" : "other";
  const capable = Boolean(nav?.serviceWorker) && Boolean(win && "PushManager" in win) && Boolean(win && "Notification" in win);
  return {
    apple, ipad, android, tablet, ios, standalone, inApp, browser,
    desktop: !apple && !android && !/mobile/i.test(ua),
    mac: /Macintosh/.test(ua) && !apple,
    windows: /Windows/.test(ua),
    secure: win?.isSecureContext !== false,
    capable,
    permission: capable ? String(win.Notification.permission || "default") : "unsupported",
    userAgent: ua,
  };
}

const IOS_PUSH = 16.04;

/**
 * Which state the "This iPhone" card is in: off, on, denied, home-screen-first, update-first,
 * in-app, not-secure or unsupported. `mine` is this phone's entry on the server; `hasSubscription`
 * whether this browser holds a sign-up.
 */
export function hereState(here, mine = null, hasSubscription = false) {
  if (!here.secure) return "not-secure";
  if (here.inApp) return "in-app";
  if (here.apple && here.ios !== null && here.ios < IOS_PUSH) return "update-first";
  if (here.apple && !here.standalone) return "home-screen-first";
  if (!here.capable) return "unsupported";
  if (here.permission === "denied") return "denied";
  if (mine && hasSubscription && here.permission === "granted") return "on";
  return "off";
}

/** "iPhone", "iPad", "phone", "tablet" or "computer": what she'd call it. */
export function deviceNoun(here) {
  if (here.ipad) return "iPad";
  if (here.apple) return "iPhone";
  if (here.tablet) return "tablet";
  if (here.android) return "phone";
  return "computer";
}

/** A name for this device to start from, which the owner can change. */
export function guessLabel(userAgent = "") {
  if (/iphone/i.test(userAgent)) return "iPhone";
  if (/ipad/i.test(userAgent)) return "iPad";
  if (/android/i.test(userAgent)) return /mobile/i.test(userAgent) ? "Android phone" : "Android tablet";
  if (/macintosh/i.test(userAgent)) return "Mac";
  if (/windows/i.test(userAgent)) return "Windows computer";
  if (/cros/i.test(userAgent)) return "Chromebook";
  return "This browser";
}

/** "iPhone" again on a list that has one is "iPhone 2" (then 3...), so she can tell them apart. */
export function uniqueLabel(label, devices = []) {
  const taken = new Set(devices.map((d) => String(d.label || "").toLowerCase()));
  const base = String(label || "").trim().slice(0, 57) || "Phone";
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** The hash the server lists a device under: SHA-256 of the endpoint, first 32 hex digits. */
export async function endpointHash(endpoint, subtle = globalThis.crypto.subtle) {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** A base64url key as bytes. */
export function keyBytes(base64url) {
  const text = String(base64url || "");
  const plain = atob(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "="));
  return Uint8Array.from(plain, (c) => c.charCodeAt(0));
}

/** Whether a sign-up was made with this site's key; one made with an old key must be made again. Unknown counts as the same. */
export function sameKey(subscription, publicKey) {
  const held = subscription?.options?.applicationServerKey;
  if (!held || !publicKey) return true;
  const a = new Uint8Array(held);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** The kinds this site offers as switches, in order. */
export function offeredKinds(meta = {}, status = {}) {
  const server = Array.isArray(status.kinds) ? new Set(status.kinds.map((k) => k.id)) : null;
  const engagement = meta.engagement === true || meta.engagementSetUp === true;
  return ORDER.filter((id) => (!server || server.has(id)) && (
    id === "comment" || id === "feedback" ? engagement : id === "quote" ? meta.quote === true : status.otherApps === true));
}

/** What to save when the switches change: what she picked among the offered, and every kind held that isn't shown. */
export function keptKinds(picked = [], offered = [], held = []) {
  return byOrder([...held.filter((k) => !offered.includes(k)), ...picked.filter((k) => offered.includes(k))]);
}

const listWords = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

/** "Tells you about comments and news from your other apps." */
export function kindsSummary(kinds = [], subject = "it") {
  const words = byOrder(kinds).filter((k) => KIND_WORDS[k]).map((k) => KIND_WORDS[k].summary);
  if (!words.length) return `Nothing is on, so ${subject} stays quiet.`;
  return `Tells you about ${listWords(words)}.`;
}

/** After a switch: "Saved. This iPhone will tell you about comments." */
export function savedKindsWords(kinds = [], name = "This iPhone") {
  const words = byOrder(kinds).filter((k) => KIND_WORDS[k]).map((k) => KIND_WORDS[k].summary);
  const here = /^This /.test(name);
  if (!words.length) return `Saved. Nothing is on, so ${here ? name.replace(/^This/, "this") : name} stays quiet.${here ? " To stop them for good, turn notifications off." : ""}`;
  return `Saved. ${name} will tell you about ${listWords(words)}.`;
}

/** "Last told you 3 hours ago." / "Hasn't told you anything yet." */
export function lastToldWords(iso, now = Date.now()) {
  const at = Date.parse(iso || "");
  if (!iso || Number.isNaN(at)) return "Hasn't told you anything yet.";
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes < 2) return "Last told you just now.";
  if (minutes < 60) return `Last told you ${minutes} minutes ago.`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "Last told you an hour ago.";
  if (hours < 24) return `Last told you ${hours} hours ago.`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Last told you yesterday.";
  if (days < 60) return `Last told you ${days} days ago.`;
  return `Last told you ${Math.round(days / 30)} months ago.`;
}

/** The words on the card for a state other than on and off: [sentence] (denied adds its steps). */
export function stateWords(state, here) {
  const noun = deviceNoun(here);
  const app = here.android ? "Chrome" : "Safari";
  switch (state) {
    case "denied": return `You said no when your ${noun} asked, so it can't show notifications from your blog. To change that:`;
    case "home-screen-first": return `On an ${noun}, your blog can only send notifications once it's on your Home Screen. It takes four taps.`;
    case "update-first": return `This ${noun} needs a newer iOS before your blog can send it notifications. In the Settings app: General, then Software Update.`;
    case "in-app": return `This page is open inside another app, which can't show notifications. Open your blog in ${app}:`;
    case "not-secure": return "Notifications only work at your blog's secure address. Tell the person who set up your site.";
    case "unsupported": return "This browser can't show notifications from your blog. On a computer, try Chrome, Edge, Firefox or Safari. On a phone, use Safari on an iPhone or Chrome on Android.";
    default: return "";
  }
}

/** The badge on the card: [words, variant], or null. */
export function stateBadge(state) {
  if (state === "on") return ["On", "success"];
  if (state === "off" || state === "asking") return ["Off", "neutral"];
  if (state === "denied") return ["Not allowed", "warning"];
  return null;
}

/** How to allow notifications again, for this phone only. */
export function deniedSteps(here) {
  if (here.apple) {
    return ["Open the Settings app.", "Tap Notifications.", "Find your blog in the list (it has the name under its icon) and tap it.", "Turn on Allow Notifications."];
  }
  if (here.android && here.standalone) return ["Touch and hold your blog's icon.", "Tap App info (or the small \"i\").", "Tap Notifications and turn them on."];
  if (here.android) return ["Tap the small icon at the left end of the address bar.", "Tap Permissions.", "Turn on Notifications."];
  if (here.browser === "firefox") return ["Click the icon at the left end of the address bar.", "Click the × beside \"Blocked: Send notifications\".", "Reload the page."];
  if (here.browser === "safari" && here.mac) return ["In the Safari menu, choose Settings.", "Click Websites, then Notifications.", "Find your blog and choose Allow."];
  if (here.browser === "chrome" || here.browser === "edge") return ["Click the small icon at the left end of the address bar.", "Turn on Notifications (in Edge: Permissions for this site, then Notifications, Allow)."];
  return ["Look in this browser's settings for this site's notifications and choose Allow."];
}

/** "Didn't see the test?": only this phone's lines. */
export function didntSeeIt(here) {
  const lines = ["Wait a minute. A phone saving battery can be slow.", "Check that Do Not Disturb or Focus is off."];
  if (here.apple) lines.push("In the Settings app: Notifications, then your blog. Allow Notifications should be on, with Lock Screen and Banners ticked.");
  else if (here.android) lines.push("In Settings: Apps, then your blog (or Chrome), then Notifications.");
  else if (here.mac) lines.push("In System Settings: Notifications, then your browser. Allow notifications should be on.");
  else if (here.windows) lines.push("In Settings: System, Notifications, then your browser.");
  lines.push("Still nothing? Turn notifications off here, then on again.");
  return lines;
}

/** The screen's lede: comments, quote requests, or both. */
export function ledeWords(offered = []) {
  const comments = offered.includes("comment");
  const quotes = offered.includes("quote");
  const what = comments ? "someone comments" : quotes ? "someone asks for a quote" : "something comes in";
  return `Your phone can tell you when ${what}, even when your blog is closed.`;
}

/**
 * What went wrong, in her words, by the server's code (G26). `during`: "on", "test", "save",
 * "rename", "remove", "other-test" or "load"; `name` the other device's name; `limit` the number.
 */
export function pushTrouble(error = {}, { noun = "iPhone", name = "", limit = 20, during = "" } = {}) {
  const code = error?.data?.code || error?.code || "";
  const status = Number(error?.status ?? 0);
  if (code === "label-required") return "Give it a name, like Kitchen iPad.";
  if (code === "too-many" || status === 409) return `Your blog can tell up to ${limit} phones and computers. Remove one you don't use any more, below.`;
  if (code === "invalid-subscription") return "This browser's notifications can't be used by your blog. Try Safari, Chrome, Edge or Firefox.";
  if (["hosted-key-rejected", "not-enabled", "not-set-up"].includes(code)) return "Notifications aren't working right now. Tell the person who set up your site.";
  if (during === "other-test" && (code === "gone" || status === 410)) return `${name} stopped taking notifications, so your blog forgot it.`;
  if (code === "gone" || status === 410) return `This ${noun} stopped taking notifications, so your blog forgot it. Turn them on again.`;
  if (during === "test" && status === 404) return `This ${noun} was taken off your list on another phone or computer. Turn them on again.`;
  if (status === 404 && (during === "other-test" || during === "save" || during === "rename" || during === "remove")) return `${name || `This ${noun}`} isn't on your list any more.`;
  if (code === "send-failed" && during === "test") return `The test didn't reach this ${noun}. Try again in a minute. If it still doesn't come, turn notifications off, then on again.`;
  if (code === "send-failed") return `The test didn't reach ${name || `this ${noun}`}. Try again in a minute.`;
  if (status === 0) return "Can't reach your blog right now. Check your connection, then try again.";
  if (["hosted-unavailable", "hosted-timeout", "storage-unavailable", "bad-reply"].includes(code) || status === 502 || status === 504 || status === 503) {
    return "Your blog couldn't reach its notification service. Try again in a minute.";
  }
  if (during === "load") return "Your blog couldn't load your notifications. Try again in a minute.";
  return "That didn't work. Try again in a minute.";
}

/** Where turning on stopped before the server (the phone's own steps), in her words. */
export function stopWords(reason, noun = "iPhone") {
  if (reason === "dismissed") return "You didn't choose Allow, so it's still off. Tap Turn on notifications and choose Allow.";
  if (reason === "denied") return "You said no, so it's off.";
  if (reason === "worker") return `Your blog couldn't get this ${noun} ready. Reload the page, then try again.`;
  if (reason === "refused") return `This ${noun}'s notification service didn't answer. Try again in a minute.`;
  return "That didn't work. Try again in a minute.";
}

/**
 * Where tapping a notice goes: the old Admin's addresses (`/admin/`, `/admin/#/quotes`) become
 * Studio's with the same `#…`; a Studio address is kept; an https page from the owner's other app is
 * kept; anything else (another path, http:, javascript:, data:) opens Studio's Home.
 */
export function studioAddress(url, origin) {
  const home = `${origin}/admin/studio/`;
  let parsed;
  try {
    parsed = new URL(String(url || ""), home);
  } catch {
    return home;
  }
  if (parsed.origin === origin) {
    if (parsed.pathname === "/admin/" || parsed.pathname === "/admin") return `${home}${parsed.hash}`;
    if (parsed.pathname.startsWith("/admin/studio/")) return parsed.href;
    return home;
  }
  if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return parsed.href;
  return home;
}
