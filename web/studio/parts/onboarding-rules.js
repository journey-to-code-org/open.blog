// Getting started's rules (Studio R9b, docs/specs/studio/onboarding/ux.md): which steps show,
// when it opens by itself, how the record moves, what the last screen says, and when the
// reminder in Write may show. Pure: no page, no network, no storage. The server decides whether
// Getting started is due and whether the reminder is; these mirror its rules for the page.
import { say } from "./words.js";
import { wordsText } from "./voice-rules.js";

/** After Finish later, it doesn't open by itself again for this long (the Home card stays). */
export const AUTO_OPEN_GAP_MS = 20 * 60 * 60 * 1000;
/** The reminder comes at most this often, and this many times ever (the server's rule). */
export const NUDGE_GAP_DAYS = 7;
export const NUDGE_MAX = 3;
/** How many stories Getting started asks for. */
export const STORIES_ASKED = 3;
const STEPS = Object.freeze(["helper", "stories", "voice"]);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether the helper has no usable key: the one case the key step is shown (G56). */
export function needsKey(status = {}) {
  const state = status?.credential?.state;
  return state === "not-set" || state === "other-provider";
}

/**
 * Whether the site's helper was never set up at all: no company chosen and no address (what a
 * new site says). Then the company is the default one, and she can paste its key.
 */
export function neverSetUp(settings = null) {
  if (!settings || typeof settings !== "object") return false;
  const provider = String(settings.provider || "");
  return (provider === "" || provider === "custom-https" || provider === "generic-https") && !String(settings.generationEndpoint || "").trim();
}

/**
 * Whether the key can't be typed by her at all: someone chose a custom address (or one that
 * isn't right), which only they can finish. `settings` is `assistant/settings`, when read.
 */
export function keyNeedsHelper(status = {}, settings = null) {
  if (neverSetUp(settings)) return false;
  const provider = String(settings?.provider || status?.providerType || "");
  return provider === "generic-https" || provider === "custom-https" || status?.reason === "bad-endpoint";
}

/**
 * The steps of this run: `{ steps, total, states }`. `steps` are the ones numbered ("Step n of
 * N"), fixed when the run starts (`record.total`): the helper's key only when there is no usable
 * key, the stories always, and the voice guide. `states` says where each stands; the voice step
 * is `not-ready` without a helper that is on or without a story, and is then passed over without
 * renumbering. `voice` is `{ stories }`: how many stories this account has told.
 */
export function startSteps(status = {}, voice = {}, record = null) {
  const withKey = record ? Number(record.total) === 3 : needsKey(status);
  const steps = withKey ? [...STEPS] : ["stories", "voice"];
  const kept = record?.steps || {};
  const settled = (state) => state === "done" || state === "skipped";
  const stories = Number(voice?.stories) || 0;
  const states = {
    helper: !withKey ? "not-needed" : settled(kept.helper) ? kept.helper : !needsKey(status) ? "done" : "pending",
    stories: settled(kept.stories) ? kept.stories : stories > 0 ? "done" : "pending",
    voice: settled(kept.voice) ? kept.voice : status?.configured === true && stories > 0 ? "pending" : "not-ready",
  };
  return { steps, total: steps.length, states };
}

/** `#/start/<step>`; anything that isn't a step is the start itself. */
export function stepRoute(step, query = "") {
  const known = [...STEPS, "done"].includes(step) ? `#/start/${step}` : "#/start";
  return query ? `${known}?${query}` : known;
}

/** The step after `current` among the shown ones, passing over a voice step that isn't ready; `done` after the last. */
export function nextStep(plan, current) {
  const at = plan.steps.indexOf(current);
  for (const step of plan.steps.slice(at + 1)) {
    if (step === "voice" && plan.states.voice === "not-ready") continue;
    return step;
  }
  return "done";
}

/** The shown step before `current`, or null on the first. */
export function previousStep(plan, current) {
  const order = current === "done" ? [...plan.steps, "done"] : plan.steps;
  const at = order.indexOf(current);
  for (const step of order.slice(0, Math.max(0, at)).reverse()) {
    if (step === "voice" && plan.states.voice === "not-ready") continue;
    return step;
  }
  return null;
}

