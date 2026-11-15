// Notifications, in words any blog can use (docs/studio-words.md). Pure data, read with `say()`
// from words.js.

/** @type {Record<string, { text: string, layer: "her" | "details", max?: number, bare?: string }>} */
export const WORDS = {
  // The push function knows no app names (one notify key for all of them), so they're named by what they are.
  "notify.appSwitch": { text: "News from your other apps", layer: "her" },
  "notify.nameHelp": { text: "So you can tell them apart, like Work phone.", layer: "her" },
  "notify.nameMissing": { text: "Give it a name, like Work phone.", layer: "her" },
  "notify.canTurnOn": { text: "{helper} can turn them on. {product} works the same without them.", layer: "her" },
  "notify.commentsLink": { text: "someone comments", layer: "her" },
  "notify.readersLink": { text: "a reader sends you something", layer: "her" },
  // W-b: sentences that name {product}.
  "notify.removedOff": { text: "This {noun} was removed from the phones {product} tells, so it's off.", layer: "her" },
  "notify.saidNo": { text: "You said no when your {noun} asked, so it can't show notifications from {product}. To change that:", layer: "her" },
  "notify.homeScreenFirst": { text: "On an {noun}, {product} can only send notifications once it's on your Home Screen. It takes four taps.", layer: "her" },
  "notify.updateFirst": { text: "This {noun} needs a newer iOS before {product} can send it notifications. In the Settings app: General, then Software Update.", layer: "her" },
  "notify.inApp": { text: "This page is open inside another app, which can't show notifications. Open {product} in {app}:", layer: "her" },
  "notify.notSecure": { text: "Notifications only work at {product}'s secure address.", layer: "her" },
  "notify.findInList": { text: "Find {product} in the list (it has the name under its icon) and tap it.", layer: "her" },
  "notify.holdIcon": { text: "Touch and hold {product}'s icon.", layer: "her" },
  "notify.findAllow": { text: "Find {product} and choose Allow.", layer: "her" },
  "notify.didntSeeApple": { text: "In the Settings app: Notifications, then {product}. Allow Notifications should be on, with Lock Screen and Banners turned on.", layer: "her" },
  "notify.didntSeeAndroid": { text: "In Settings: Apps, then {product} (or Chrome), then Notifications.", layer: "her" },
  "notify.lede": { text: "Your phone can tell you when {what}, even when {product} is closed.", layer: "her" },
  "notify.tooMany": { text: "{product} can tell up to {limit} phones and computers. Remove one you don't use any more, below.", layer: "her" },
  "notify.otherGone": { text: "{name} stopped taking notifications, so {product} forgot it.", layer: "her" },
  "notify.gone": { text: "This {noun} stopped taking notifications, so {product} forgot it. Turn them on again.", layer: "her" },
  "notify.removedElsewhere": { text: "This {noun} was removed from the phones {product} tells, on another phone or computer. Turn them on again.", layer: "her" },
  "notify.cantReach": { text: "Can't reach {product} right now. Check your connection, then try again.", layer: "her" },
  "notify.serviceDown": { text: "{product} couldn't reach its notification service. Try again in a minute.", layer: "her" },
  "notify.cantLoad": { text: "{product} couldn't load your notifications. Try again in a minute.", layer: "her" },
  "notify.notReady": { text: "{product} couldn't get this {noun} ready. Reload the page, then try again.", layer: "her" },
  "notify.notSetUp": { text: "Notifications aren't set up for {product}", layer: "her" },
  "notify.nothingOn": { text: "They tell you about comments and quote requests, and neither is turned on for {product}.", layer: "her" },
  "notify.removeAsk": { text: "It won't get notifications from {product} any more. To get them there again, open {product} on it and turn them on.", layer: "her" },
};
