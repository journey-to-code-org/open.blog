// The writing helper's rules (Studio R8, docs/specs/studio/r8/ux.md): its state in her words, what
// goes to the company before anything is sent, which part of her post is read, what it looks for,
// and how one suggestion is put into one box of her words and taken out again. The review rules
// are lifted from web/admin/admin.js (ADRs 0286 and 0290) with their behaviour and tests. Pure:
// no page, no network.
//
// What a helper returns is untrusted text. Nothing here acts on it: `applyFinding` can only swap
// the exact quoted words inside one box, outside any card, and proves the rest of the post is
// byte for byte as it was.
import { say } from "./words.js";
import { splitBlocks } from "./word-blocks.js";

// ---- the company

const COMPANIES = {
  anthropic: "Anthropic", "open-ai": "OpenAI", openai: "OpenAI", google: "Google", gemini: "Google", xai: "xAI", "x.ai": "xAI",
  "deep-seek": "DeepSeek", deepseek: "DeepSeek", mistral: "Mistral", "open-router": "OpenRouter", openrouter: "OpenRouter",
};
/** A name as the server gives it, kept only when it is plain words (never markup or an address with a path). */
const plainName = (value) => (typeof value === "string" && /^[\p{L}\p{N}][\p{L}\p{N} .\-]{0,62}$/u.test(value.trim()) ? value.trim() : "");

/**
 * The company a helper sends to, by name: "Anthropic", never an address, a path or a model. Takes
 * `assistant/status` (`company`, `providerType`, `destination`) or R4's `{ provider, destination }`.
 * A custom address is named by its host.
 */
export function companyName(status = {}) {
  const given = plainName(status?.company);
  if (given) return given;
  const provider = String(status?.provider || status?.providerType || "").toLowerCase();
  if (COMPANIES[provider]) return COMPANIES[provider];
  const text = String(status?.destination || "").trim();
  try {
    const host = new URL(text).hostname.replace(/^(api|www)\./, "");
    const known = Object.entries(COMPANIES).find(([key]) => host.split(".").includes(key.replace("-", "")));
    return known ? known[1] : host || "another company";
  } catch {
    return plainName(text) || "another company";
  }
}

// ---- its state

/**
 * Where the helper stands: `checking` (status on its way), `no-signal`, `ready`, or `off` with the
 * server's `reason` (G56: no-key, no-model, no-endpoint, bad-endpoint, key-other-provider).
 */
export function helperState(status, { online = true, loading = false } = {}) {
  if (!online) return { state: "no-signal", reason: "" };
  if (loading || !status) return { state: "checking", reason: "" };
  if (status.configured === true) return { state: "ready", reason: "ready" };
  const reason = typeof status.reason === "string" && status.reason !== "ready" ? status.reason : status.state === "invalid" ? "bad-endpoint" : "";
  return { state: "off", reason };
}

/** The status line of each state, in her words. */
export function stateWords(state) {
  switch (state?.state) {
    case "ready": return say("helper.ready");
    case "no-signal": return say("helper.noSignal");
    case "off": return say("helper.offHeading");
    default: return say("helper.checking");
  }
}

/** Why it is off, for {helper} (never her layer). */
export function reasonWords(reason) {
  switch (reason) {
    case "no-key": return say("helper.reasonNoKey");
    case "no-model": return say("helper.reasonNoModel");
    case "no-endpoint": return say("helper.reasonNoAddress");
    case "bad-endpoint": return say("helper.reasonBadAddress");
    case "key-other-provider": return say("helper.reasonOtherKey");
    default: return say("helper.reasonUnknown");
  }
}

/**
 * The side card's line: `{ kind: "idle" | "reading" | "left" | "finished" | "no-signal", count }`.
 * "finished" is a read that ended while the sheet was closed.
 */
export function helperLine(state = {}) {
  const count = Math.max(0, Number(state.count) || 0);
  switch (state.kind) {
    case "reading": return say("helper.lineReading");
    case "no-signal": return say("helper.lineNoSignal");
    case "finished": return count === 1 ? say("helper.lineFinishedOne") : say("helper.lineFinished", { count });
    case "left": return count === 0 ? say("helper.lineNoneLeft") : count === 1 ? say("helper.lineLeftOne") : say("helper.lineLeft", { count });
    default: return say("helper.lineIdle");
  }
}

// ---- when a call fails

