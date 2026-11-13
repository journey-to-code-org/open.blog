// Add to Home Screen's rules (Studio R3): which way this phone or computer puts the blog on its
// Home Screen or installs it as an app, the steps for that way only, and the account menu's words.
// Pure: `here` comes from notification-rules.js herePhone(). docs/specs/studio/r3/ux.md.

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
  return onPhone(here) ? "Add your blog to your Home Screen" : "Install your blog as an app";
}

/** The account menu's item, or null when it would do nothing here. */
export function menuLabel(here, hasPrompt = false) {
  if (here.standalone) return null;
  if (onPhone(here)) return "Add to Home Screen";
  const way = installWay(here, hasPrompt);
  return way === "prompt" || way === "mac-safari" ? "Install as an app" : null;
}

const IOS_STEPS = (ipad) => [
  { text: `Tap the Share button ${ipad ? "at the top right" : "at the bottom of the screen"}.`, share: true, more: ipad ? "" : "Don't see it? Tap the three dots first." },
  { text: "Scroll down and tap Add to Home Screen." },
  { text: "You can change the name. Tap Add." },
  { text: "Open your blog from its new icon and sign in again." },
];

/**
 * What the sheet says for a way: { intro, steps: [{ text, share?, more? }], words, copy, ask }.
 * `copy`: show the address with Copy the address; `ask`: show Add it.
 */
export function installSteps(way, here) {
  const phone = onPhone(here);
  const intro = phone ? "Then your blog opens from its own icon, like your other apps." : "Then your blog opens in its own window, like your other apps.";
  const app = here.android ? "Chrome" : "Safari";
  switch (way) {
    case "prompt": return { intro, steps: [], words: "Your browser asks first. Choose Install.", copy: false, ask: true };
    case "ios-safari": return { intro, steps: IOS_STEPS(here.ipad), words: "", copy: false, ask: false };
    case "ios-other": return { intro, steps: IOS_STEPS(here.ipad), words: "Don't see Add to Home Screen? Open your blog in Safari:", copy: true, ask: false };
    case "in-app": return { intro, steps: [], words: `This page is open inside another app. Open your blog in ${app}:`, copy: true, ask: false };
    case "android-menu": return { intro, steps: [{ text: "Open your browser's menu (the three dots)." }, { text: "Tap Add to Home screen, or Install." }, { text: "Open your blog from its new icon." }], words: "", copy: false, ask: false };
    case "desktop-chromium": return { intro, steps: [], words: "Look for the Install button at the right end of the address bar. Or open the browser's menu and choose Install.", copy: false, ask: false };
    case "mac-safari": return { intro, steps: [], words: "In the menu bar, choose File, then Add to Dock.", copy: false, ask: false };
    case "firefox-desktop": return { intro: "", steps: [], words: "Firefox can't add your blog as an app. It works the same in a tab: bookmark it instead.", copy: false, ask: false };
    default: return { intro: "", steps: [], words: "You're already using your blog from its icon.", copy: false, ask: false };
  }
}

/** After the browser's own question. */
export function promptOutcomeWords(outcome, here) {
  if (outcome === "accepted") return onPhone(here) ? "Added. Open your blog from its icon from now on." : "Added. Your blog opens in its own window from now on.";
  return "Not added. You can add it any time from your name's menu.";
}
