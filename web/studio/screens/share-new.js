// Share a post: which post, which of her accounts, what to say (counted against the shortest limit),
// and when: in a few minutes (so the post's page is up before anyone clicks) or a day and time she
// picks. One share per account, each with its own key made when the composer opens, so trying again
// never shares twice. Studio slice 10c; docs/specs/studio/slice-10bc/ux.md.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { accountLabel, captionWords, providerName, sentWords, shareTrouble } from "../parts/share-words.js";
import { sayWhen } from "../parts/dates.js";

const MODEL = "/admin/announcements.js";
const SOON_MS = 5 * 60 * 1000;
const CHOSEN = "studio:share:accounts";

export async function createShareNew({ api, go }, route) {
  await use("action-button", "alert-banner", "date-field", "select-field", "skeleton-block", "text-field", "toggle-switch");
  const M = await import(MODEL);
  const zone = M.browserZone();
  let destinations = [];
  let posts = [];
  let keys = {}; // account id → idempotency key, made once
  let shared = new Set(); // accounts already taken this time
  let touched = false;
  let sendAt = null; // the time fixed at the first press, so a retry sends the same request
  const maybe = new Set(); // accounts that may have it (no clear answer): never sent again

  const heading = h("h2", { id: "studio-share-new-h", class: "studio-question", tabindex: "-1", text: "Share a post" });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const banner = h("div", { class: "studio-banner" });
  const body = h("div", { class: "studio-card-form", "aria-busy": "true" }, h("skeleton-block", { lines: 6 }));
  const element = h("section", { class: "studio-page studio-share-new", "aria-labelledby": "studio-share-new-h" },
    h("a", { class: "studio-more-link", href: "#/sharing", text: "Back to Sharing" }), heading, banner, status, body);

  let post, caption, count, whenPick, day, time, button;
  const toggles = new Map();

  const chosen = () => destinations.filter((d) => toggles.get(d.id)?.checked && !shared.has(d.id) && !maybe.has(d.id));

  function recount() {
    const words = captionWords(caption.value, chosen().map((d) => d.provider));
    count.textContent = words.text;
    count.classList.toggle("studio-comment-trouble", words.over);
  }

  async function load() {
    try {
      const dest = await api.get("social/destinations");
      const found = await api.get("social/posts");
      destinations = dest.destinations || [];
      posts = (found.posts || []).filter((p) => p.eligible);
    } catch (error) {
      if (error.status === 401) throw error;
      body.removeAttribute("aria-busy");
      body.replaceChildren(h("alert-banner", { variant: "danger", heading: "Sharing didn't open" }, shareTrouble(error), " ",
        h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again")));
      return;
    }
    draw();
  }

  function draw() {
    body.removeAttribute("aria-busy");
    if (!destinations.length || !posts.length) {
      body.replaceChildren(h("alert-banner", { variant: "info", heading: !destinations.length ? "Nothing to share to yet" : "Nothing to share yet" },
        !destinations.length ? "Connect an account first. " : "Publish a post first, then share it here. ",
        !destinations.length ? h("a", { href: "/admin/#/social", target: "_blank", rel: "noopener" }, "Connect an account") : null));
      return;
    }
    let remembered = null;
    try { remembered = JSON.parse(localStorage.getItem(CHOSEN) || "null"); } catch { /* every account */ }
    const wanted = posts.find((p) => p.work === route.query.post || p.canonicalUrl === route.query.post) || posts[0];
    post = h("select-field", { label: "Which post?", options: posts.map((p) => ({ value: p.work, label: p.title })), value: wanted.work,
      onValuechange: () => { if (!touched) caption.value = posts.find((p) => p.work === post.value)?.title || ""; recount(); } });
    const accounts = h("fieldset", { class: "studio-field-group" }, h("legend", { text: "Share to" }),
      ...destinations.map((d) => {
        const t = h("toggle-switch", { label: accountLabel(d), onCheckedchange: () => { recount(); remember(); } });
        toggles.set(d.id, t);
        requestAnimationFrame(() => { t.checked = !remembered || remembered.includes(d.id); recount(); });
        return t;
      }));
    caption = h("text-field", { label: "What to say", rows: 4, value: wanted.title, onValuechange: () => { touched = true; caption.error = ""; recount(); } });
    count = h("p", { class: "studio-help", "aria-live": "polite" });
    caption.setAttribute("aria-describedby", "studio-share-count");
    count.id = "studio-share-count";
    whenPick = h("select-field", { label: "When", options: [{ value: "soon", label: "In a few minutes" }, { value: "pick", label: "Pick a day and time" }], value: "soon",
      onValuechange: () => { picked.hidden = whenPick.value !== "pick"; sendAt = null; } });
    day = h("date-field", { label: "Day", onValuechange: () => { sendAt = null; } });
    time = h("text-field", { label: "Time", type: "time", value: "09:00", onValuechange: () => { sendAt = null; } });
    const picked = h("div", { class: "studio-business-times", hidden: true }, day, time);
    button = h("action-button", { size: "lg", onClick: () => send() }, "Share it");
    body.replaceChildren(post, accounts, caption, count, whenPick, picked,
      h("p", { class: "studio-help", text: "The link to your post goes with it." }), button,
      h("details", { class: "studio-help" }, h("summary", { text: "For the person who set up your site" }),
        h("p", { class: "studio-mono", text: `zone ${zone}; ${posts.length} posts can be shared; ${destinations.map((d) => `${d.provider}:${d.id}`).join(", ")}` })));
    recount();
  }

  function remember() {
    try { localStorage.setItem(CHOSEN, JSON.stringify(destinations.filter((d) => toggles.get(d.id)?.checked).map((d) => d.id))); } catch { /* not kept */ }
  }

  function when() {
    // At least 5 minutes from now, on the next whole minute.
    if (whenPick.value !== "pick") return { ok: true, iso: `${new Date(Math.ceil((Date.now() + SOON_MS) / 60000) * 60000).toISOString().slice(0, 16)}:00Z`, words: "in about 5 minutes" };
    if (!day.value) return { ok: false, message: "Pick a day." };
    const converted = M.localToInstant(`${day.value}T${time.value || "09:00"}`, zone);
    if (!converted?.ok) return { ok: false, message: "Pick a day and time that's still to come." };
    return { ok: true, iso: converted.iso, words: sayWhen(converted.iso) };
  }

  async function send() {
    const to = chosen();
    if (!to.length) { status.textContent = "Choose at least one account to share to."; return; }
    const words = captionWords(caption.value, to.map((d) => d.provider));
    if (!caption.value.trim()) { caption.error = "Write something to go with the link."; return; }
    if (words.over) { caption.error = `${words.text}. Shorten it a little.`; caption.querySelector("textarea")?.focus(); return; }
    caption.error = "";
    const at = sendAt || when();
    if (!at.ok) { status.textContent = at.message; day.querySelector("input")?.focus(); return; }
    sendAt = at;
    button.loading = true;
    const done = [];
    const failed = [];
    const unsure = [];
    let field = null;
    for (const d of to) {
      keys[d.id] ||= M.newKey();
      try {
        await api.post("social/announcements", { accountId: d.id, work: post.value, caption: caption.value, scheduledFor: at.iso, timeZone: zone, idempotencyKey: keys[d.id] });
        shared.add(d.id);
        done.push(providerName(d.provider));
      } catch (error) {
        if (error.status === 401) { button.loading = false; throw error; }
        const code = error.data?.code || "";
        // No clear answer (it may have been stored), or the key already holds a share: never send again.
        if (!error.status || error.status >= 502 || code === "idempotency-conflict") {
          maybe.add(d.id);
          unsure.push(providerName(d.provider));
          continue;
        }
        if (/^caption-/.test(code)) field ||= "caption";
        else if (/^time-/.test(code)) field ||= "time";
        // Refused, so nothing was kept: the next press may change the words or time.
        sendAt = null;
        failed.push(`${providerName(d.provider)} didn't take it${/^caption-/.test(code) ? ": the words don't fit there" : /^time-/.test(code) ? ": that time doesn't work" : ""}.`);
      }
    }
    button.loading = false;
    if (!failed.length && !unsure.length) {
      touched = false;
      toast(sentWords(done, at.words));
      go("#/sharing");
      return;
    }
    const may = unsure.length ? ` Studio didn't hear back from ${unsure.join(" and ")}; it may have it. Look under Sharing in a minute before sharing there again.` : "";
    status.textContent = `${done.length ? `Shared to ${done.join(" and ")}. ` : ""}${failed.join(" ")}${failed.length ? " Change it and press Share it again; the ones that went won't go twice." : ""}${may}`;
    if (field === "caption") { caption.error = "This doesn't fit on every account you chose. Shorten it a little."; caption.querySelector("textarea")?.focus(); }
    else if (field === "time") { status.textContent += " Pick another time."; (day.querySelector("input") || whenPick).focus?.(); }
    if (!failed.length) { touched = false; }
    recount();
  }

  async function leave() {
    if (!touched) return true;
    const choice = await ask({ heading: "Share this post?", text: "You wrote something and didn't share it.", choices: [{ label: "Share it", value: "share" }, { label: "Leave without sharing", value: "go", variant: "secondary" }] });
    if (choice === "share") { await send(); return !touched; }
    return choice === "go";
  }

  return {
    title: "Share a post",
    element,
    load,
    leave,
    isDirty: () => touched,
    focus: () => heading.focus(),
  };
}