/** Today's sentences, for a server that doesn't send codes yet (before G54/G55). */
function codeFromWords(error) {
  const text = String(error?.data?.error || error?.message || "");
  if (/returned HTTP 40[13]\b/.test(text)) return "key-rejected";
  if (/returned HTTP 429\b/.test(text)) return "provider-busy";
  if (/returned HTTP 5\d\d\b/.test(text)) return "provider-down";
  if (/longer than|too large/i.test(text)) return "too-long";
  if (/Two Assistant operations/.test(text)) return "concurrency-limit";
  if (/timed out/i.test(text)) return "timeout";
  return "";
}

/**
 * One failed helper call, for every helper call in Studio: `{ code, words, details: [..], off,
 * setup, quiet, signal }`. `words` is her sentence (her post is always unchanged); `details` are
 * for {helper}; `off` means the helper is no longer set up (the sheet redraws); `setup` offers Go
 * to setup; `quiet` failures are ones a later try may clear by itself (suggestions as you type
 * stay silent about them); `signal` is no signal. `task` is "review" for Read it over.
 * The server's own sentence goes to details only: it is never shown on her layer.
 */
export function helperProblem(error = {}, { company = "", task = "" } = {}) {
  const data = error?.data && typeof error.data === "object" ? error.data : {};
  const status = Number(error?.status) || 0;
  // With no company to name (her blog did the work itself), the helper is what didn't answer.
  const where = company || "your helper";
  const server = typeof data.error === "string" ? data.error : "";
  const out = (code, words, details = [], extra = {}) => ({ code, words, details: details.filter(Boolean), off: false, setup: false, quiet: false, signal: false, ...extra });
  if (status === 0 && !data.code) return out("no-signal", say("helper.noSignal"), [], { signal: true, quiet: true });
  if (status === 401) return out("signed-out", say("helper.signIn"));
  const code = typeof data.code === "string" && data.code ? data.code : codeFromWords(error) || (status === 429 ? "concurrency-limit" : status === 504 ? "timeout" : status === 413 ? "too-long" : "");
  switch (code) {
    case "concurrency-limit": return out(code, say("helper.busy"), [say("helper.busyDetail")], { quiet: true });
    case "provider-busy": {
      const seconds = Number.isFinite(data.retryAfter) ? Math.max(0, Math.round(data.retryAfter)) : null;
      return out(code, say("helper.companyBusy", { company: where }), [seconds === null ? say("helper.companyBusyPlain") : say("helper.companyBusyDetail", { seconds })], { quiet: true });
    }
    case "provider-down":
    case "provider-error": return out(code, say("helper.companyDown", { company: where }), [server]);
    case "timeout": return out(code, say("helper.tookTooLong", { company: where }), [say("helper.tookTooLongDetail"), server], { quiet: true });
    case "invalid-result": return out(code, say("helper.nonsense"), [server]);
    case "refused": return out(code, say("helper.refused", { company: where }), [server]);
    case "cut-short": return out(code, say("helper.cutShort"), [server]);
    case "key-rejected": return out(code, say("helper.keyRejected", { company: where }), [say("helper.keyRejectedDetail")], { setup: true });
    case "missing-credential":
    case "not-configured":
    case "invalid-configuration": return out(code, say("helper.turnedOff"), [server], { off: true, setup: true });
    case "too-long":
    case "notes-too-long": {
      const detail = data.field && data.max ? say("helper.tooLongDetail", { field: String(data.field), max: Number(data.max).toLocaleString("en-US"), unit: String(data.unit || "") }) : server;
      return out("too-long", task === "review" ? say("helper.tooLongReview") : say("helper.tooLong"), [detail]);
    }
    case "over-budget": {
      const budget = data.budget && typeof data.budget === "object" ? data.budget : {};
      const number = (value) => (Number.isFinite(value) ? Number(value).toLocaleString("en-US") : "?");
      return out(code, say("helper.overBudget"), [say("helper.overBudgetDetail", { samples: number(data.samples), letters: number(data.characters), maxSamples: number(budget.samples), maxLetters: number(budget.characters) })]);
    }
    case "skill-scope":
    case "context-unavailable": return out(code, say("helper.changedUnder"), [say("helper.changedUnderDetail", { id: clip(String(data.skillId || data.id || ""), 120).text }), server]);
    default: return out(code || "other", say("helper.didntWork"), [server]);
  }
}

// ---- words she cares about

/** How many words, as she'd say it: exact under 100, else to the nearest ten ("1,240"). */
export function wordsAbout(n) {
  const count = Math.max(0, Math.round(Number(n) || 0));
  return (count < 100 ? count : Math.round(count / 10) * 10).toLocaleString("en-US");
}

