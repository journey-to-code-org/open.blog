// New job (#/new-job, Studio R4): "Get this job down before I leave the site." Photos from the camera
// or the library (made smaller on the phone first), a voice note, a few words, and the trade,
// service and town remembered on this phone; Save this job keeps it on this phone and the window's
// sender sends it when there's a signal. The job she's in the middle of is kept as she goes, apart
// from the waiting list, so a reload (iPhones reload when the camera opens) loses nothing. Beside
// it: what's waiting on this phone and what went this visit. docs/specs/studio/r4/ux.md.
import { h, toast as defaultToast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { createSheet } from "../parts/sheet.js";
import { detailsBox } from "../parts/account-details.js";
import { sayWhen } from "../parts/dates.js";
import { herePhone, deviceNoun } from "../parts/notification-rules.js";
import { tradeSite } from "../parts/record-kinds.js";
import { captureBytes, queueLimits, DB_NAME, STORE_NAME, DB_VERSION } from "../parts/capture-queue.js";
import { captureLimits, captureProblem, captureTitle, newCaptureId, photoProblem, photosToRemove, readPrefs, rememberPicks, serviceTitle, writePrefs } from "../parts/new-job-rules.js";
import { tradeLabel } from "../parts/job-rules.js";
import { PHOTO_WORDS, ROOM_WORDS, cameraHelp, flushWords, sentWords, tooManyWords, waitingCount } from "../parts/job-words.js";
import { shrinkPhoto } from "../parts/photo-shrink.js";
import { createJobInProgress } from "../parts/job-in-progress.js";
import { createVoiceNote } from "../parts/new-job-voice.js";
import { savePhotos, throwAwayAsk, waitingCard } from "../parts/waiting-cards.js";
import { stepWords } from "../parts/job-sender.js";

const KEEP_MS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const OTHER = "__other";
const slug = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

export async function createNewJob(context, route = { query: {} }) {
  const { api, meta = {}, jobs } = context;
  const toast = context.toast || defaultToast;
  await use("breadcrumb-trail", "action-button", "file-drop", "auto-grid", "text-field", "select-field", "status-badge", "alert-banner", "empty-state", "dropdown-menu", "side-sheet", "modal-dialog", "skeleton-block");
  const here = herePhone({ navigator, window: globalThis });
  const noun = deviceNoun(here);
  const limits = { ...captureLimits(meta), ...queueLimits(meta) };
  const services = Array.isArray(meta.job?.services) ? meta.job.services.filter((s) => s && typeof s.id === "string") : [];
  const siteTrade = String(meta.job?.siteTrade || "");
  const storage = safeStorage();
  const inProgress = createJobInProgress();
  const sheet = await createSheet({ label: "Voice note", wide: false });
  let prefs = readPrefs(storage);
  let id = newCaptureId();
  let photos = []; // { key, name, type, size, blob, preview, busy }
  let saving = null;
  let keepTimer = 0;
  let restoredAt = null;
  let held = false; // something of hers is kept in progress (so leaving an empty form makes nothing)
  let lastSaid = 0;
  let flushing = { total: 0, done: 0 };

  // ---- the page
  const heading = h("h2", { id: "studio-new-job-h", class: "studio-question", tabindex: "-1", text: "New job" });
  const status = h("p", { class: "studio-status", role: "status", "aria-live": "polite", tabindex: "-1" });
  const undoSlot = h("div", { class: "studio-notifications-undo" });
  const banners = h("div", { class: "studio-banner" });
  const problemBox = h("div", { class: "studio-banner", role: "alert", id: "studio-new-job-problem" });
  const waitingLink = h("p", { class: "studio-help" });
  const thumbs = h("auto-grid", { min: "5.5rem", class: "studio-thumbs", role: "list", "aria-label": "Photos in this job" });
  const camera = h("file-drop", { label: "Take a photo", look: "button", accept: "image/*", capture: "environment", multiple: false, "data-camera": "true" });
  const library = h("file-drop", { label: "Choose photos", look: "button", accept: "image/*", multiple: true, "data-library": "true" });
  const count = h("p", { class: "studio-help", "aria-live": "polite" });
  const notes = h("text-field", { label: "What did you do?", rows: 4, maxlength: limits.maxNotesChars, "data-notes": "true" });
  const notesCount = h("p", { class: "studio-help" });
  const voice = createVoiceNote({
    meta, here, noun, api, sheet, captureId: () => id, notes, maxNotes: limits.maxNotesChars,
    say, offerUndo, onChange: () => keepSoon(),
  });

  // Trade, service, town: a summary line once remembered, the fields on first use or Change.
  const trades = [...new Set([...(meta.job?.trades || []), prefs.trade].filter(Boolean))];
  const trade = h("select-field", { label: "Trade", options: [{ value: "", label: "Choose your trade" }, ...trades.map((t) => ({ value: t, label: tradeLabel(t) }))], value: siteTrade || prefs.trade, hidden: Boolean(siteTrade) });
  const serviceKnown = (value) => services.some((s) => s.id === value);
  const service = h("select-field", {
    label: "Service",
    options: [{ value: "", label: "Choose a service" }, ...services.map((s) => ({ value: s.id, label: s.title })), { value: OTHER, label: "Something else" }],
    value: serviceKnown(prefs.service) ? prefs.service : prefs.service ? OTHER : "",
  });
  const otherService = h("text-field", { label: "What service?", description: "Add it under Services later so it shows on your site.", value: serviceKnown(prefs.service) ? "" : serviceTitle(prefs.service), hidden: service.value !== OTHER });
  const town = h("text-field", { label: "Town", description: "Just the town, never the street. Customers see it.", value: prefs.towns[0] || "", autocomplete: "off" });
  const towns = h("div", { class: "studio-row", role: "group", "aria-label": "Recent towns" });
  const pickFields = h("div", { class: "studio-picks" }, trade, service, otherService, town, towns);
  const summary = h("p", { class: "studio-picks-summary" });
  const change = h("action-button", { variant: "link", onClick: () => openPicks(true) }, "Change");
  const picks = h("div", { class: "studio-picks-box" }, h("div", { class: "studio-row studio-picks-line" }, summary, change), pickFields);
  const cameraTrouble = h("details", { class: "studio-help" }, h("summary", { text: "Camera won't open?" }), h("p", { text: cameraHelp(here) }));
  const save = h("action-button", { size: "lg", class: "studio-primary", "aria-keyshortcuts": "Control+S Meta+S", "aria-describedby": "studio-new-job-problem", onClick: () => saveJob() }, "Save this job");

  const waitingHeading = h("h3", { id: "studio-waiting-h", tabindex: "-1", text: here.desktop ? "Waiting on this computer" : `Waiting on this ${noun}` });
  const waitingList = h("ul", { class: "studio-comment-list", "aria-labelledby": "studio-waiting-h" });
  const waitingBox = h("section", { class: "studio-section", "aria-labelledby": "studio-waiting-h", hidden: true }, waitingHeading, waitingList);
  const sentHeading = h("h3", { id: "studio-sent-h", text: "Sent this visit" });
  const sentList = h("ul", { class: "studio-sent-list", "aria-labelledby": "studio-sent-h" });
  const sentBox = h("section", { class: "studio-section", "aria-labelledby": "studio-sent-h", hidden: true }, sentHeading, sentList);
  const appHint = h("p", { class: "studio-help" });
  const details = h("div");

  const form = h("div", { class: "studio-account-main studio-new-job-form" },
    problemBox, thumbs,
    h("div", { class: "studio-new-job-photos" }, camera, library), count,
    voice.element, notes, notesCount, picks, cameraTrouble);
  const side = h("div", { class: "studio-account-side" }, waitingBox, sentBox, appHint, details);
  const columns = h("div", { class: "studio-account-columns" }, form, side);
  const bar = h("div", { class: "studio-write-bar studio-new-job-bar" }, save);
  const element = h("section", { class: "studio-page studio-new-job", "aria-labelledby": "studio-new-job-h" },
    h("breadcrumb-trail", { items: [{ label: "Home", href: "#/" }, { label: "New job", href: "" }] }),
    heading,
    h("p", { class: "studio-lede", text: `Take photos and say what you did. It's kept on this ${noun} until there's a signal, then goes to your blog as a draft.` }),
    status, undoSlot, banners, waitingLink, columns, bar);

  // ---- words and status
  function say(words) {
    status.textContent = words;
    lastSaid = Date.now();
  }
  function offerUndo(words, undo) {
    say(words);
    const button = h("action-button", { variant: "secondary", size: "sm", onClick: () => { undoSlot.replaceChildren(); undo(); notes.querySelector("textarea")?.focus(); } }, "Undo");
    undoSlot.replaceChildren(h("p", {}, h("span", { text: "Undo adding those words?" }), button));
    setTimeout(() => { if (undoSlot.contains(button)) undoSlot.replaceChildren(); }, 60_000);
  }

  // ---- photos
  function drawPhotos() {
    thumbs.replaceChildren(...photos.map((photo, index) => h("div", { class: "studio-thumb", role: "listitem", "data-photo": String(index + 1) },
      photo.busy ? h("skeleton-block", { shape: "card", label: `Getting photo ${index + 1} ready` }) : h("img", { src: photo.preview, alt: "", class: "studio-thumb-img" }),
      h("action-button", { variant: "ghost", size: "sm", class: "studio-thumb-remove", label: `Remove photo ${index + 1}`, onClick: () => removePhoto(index) }, "×"))));
    thumbs.hidden = photos.length === 0;
    count.textContent = `${photos.length} of ${limits.maxPhotos} photos`;
  }

  function removePhoto(index) {
    const [gone] = photos.splice(index, 1);
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    drawPhotos();
    say(`Removed photo ${index + 1}.`);
    keepSoon();
    requestAnimationFrame(() => (thumbs.querySelector(`[data-photo="${index + 1}"] button`) || camera.querySelector("input"))?.focus());
  }

  async function addFiles(files) {
    const problems = [];
    const over = [];
    const work = [];
    for (const file of files) {
      if (photos.length >= limits.maxPhotos) {
        over.push(file.name || "photo");
        continue;
      }
      const slot = { key: Math.random().toString(16).slice(2), name: file.name || "photo.jpg", busy: true };
      photos.push(slot);
      work.push(shrinkPhoto(file).then((ready) => {
        const problem = photoProblem(ready, limits);
        if (problem) {
          problems.push(PHOTO_WORDS(problem, { name: file.name, limits }));
          photos = photos.filter((photo) => photo !== slot);
          return;
        }
        Object.assign(slot, { name: ready.name || slot.name, type: ready.type || "image/jpeg", size: ready.size, blob: ready, preview: URL.createObjectURL(ready), busy: false });
      }));
    }
    drawPhotos();
    await Promise.all(work);
    drawPhotos();
    if (over.length) problems.push(tooManyWords(over, limits.maxPhotos));
    if (problems.length) showProblem(problems);
    else clearProblem();
    keepSoon();
  }
  for (const picker of [camera, library]) picker.addEventListener("fileschange", (event) => addFiles([...(event.detail || [])]));

  // ---- the picks
  function drawTowns() {
    towns.replaceChildren(...prefs.towns.slice(0, 5).map((name) => h("action-button", { variant: "link", label: `Use ${name}`, onClick: () => { town.value = name; keepSoon(); drawSummary(); town.querySelector("input")?.focus(); } }, name)));
    towns.hidden = prefs.towns.length === 0;
  }
  const serviceValue = () => (service.value === OTHER ? slug(otherService.value) : String(service.value || ""));
  const tradeValue = () => String(siteTrade || trade.value || "");
  function drawSummary() {
    const parts = [tradeLabel(tradeValue()), serviceValue() ? serviceTitle(serviceValue(), services) : "", String(town.value || "").trim()].filter(Boolean);
    summary.textContent = parts.join(" · ") || "No trade, service or town yet";
  }
  function openPicks(focus) {
    pickFields.hidden = false;
    change.hidden = true;
    if (focus) requestAnimationFrame(() => [...pickFields.querySelectorAll("select-field")].find((field) => !field.hidden)?.querySelector("select")?.focus());
  }
  service.addEventListener("valuechange", () => {
    otherService.hidden = service.value !== OTHER;
    if (service.value === OTHER) requestAnimationFrame(() => otherService.querySelector("input")?.focus());
    drawSummary();
    keepSoon();
  });
  for (const field of [trade, otherService, town, notes]) field.addEventListener("valuechange", () => { drawSummary(); drawCount(); keepSoon(); });
  function drawCount() {
    const length = String(notes.value || "").length;
    notesCount.textContent = length >= limits.maxNotesChars * 0.9 ? `${length.toLocaleString("en-US")} of ${limits.maxNotesChars.toLocaleString("en-US")} letters` : "";
  }

  // ---- problems
  function showProblem(lines) {
    problemBox.replaceChildren(h("alert-banner", { variant: "warning" }, ...[].concat(lines).map((line) => h("p", { text: line }))));
  }
  function clearProblem() {
    problemBox.replaceChildren();
  }

  // ---- the job she's in the middle of
  const read = () => ({
    id,
    fields: { trade: tradeValue(), service: serviceValue(), town: String(town.value || "").trim(), notes: String(notes.value || "") },
    photos: photos.filter((p) => !p.busy).map(({ name, type, size, blob }) => ({ name, type, size, blob })),
    audio: voice.note(),
  });
  const empty = (job) => !job.photos.length && !job.fields.notes.trim() && !job.audio;
  function keepSoon() {
    clearTimeout(keepTimer);
    keepTimer = setTimeout(keepNow, KEEP_MS);
  }
  async function keepNow() {
    clearTimeout(keepTimer);
    keepTimer = 0;
    const job = read();
    if (empty(job)) {
      if (held) await inProgress.clear(api.user);
      held = false;
    } else {
      held = await inProgress.keep(api.user, { ...job, left: voice.left(), open: !pickFields.hidden });
    }
  }

  async function restore() {
    const kept = await inProgress.get(api.user);
    if (!kept) return;
    held = true;
    id = kept.id;
    photos = (kept.photos || []).filter((p) => p?.blob instanceof Blob).map((p) => ({ ...p, key: Math.random().toString(16).slice(2), preview: URL.createObjectURL(p.blob), busy: false }));
    notes.value = kept.fields?.notes || "";
    if (kept.fields?.trade && !siteTrade) trade.value = kept.fields.trade;
    if (kept.fields?.service) {
      service.value = serviceKnown(kept.fields.service) ? kept.fields.service : OTHER;
      otherService.hidden = service.value !== OTHER;
      if (service.value === OTHER) otherService.value = serviceTitle(kept.fields.service);
    }
    town.value = kept.fields?.town || "";
    if (kept.open) openPicks(false);
    voice.set(kept.audio || null, { left: kept.left });
    restoredAt = kept.keptAt ? new Date(kept.keptAt) : new Date();
    drawPhotos();
    drawSummary();
    drawCount();
    const when = sayWhen(restoredAt.toISOString());
    say(`Picked up where you left off, ${/^(Today|Yesterday)/.test(when) ? when.charAt(0).toLowerCase() + when.slice(1) : when}.`);
    if (Date.now() - restoredAt.getTime() > DAY_MS) {
      banners.append(h("p", { class: "studio-help", "data-start-over": "true" }, "Kept from a while ago. ", h("action-button", { variant: "link", onClick: (event) => startOver(event.currentTarget) }, "Start over")));
    }
  }

  async function startOver(button) {
    const job = read();
    const what = [job.photos.length ? `${job.photos.length} photo${job.photos.length === 1 ? "" : "s"}` : "", job.fields.notes.trim() ? "words" : "", job.audio ? "voice note" : ""].filter(Boolean);
    const choice = await ask({ heading: "Throw away this unsaved job?", text: `Its ${what.join(" and ") || "picks"} go.`, choices: [{ label: "Keep it", value: "keep" }, { label: "Throw it away", value: "throw", variant: "destructive" }] });
    if (choice !== "throw") { button?.focus?.(); return; }
    await clearForm();
    banners.querySelector("[data-start-over]")?.remove();
    say("Started over.");
  }

  async function clearForm() {
    for (const photo of photos) if (photo.preview) URL.revokeObjectURL(photo.preview);
    photos = [];
    id = newCaptureId();
    notes.value = "";
    voice.reset();
    town.value = prefs.towns[0] || "";
    drawPhotos();
    drawSummary();
    drawCount();
    clearTimeout(keepTimer);
    if (held) await inProgress.clear(api.user);
    held = false;
  }

  // ---- Save this job
  function saveJob() {
    if (saving) return saving;
    saving = (async () => {
      save.loading = true;
      try {
        await voice.stop();
        const job = read();
        if (photos.some((p) => p.busy)) {
          say("A photo is still getting ready. Try again in a moment.");
          return false;
        }
        if (captureProblem(job, limits) === "empty") {
          showProblem("Add a photo, a voice note or a few words first.");
          camera.querySelector("input")?.focus();
          return false;
        }
        clearProblem();
        const kept = await jobs.add(job);
        if (!kept.ok && kept.code === "no-store") return sendStraightAway(job);
        if (!kept.ok) {
          const remove = kept.code === "maxCaptureBytes" ? photosToRemove(job.photos, job.audio?.size || 0, limits.maxCaptureBytes) : 1;
          showProblem(ROOM_WORDS(kept.quota ? "write" : kept.code, { limits, noun, queued: jobs.entries().length, remove }));
          if (kept.code === "maxQueued" && navigator.onLine !== false) problemBox.querySelector("alert-banner")?.append(h("action-button", { variant: "secondary", size: "sm", onClick: () => jobs.sendNow() }, "Send now"));
          return false;
        }
        prefs = rememberPicks(prefs, job.fields);
        writePrefs(storage, prefs);
        askToKeep();
        await clearForm();
        drawTowns();
        say(`Saved on this ${noun}.`);
        status.focus();
        return true;
      } finally {
        save.loading = false;
        saving = null;
      }
    })();
    return saving;
  }

  // A window that can't keep anything sends straight away, and keeps the form when that fails.
  async function sendStraightAway(job) {
    say("Sending…");
    try {
      const sent = await jobs.sendDirect(job);
      const title = captureTitle(job.fields, new Date(), services);
      prefs = rememberPicks(prefs, job.fields);
      writePrefs(storage, prefs);
      await clearForm();
      say(sentWords(title));
      toast(sentWords(title), { action: { label: "Finish it", href: `#/write/${encodeURIComponent(sent.path)}` } });
      return true;
    } catch {
      showProblem("It didn't send, and it's still here. Try again when there's a signal.");
      return false;
    }
  }

  function askToKeep() {
    try {
      if (storage?.getItem("studio:persist-asked")) return;
      storage?.setItem("studio:persist-asked", "1");
      navigator.storage?.persist?.().catch(() => {});
    } catch {
      // Asked or not, the job is kept.
    }
  }

  // ---- waiting on this phone
  const titleOf = (record) => captureTitle(record.fields, new Date(record.createdAt), services);
  const actions = {
    send: () => jobs.sendNow(),
    retry: (entry) => jobs.retry(entry.id),
    again: (entry) => jobs.sendAgain(entry.id),
    done: (entry) => jobs.done(entry.id),
    as: (entry) => jobs.sendAs(entry.id),
    reload: () => location.reload(),
    save: async (entry) => say(await savePhotos(entry.record, titleOf(entry.record), { here })),
    throwAway: async (entry) => {
      const name = entry.record ? titleOf(entry.record) : "this job";
      if (await throwAwayAsk(entry, name, { jobs, noun, onSave: actions.save })) {
        say("Thrown away.");
        waitingHeading.focus();
      }
    },
  };

  function drawWaiting() {
    const entries = jobs.entries();
    const focused = document.activeElement?.closest?.("[data-waiting]");
    const focusId = focused?.dataset.waiting;
    const focusStep = document.activeElement?.closest?.("[data-step]")?.dataset.step;
    waitingBox.hidden = entries.length === 0;
    waitingList.replaceChildren(...entries.map((entry) => waitingCard(entry, { jobs, title: entry.record ? titleOf(entry.record) : "", noun, here, limits, on: actions })));
    if (focusId) requestAnimationFrame(() => (waitingList.querySelector(`[data-waiting="${focusId}"] [data-step="${focusStep}"] button`) || waitingList.querySelector(`[data-waiting="${focusId}"] h4`) || waitingHeading)?.focus());
    waitingLink.replaceChildren(...(entries.length ? [`${waitingCount(entries.length, noun)}. `, h("a", { href: "#/new-job?focus=waiting", onClick: (event) => { event.preventDefault(); waitingHeading.focus(); waitingHeading.scrollIntoView({ block: "start" }); }, text: "See them" })] : []));
    const sent = jobs.sentThisVisit();
    sentBox.hidden = sent.length === 0;
    sentList.replaceChildren(...sent.map((item) => h("li", {}, h("span", { text: `${item.title}. ` }), h("a", { href: `#/write/${encodeURIComponent(item.path)}`, text: "Finish it" }))));
    appHint.textContent = entries.length === 0 && here.apple && here.standalone ? "Saved a job in Safari instead? It's waiting there: open your blog in Safari to send it." : "";
    drawBanners(entries.length);
    drawDetails(entries);
  }

  function drawBanners(waiting) {
    const nodes = [];
    if (jobs.unusable()) nodes.push(h("alert-banner", { variant: "warning", heading: "This window can't keep jobs for later" }, "Jobs send straight away instead, so save one where there's a signal. In a normal Safari window your blog can keep them."));
    if (here.inApp) {
      nodes.push(h("alert-banner", { variant: "warning" }, "This page is open inside another app, which may not keep your jobs. Open your blog in Safari. ",
        h("action-button", { variant: "secondary", size: "sm", onClick: () => navigator.clipboard?.writeText(location.href).then(() => say("Copied. Paste it into Safari."), () => say("Copy it from the address bar instead.")) }, "Copy the address")));
    }
    if (here.apple && !here.standalone && waiting) nodes.push(h("p", { class: "studio-help" }, h("a", { href: "#/notifications?sheet=home-screen", text: "Add your blog to your Home Screen so jobs waiting here are kept safe." })));
    if ((here.apple || here.android) && !navigator.serviceWorker?.controller) nodes.push(h("p", { class: "studio-help", text: "Open this before you go up. It keeps working when the signal drops." }));
    const start = banners.querySelector("[data-start-over]");
    banners.replaceChildren(...nodes, ...(start ? [start] : []));
  }

  async function drawDetails(entries) {
    const bytes = entries.reduce((sum, entry) => sum + (entry.record ? captureBytes(entry.record) : 0), 0);
    const estimate = await navigator.storage?.estimate?.().catch(() => null);
    const persisted = await navigator.storage?.persisted?.().catch(() => null);
    details.replaceChildren(detailsBox([
      `IndexedDB ${DB_NAME} v${DB_VERSION} / ${STORE_NAME}: ${entries.length} of ${limits.maxQueued} jobs, ${(bytes / 1048576).toFixed(1)} of ${Math.round(limits.maxQueueBytes / 1048576)} MB`,
      `in progress: IndexedDB studio-new-job v1 / open, key ${api.user || "(none)"}`,
      `storage.persist(): ${persisted === null || persisted === undefined ? "unknown" : persisted ? "granted" : "not granted"}${estimate ? `; estimate ${(estimate.usage / 1048576).toFixed(1)} of ${(estimate.quota / 1048576).toFixed(0)} MB` : ""}`,
      `Web Locks ${navigator.locks ? "yes" : "no"}; BroadcastChannel ${typeof BroadcastChannel === "function" ? "yes" : "no"}; ${here.standalone ? "Home Screen app" : "browser tab"}`,
      "Safari may clear site data after 7 days without a visit; the Home Screen app is exempt; Safari and the Home Screen app don't share storage.",
      "Old Admin windows opened before this update use the same list; sending from both makes one draft (ADR 0297).",
      `limits: ${Object.entries(meta.capture || {}).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    ]));
  }

  // Sending, said in the status line at most every 2 s.
  const unsubscribe = jobs.subscribe((event) => {
    if (!element.isConnected) return;
    if (event.type === "flush") flushing = { total: event.total, done: 0 };
    if (event.type === "sent") flushing.done += 1;
    if (event.type === "step") {
      const card = waitingList.querySelector(`[data-waiting="${event.id}"] p:not(.studio-help)`);
      if (card) card.textContent = stepWords(event.step);
      if (Date.now() - lastSaid > 2000 && flushing.total) say(flushWords({ total: flushing.total, done: flushing.done }));
      return;
    }
    if (event.type === "flushed" && flushing.total) {
      const waiting = jobs.entries().filter((entry) => ["waiting", "tried"].includes(jobs.stateOf(entry))).length;
      const words = flushWords({ sent: event.sent, blocked: event.blocked, waiting });
      if (words) say(words);
      flushing = { total: 0, done: 0 };
    }
    drawWaiting();
  });

  // ---- not a trade site
  function notForJobs() {
    columns.replaceChildren(h("empty-state", { heading: "Your blog isn't set up for jobs" },
      "This is for posting work from a job site, like a new roof. To write a recipe or a story, start here.",
      h("action-button", { slot: "actions", href: "#/write" }, "Write something new"),
      detailsBox(["New job appears when meta.siteUses.trade is true."])));
    bar.hidden = true;
  }

  async function load() {
    if (!jobs.available()) await jobs.start({ create: false });
    if (!tradeSite(meta)) {
      if (!jobs.entries().length) {
        notForJobs();
        return;
      }
      form.hidden = true;
      bar.hidden = true;
    }
    drawTowns();
    drawSummary();
    if (prefs.trade || prefs.service || prefs.towns.length) pickFields.hidden = true;
    else openPicks(false);
    change.hidden = !pickFields.hidden;
    drawPhotos();
    await restore();
    drawWaiting();
    jobs.watch(true);
    if (route.query?.focus === "waiting" && jobs.entries().length) requestAnimationFrame(() => waitingHeading.focus());
  }

  return {
    title: "New job",
    element,
    load,
    keys: ["save"],
    isDirty: () => Boolean(saving),
    async leave() {
      // Nothing to ask: what she has is kept on this phone as she goes. A save running finishes first.
      if (saving) await saving;
      await voice.stop({ left: true });
      await keepNow();
      jobs.watch(false);
      unsubscribe();
      voice.destroy();
      sheet.close();
      return true;
    },
    focus: () => (route.query?.focus === "waiting" && jobs.entries().length ? waitingHeading : heading).focus(),
    get palette() {
      return [
        { id: "save", label: "Save this job", group: "This job" },
        ...(jobs.entries().length ? [{ id: "send-jobs", label: "Send waiting jobs now", group: "This job" }] : []),
      ];
    },
    command(name) {
      if (name === "save") saveJob();
      if (name === "send-jobs") jobs.sendNow();
    },
  };
}

function safeStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
