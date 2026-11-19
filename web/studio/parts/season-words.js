// Today's sentence and the words around putting a look up, from GET seasons and her calendar.
// DOM-free, tested.
import { say } from "./words.js";

/** Word ids a site may change (docs/studio-words.md): {product} is "your blog" unless it says. */
export const WORDS = {
  "decorations.canvasShowOn": { text: "Show it on", layer: "her" },
  "decorations.canvasComputer": { text: "Computer", layer: "her" },
  "decorations.canvasPhone": { text: "Phone", layer: "her" },
  "decorations.canvasNote": { text: "Your front page with these up. It changes as you take things down or put them back.", layer: "her" },
  "decorations.canvasWait": { text: "Getting it ready…", layer: "her" },
  "decorations.canvasTitle": { text: "Your front page in {look}", layer: "her" },
  "decorations.canvasFailed": { text: "The picture of your front page didn't open", layer: "her" },
  "decorations.canvasFailedHelp": { text: "Your switches still work.", layer: "her" },
  "decorations.canvasRetry": { text: "Try again", layer: "her" },
  "decorations.calendarOff": { text: "{product} wears {theme} every day. The calendar is off.", layer: "her" },
  "decorations.putUpEarly": { text: "{product} is decorated for {theme}, put up early. It stays up through {until}.", layer: "her" },
  "decorations.decorated": { text: "{product} is decorated for {theme}.", layer: "her" },
  "decorations.everyday": { text: "{product} is wearing its everyday look: {theme}.", layer: "her" },
  "decorations.betweenOff": { text: "The look {product} wears while the calendar is off.", layer: "her" },
  "decorations.noSeasons": { text: "Add one, like Christmas from December 1 to January 6, and {product} changes by itself.", layer: "her" },
  "decorations.addedFirst": { text: "Added first on your calendar, from today, so it shows over the season under it. Not saved yet.", layer: "her" },
  "decorations.byItself": { text: "{product} changes by itself on the days below.", layer: "her" },
  "decorations.whenYouSave": { text: "When you save, {product} wears {theme} every day. Your seasons are kept for when you turn this back on.", layer: "her" },
  "decorations.everyDay": { text: "{product} wears {theme} every day.", layer: "her" },
  // Things set down on a picture: a theme component's `places` setting (ADR 0434).
  "places.how": { text: "Choose one below, then tap the picture where it goes. Tap one that's there to pick it up, then drag it or use the buttons.", layer: "her", max: 320 },
  "places.paletteLabel": { text: "What you can add", layer: "her", max: 80 },
  "places.listLabel": { text: "What's on it", layer: "her", max: 80 },
  "places.toolsLabel": { text: "Move the one you picked up", layer: "her", max: 120 },
  "places.said": { text: "{n} on it. Each is listed below.", vars: ["n"], layer: "her", max: 160 },
  "places.none": { text: "Nothing on it yet.", layer: "her", max: 120 },
  "places.item": { text: "{thing}, {where}", vars: ["thing", "where"], layer: "her", max: 200 },
  "places.armed": { text: "{thing}: now tap the picture where it goes, as many times as you like. From the keyboard, press Shift and Enter to add one.", vars: ["thing"], layer: "her", max: 280 },
  "places.added": { text: "{thing} added {where}.", vars: ["thing", "where"], layer: "her", max: 200 },
  "places.picked": { text: "{thing} picked up. Drag it, tap where it goes, or use the buttons.", vars: ["thing"], layer: "her", max: 240 },
  "places.moved": { text: "{thing} is {where} now.", vars: ["thing", "where"], layer: "her", max: 200 },
  "places.removed": { text: "{thing} taken off.", vars: ["thing"], layer: "her", max: 160 },
  "places.full": { text: "That's all {max} it holds. Take one off to add another.", vars: ["max"], layer: "her", max: 200 },
  "places.chooseFirst": { text: "Choose one below first, or tap one that's on the picture.", layer: "her", max: 200 },
  "places.left": { text: "Left", layer: "her", max: 40 },
  "places.right": { text: "Right", layer: "her", max: 40 },
  "places.up": { text: "Up", layer: "her", max: 40 },
  "places.down": { text: "Down", layer: "her", max: 40 },
  "places.remove": { text: "Take it off", layer: "her", max: 60 },
  "places.where.tl": { text: "at the top left", layer: "her", max: 40 },
  "places.where.t": { text: "at the top", layer: "her", max: 40 },
  "places.where.tr": { text: "at the top right", layer: "her", max: 40 },
  "places.where.l": { text: "on the left", layer: "her", max: 40 },
  "places.where.m": { text: "in the middle", layer: "her", max: 40 },
  "places.where.r": { text: "on the right", layer: "her", max: 40 },
  "places.where.bl": { text: "at the bottom left", layer: "her", max: 40 },
  "places.where.b": { text: "at the bottom", layer: "her", max: 40 },
  "places.where.br": { text: "at the bottom right", layer: "her", max: 40 },
};

const DAY = 86400000;

/** "2026-12-01" → "Tuesday, December 1" (the year only when it isn't this year). */
export function sayLongDate(ymd, { now = new Date() } = {}) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  const words = at.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  return y === now.getUTCFullYear() ? words : `${words}, ${y}`;
}

/** The day after "YYYY-MM-DD". */
export function dayAfter(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + DAY).toISOString().slice(0, 10);
}

/**
 * The top sentence. `state` is GET seasons ({ theme, seasons, wearing, next }); `label(name)` gives a
 * look's label; `seasonal(name)` says whether a calendar season uses that look.
 */
export function todaySentence(state, label, { today, now = new Date() } = {}) {
  const wearing = state.wearing;
  const up = state.seasons?.upNow;
  const isUp = up && up.until >= today && up.theme === wearing;
  const off = !state.seasons?.enabled && !isUp;
  const lines = [];
  if (off) {
    lines.push(say("decorations.calendarOff", { theme: label(state.theme) }));
    return lines;
  }
  const inSeason = (state.seasons?.windows || []).some((w) => w.theme === wearing) || isUp;
  if (isUp) lines.push(say("decorations.putUpEarly", { theme: label(wearing), until: sayLongDate(up.until, { now }) }));
  else if (inSeason && wearing !== state.theme) lines.push(say("decorations.decorated", { theme: label(wearing) }));
  else lines.push(say("decorations.everyday", { theme: label(wearing) }));
  if (state.next) lines.push(`On ${sayLongDate(state.next.day, { now })} it changes to ${label(state.next.theme)}.`);
  return lines;
}