/** The words in a text. */
export const countWords = (text) => String(text ?? "").trim().split(/\s+/).filter(Boolean).length;

/** Text cut at `max` letters (whole characters): `{ text, clipped }`. */
export function clip(text, max = 600) {
  const letters = Array.from(String(text ?? ""));
  return letters.length <= max ? { text: letters.join(""), clipped: false } : { text: `${letters.slice(0, max).join("")}…`, clipped: true };
}

// ---- what is sent of the post

/** Never sent, whatever is chosen (R7: where someone was stays private). */
export const NEVER_SENT = Object.freeze(["trackToken", "captureId", "route", "routeShape", "elevationProfile", "credits", "creditEtag"]);

/**
 * The post's details as the helper gets them: her fields without anything that says where she
 * was, anything the page keeps for itself (`_...`), and anything empty.
 */
export function helperSource(form = {}) {
  const out = {};
  for (const [key, value] of Object.entries(form.fields || {})) {
    // The title goes as the title, once.
    if (NEVER_SENT.includes(key) || key.startsWith("_") || key === "title") continue;
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && !value.length) continue;
    if (typeof value === "object" && !Array.isArray(value)) continue;
    out[key] = value;
  }
  return out;
}

const GROUPS = [
  ["when", ["date", "draft"]],
  ["tags", ["tags"]],
  ["summary", ["description", "subtitle"]],
  ["recipe", ["servings", "prepTime", "cookTime", "totalTime", "course", "cuisine", "yield", "calories", "adaptedFrom"]],
  ["video", ["videoUrl", "duration", "productionStatus", "videoTitle", "videoDescription", "aiDisclosure", "seasonNumber", "episodeNumber", "madeForKids", "syntheticMedia", "videoPeople", "videoRights", "productionCredits"]],
  ["trip", ["activity", "location", "distanceKm", "elevationGainM", "conditions", "locationPrivacy"]],
];
/** The groups of details present in what is sent, in her words. */
export function detailGroups(metadata = {}) {
  const keys = Object.keys(metadata).filter((key) => key !== "title");
  const found = [];
  const seen = new Set();
  const trip = metadata.profile === "field-journal";
  for (const [group, names] of GROUPS) {
    // "duration" is a video's or a trip's, by what kind of post it is.
    const mine = keys.filter((key) => names.includes(key) && !(key === "duration" && (group === "video") === trip));
    if (!mine.length) continue;
    mine.forEach((key) => seen.add(key));
    found.push(group);
  }
  if (keys.some((key) => key.startsWith("job."))) found.push("job");
  keys.filter((key) => key.startsWith("job.")).forEach((key) => seen.add(key));
  if (keys.some((key) => !seen.has(key))) found.push("other");
  return found.map((group) => ({
    when: say("helper.groupWhen"), tags: say("helper.groupTags"), summary: say("helper.groupSummary"), recipe: say("helper.groupRecipe"),
    job: say("helper.groupJob"), video: say("helper.groupVideo"), trip: say("helper.groupTrip"), other: say("helper.groupOther"),
  })[group]);
}

/** The details, one "name: value" line each, for Word for word. */
export function detailLines(metadata = {}) {
  return Object.entries(metadata).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
}

// ---- which part is read (lifted, ADR 0290)

/** The longest passage, in Unicode code points, a selection or part review sends (the server's limit). */
export const MAX_PASSAGE = 20_000;

/** The offsets (UTF-16) where ATX heading lines start, leaving out lines inside fenced code. */
export function markdownHeadingStarts(markdown = "") {
  const starts = [];
  let fence = null;
  let offset = 0;
  for (const line of String(markdown).split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
    if (fence) {
      if (marker && marker[0] === fence.character && marker.length >= fence.length && line.slice(line.indexOf(marker) + marker.length).trim() === "") fence = null;
    } else if (marker) {
      fence = { character: marker[0], length: marker.length };
    } else if (/^ {0,3}#{1,6}[ \t]+\S/.test(line)) {
      starts.push(offset);
    }
    offset += line.length + 1;
  }
  return starts;
}

const points = (text, index) => Array.from(text.slice(0, index)).length;

/**
 * The passage a selection or section review sends, from the post's words and the selection
 * (UTF-16 offsets, as a text box reports them). A selection is trimmed of surrounding space; a
 * section runs from the heading before the caret (or the start) to the next heading (or the end).
 * The answer is in Unicode code points, which is how the server and the suggestions count.
 * `{ error: "empty" | "too-long" | "kind" }` when there is nothing to send.
 */
