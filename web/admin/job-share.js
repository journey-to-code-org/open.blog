// The Share this job screen (story #488, ADRs 0393 to 0396): one finished job for Google Business
// Profile, a Facebook Page and Nextdoor. For each place it shows exactly what would go (the words,
// the link, the photo), anything to fix, and where it stands. A Facebook Page that is connected
// under Connected accounts is posted to through the announcements (SP5); everything else is posted
// by hand from here: copy the words, save the photo, open the place, then say it is done. Sending
// to Google needs Google's approval and runs from the command (ADR 0393), so this screen never
// sends to Google. Designed at 400px first: one column, 44px targets, every state said in words.
//
// The pure functions at the top are the contract and are tested without a page.

import { el } from "./block-forms.js";
import { DELIVERY_BADGES, deliveryOf, newKey } from "./announcements.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-08T12:00:00Z" as "Nov 8, 2026". */
export function dayText(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  return match ? `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}` : "";
}

const RECORD_WORDS = Object.freeze({
  "kit-made": (on) => `A by-hand kit was made${on}. Post it yourself, then say so here.`,
  posted: (on) => `Posted${on}.`,
  unknown: (on) => `May have been posted${on}. Look on the place first; it will not be sent again until that is settled on your computer.`,
  "not-posted": (on) => `Not posted${on}. You can try again.`,
  "posted-by-hand": (on) => `You posted it by hand${on}.`,
});

/**
 * Where one place stands, in words, from the private record (and, for a Facebook Page, its
 * announcement). A Page post that failed or was canceled gives way to her own "I posted it" mark,
 * since that mark is what keeps Post to <Page> from being offered again (ADR 0397).
 */
export function standingText(destination, announcement = null) {
  const byHand = destination?.record?.status === "posted-by-hand";
  if (announcement && !(byHand && pageOpen(announcement))) {
    const state = deliveryOf(announcement);
    const badge = DELIVERY_BADGES[state]?.text || "Needs checking";
    return `On your Facebook Page: ${badge}.`;
  }
  const record = destination?.record;
  if (!record) return "Not shared yet.";
  const on = dayText(record.at) ? ` on ${dayText(record.at)}` : "";
  const words = (RECORD_WORDS[record.status] || (() => "Not shared yet."))(on);
  return destination.changedSince ? `${words} The job has changed since.` : words;
}

/** The newest announcement of this job on a Facebook Page, or null. */
export function facebookAnnouncement(announcements, work) {
  const mine = (Array.isArray(announcements) ? announcements : [])
    .filter((item) => item?.work === work && item?.destination?.provider === "facebook")
    .sort((a, b) => String(b.createdAt || b.scheduledFor || "").localeCompare(String(a.createdAt || a.scheduledFor || "")));
  return mine[0] || null;
}

/**
 * How the owner gets this place done: `facebook-page` when open.blog can post it through her
 * connected Page, otherwise `by-hand`. Google is never sent from here.
 */
export function wayFor(destination, { pages = [], announcements = false } = {}) {
  if (destination?.destination === "facebook" && destination.route === "adapter" && announcements && pages.length) return "facebook-page";
  return "by-hand";
}

/**
 * Whether the job may be scheduled on the Facebook Page again: only when it has no announcement
 * there, or its newest one failed or was canceled. A scheduled, sending, published or unsettled
 * one is never doubled, even from a screen opened later with a new key (ADR 0397). A job she
 * said she posted by hand is not offered either.
 */
export function pageOpen(announcement) {
  if (!announcement) return true;
  const state = deliveryOf(announcement);
  return state === "failed" || state === "canceled";
}

