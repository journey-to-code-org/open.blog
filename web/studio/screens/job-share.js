// Share this job (#/sharing/job/<path>, R1): "Where should customers see this job?" One finished job
// for Google Business Profile, a Facebook Page and Nextdoor. Each place shows exactly what would go
// (the words, the photo), anything to fix first, and where it stands. A connected Facebook Page is
// posted to through her shares; everything else she posts herself: copy the words, open the place,
// then say "I posted it" (with Undo, G17). Google is never sent from here. The job's words are only
// ever text. docs/specs/studio/r1/ux.md; old Admin's web/admin/job-share.js.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { facebookAnnouncement, jobShareTrouble, keyFor, newKey, pageOpen, problemWords, soon, standing, standingText, wayFor } from "../parts/job-share-rules.js";

export async function createJobShare({ api, go }, path, route = { query: {} }) {
  await use("action-button", "alert-banner", "skeleton-block", "status-badge");
  let data = null;
  let pages = [];
  let queue = [];
  const keys = new Map(); // one key per job and words, so pressing twice schedules once
  const fromWrite = route.query?.from === "write";

  const heading = h("h2", { id: "studio-job-share-h", class: "studio-question", tabindex: "-1", text: "Share this job" });
  const lede = h("p", { class: "studio-lede", text: "Post it where customers look." });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const undoSlot = h("div", { class: "studio-banner" });
  const banner = h("div", { class: "studio-banner" });
  const list = h("ul", { class: "studio-comment-list", "aria-labelledby": "studio-job-share-h", "aria-busy": "true" }, h("li", {}, h("skeleton-block", { shape: "card" })));
  const details = h("details", { class: "studio-help" });
  const back = h("a", { class: "studio-more-link", href: fromWrite ? `#/write/${encodeURIComponent(path)}` : "#/sharing", text: fromWrite ? "Back to Write" : "Back to Sharing" });
  const element = h("section", { class: "studio-page studio-job-share", "aria-labelledby": "studio-job-share-h" },
    back, h("div", { class: "studio-today" }, heading, lede), undoSlot, banner, status, list, details);

  const say = (words) => { status.textContent = words; };

  async function loadQueue() {
    pages = [];
    queue = [];
    if (!data?.announcements) return;
    try {
      const destinations = await api.get("social/destinations");
      const listed = await api.get(`social/announcements?work=${encodeURIComponent(data.work)}`);
      pages = (destinations.destinations || []).filter((d) => d.provider === "facebook");
      queue = listed.announcements || [];
    } catch (error) {
      if (error.status === 401) throw error;
      // Without her shares a Facebook Page is posted by hand, as when none is connected.
    }
  }

  async function load() {
    list.setAttribute("aria-busy", "true");
    try {
      data = await api.get(`job-share?path=${encodeURIComponent(path)}`);
      await loadQueue();
      banner.replaceChildren();
      draw();
    } catch (error) {
      if (error.status === 401) throw error;
      list.removeAttribute("aria-busy");
      list.replaceChildren();
      banner.replaceChildren(h("alert-banner", { variant: error.status === 422 ? "info" : "danger", heading: error.status === 422 ? "Nothing to share" : "This job didn't open" },
        jobShareTrouble(error), " ",
        error.status === 422 ? h("a", { href: `#/write/${encodeURIComponent(path)}` }, "Open it in Write")
          : h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again")));
      drawDetails(error);
    }
  }

  function draw() {
    list.removeAttribute("aria-busy");
    lede.textContent = `${data.title || "This job"}. Post it where customers look.`;
    const places = data.destinations || [];
    const firstOpen = places.find((d) => !standing(d, announcementFor(d)).done);
    list.replaceChildren(...places.map((d) => card(d, d === firstOpen)));
    drawDetails();
  }

  const announcementFor = (d) => (d.destination === "facebook" ? facebookAnnouncement(queue, data.work) : null);

  function card(d, first) {
    const announcement = announcementFor(d);
    const now = standing(d, announcement);
    const way = wayFor(d, { pages, announcements: data.announcements });
    const line = standingText(d, announcement);
    const blocking = (d.problems || []).filter((p) => p.blocking);
    const wordsId = `studio-job-words-${d.destination}`;
    const words = h("div", { class: "studio-share-caption studio-job-words", id: wordsId, role: "region", tabindex: "0", "aria-label": `Words for ${d.label}`, text: d.text || "" });
    const buttons = [];
    let primaryUsed = !first;
    const variant = () => (primaryUsed ? "secondary" : ((primaryUsed = true), "primary"));
    if (!blocking.length && d.ready) {
      if (way === "facebook-page" && pageOpen(announcement) && d.record?.status !== "posted-by-hand") {
        buttons.push(h("action-button", { variant: variant(), onClick: (e) => postToPage(d, e.currentTarget) }, `Post to ${pages[0].displayName}`));
      }
      if (!now.done) {
        buttons.push(h("action-button", { variant: variant(), label: `Copy the words for ${d.label}`, onClick: () => copy(d, words) }, "Copy the words"));
        if (d.openUrl) buttons.push(h("action-button", { variant: "secondary", href: d.openUrl, target: "_blank", label: `Open ${d.label} (opens a new tab)` }, `Open ${d.label}`));
        buttons.push(h("action-button", { variant: "secondary", label: `I posted it on ${d.label}`, onClick: (e) => markPosted(d, e.currentTarget) }, "I posted it"));
      }
    }
    const notes = [];
    if (d.destination === "google-business-profile") {
      notes.push(data.googleSending ? "Your site sends this to Google." : "Add a Learn more button with the link, and the photo.");
    }
    return h("li", { class: "studio-comment", "data-destination": d.destination },
      h("div", { class: "studio-comment-head" },
        h("h3", { class: "studio-comment-who", tabindex: "-1", text: d.label }),
        h("status-badge", { variant: now.variant }, now.text)),
      line ? h("p", { class: "studio-help", text: line }) : null,
      blocking.length ? h("div", { class: "studio-job-fix" },
        h("p", { class: "studio-comment-trouble", text: "Fix this first" }),
        h("ul", {}, ...[...new Set(blocking.map((p) => problemWords(p.code)))].map((t) => h("li", { text: t }))),
        h("action-button", { variant: "secondary", href: `#/write/${encodeURIComponent(data.path)}` }, "Fix it in Write")) : null,
      ...notes.map((t) => h("p", { class: "studio-help", text: t })),
      words,
      d.photo ? h("div", { class: "studio-quote-photos" },
        h("img", { src: d.photo.sitePath, alt: "The finished job", width: 96, height: 96, class: "studio-job-photo" }),
        h("a", { href: d.photo.sitePath, download: d.photo.fileName || "", text: "Save the photo" })) : null,
      h("p", { class: "studio-comment-trouble", role: "alert", hidden: true, "data-problem": d.destination }),
      buttons.length ? h("div", { class: "studio-comment-actions" }, ...buttons) : null);
  }

  async function copy(d, words) {
    try {
      await navigator.clipboard.writeText(d.text || "");
      say(`Copied. Paste them into ${d.label}.`);
    } catch {
      getSelection()?.selectAllChildren(words);
      words.focus();
      say("Select the words and copy them.");
    }
  }

  function cardProblem(d, words) {
    const box = list.querySelector(`[data-problem="${d.destination}"]`);
    if (box) { box.textContent = words; box.hidden = false; }
    else say(words);
  }

  async function postToPage(d, button) {
    if (button.loading) return;
    const page = pages[0];
    const signature = keyFor(data.work, d.digest);
    if (!keys.has(signature)) keys.set(signature, newKey());
    button.loading = true;
    try {
      await api.post("social/announcements", { accountId: page.id, work: data.work, caption: d.text, scheduledFor: soon(), idempotencyKey: keys.get(signature) });
      await loadQueue();
      draw();
      const words = `On its way to ${page.displayName} in about 5 minutes.`;
      say(words);
      toast(words);
      focusCard(d);
    } catch (error) {
      if (error.status === 401) throw error;
      button.loading = false;
      cardProblem(d, error.data?.code === "idempotency-conflict" || !error.status || error.status >= 502
        ? "Studio didn't hear back. Look under Sharing in a minute before posting again."
        : jobShareTrouble(error, d.label));
      drawDetails(error);
    }
  }

  async function markPosted(d, button) {
    if (button.loading) return;
    button.loading = true;
    try {
      await api.post("job-share/by-hand", { path: data.path, destination: d.destination, digest: d.digest });
      await load();
      const words = `Noted: you posted it on ${d.label}.`;
      say(words);
      focusCard(d);
      const undo = h("action-button", { size: "sm", onClick: async () => {
        if (undo.loading) return;
        undo.loading = true;
        try {
          await api.post("job-share/by-hand", { path: data.path, destination: d.destination, undo: true });
          undoSlot.replaceChildren();
          await load();
          say(`Undone. ${d.label} is back to not yet.`);
          focusCard(d);
        } catch (error) {
          if (error.status === 401) throw error;
          undo.loading = false;
          say(jobShareTrouble(error, d.label));
        }
      } }, "Undo");
      undoSlot.replaceChildren(h("alert-banner", { variant: "info", dismissible: true, heading: words }, undo));
    } catch (error) {
      if (error.status === 401) throw error;
      button.loading = false;
      const code = error.data?.code;
      if (code === "changed") { await load(); say(jobShareTrouble(error, d.label)); return; }
      if (code === "not-ready") { await load(); cardProblem(d, "Fix what's shown here first."); return; }
      cardProblem(d, jobShareTrouble(error, d.label));
      drawDetails(error);
    }
  }

  const focusCard = (d) => requestAnimationFrame(() => list.querySelector(`[data-destination="${d.destination}"] h3`)?.focus());

  function drawDetails(error = null) {
    details.replaceChildren(h("summary", { text: "For the person who set up your site" }),
      h("ul", { class: "studio-mono" }, ...[
        error ? `error ${error.status}${error.data?.code ? ` (${error.data.code})` : ""}: ${error.message}` : null,
        data ? `job ${data.path} at ${data.work}; announcements ${data.announcements ? "on" : "off"}; google sending ${data.googleSending ? "on" : "off"}` : null,
        ...(data?.destinations || []).flatMap((d) => [
          `${d.destination}: ${d.route}, ready ${d.ready}, digest ${d.digest}${d.record ? `, record ${JSON.stringify(d.record)}` : ""}`,
          ...(d.problems || []).map((p) => `${d.destination} ${p.blocking ? "blocking" : "advice"} ${p.code}: ${p.message}`),
        ]),
      ].filter(Boolean).map((t) => h("li", { text: t }))));
  }

  return {
    title: "Share this job",
    element,
    load,
    reload: load,
    focus: () => heading.focus(),
  };
}