export function assistantReviewPassage(markdown = "", start = 0, end = start, kind = "selection") {
  const text = String(markdown);
  let from = Math.max(0, Math.min(start, end, text.length));
  let to = Math.max(0, Math.min(Math.max(start, end), text.length));
  if (kind === "section") {
    // A `#` line inside fenced code (a shell comment, say) is code, not a heading.
    const headings = markdownHeadingStarts(text);
    const heading = headings.filter((at) => at <= to).pop();
    from = heading ?? 0;
    to = headings.find((at) => at > (heading ?? -1)) ?? text.length;
  } else if (kind !== "selection") {
    return { error: "kind" };
  }
  while (from < to && /\s/.test(text[from])) from += 1;
  while (to > from && /\s/.test(text[to - 1])) to -= 1;
  if (from >= to) return { error: "empty" };
  const passage = { kind, start: points(text, from), end: points(text, to) };
  if (passage.end - passage.start > MAX_PASSAGE) return { error: "too-long", passage, text: text.slice(from, to) };
  return { passage, text: text.slice(from, to) };
}

/**
 * Where each box of her words sits in the whole post: `[{ index, name, start, end, startPoint,
 * endPoint }]` (UTF-16 offsets, and the same in code points). A box whose words can't be found in
 * the post in order (it never should be) is left out, so nothing is applied to it.
 * `form` is `{ body, boxes: [{ name, value }] }`.
 */
export function boxSpans(form = {}) {
  const body = String(form.body ?? "");
  const spans = [];
  let from = 0;
  (form.boxes || []).forEach((box, index) => {
    const value = String(box?.value ?? "");
    if (!value) return;
    const at = body.indexOf(value, from);
    if (at < 0) return;
    spans.push({ index, name: String(box.name || ""), start: at, end: at + value.length, startPoint: points(body, at), endPoint: points(body, at + value.length) });
    from = at + value.length;
  });
  return spans;
}

/**
 * What she had selected and where her caret was when the sheet opened, so tapping the button
 * doesn't lose it. `selection` is `{ box (index), at (caret, UTF-16 in that box), text (selected) }`
 * or null. Gives `{ box, start, end, caret, words }` in the whole post's offsets, or null when she
 * wasn't in a box.
 */
export function captureTarget(form = {}, selection = null) {
  if (!selection || !Number.isInteger(selection.box)) return null;
  const span = boxSpans(form).find((s) => s.index === selection.box);
  if (!span) return null;
  const value = String(form.boxes[selection.box].value ?? "");
  const at = Math.max(0, Math.min(Number(selection.at) || 0, value.length));
  const selected = String(selection.text ?? "");
  const from = selected && value.slice(at - selected.length, at) === selected ? at - selected.length : at;
  return { box: selection.box, name: span.name, start: span.start + from, end: span.start + at, caret: span.start + at, words: countWords(value.slice(from, at)) };
}

/**
 * What is read for her choice (`whole`, `selected`, `part`): `{ choice, passage (null for the
 * whole post), text, label, error }`. A part is the heading before her caret to the next; with no
 * heading before it, the box she is in. `error` is "empty" or "too-long".
 */
