// "Waiting on this phone" (Studio R4): one card per job kept on this phone, oldest first, with where
// it stands in her words, its one next step, and More (save its photos to the phone, throw it away).
// Mikey's details sit under each card. Nothing here says sizes or codes on her layer.
import { h } from "./dom.js";
import { detailsBox } from "./account-details.js";
import { ask } from "./dialogs.js";
import { captureBytes } from "./capture-queue.js";
import { savedWords, waitingWords } from "./job-words.js";
import { stepWords } from "./job-sender.js";
import { captureSlug } from "./new-job-rules.js";

const MB = 1024 * 1024;

/** The card's one next step for each state: `[label, action]`, or null. */
function nextStep(state) {
  return {
    waiting: ["Send now", "send"], tried: ["Send now", "send"], signin: ["Sign in", "send"],
    refused: ["Try again", "retry"], removed: ["Send it again", "again"], sent: ["Done", "done"],
    "someone-else": ["Send it", "as"], newer: ["Reload", "reload"],
  }[state] || null;
}

/**
 * Save a job's photos to this phone: shared to Photos on a phone, one download each on a computer.
 * Resolves the words to say.
 */
export async function savePhotos(record, title, { here = {}, win = globalThis } = {}) {
  const stem = captureSlug(title, record.id).replace(/-[0-9a-f]{6}$/, "");
  const files = record.photos.map((photo, index) => new File([photo.blob], `${stem}-${index + 1}.${/png/.test(photo.type) ? "png" : "jpg"}`, { type: photo.type || "image/jpeg" }));
  if (!files.length) return "This job has no photos.";
  const phone = here.apple || here.android;
  if (phone && win.navigator?.canShare?.({ files })) {
    try {
      await win.navigator.share({ files });
      return files.length === 1 ? "Your photo is saved." : `Your ${files.length} photos are saved.`;
    } catch {
      return "Your phone didn't let them be saved. Try again from the Photos button.";
    }
  }
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const link = h("a", { href: url, download: file.name, class: "studio-visually-hidden" });
    win.document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return files.length === 1 ? "Your photo is downloading." : `Your ${files.length} photos are downloading.`;
}

/**
 * One card. `title` is the job's name in her words; `on` is { send, retry, again, done, as, reload,
 * finish(path), throwAway(entry, button), save(entry) }.
 */
export function waitingCard(entry, { jobs, title, noun = "phone", here = {}, now = new Date(), limits = {}, on }) {
  const record = entry.record || null;
  const state = jobs.stateOf(entry);
  const live = jobs.live(entry.id);
  const name = record ? title : "A job kept on this phone";
  const said = waitingWords(state, { record, live, step: live.step ? stepWords(live.step) : "", now, noun });
  const id = `studio-waiting-${entry.id || Math.random().toString(16).slice(2)}`;
  const buttons = [];
  const step = nextStep(state);
  if (step && state !== "sending") {
    buttons.push(h("action-button", {
      variant: "secondary",
      label: step[1] === "send" && state !== "signin" ? `Send ${name} now` : `${step[0]}: ${name}`,
      "data-step": step[1],
      onClick: (event) => on[step[1]]?.(entry, event.currentTarget),
    }, step[0]));
  }
  if (state === "sent" && record?.sent?.path) {
    buttons.push(h("action-button", { variant: "link", href: `#/write/${encodeURIComponent(record.sent.path)}`, label: `Finish ${name}` }, "Finish it"));
  }
  const items = [];
  if (record?.photos.length) items.push({ value: "save", label: record.photos.length === 1 ? "Save the photo to this phone" : "Save the photos to this phone" });
  if (state !== "sending") items.push({ value: "throw", label: "Throw it away…" });
  const menu = items.length ? h("dropdown-menu", {
    class: "studio-row-menu",
    items,
    onItemselect: (event) => (event.detail === "save" ? on.save(entry) : on.throwAway(entry, menu)),
  }, h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: ` for ${name}` }))) : null;
  const bytes = record ? captureBytes(record) : 0;
  return h("li", { class: "studio-comment studio-waiting", "data-waiting": entry.id, "data-state": state },
    h("div", { class: "studio-comment-head" },
      h("h4", { id, class: "studio-comment-who", tabindex: "-1", text: name }),
      h("status-badge", { variant: said.variant === "neutral" ? "outline" : said.variant === "info" ? "primary" : said.variant }, said.badge)),
    record ? h("p", { class: "studio-help", text: savedWords(record, now) }) : null,
    h("p", { text: said.words, "aria-live": state === "sending" ? "off" : null }),
    buttons.length || menu ? h("div", { class: "studio-comment-actions" }, ...buttons, menu) : null,
    detailsBox([
      `id ${entry.id || "(none)"}`,
      record ? `v ${record.v}; created ${record.createdAt}; by ${record.by || "(not recorded)"}` : `state ${entry.state}`,
      record ? `attempts ${record.attempts}; lastError ${record.lastError || "none"}` : "",
      record ? `${(bytes / MB).toFixed(1)} MB of ${Math.round((limits.maxCaptureBytes || 60 * MB) / MB)} MB a job` : "",
      live.status !== undefined ? `last answer: HTTP ${live.status}${live.code ? `, ${live.code}` : ""}${live.error ? `: ${live.error}` : ""}` : "",
      record?.sent ? `sent to ${record.sent.path}${record.sent.removed ? " (deleted there since)" : ""}; skipped ${record.sent.skipped.join(", ") || "none"}` : "",
    ]));
}

/** Throw it away: what goes, asked once, with Save the photos first. Resolves true when it went. */
export async function throwAwayAsk(entry, title, { jobs, noun = "phone", onSave }) {
  const record = entry.record;
  const what = record
    ? [record.photos.length ? `${record.photos.length} photo${record.photos.length === 1 ? "" : "s"}` : "", record.audio ? "voice note" : "", record.fields.notes.trim() ? "words" : ""].filter(Boolean)
    : [];
  const list = what.length > 1 ? `${what.slice(0, -1).join(", ")} and ${what.at(-1)}` : what[0] || "everything in it";
  // Keep it first, so it has the focus.
  const choices = [
    { label: "Keep it", value: "keep", variant: "primary" },
    ...(record?.photos.length ? [{ label: "Save the photos first", value: "save", variant: "secondary" }] : []),
    { label: "Throw it away", value: "throw", variant: "destructive" },
  ];
  for (;;) {
    const choice = await ask({ heading: `Throw away ${title}?`, text: `Its ${list} ${what.length === 1 && !what[0].endsWith("s") ? "is" : "are"} only on this ${noun}, so ${what.length === 1 && !what[0].endsWith("s") ? "it'll" : "they'll"} be gone for good.`, choices });
    if (choice === "save") {
      await onSave(entry);
      continue;
    }
    if (choice !== "throw") return false;
    if (await jobs.discard(entry.id)) return true;
    return "busy";
  }
}
