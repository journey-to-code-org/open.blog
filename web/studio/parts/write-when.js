// When it appears, on Write: a future day with an empty time gets 8:00 AM her time (shown, so she
// can change it), the help says when the post really goes up (by itself, or the next time the site
// is sent out: G37), a time without a day is an error on its field, and moving a published post to
// a later day asks before it comes off the site. Studio R5.
import { ask } from "./dialogs.js";
import { defaultTime, joinInstant } from "./dates.js";
import { whenHelp, whenProblem } from "./post-fields.js";

/**
 * `state()` is the post's state; `schedule()` "self" | "next-send" | null. Listens on the fields
 * before Write does, so the time is filled in before the change is read.
 */
export function createWhen({ day, time, help, state, schedule, now = () => new Date() }) {
  let defaulted = false;
  let filling = false;

  day.addEventListener("valuechange", () => {
    const picked = String(day.value || "");
    const filled = defaultTime(picked, String(time.value || ""), now());
    if (filled && !String(time.value || "")) {
      filling = true;
      time.value = filled;
      filling = false;
      defaulted = true;
    } else if (!picked && defaulted) {
      time.value = "";
      defaulted = false;
    }
  });
  time.addEventListener("valuechange", () => { if (!filling) defaulted = false; });

  const value = () => {
    try { return joinInstant({ date: day.value || "", time: time.value || "" }) || ""; } catch { return String(day.value || ""); }
  };

  return {
    /** The help under the fields, and the error when a time has no day. */
    paint() {
      const problem = whenProblem(day.value, time.value);
      time.error = problem;
      const said = whenHelp({ state: state(), date: value(), schedule: schedule(), defaulted, problem: "" }, now());
      help.textContent = said.words;
      return said;
    },
    /** The problem that stops a save, or "". */
    problem: () => whenProblem(day.value, time.value),
    /** Moving a published post to a later day: asks first. Resolves true to go ahead. */
    async confirmMove() {
      const said = whenHelp({ state: state(), date: value(), schedule: schedule() }, now());
      if (!said.ask) return true;
      const choice = await ask({ heading: said.ask.heading, text: said.words, choices: [{ label: said.ask.yes, value: "yes" }, { label: said.ask.no, value: "no", variant: "secondary" }] });
      return choice === "yes";
    },
    /** A post opened from the server: its time is its own, never a default. */
    reset() { defaulted = false; },
    focusTime: () => time.querySelector("input")?.focus(),
  };
}