export function passageFor(target, choice, form = {}) {
  const body = String(form.body ?? "");
  if (choice === "whole" || !target) return { choice: "whole", passage: null, text: body, label: "", error: body.trim() ? "" : "empty" };
  if (choice === "selected") {
    const got = assistantReviewPassage(body, target.start, target.end, "selection");
    return { choice, passage: got.passage || null, text: got.text || "", label: "", error: got.error || "" };
  }
  const headings = markdownHeadingStarts(body);
  const heading = headings.filter((at) => at <= target.caret).pop();
  if (heading === undefined) {
    // No heading above her: the box she's in, sent as a selection of exactly that box.
    const span = boxSpans(form).find((s) => s.index === target.box);
    const got = span ? assistantReviewPassage(body, span.start, span.end, "selection") : { error: "empty" };
    return { choice, passage: got.passage ? { ...got.passage, kind: "section" } : null, text: got.text || "", label: say("helper.partAll", { box: target.name }), error: got.error || "" };
  }
  const got = assistantReviewPassage(body, target.caret, target.caret, "section");
  const line = body.slice(heading).split("\n")[0].replace(/^ {0,3}#{1,6}[ \t]+/, "").replace(/[ \t]+#+[ \t]*$/, "").trim();
  return { choice, passage: got.passage || null, text: got.text || "", label: say("helper.partFrom", { heading: clip(line, 60).text }), error: got.error || "", heading: line };
}

// ---- what it looks for

/** Whether a skill declares the review scope (`document`, `selection` or `section`). */
export function skillFitsScope(skill = {}, scope = "document") {
  return Array.isArray(skill.scopes) && skill.scopes.includes(scope);
}

/** The scope a choice of what to read asks a skill for. */
export const scopeOf = (choice) => (choice === "selected" ? "selection" : choice === "part" ? "section" : "document");

/** A skill that can be used for a review at all. */
const usable = (skill) => skill && skill.valid === true && skill.selectable === true && (skill.output === undefined || skill.output === "review");

/** The ids, of those asked for, that can be chosen: valid and selectable, each once. */
export function selectableSkillIds(skills = [], requested = []) {
  const available = new Set(skills.filter((skill) => skill.valid === true && skill.selectable === true).map((skill) => skill.id));
  return [...new Set(requested)].filter((id) => available.has(id));
}

/** One skill as the setup screen lists it. */
export function skillPresentation(skill = {}) {
  const errors = Array.isArray(skill.errors) ? skill.errors.filter((error) => typeof error === "string") : [];
  const valid = skill.valid === true;
  const scopes = (Array.isArray(skill.scopes) ? skill.scopes : []).map((scope) => ({ document: say("hsetup.scopeWhole"), section: say("hsetup.scopePart"), selection: say("hsetup.scopeSelected") })[scope]).filter(Boolean);
  const source = skill.source === "project" ? say("hsetup.yours") : say("hsetup.builtIn");
  return {
    title: String(skill.name || skill.id || ""),
    source,
    line: valid ? say("hsetup.skillLine", { source, version: String(skill.version || "?"), scopes: scopes.join(", ") || "—" }) : say("hsetup.skillInvalid", { source }),
    note: valid && skill.overrideState === "active" ? say("hsetup.replacesBuiltIn") : valid && skill.overrideState === "overridden" ? say("hsetup.replacedByYours") : "",
    disabled: !valid || skill.selectable !== true,
    editable: skill.source === "project",
    errors,
  };
}

const HER_CHOICES = [
  { id: "copy", skills: ["copy-review"] },
  { id: "flow", skills: ["developmental-review"] },
  { id: "voice", skills: ["voice-review"], extra: ["voice-match"], needsGuide: true },
  { id: "facts", skills: ["source-review"], research: true },
];
const HER_SKILLS = new Set(HER_CHOICES.flatMap((choice) => [...choice.skills, ...(choice.extra || [])]));

/**
 * Her choices of what to look for, for this post and what is read: `{ choices: [{ id, label, on }],
 * others: [{ id, label, fits }] }`. A choice whose skill is missing, invalid, replaced by an invalid
 * one, or doesn't fit what is read is left out (never shown greyed). `others` are every other
 * usable review skill, for {helper}.
 */
export function lookForChoices(catalog = [], post = {}, guide = null, scope = "document") {
  const skills = Array.isArray(catalog) ? catalog : [];
  const active = (id) => skills.find((skill) => skill.id === id && usable(skill));
  const labels = { copy: say("helper.lookCopy"), flow: say("helper.lookFlow"), voice: say("helper.lookVoice"), facts: say("helper.lookFacts") };
  const choices = HER_CHOICES
    .filter((choice) => (!choice.needsGuide || guide) && (!choice.research || post.kind === "research"))
    .filter((choice) => choice.skills.every((id) => active(id) && skillFitsScope(active(id), scope)))
    .map((choice) => ({ id: choice.id, label: labels[choice.id], on: choice.id === "copy" || (choice.id === "facts" && post.kind === "research") }));
  const others = skills
    .filter((skill) => usable(skill) && !HER_SKILLS.has(skill.id))
    .map((skill) => ({ id: skill.id, label: `${clip(String(skill.name || skill.id), 80).text} (${clip(String(skill.version || "?"), 20).text})`, fits: skillFitsScope(skill, scope) }));
  return { choices, others };
}

/**
 * The skill ids her choices send for what is read. "Whether it sounds like me" also asks for the
 * closer match on a selection or a part, when that skill is there.
 */
export function skillsFor(choices = [], scope = "document", catalog = [], others = []) {
  const skills = Array.isArray(catalog) ? catalog : [];
  const fits = (id) => skills.some((skill) => skill.id === id && usable(skill) && skillFitsScope(skill, scope));
  const ids = [];
  for (const choice of HER_CHOICES) {
    if (!choices.includes(choice.id)) continue;
    ids.push(...choice.skills.filter(fits));
    if (scope !== "document") ids.push(...(choice.extra || []).filter(fits));
  }
  ids.push(...others.filter((id) => !HER_SKILLS.has(id) && fits(id)));
  return [...new Set(ids)];
}

// ---- the request, and what goes

/** The body of `POST assistant/review`. */
export function reviewRequest({ form = {}, passage = null, skillIds = [], contextIds = [] } = {}) {
  return {
    source: { title: String(form.title ?? ""), metadata: helperSource(form), markdown: String(form.body ?? "") },
    ...(passage ? { passage: { kind: passage.kind, start: passage.start, end: passage.end } } : {}),
    skillIds: [...new Set(skillIds)],
    contextIds: [...new Set(contextIds)],
  };
}

/** Whether what was sent is still what she has (lifted). */
export function sourceChanged(submitted = {}, current = {}) {
  return submitted.title !== current.title || submitted.markdown !== current.markdown || JSON.stringify(submitted.metadata) !== JSON.stringify(current.metadata);
}

const NOTE_TYPES = { author: "author", site: "site", post: "post" };

/**
 * What goes to the company for a request, computed from her choices only (never from anything a
 * helper said): `{ company, heading, lines: [..], never, sent: [{ id, label, kind }], details }`.
 * `sent` names every context id the request carries and nothing else; `lines` says each in her
 * words. `catalog` is `assistant/context` (documents, voiceGuides, references, postSnapshots,
 * voiceSamples); `skills` the skill catalog, for {helper}'s lines.
 */
export function whatGoes(request = {}, catalog = {}, status = {}, { skills = [] } = {}) {
  const company = companyName(status);
  const markdown = String(request.source?.markdown ?? "");
  const passage = request.passage || null;
  const letters = Array.from(markdown);
  const read = passage ? letters.slice(passage.start, passage.end).join("") : markdown;
  const count = wordsAbout(countWords(read));
  const lines = [passage?.kind === "selection" ? say("helper.goesSelected", { count }) : passage ? say("helper.goesPart", { count }) : say("helper.goesWords", { count })];
  const groups = detailGroups(request.source?.metadata || {});
  if (groups.length) lines.push(say("helper.goesDetails", { list: groups.join(", ") }));

  const all = [...(catalog.documents || []), ...(catalog.voiceGuides || []), ...(catalog.references || []), ...(catalog.postSnapshots || []), ...(catalog.voiceSamples || [])];
  const sent = (request.contextIds || []).map((id) => {
    const doc = all.find((item) => item?.id === id) || {};
    const kind = doc.contextType === "voice" ? "voice" : NOTE_TYPES[doc.contextType] ? "note" : doc.kind === "postSnapshot" ? "post" : doc.kind === "voiceSample" ? "sample" : "text";
    const label = kind === "voice" ? say("helper.goesVoice")
      : doc.contextType === "author" ? say("helper.noteAuthor") : doc.contextType === "site" ? say("helper.noteSite") : doc.contextType === "post" ? say("helper.notePost")
        : clip(String(doc.title || doc.path || doc.name || id), 80).text;
    return { id, label, kind, visibility: String(doc.visibility || ""), characters: Number(doc.characters) || 0 };
  });
  const notes = [...new Set(sent.filter((item) => item.kind === "note").map((item) => item.label))];
  if (notes.length) lines.push(say("helper.goesNotes", { list: notes.join(", ") }));
  if (sent.some((item) => item.kind === "voice")) lines.push(say("helper.goesVoice"));
  const other = sent.filter((item) => !["note", "voice"].includes(item.kind)).map((item) => item.label);
  if (other.length) lines.push(say("helper.goesOther", { list: other.join(", ") }));

  const sentPosts = sent.some((item) => item.kind === "post");
  const samples = sent.filter((item) => item.kind === "sample");
  const details = [
    say("helper.sendsSkills", { list: clip((request.skillIds || []).map((id) => `${id} ${skills.find((skill) => skill.id === id)?.version || "?"}`).join(", ") || "—", 200).text }),
    sent.length ? say("helper.sendsContext", { list: clip(sent.map((item) => `${item.id} (${item.visibility || "source"}, ${item.characters.toLocaleString("en-US")})`).join("; "), 200).text }) : say("helper.sendsContextNone"),
    ...(samples.length ? [say("helper.budget", {
      samples: samples.length, maxSamples: Number(catalog.voiceBudget?.samples) || 8,
      letters: samples.reduce((sum, item) => sum + item.characters, 0).toLocaleString("en-US"), maxLetters: (Number(catalog.voiceBudget?.characters) || 120000).toLocaleString("en-US"),
    })] : []),
    say("helper.sendsModel", { model: clip(String(status.model || "—"), 80).text, destination: clip(String(status.destination || "—"), 100).text }),
  ];
  return { company, heading: say("helper.goesTo", { company }), lines, never: sentPosts ? say("helper.goesNeverPosts", { company }) : say("helper.goesNever", { company }), sent, details };
}

// ---- what it found

const SEVERITY = { high: 0, medium: 1, low: 2, note: 3 };

/** A finding the page can show: text fields that are text, a range of two whole numbers. */
export function usableFinding(finding) {
  return Boolean(finding) && typeof finding === "object" && typeof finding.evidence === "string" && typeof finding.explanation === "string"
    && Number.isInteger(finding.range?.start) && Number.isInteger(finding.range?.end) && finding.range.end >= finding.range.start
    && (finding.suggestion === null || finding.suggestion === undefined || typeof finding.suggestion === "string");
}

/** The findings in post order; in one place, the weightiest first. Anything malformed is dropped. */
export function orderFindings(findings = []) {
  return (Array.isArray(findings) ? findings : []).filter(usableFinding)
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => a.finding.range.start - b.finding.range.start || (SEVERITY[a.finding.severity] ?? 9) - (SEVERITY[b.finding.severity] ?? 9) || a.index - b.index)
    .map((entry) => entry.finding);
}

