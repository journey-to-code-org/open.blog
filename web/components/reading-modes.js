// The pure rules of reading modes (ADR 0170, 0171, 0172), shared by
// <ob-reading-modes> and its tests. Nothing here touches the page.
//
// A reading mode only decides which author-written supplements are shown. The
// three names, the order and the rule below are the same contract the build
// uses (`openblog_core::reading_depth`); tests/fixtures/reading-modes.json
// holds it once, and both the Rust and the Node tests read that file.

export const MODES = ["standard", "guided", "deep-dive"];
export const LABELS = { standard: "Standard", guided: "Guided", "deep-dive": "Deep dive" };
/** The one key the choice is kept under. localStorage is per site (origin). */
export const STORAGE_KEY = "ob-reading-mode";

export const isMode = (value) => typeof value === "string" && MODES.includes(value);

/**
 * Whether `mode` shows a supplement of `level`: standard shows none, guided
 * shows the guided ones, deep-dive shows both. A supplement that holds a
 * warning or caution callout (`always`) is shown in every mode, so safety
 * text is never hidden.
 */
export function shows(mode, level, always = false) {
  if (always) return true;
  if (mode === "guided") return level === "guided";
  if (mode === "deep-dive") return level === "guided" || level === "deep-dive";
  return false;
}

/** The mode to open in: the reader's saved choice, else the author's default, else standard. */
export function resolveMode(preference, authorDefault) {
  if (isMode(preference)) return preference;
  if (isMode(authorDefault)) return authorDefault;
  return "standard";
}

/** The browser's local storage, or null where it is blocked or missing. */
export function localStore() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The saved mode, or null when there is none, it is not a mode, or storage fails. */
export function readPreference(storage = localStore()) {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return isMode(value) ? value : null;
  } catch {
    return null;
  }
}

/** Saves the choice on this device only. False when it could not be saved. */
export function writePreference(storage, mode) {
  if (!isMode(mode)) return false;
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

/** Forgets the saved choice. False when storage failed. */
export function clearPreference(storage) {
  try {
    if (!storage) return false;
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** How many supplements each mode shows, from `[{ level, always }]`. */
export function countsByMode(items) {
  return Object.fromEntries(
    MODES.map((mode) => [mode, items.filter((item) => shows(mode, item.level, item.always)).length]),
  );
}

/** The one line that says what a mode does, with how many supplements it shows. */
export function describe(mode, shown, total) {
  if (mode === "standard") {
    return shown === 0
      ? "The article alone."
      : `The article, with ${plural(shown, "supplement")} that hold${shown === 1 ? "s" : ""} a warning.`;
  }
  const what = mode === "guided" ? "short explanations" : "everything the author added";
  return `Adds ${what}: ${shown} of ${plural(total, "supplement")} shown.`;
}

/** What is announced to a screen reader after a mode change. */
export function announcement(mode, shown, total) {
  return shown === 0
    ? `${LABELS[mode]} reading. No supplements shown.`
    : `${LABELS[mode]} reading. Showing ${shown} of ${plural(total, "supplement")}.`;
}
