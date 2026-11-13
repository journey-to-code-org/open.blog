// When a post changed somewhere else while she had it open: the question, and the banners that
// keep it in reach. Write keeps the post's state; this only asks and says.
import { h } from "./dom.js";
import { ask } from "./dialogs.js";

const STATE_WORDS = { draft: "a draft", scheduled: "scheduled", published: "published" };

/** "mine", "theirs", or null (she closed it, or went back from "Use your words?"). */
export async function askWhichToKeep({ name, theirState, myState, what = "words", them = "it", were = false }) {
  const text = [`${name} ${were ? "were" : "was"} changed on another device or by someone else while you had ${them} open.`];
  if (theirState !== myState && STATE_WORDS[theirState]) text.push(`The other version is ${STATE_WORDS[theirState]}. Using your ${what} keeps it ${STATE_WORDS[theirState]}.`);
  text.push(`Your ${what} are still here. Which do you want to keep?`);
  const choice = await ask({ heading: "Changed somewhere else", text, choices: [{ label: `Use my ${what}`, value: "mine" }, { label: "Show the other version", value: "theirs", variant: "secondary" }] });
  if (choice !== "mine") return choice;
  const sure = await ask({ heading: `Use your ${what}?`, text: `This replaces the other changes to ${name} with what you have here.`, choices: [{ label: `Yes, use my ${what}`, value: "yes" }, { label: "Go back", value: "no", variant: "secondary" }] });
  return sure === "yes" ? "mine" : null;
}

/** The banner that waits for her to choose (after an autosave, or if she closed the question). */
export function chooseLaterBanner(onChoose) {
  return h("alert-banner", { variant: "warning", heading: "Changed somewhere else" },
    "This post was changed on another device or by someone else. Your words are still here.",
    h("action-button", { variant: "secondary", onClick: onChoose }, "Choose which to keep"));
}

/** The server said "changed", but nothing did: it was busy. */
export function busyBanner() {
  return h("alert-banner", { variant: "warning", heading: "Not saved yet" }, "Your site was busy. Your words are still here; press the button again in a moment.");
}