/** Where a suggestion is, in her words: "In Your story", or near its first words when it spans boxes. */
export function findingPlace(range, spans = [], evidence = "") {
  const box = spans.find((span) => range && range.start >= span.startPoint && range.end <= span.endPoint);
  if (box?.name) return say("found.inBox", { box: box.name });
  return say("found.near", { words: clip(String(evidence).replace(/\s+/g, " ").trim(), 30).text });
}

/** Where the evidence sits in `source` (arrays of code points): every start. */
function occurrences(source, evidence) {
  const starts = [];
  if (!evidence.length) return starts;
  outer: for (let index = 0; index <= source.length - evidence.length; index += 1) {
    for (let at = 0; at < evidence.length; at += 1) if (source[index + at] !== evidence[at]) continue outer;
    starts.push(index);
  }
  return starts;
}

/**
 * Put a suggestion into the post's words (lifted from the old Admin): the quoted words at their
 * range, or, when they moved, at the one place they now are. `{ ok, markdown, start, sourceEnd,
 * end }` in code points, or `{ ok: false, error: "none" | "moved" | "twice" }`.
 */
export function applyAssistantSuggestion(markdown, finding = {}) {
  const source = Array.from(String(markdown ?? ""));
  const evidence = typeof finding.evidence === "string" ? Array.from(finding.evidence) : [];
  const suggestion = typeof finding.suggestion === "string" ? Array.from(finding.suggestion) : null;
  if (!evidence.length || suggestion === null) return { ok: false, error: "none" };
  const matchesAt = (start) => start >= 0 && start + evidence.length <= source.length && evidence.every((character, index) => source[start + index] === character);
  const requestedStart = finding.range?.start;
  const requestedEnd = finding.range?.end;
  let start = Number.isInteger(requestedStart) && Number.isInteger(requestedEnd) && requestedEnd - requestedStart === evidence.length && matchesAt(requestedStart) ? requestedStart : -1;
  if (start < 0) {
    const matches = occurrences(source, evidence);
    if (matches.length !== 1) return { ok: false, error: matches.length ? "twice" : "moved" };
    [start] = matches;
  }
  const updated = [...source.slice(0, start), ...suggestion, ...source.slice(start + evidence.length)].join("");
  return { ok: true, markdown: updated, start, sourceEnd: start + evidence.length, end: start + suggestion.length };
}