/** The time a Facebook announcement is scheduled for: five minutes from now, as a UTC instant. */
export function soon(now = Date.now()) {
  return new Date(now + 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** An error from the share routes, in words. */
export function shareErrorText(error) {
  const message = error?.data?.error || error?.message || "";
  return message || "Something went wrong. Try again.";
}

let uid = 0;

export function createJobShare({ api, path, clipboard = globalThis.navigator?.clipboard, now = () => Date.now(), random = newKey }) {
  const id = `oba-job-share-${++uid}`;
  let data = null;
  let pages = [];
  let queue = [];
  let busy = false;
  let destroyed = false;
  // One key per job and words, so pressing the button twice schedules the post once.
  const keys = new Map();

  const root = el("div", { class: "oba-seasonal oba-job-share", "data-job-share": "true" });
  const status = el("p", { class: "oba-small", role: "status", "aria-live": "polite", "data-job-share-status": "true" });
  const body = el("div", { class: "oba-seasonal-body" });

  const say = (message, kind = "small") => {
    status.className = kind === "error" ? "oba-error" : kind === "ok" ? "oba-ok" : "oba-small";
    status.setAttribute("role", kind === "error" ? "alert" : "status");
    status.textContent = message;
  };

  const run = async (work) => {
    if (busy) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    try {
      await work();
    } catch (error) {
      if (error?.status === 401) throw error;
      if (!destroyed) say(shareErrorText(error), "error");
    } finally {
      busy = false;
      root.removeAttribute("aria-busy");
    }
  };

  async function copy(text, label) {
    try {
      await clipboard.writeText(text);
      say(`The words for ${label} are copied. Paste them in.`, "ok");
    } catch {
      say("Copying did not work here. Press and hold the words to select and copy them.", "error");
    }
  }

  async function markPosted(destination) {
    say("Saving…");
    const result = await api.call("POST", "job-share/by-hand", { json: { path: data.path, destination: destination.destination, digest: destination.digest } });
    if (destroyed) return;
    destination.record = result.record;
    destination.changedSince = false;
    render();
    say(`Noted: you posted it on ${destination.label}.`, "ok");
  }

  async function postToPage(destination, photoApproval = null) {
    const page = pages[0];
    const signature = `${data.work}\n${destination.digest}\n${photoApproval?.approvalDigest || ""}`;
    if (!keys.has(signature)) keys.set(signature, { key: random(), scheduledFor: soon(now()) });
    say("Scheduling it on your Facebook Page…");
    const request = keys.get(signature);
    const common = { accountId: page.id, scheduledFor: request.scheduledFor, idempotencyKey: request.key };
    const answer = photoApproval
      ? await api.call("POST", "social/job-photo-schedule", { json: { ...common, path: data.path, digest: destination.digest, ...photoApproval } })
      : await api.call("POST", "social/announcements", { json: { ...common, work: data.work, caption: destination.text } });
    if (destroyed) return;
    await loadQueue();
    render();
    say(`${answer?.replayed ? "Already scheduled" : "Scheduled"}: it goes to ${page.displayName} on Facebook in about five minutes. Its progress shows here and under Announcements.`, "ok");
  }

  const problems = (destination) => {
    const blocking = destination.problems.filter((problem) => problem.blocking);
    const advice = destination.problems.filter((problem) => !problem.blocking);
    return [
      blocking.length ? el("div", { class: "oba-error", "data-job-share-fix": destination.destination }, el("p", {}, el("strong", {}, "Fix this first")), el("ul", {}, ...blocking.map((problem) => el("li", {}, problem.message)))) : null,
      advice.length ? el("div", { class: "oba-help" }, el("p", {}, el("strong", {}, "Good to know")), el("ul", {}, ...advice.map((problem) => el("li", {}, problem.message)))) : null,
    ];
  };

  const photo = (destination) => {
    if (destination.photo) {
      return el("div", {},
        el("img", { src: destination.photo.sitePath, alt: "The finished job", width: destination.photo.width, height: destination.photo.height }),
        el("p", {}, el("a", { class: "oba-btn", href: destination.photo.sitePath, download: destination.photo.fileName, "data-action": "job-share-photo" }, "Save the photo")),
      );
    }
    const held = destination.problems.some((problem) => problem.code === "photo-location");
    return el("p", { class: "oba-small", "data-job-share-no-photo": destination.destination }, held ? "The photo is left out until it is replaced with a copy that does not hold where it was taken." : "No photo goes with this one.");
  };

  const card = (destination) => {
    const ready = destination.ready;
    const announcement = destination.destination === "facebook" ? facebookAnnouncement(queue, data.work) : null;
    const way = wayFor(destination, { pages, announcements: data.announcements });
    const actions = [];
    let photoConsent = null;
    if (ready && way === "facebook-page" && pageOpen(announcement) && destination.record?.status !== "posted-by-hand") {
      if (destination.photo) {
        let approval = null;
        let ticket = 0;
        const description = el("input", { id: `${id}-facebook-alt`, type: "text", maxlength: "1500", "data-job-photo-alt": "true" });
        const accept = el("input", { id: `${id}-facebook-accept`, type: "checkbox", disabled: true });
        const result = el("div", { "data-job-photo-preview": "true" });
        const post = el("button", { class: "oba-btn oba-btn-primary", type: "button", disabled: true, "data-action": "job-share-facebook", onClick: () => run(() => postToPage(destination, approval)) }, `Post to ${pages[0].displayName}`);
        const clear = () => {
          ticket += 1;
          approval = null;
          accept.checked = false;
          accept.disabled = true;
          post.disabled = true;
          result.replaceChildren();
        };
        description.addEventListener("input", clear);
        accept.addEventListener("change", () => { post.disabled = !accept.checked || !approval; });
        const preview = el("button", { class: "oba-btn", type: "button", onClick: () => run(async () => {
          clear();
          const current = ticket;
          const text = description.value.trim();
          if (!text) throw new Error("Describe the photo before previewing it.");
          say("Checking the photo...");
          const answer = await api.call("POST", "social/job-photo-preview", { json: { path: data.path, digest: destination.digest, description: text } });
          if (destroyed || current !== ticket) return;
          approval = { approvalDigest: answer.approvalDigest, description: text };
          result.replaceChildren(el("img", { src: answer.imageDataUrl, alt: text }), el("p", {}, text));
          accept.disabled = false;
          say("Check the photo and description before approving them.");
        }) }, "Preview photo for Facebook");
        photoConsent = el("div", { class: "oba-field" },
          el("label", { for: description.id }, "Photo description for Facebook"),
          description,
          el("p", { class: "oba-small" }, "This description is sent as alt text. If the photo cannot be uploaded, nothing is posted."),
          preview, result,
          el("div", { class: "oba-announce-choice" }, accept, el("label", { for: accept.id }, "Approve this photo and description")));
        actions.push(post);
      } else {
        actions.push(el("button", { class: "oba-btn oba-btn-primary", type: "button", "data-action": "job-share-facebook", onClick: () => run(() => postToPage(destination)) }, `Post to ${pages[0].displayName}`));
      }
    }
    if (ready) {
      actions.push(
        el("button", { class: "oba-btn", type: "button", "data-action": "job-share-copy", onClick: () => copy(destination.text, destination.label) }, "Copy the words"),
        el("a", { class: "oba-btn", href: destination.openUrl, target: "_blank", rel: "noopener noreferrer", "data-action": "job-share-open" }, `Open ${destination.label}`),
        el("button", { class: "oba-btn", type: "button", "data-action": "job-share-done", onClick: () => run(() => markPosted(destination)) }, "I posted it"),
      );
    }
    const note = destination.destination === "google-business-profile"
      ? el("p", { class: "oba-help" }, data.googleSending
        ? "Sending to Google from open.blog is turned on, and it runs from your computer (see the guide on sharing a job). Or post it by hand here."
        : "open.blog can send to Google only after Google approves it, so for now post it by hand: copy the words, add a Learn more button with the link, and add the photo.")
      : destination.destination === "facebook" && way !== "facebook-page"
        ? el("p", { class: "oba-help" }, destination.route === "adapter"
          ? "Connect your Facebook Page under Connected accounts and open.blog can post it for you. Until then, post it by hand."
          : "open.blog posts to a Facebook Page without a photo, so a job with one is posted by hand.")
        : null;
    return el("li", { class: "oba-seasonal-card", "data-destination": destination.destination, "data-ready": ready ? "true" : "false" },
      el("h3", {}, destination.label),
      el("p", { "data-job-share-standing": destination.destination }, standingText(destination, announcement)),
      ...problems(destination),
      note,
      el("p", { class: "oba-small" }, "The words:"),
      el("pre", { tabindex: "0", "aria-label": `Words for ${destination.label}`, "data-job-share-words": destination.destination }, destination.text),
      destination.destination === "google-business-profile" ? el("p", { class: "oba-small" }, `Learn more link: ${destination.link}`) : null,
      photo(destination),
      photoConsent,
      el("div", { class: "oba-seasonal-actions" }, ...actions),
    );
  };

  function render() {
    if (!data) return;
    body.replaceChildren(
      el("h2", { id: `${id}-title` }, `Share "${data.title}"`),
      el("p", {}, "Nothing is posted until you choose to. Each place gets the same job: one line about the work, the service and town, the first after photo and a link to the job's page."),
      el("ul", { class: "oba-seasonal-list", "aria-labelledby": `${id}-title`, "data-job-share-places": "true" }, ...data.destinations.map(card)),
    );
  }

  async function loadQueue() {
    if (!data?.announcements) return;
    try {
      const [destinations, list] = await Promise.all([
        api.call("GET", "social/destinations"),
        api.call("GET", `social/announcements?work=${encodeURIComponent(data.work)}`),
      ]);
      pages = (destinations.destinations || []).filter((item) => item.provider === "facebook");
      queue = list.announcements || [];
    } catch (error) {
      if (error?.status === 401) throw error;
      // Without the announcements a Facebook Page is posted by hand, as when none is connected.
      pages = [];
      queue = [];
    }
  }

  async function load() {
    root.setAttribute("aria-busy", "true");
    try {
      data = await api.call("GET", `job-share?path=${encodeURIComponent(path)}`);
      if (destroyed) return;
      await loadQueue();
      if (!destroyed) render();
    } catch (error) {
      if (error?.status === 401) throw error;
      if (!destroyed) say(shareErrorText(error), "error");
    } finally {
      root.removeAttribute("aria-busy");
    }
  }

  root.append(status, body);

  return {
    element: root,
    load,
    isDirty: () => false,
    isBusy: () => busy,
    destroy: () => {
      destroyed = true;
    },
  };
}