/** "Step n of N": the place of `step` among the shown steps (1-based), 0 when it isn't one. */
export const stepNumber = (plan, step) => plan.steps.indexOf(step) + 1;

/** A step's name in her words. */
export function stepName(step) {
  if (step === "helper") return say("start.stepHelper");
  if (step === "voice") return say("start.stepVoice");
  return say("start.stepStories");
}

/**
 * What a fresh load does about Getting started: `open` it, show the Home `card`, or `none`.
 * `onboarding` is `meta.onboarding`; `fresh` is false for the copy of `meta` kept for no signal
 * (it never opens from that). It opens by itself only when the load came to Home (or with no
 * address): a tapped notification, a shared link or a Write address get the card instead. After
 * Finish later (`record.lastAutoOpen`) it waits 20 hours; a practice run opens every time.
 */
export function startDecision(onboarding, route = {}, now = Date.now(), { fresh = true, record = null } = {}) {
  if (!onboarding || !fresh) return "none";
  const inProgress = onboarding.resume === true && onboarding.mode !== "off";
  if (onboarding.due !== true) return inProgress ? "card" : "none";
  const atHome = (route.name || "home") === "home" && !route.arg;
  if (!atHome) return "card";
  if (onboarding.practice === true) return "open";
  const later = Date.parse(record?.lastAutoOpen || "");
  if (Number.isFinite(later) && now - later < AUTO_OPEN_GAP_MS) return "card";
  return "open";
}

/** Home's card: `{ n, total, step }` for "Step {n} of {total}: {step}.", or null when there is none to show. */
export function homeCard(onboarding) {
  if (!onboarding || onboarding.mode === "off" && onboarding.resume !== true) return null;
  if (onboarding.due !== true && onboarding.resume !== true) return null;
  const total = Number(onboarding.total) === 3 ? 3 : 2;
  const steps = total === 3 ? STEPS : ["stories", "voice"];
  const step = steps.includes(onboarding.step) ? onboarding.step : steps[0];
  return { n: steps.indexOf(step) + 1, total, step, name: stepName(step) };
}

/**
 * The change to send for something she did: the body of `PUT onboarding` (without its etag).
 * `step-done` and `step-skipped` settle a step and move to the next; `skip-rest` ends the run as
 * skipped; `finished` ends it as done. `plan` is `startSteps(...)`.
 */
export function recordAfter(plan, event, step = "") {
  if (event === "skip-rest") return { status: "skipped" };
  if (event === "finished") return { status: "done", step: "done" };
  if ((event === "step-done" || event === "step-skipped") && STEPS.includes(step)) {
    const state = event === "step-done" ? "done" : "skipped";
    const after = { ...plan, states: { ...plan.states, [step]: state } };
    const next = nextStep(after, step);
    // A voice step that was passed over says why on the last screen.
    const passed = step !== "voice" && next === "done" && after.steps.includes("voice") && after.states.voice === "not-ready";
    return { step: next, steps: { [step]: state, ...(passed ? { voice: "not-ready" } : {}) } };
  }
  if (event === "step-not-ready" && step === "voice") return { step: "done", steps: { voice: "not-ready" } };
  return {};
}

/**
 * The stories of this run as rows, in the order told: `[{ id, title, told, words, line }]`.
 * `pieces` is `voice/samples`' list; `ids` the record's stories. A story that was thrown away
 * somewhere else is simply not there.
 */
export function storyRows(pieces = [], ids = []) {
  const byId = new Map((Array.isArray(pieces) ? pieces : []).filter((piece) => piece?.valid && piece.stage === "rough").map((piece) => [piece.id, piece]));
  return ids.filter((id) => byId.has(id)).map((id) => {
    const piece = byId.get(id);
    const title = String(piece.promptTitle || piece.title || "");
    const words = wordsText(Number(piece.words) || 0);
    const told = piece.told === "spoken" ? "spoken" : "typed";
    return { id, title, told, words: Number(piece.words) || 0, line: told === "spoken" ? say("start.storyRowSpoken", { title, words }) : say("start.storyRowTyped", { title, words }) };
  });
}