/** A suggestion made plain before it enters her words: one kind of line break, no control characters. */
export function plainSuggestion(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​‪-‮⁦-⁩﻿]/g, "");
}

/**
 * Use a suggestion: only when its quoted words are found exactly once in the post, inside one box
 * of her words and outside any card, don't overlap a suggestion already used, and putting the box
 * back into the post gives the old post with only that swap (checked byte for byte). `form` is
 * `{ body, boxes: [{ name, value }] }`; `used` the records of suggestions already used.
 * `{ ok, box, text (the box's new words), at, end (UTF-16 in the box), record }` or
 * `{ ok: false, why: "advice" | "moved" | "twice" | "across" | "card" | "overlap" | "same" }`.
 */
export function applyFinding(form = {}, finding = {}, used = []) {
  if (!usableFinding(finding) || typeof finding.suggestion !== "string" || !finding.evidence) return { ok: false, why: "advice" };
  const body = String(form.body ?? "");
  const suggestion = plainSuggestion(finding.suggestion);
  if (suggestion === finding.evidence) return { ok: false, why: "same" };
  const letters = Array.from(body);
  const found = occurrences(letters, Array.from(finding.evidence));
  if (found.length !== 1) return { ok: false, why: found.length ? "twice" : "moved" };
  const applied = applyAssistantSuggestion(body, { ...finding, suggestion });
  if (!applied.ok || applied.start !== found[0]) return { ok: false, why: "moved" };
  const start16 = letters.slice(0, applied.start).join("").length;
  const end16 = start16 + finding.evidence.length;
  const span = boxSpans(form).find((s) => start16 >= s.start && end16 <= s.end);
  if (!span) return { ok: false, why: "across" };
  const value = String(form.boxes[span.index].value ?? "");
  const at = start16 - span.start;
  // Outside any card: a photo, a tip, a table or a piece is changed through its own form.
  if (cardRanges(value).some(([from, to]) => at < to && at + finding.evidence.length > from)) return { ok: false, why: "card" };
  if (used.some((record) => record.box === span.index && at < record.end && at + finding.evidence.length > record.at)) return { ok: false, why: "overlap" };
  const text = value.slice(0, at) + suggestion + value.slice(at + finding.evidence.length);
  // The post put back together must be the old post with only this swap.
  if (body.slice(0, span.start) + text + body.slice(span.end) !== applied.markdown) return { ok: false, why: "moved" };
  const record = { id: String(finding.id ?? ""), box: span.index, at, end: at + suggestion.length, evidence: finding.evidence, suggestion, before: value, after: text };
  return { ok: true, box: span.index, text, at, end: at + suggestion.length, record };
}

