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
import { queueLimits } from "../parts/capture-queue.js";
import { captureLimits, captureProblem, captureTitle, newCaptureId, photoBytesLines, photoProblem, photosToRemove, readPrefs, rememberPicks, writePrefs } from "../parts/new-job-rules.js";
import { PHOTO_WORDS, ROOM_WORDS, cameraHelp, flushWords, sentWords, tooManyWords } from "../parts/job-words.js";
import { shrinkPhoto } from "../parts/photo-shrink.js";
import { createJobInProgress } from "../parts/job-in-progress.js";
import { createVoiceNote } from "../parts/new-job-voice.js";
import { createWaitingSide } from "../parts/waiting-side.js";
import { createPicks } from "../parts/new-job-picks.js";
import { stepWords } from "../parts/job-sender.js";

const KEEP_MS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function createNewJob(context, route = { query: {} }) {
  const { api, meta = {}, jobs } = context;
  const toast = context.toast || defaultToast;
  await use("breadcrumb-trail", "action-button", "file-drop", "auto-grid", "text-field", "select-field", "status-badge", "alert-banner", "empty-state", "dropdown-menu", "side-sheet", "modal-dialog", "skeleton-block");
  const here = herePhone({ navigator, window: globalThis });
  const noun = deviceNoun(here);
  const limits = { ...captureLimits(meta), ...queueLimits(meta) };
  const services = Array.isArray(meta.job?.services) ? meta.job.services.filter((s) => s && typeof s.id === "string") : [];
  const storage = safeStorage();
  const inProgress = createJobInProgress();
  const sheet = await createSheet({ label: "Voice note", wide: false });
  let prefs = readPrefs(storage);
  let id = newCaptureId();
  let photos = []; // { key, name, type, size, blob, preview, busy, originalSize, originalType }
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
  const thumbs = h("auto-grid", { min: "5.5rem", class: "studio-thumbs", role: "list", "aria-label": "Photos in this job" });
  const camera = h("file-drop", { label: "Take a photo", look: "button", accept: "image/*", capture: "environment", multiple: false, "data-camera": "true" });
  const library = h("file-drop", { label: "Choose photos", look: "button", accept: "image/*", multiple: true, "data-library": "true" });
  const count = h("p", { class: "studio-help", "aria-live": "polite" });
  const photoDetails = h("div", { "data-photo-details": "true" }); // Mikey's: original vs kept bytes
  const notes = h("text-field", { label: "What did you do?", rows: 4, maxlength: limits.maxNotesChars, "data-notes": "true" });
  const notesCount = h("p", { class: "studio-help" });
  const voice = createVoiceNote({
    meta, here, noun, api, sheet, captureId: () => id, notes, maxNotes: limits.maxNotesChars,
    say, offerUndo, onChange: () => keepSoon(),
  });

  // Trade, service, town (parts/new-job-picks.js).
  const picks = createPicks({ meta, services, prefs: () => prefs, onChange: () => keepSoon() });
  const cameraTrouble = h("details", { class: "studio-help" }, h("summary", { text: "Camera won't open?" }), h("p", { text: cameraHelp(here) }));
  const save = h("action-button", { size: "lg", class: "studio-primary", "aria-keyshortcuts": "Control+S Meta+S", "aria-describedby": "studio-new-job-problem", onClick: () => saveJob() }, "Save this job");

  const side = createWaitingSide({ jobs, meta, api, here, noun, limits, services, say });

  const form = h("div", { class: "studio-account-main studio-new-job-form" },
    problemBox, thumbs,
    h("div", { class: "studio-new-job-photos" }, camera, library), count, photoDetails,
    voice.element, notes, notesCount, picks.element, cameraTrouble);
  const columns = h("div", { class: "studio-account-columns" }, form, side.element);
  const bar = h("div", { class: "studio-write-bar studio-new-job-bar" }, save);
  const element = h("section", { class: "studio-page studio-new-job", "aria-labelledby": "studio-new-job-h" },
    h("breadcrumb-trail", { items: [{ label: "Home", href: "#/" }, { label: "New job", href: "" }] }),
    heading,
    h("p", { class: "studio-lede", text: `Take photos and say what you did. It's kept on this ${noun} until there's a signal, then goes to your blog as a draft.` }),
    status, undoSlot, banners, side.link, columns, bar);

  // ---- words and status
  function say(words) {
    status.textContent = words;
    lastSaid = Date.now();
  }
  // One Undo at a time, inline under the status. Removing a photo offers it until her next action;
  // any change to the job (keepSoon) ends it.
  let undoPhoto = null; // { photo, index } while removing it can be undone
  function clearUndo() {
    if (undoPhoto && !photos.includes(undoPhoto.photo) && undoPhoto.photo.preview) URL.revokeObjectURL(undoPhoto.photo.preview);
    undoPhoto = null;
    undoSlot.replaceChildren();
  }
  function offerUndo(words, undo) {
    clearUndo();
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
    const open = Boolean(photoDetails.querySelector("details")?.open);
    photoDetails.replaceChildren(...(photos.length ? [detailsBox(photoBytesLines(photos))] : []));
    if (open && photos.length) photoDetails.querySelector("details").open = true;
  }

  function removePhoto(index) {
    const [gone] = photos.splice(index, 1);
    drawPhotos();
    keepSoon();
    say(`Removed photo ${index + 1}.`);
    if (gone) {
      // Kept (with its preview) until the Undo goes.
      undoPhoto = { photo: gone, index };
      const button = h("action-button", { variant: "secondary", size: "sm", label: `Undo removing photo ${index + 1}`, onClick: () => putBack() }, "Undo");
      undoSlot.replaceChildren(h("p", {}, h("span", { text: `Removed photo ${index + 1}. ` }), button));
    }
    requestAnimationFrame(() => (thumbs.querySelector(`[data-photo="${index + 1}"] button`) || camera.querySelector("input"))?.focus());
  }

  function putBack() {
    if (!undoPhoto) return;
    const { photo, index } = undoPhoto;
    undoPhoto = null;
    undoSlot.replaceChildren();
    photos.splice(Math.min(index, photos.length), 0, photo);
    drawPhotos();
    keepSoon();
    say(`Photo ${index + 1} is back.`);
    requestAnimationFrame(() => thumbs.querySelector(`[data-photo="${index + 1}"] button`)?.focus());
  }

  async function addFiles(files) {
    clearUndo();
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
        Object.assign(slot, { name: ready.name || slot.name, type: ready.type || "image/jpeg", size: ready.size, blob: ready, preview: URL.createObjectURL(ready), busy: false, originalSize: file.size, originalType: file.type || "" });
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

  notes.addEventListener("valuechange", () => { drawCount(); keepSoon(); });
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
    fields: { ...picks.values(), notes: String(notes.value || "") },
    // The original's size and type stay with the job in progress (for Details); the record kept on
    // this phone takes only name, type, size and blob (makeRecord).
    photos: photos.filter((p) => !p.busy).map(({ name, type, size, blob, originalSize, originalType }) => ({ name, type, size, blob, originalSize, originalType })),
    audio: voice.note(),
  });
  const empty = (job) => !job.photos.length && !job.fields.notes.trim() && !job.audio;
  function keepSoon() {
    clearUndo();
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
      held = await inProgress.keep(api.user, { ...job, left: voice.left(), open: picks.isOpen() });
    }
  }

  async function restore() {
    const kept = await inProgress.get(api.user);
    if (!kept) return;
    held = true;
    id = kept.id;
    photos = (kept.photos || []).filter((p) => p?.blob instanceof Blob).map((p) => ({ ...p, key: Math.random().toString(16).slice(2), preview: URL.createObjectURL(p.blob), busy: false }));
    notes.value = kept.fields?.notes || "";
    picks.set(kept.fields || {});
    if (kept.open) picks.open(false);
    voice.set(kept.audio || null, { left: kept.left });
    restoredAt = kept.keptAt ? new Date(kept.keptAt) : new Date();
    drawPhotos();
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
    clearUndo();
    for (const photo of photos) if (photo.preview) URL.revokeObjectURL(photo.preview);
    photos = [];
    id = newCaptureId();
    notes.value = "";
    voice.reset();
    picks.reset();
    drawPhotos();
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

  // ---- waiting on this phone (parts/waiting-side.js), and what's said above it
  function drawWaiting() {
    side.draw();
    drawBanners(jobs.entries().length);
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

  // Sending, said in the status line at most every 2 s.
  const unsubscribe = jobs.subscribe((event) => {
    if (!element.isConnected) return;
    if (event.type === "flush") flushing = { total: event.total, done: 0 };
    if (event.type === "sent") flushing.done += 1;
    if (event.type === "step") {
      const card = side.list.querySelector(`[data-waiting="${event.id}"] p:not(.studio-help)`);
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
    drawPhotos();
    await restore();
    drawWaiting();
    jobs.watch(true);
    if (route.query?.focus === "waiting" && jobs.entries().length) requestAnimationFrame(() => side.heading.focus());
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
    focus: () => (route.query?.focus === "waiting" && jobs.entries().length ? side.heading : heading).focus(),
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
