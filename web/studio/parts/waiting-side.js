// New job's side column (Studio R4): "Waiting on this phone" with a card per job and what each
// card's buttons do, "Sent this visit", the line under the lede that says how many wait, and Mikey's
// details about the list on this phone. Redrawn whenever the sender says something changed; focus
// stays on the card it was on.
import { h } from "./dom.js";
import { detailsBox } from "./account-details.js";
import { captureBytes, DB_NAME, DB_VERSION, STORE_NAME } from "./capture-queue.js";
import { captureTitle } from "./new-job-rules.js";
import { keptTitle, waitingCount } from "./job-words.js";
import { savePhotos, throwAwayAsk, waitingCard } from "./waiting-cards.js";
import { clearSavedPages, readReleases } from "./releases.js";
import { readSentLog, sentLogLines } from "./sent-log.js";
import { ask } from "./dialogs.js";
import { detailsText } from "./job-sender.js";

/** `{ jobs, meta, api, here, noun, limits, services, say }`. */
export function createWaitingSide({ jobs, meta, api, here, noun, limits, services, say }) {
  const heading = h("h3", { id: "studio-waiting-h", tabindex: "-1", text: here.desktop ? "Waiting on this computer" : `Waiting on this ${noun}` });
  const list = h("ul", { class: "studio-comment-list", "aria-labelledby": "studio-waiting-h" });
  const box = h("section", { class: "studio-section", "aria-labelledby": "studio-waiting-h", hidden: true }, heading, list);
  const sentList = h("ul", { class: "studio-sent-list", "aria-labelledby": "studio-sent-h" });
  const sentBox = h("section", { class: "studio-section", "aria-labelledby": "studio-sent-h", hidden: true }, h("h3", { id: "studio-sent-h", text: "Sent this visit" }), sentList);
  const appHint = h("p", { class: "studio-help" });
  const details = h("div");
  const link = h("p", { class: "studio-help" });
  const element = h("div", { class: "studio-account-side" }, box, sentBox, appHint, details);

  const titleOf = (record) => captureTitle(record.fields, new Date(record.createdAt), services);
  // A job that can't be read has no title of its own: each gets a number, so the cards and their
  // More buttons are told apart.
  let names = new Map();
  const nameOf = (entry) => (entry.record ? titleOf(entry.record) : names.get(entry) || keptTitle(0, noun));
  const actions = {
    // A card's Send now sends that job only (Home's and the palette's send them all).
    send: (entry) => jobs.flush({ manual: true, only: entry.id }),
    retry: (entry) => jobs.retry(entry.id),
    again: (entry) => jobs.sendAgain(entry.id),
    done: (entry) => jobs.done(entry.id),
    // Someone else's job goes as hers only once she says so; who saved it stays on the record.
    as: async (entry, button) => {
      const choice = await ask({ heading: `Send ${entry.record.by}'s job as you?`, text: "It goes to your blog as yours.", choices: [{ label: "Send it", value: "send" }, { label: "Not now", value: "no", variant: "secondary" }] });
      if (choice === "send") return jobs.sendAs(entry.id);
      button?.querySelector?.("button")?.focus();
      return null;
    },
    reload: () => location.reload(),
    // Mikey's: the record, the last answer and the step log, as text.
    copy: (entry) => navigator.clipboard?.writeText(detailsText(entry, jobs.live(entry.id)))
      .then(() => say("Copied the details."), () => say("Couldn't copy. Select the lines in Details instead."))
      ?? say("Couldn't copy. Select the lines in Details instead."),
    save: async (entry) => say(await savePhotos(entry.record, titleOf(entry.record), { here })),
    throwAway: async (entry) => {
      const name = nameOf(entry);
      const gone = await throwAwayAsk(entry, name, { jobs, noun, onSave: actions.save });
      if (gone === "busy") say("It's being sent right now, so it wasn't thrown away. Look again in a moment.");
      else if (gone) {
        say("Thrown away.");
        heading.focus();
      }
    },
  };

  function draw() {
    const entries = jobs.entries();
    const focusId = document.activeElement?.closest?.("[data-waiting]")?.dataset.waiting;
    const focusStep = document.activeElement?.closest?.("[data-step]")?.dataset.step;
    // A card's Details Mikey opened stay open through the redraw.
    const opened = new Set([...list.querySelectorAll("[data-waiting] > details[open]")].map((node) => node.closest("[data-waiting]").dataset.waiting));
    box.hidden = entries.length === 0;
    names = new Map(entries.filter((entry) => !entry.record).map((entry, index) => [entry, keptTitle(index, noun)]));
    list.replaceChildren(...entries.map((entry) => waitingCard(entry, { jobs, title: nameOf(entry), noun, here, limits, on: actions })));
    for (const id of opened) {
      const details = list.querySelector(`[data-waiting="${CSS.escape(id)}"] > details`);
      if (details) details.open = true;
    }
    if (focusId) {
      const card = `[data-waiting="${CSS.escape(focusId)}"]`;
      requestAnimationFrame(() => ((focusStep && list.querySelector(`${card} [data-step="${CSS.escape(focusStep)}"] button`)) || list.querySelector(`${card} h4`) || heading)?.focus());
    }
    link.replaceChildren(...(entries.length ? [`${waitingCount(entries.length, noun)}. `, h("a", { href: "#/new-job?focus=waiting", onClick: (event) => { event.preventDefault(); heading.focus(); heading.scrollIntoView({ block: "start" }); }, text: "See them" })] : []));
    const sent = jobs.sentThisVisit();
    sentBox.hidden = sent.length === 0;
    sentList.replaceChildren(...sent.map((item) => h("li", {}, h("span", { text: `${item.title}. ` }), h("a", { href: `#/write/${encodeURIComponent(item.path)}`, text: "Finish it" }))));
    appHint.textContent = entries.length === 0 && here.apple && here.standalone ? "Saved a job in Safari instead? It's waiting there: open your blog in Safari to send it." : "";
    drawDetails(entries);
  }

  // Which release is where: read when New job opens and again each time Mikey opens Details (a first
  // visit has no worker in charge yet).
  let releases = null;
  let releasesAt = 0;
  const clearButton = () => {
    const offline = navigator.onLine === false;
    return h("p", {},
      h("action-button", { variant: "secondary", size: "sm", disabled: offline, "data-clear-pages": "true", onClick: () => clearSavedPages() }, "Clear saved pages"),
      h("span", { class: "studio-help", text: offline ? " Needs a signal: the pages are fetched again." : " Deletes the kept copy of these pages and reloads. Jobs on this phone stay." }));
  };

  async function drawDetails(entries) {
    if (!releases) {
      releasesAt = Date.now();
      releases = readReleases().catch(() => ({ lines: [], mismatch: false }));
    }
    const release = await releases;
    const bytes = entries.reduce((sum, entry) => sum + (entry.record ? captureBytes(entry.record) : 0), 0);
    const estimate = await navigator.storage?.estimate?.().catch(() => null);
    const persisted = await navigator.storage?.persisted?.().catch(() => null);
    // Redrawn as jobs change: what Mikey opened stays open.
    const open = Boolean(details.querySelector("details")?.open);
    details.replaceChildren(detailsBox([
      `IndexedDB ${DB_NAME} v${DB_VERSION} / ${STORE_NAME}: ${entries.length} of ${limits.maxQueued} jobs, ${(bytes / 1048576).toFixed(1)} of ${Math.round(limits.maxQueueBytes / 1048576)} MB`,
      `in progress: IndexedDB studio-new-job v1 / open, key ${api.user || "(none)"}`,
      `storage.persist(): ${persisted === null || persisted === undefined ? "unknown" : persisted ? "granted" : "not granted"}${estimate ? `; estimate ${(estimate.usage / 1048576).toFixed(1)} of ${(estimate.quota / 1048576).toFixed(0)} MB` : ""}`,
      `Web Locks ${navigator.locks ? "yes" : "no"}; BroadcastChannel ${typeof BroadcastChannel === "function" ? "yes" : "no"}; ${here.standalone ? "Home Screen app" : "browser tab"}`,
      "Safari may clear site data after 7 days without a visit; the Home Screen app is exempt; Safari and the Home Screen app don't share storage.",
      "Old Admin windows opened before this update use the same list; sending from both makes one draft (ADR 0297).",
      `limits: ${Object.entries(meta.capture || {}).map(([k, v]) => `${k} ${v}`).join(", ")}`,
      ...release.lines,
      ...sentLogLines(readSentLog(safeStorage())),
    ], release.mismatch ? h("status-badge", { variant: "warning", "data-release-mismatch": "true" }, "Releases differ") : null, clearButton()));
    const box = details.querySelector("details");
    // Re-opened here after a redraw: that toggle isn't Mikey's, so it doesn't read again.
    let restoring = open;
    if (open) box.open = true;
    box.addEventListener("toggle", () => {
      if (restoring) {
        restoring = false;
        return;
      }
      if (box.open && Date.now() - releasesAt > 500) {
        releases = null;
        drawDetails(jobs.entries());
      }
    });
  }

  return { element, link, heading, list, draw };
}

function safeStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