/** The cards in a box's words, as `[start, end]` offsets. */
export function cardRanges(value) {
  return splitBlocks(String(value ?? "")).filter((block) => block.type === "card" && block.source).map((block) => [block.start, block.start + block.source.length]);
}

/** After a suggestion is used in a box, where the ones used before it in that box now are. */
export function shiftUsed(used = [], record) {
  const delta = record.suggestion.length - record.evidence.length;
  return used.map((other) => (other.box === record.box && other.at >= record.at ? { ...other, at: other.at + delta, end: other.end + delta } : other));
}

/**
 * Undo one used suggestion in its box's words as they are now: exactly back when nothing changed
 * since; else the swap alone is reversed where it still stands (so later changes of hers stay).
 * `{ ok, text, at, end }` or `{ ok: false }` when her words there changed.
 */
export function undoFinding(value, record) {
  const now = String(value ?? "");
  if (now === record.after) return { ok: true, text: record.before, at: record.at, end: record.at + record.evidence.length };
  const here = now.slice(record.at, record.at + record.suggestion.length) === record.suggestion ? record.at : -1;
  let at = here;
  if (at < 0 && record.suggestion) {
    const first = now.indexOf(record.suggestion);
    if (first >= 0 && now.indexOf(record.suggestion, first + 1) < 0) at = first;
  }
  if (at < 0) return { ok: false };
  return { ok: true, text: now.slice(0, at) + record.evidence + now.slice(at + record.suggestion.length), at, end: at + record.evidence.length };
}

/** Where the quoted words are in a box now (for Show me): `{ box, start, end }` or null. */
export function findingInBoxes(form = {}, finding = {}) {
  const body = String(form.body ?? "");
  const letters = Array.from(body);
  const evidence = Array.from(String(finding.evidence ?? ""));
  const found = occurrences(letters, evidence);
  const spans = boxSpans(form);
  let start = found.length === 1 ? found[0] : -1;
  if (start < 0 && Number.isInteger(finding.range?.start)) start = Math.min(finding.range.start, letters.length);
  if (start < 0) return null;
  const start16 = letters.slice(0, start).join("").length;
  const span = spans.find((s) => start16 >= s.start && start16 <= s.end) || spans[0];
  if (!span) return null;
  const from = Math.max(0, start16 - span.start);
  const length = found.length === 1 ? String(finding.evidence).length : 0;
  return { box: span.index, start: from, end: Math.min(span.end - span.start, from + length) };
}
