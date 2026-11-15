// Add to Home Screen's rules (Studio R3): which way this phone or computer puts the blog on its
// Home Screen or installs it as an app, the steps for that way only, and the account menu's words.
// Pure: `here` comes from notification-rules.js herePhone(). docs/specs/studio/r3/ux.md.
import { BAR } from "./notification-rules.js";
import { say } from "./words.js";

/**
 * prompt (the browser can ask), ios-safari, ios-other (Chrome or Firefox on an iPhone), in-app,
 * android-menu, desktop-chromium, mac-safari, firefox-desktop, or installed (opened from the icon).
 */
export function installWay(here, hasPrompt = false) {
  if (here.standalone) return "installed";
  if (here.inApp) return "in-app";
  if (hasPrompt) return "prompt";
  if (here.apple) return here.browser === "safari" ? "ios-safari" : "ios-other";
  if (here.android) return "android-menu";
  if (here.browser === "firefox") return "firefox-desktop";
  if (here.browser === "safari") return "mac-safari";
  return "desktop-chromium";
}

/** A phone or tablet adds to the Home Screen; a computer installs an app. */
export const onPhone = (here) => Boolean(here.apple || here.android);

/** The sheet's heading. */
export function sheetLabel(here) {
  return onPhone(here) ? say("install.addHomeScreen") : say("install.asApp");
}

/** The account menu's item, or null when it would do nothing here. */
export function menuLabel(here, hasPrompt = false) {
  if (here.standalone) return null;
  if (onPhone(here)) return "Add to Home Screen";
  const way = installWay(here, hasPrompt);
  return way === "prompt" || way === "mac-safari" ? "Install as an app" : null;
}

// An iPhone's Home Screen app keeps its own sign-in, so she signs in once more from the new icon.
const signInFirst = () => say("install.signInFirst");

const IOS_STEPS = (ipad) => [
  { text: `Tap the Share button ${ipad ? "at the top right" : "at the bottom of the screen"}.`, share: true, more: ipad ? "" : "Don't see it? Tap the three dots (•••) at the bottom right first." },
  { text: "Scroll down and tap Add to Home Screen." },
  { text: "You can change the name. Tap Add." },
  { text: say("install.openSignIn") },
];

/**
 * What the sheet says for a way: { intro, before, steps: [{ text, share?, more? }], words, copy, ask }.
 * `before`: a warning shown before step 1; `copy`: show the address with Copy the address; `ask`: show Add it.
 */
export function installSteps(way, here) {
  const phone = onPhone(here);
  const intro = phone ? say("install.ownIcon") : say("install.ownWindow");
  const app = here.android ? "Chrome" : "Safari";
  switch (way) {
    case "prompt": return { intro, before: "", steps: [], words: "Your browser asks first. Choose Install.", copy: false, ask: true };
    case "ios-safari": return { intro, before: signInFirst(), steps: IOS_STEPS(here.ipad), words: "", copy: false, ask: false };
    case "ios-other": return { intro, before: signInFirst(), steps: IOS_STEPS(here.ipad), words: say("install.openInSafari"), copy: true, ask: false };
    case "in-app": return { intro, before: "", steps: [], words: say("install.inApp", { app }), copy: true, ask: false };
    case "android-menu": return { intro, before: "", steps: [{ text: "Open the menu: the three dots at the top right." }, { text: "Tap Add to Home screen, or Install." }, { text: say("install.openIcon") }], words: "", copy: false, ask: false };
    case "desktop-chromium": return { intro, before: "", steps: [], words: `Look for the Install button at the right end of ${BAR}. Or open the menu (the three dots at the top right) and choose Install.`, copy: false, ask: false };
    case "mac-safari": return { intro, before: "", steps: [], words: "In the menu bar, choose File, then Add to Dock.", copy: false, ask: false };
    case "firefox-desktop": return { intro: "", before: "", steps: [], words: say("install.firefox"), copy: false, ask: false };
    default: return { intro: "", before: "", steps: [], words: say("install.already"), copy: false, ask: false };
  }
}

/** After the browser's own question. */
export function promptOutcomeWords(outcome, here) {
  if (outcome === "accepted") return onPhone(here) ? say("install.addedPhone") : say("install.addedWindow");
  return "Not added. You can add it any time from your name's menu.";
}

/**
 * After Copy the address (`copied`), or when copying was refused and the address is selected: how
 * to paste it, in the app she'll open (Chrome on Android, Safari otherwise).
 */
export function copiedWords(here, copied) {
  const app = here.android ? "Chrome" : "Safari";
  return copied
    ? `Copied. Touch and hold in the bar at the top of ${app}, then tap Paste.`
    : `Select the address and copy it. Then touch and hold in the bar at the top of ${app}, and tap Paste.`;
}