/** How many of the three are told, never more than three. */
export const storyProgress = (n) => Math.max(0, Math.min(STORIES_ASKED, Math.floor(Number(n) || 0)));

/**
 * The last screen's lines: `[{ ok, words }]`, each a word and a mark (✓ or –), never colour
 * alone. `stories` is how many are kept; `status` is `assistant/status`.
 */
export function doneLines(record = {}, status = {}, stories = 0) {
  const steps = record?.steps || {};
  const on = status?.configured === true;
  const count = Math.max(0, Number(stories) || 0);
  return [
    { ok: on, words: on ? say("start.doneHelperOn") : say("start.doneHelperOff") },
    { ok: count > 0, words: count > 0 ? (count === 1 ? say("start.doneStoriesOne") : say("start.doneStories", { n: count })) : say("start.doneStoriesNone") },
    { ok: steps.voice === "done", words: steps.voice === "done" ? say("start.doneVoice") : say("start.doneVoiceLater") },
  ];
}

/** "Getting started is on, set by the server's environment." for {helper}; plus each problem. */
export function modeLine(accounts = {}) {
  const value = accounts.mode === "on" && accounts.round && accounts.round !== "1" ? `on (round ${accounts.round})` : String(accounts.mode || "off");
  return { words: say("start.detailsMode", { value, source: String(accounts.sourceWords || "") }), problems: (Array.isArray(accounts.problems) ? accounts.problems : []).map(String) };
}

/**
 * Whether the reminder in Write is due (the server decides; this mirrors its rule): the mode
 * isn't off, she left the stories without telling one, has no pieces of her own, hasn't said
 * Don't ask again, has seen it fewer than three times, and not within seven days.
 */
export function nudgeDue(record, ownPieces = 0, now = Date.now(), mode = "on") {
  if (mode === "off" || !record || ownPieces > 0) return false;
  const steps = record.steps || {};
  const skipped = steps.stories === "skipped" || (record.status === "skipped" && steps.stories !== "done");
  const nudge = record.nudge || {};
  const shown = Array.isArray(nudge.shown) ? nudge.shown : [];
  if (!skipped || nudge.stopped === true || shown.length >= NUDGE_MAX) return false;
  if (!shown.length) return true;
  const last = Date.parse(`${shown.at(-1)}T00:00:00Z`);
  const today = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`);
  return !Number.isFinite(last) || Math.floor((today - last) / DAY_MS) >= NUDGE_GAP_DAYS;
}

/** The card may show only as a new post opens, and never once she has typed in this visit. */
export const nudgeAllowed = (typedThisVisit, routeIsNew) => routeIsNew === true && typedThisVisit !== true;

/** Whether a Write address is a new post's (`#/write`, `#/write/new`, `#/write/new/<kind>`). */
export const isNewPostRoute = (route = {}) => route.name === "write" && (route.arg === "" || route.arg === "new" || String(route.arg || "").startsWith("new/"));

/**
 * One failed Getting started call: `{ code, words, quiet, signal }`. `quiet` ones the page
 * handles without words (a newer record somewhere else: it reloads to that step).
 */
export function startProblem(error = {}) {
  const data = error?.data && typeof error.data === "object" ? error.data : {};
  const status = Number(error?.status) || 0;
  const code = typeof data.code === "string" ? data.code : "";
  const out = (c, words, extra = {}) => ({ code: c, words, quiet: false, signal: false, details: typeof data.error === "string" ? data.error : "", ...extra });
  if (status === 0) return out("no-signal", say("start.noSignal"), { signal: true });
  if (code === "stale" || code === "bad-step" || code === "practice-only") return out(code, "", { quiet: true });
  if (code === "unknown-user") return out(code, say("start.resetGone"));
  return out(code || "other", say("start.loadFailed"));
}
