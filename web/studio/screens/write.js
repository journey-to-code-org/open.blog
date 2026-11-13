// Write: a new post or an existing one. Title, words, when it appears, tags and a cover photo.
// Drafts save themselves; a published post changes on the site only when she presses Update (until
// then her edits are kept on this device). Nothing she types is lost: not on a conflict, not when
// her session runs out, not when she leaves.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { coverPicker } from "../parts/cover-picker.js";
import { createKept } from "../parts/kept.js";
import { joinInstant, splitInstant } from "../parts/dates.js";
import { fieldsToSend, formFromDocument, postState, primaryAction, statusLine } from "../parts/post-fields.js";

const AUTOSAVE_MS = 3000;

export async function createWrite(context, path) {
  const { api, meta } = context;
  await use("text-field", "date-field", "tag-input", "action-button", "dropdown-menu", "side-sheet", "breadcrumb-trail", "alert-banner", "cluster-layout", "loading-spinner");
  const kept = createKept(safeStorage(), api.user);
  const doc = { path: path || "", etag: "", fields: {}, url: "", state: path ? "draft" : "new" };
  let form = { title: "", date: "", tags: [], cover: "", coverAlt: "", draft: true, body: "" };
  let dirty = false;
  let savedAt = null;
  let saving = null;
  let timer = 0;
  let titleLeft = false;
  let lastPublish = null;

  // ---- the page
  const trail = h("breadcrumb-trail", { items: [{ label: "Posts", href: "#/posts" }, { label: "New post", href: "" }] });
  const status = h("p", { class: "studio-status", role: "status" });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const title = h("text-field", { label: "Title", class: "studio-writing studio-writing-title", maxlength: 200 });
  const words = h("text-field", { label: "Words", class: "studio-writing", rows: 18, description: "Leave an empty line between paragraphs." });
  const day = h("date-field", { label: "Date" });
  const time = h("text-field", { label: "Time (your time)", type: "time" });
  const tags = h("tag-input", { label: "Tags", max: 20, suggestions: meta.tags || [] });
  const cover = h("div");
  const save = h("action-button", { variant: "secondary", onClick: () => saveNow("draft") }, "Save draft");
  const primaryLabel = h("span", { text: "Publish" });
  const primary = h("action-button", { onClick: () => saveNow("publish") }, primaryLabel);
  const more = h("dropdown-menu", { label: "More", items: [], onItemselect: (e) => moreChoice(e.detail) });
  const details = h("side-sheet", { label: "About this post", side: "right" });
  const element = h("section", { class: "studio-page studio-write", "aria-labelledby": "studio-write-h" },
    h("div", { class: "studio-write-top" }, trail, more),
    h("h2", { id: "studio-write-h", class: "studio-visually-hidden", tabindex: "-1", text: "Write" }),
    status, banner,
    h("div", { class: "studio-write-grid" },
      h("div", { class: "studio-write-main" }, title, words),
      h("div", { class: "studio-write-side" },
        h("fieldset", { class: "studio-when" }, h("legend", { text: "When it appears" }),
          h("cluster-layout", { gap: "0.75rem" }, day, time),
          h("p", { class: "studio-help", text: "Leave it empty to use the day you publish." })),
        tags, cover)),
    h("div", { class: "studio-write-bar" }, save, primary),
    details);

  // ---- reading the form
  const read = () => ({
    ...form,
    title: String(title.value || ""),
    body: String(words.value || ""),
    date: safeJoin(day.value || "", time.value || ""),
    tags: [...(tags.value || [])],
  });
  const now = () => new Date();
  const isPublished = () => doc.state === "published" || doc.state === "scheduled";

  function paint() {
    const current = read();
    const action = doc.state === "published" ? "Update" : primaryAction(doc.state === "new" ? "draft" : doc.state, current.date, now());
    primaryLabel.textContent = action;
    save.hidden = doc.state === "published";
    trail.items = [{ label: "Posts", href: "#/posts" }, { label: current.title.trim() || "New post", href: "" }];
    context.setTitle(current.title.trim() || "New post");
    status.replaceChildren(statusLine({ state: doc.state, savedAt, dirtyPublished: isPublished() && dirty, date: form.date || current.date }, now()));
    if (doc.url && doc.state === "published") status.append(" ", h("a", { href: doc.url, target: "_blank", rel: "noopener", text: "See it on your site" }));
    more.items = [
      { value: "details", label: "Show details" },
      ...(doc.url && isPublished() ? [{ value: "view", label: "See it on your site" }] : []),
      ...(doc.path ? [{ value: "old", label: "Open in the old Admin" }] : []),
    ];
  }

  function fill(values) {
    title.value = values.title;
    words.value = values.body;
    const parts = splitInstant(values.date || "");
    day.value = parts.date;
    time.value = parts.time;
    tags.value = [...values.tags];
  }

  async function buildCover() {
    const picker = await coverPicker({ api, cover: form.cover, coverAlt: form.coverAlt, maxBytes: meta.capture?.maxPhotoBytes || 0, onChange: (v) => { form.cover = v.cover; form.coverAlt = v.coverAlt; changed(); } });
    cover.replaceChildren(picker.element);
  }

  // ---- changes and saving
  function changed() {
    dirty = true;
    paint();
    clearTimeout(timer);
    if (isPublished()) {
      if (doc.path) kept.keep(doc.path, doc.etag, read());
      return;
    }
    if (doc.state === "new" && !(read().title.trim().length >= 3 && (titleLeft || read().body.trim()))) return;
    timer = setTimeout(() => saveNow("draft", { quiet: true }), AUTOSAVE_MS);
  }

  async function saveNow(intent, { quiet = false } = {}) {
    clearTimeout(timer);
    if (saving) await saving.catch(() => {});
    const values = read();
    if (!values.title.trim()) {
      title.error = "Give your post a title first.";
      title.querySelector("input")?.focus();
      return false;
    }
    title.error = "";
    const effective = intent === "publish" ? "publish" : "draft";
    const fields = fieldsToSend(doc.fields, { ...values, cover: form.cover, coverAlt: form.coverAlt }, effective, { now: now() });
    const button = intent === "publish" ? primary : save;
    if (!quiet) button.loading = true;
    saving = (async () => {
      const reply = doc.path
        ? await api.call("PUT", `document?path=${encodeURIComponent(doc.path)}`, { json: { fields, body: values.body, etag: doc.etag } })
        : await api.call("POST", "document", { json: { kind: "posts", fields, body: values.body } });
      if (!doc.path) history.replaceState(null, "", `#/write/${encodeURIComponent(reply.path)}`);
      doc.path = reply.path;
      doc.etag = reply.etag;
      doc.fields = { ...fields };
      for (const key of Object.keys(doc.fields)) if (doc.fields[key] === null) delete doc.fields[key];
      doc.url = reply.url || doc.url;
      doc.state = reply.status === "scheduled" ? "scheduled" : reply.status === "published" ? "published" : "draft";
      form = { ...values, cover: form.cover, coverAlt: form.coverAlt, date: fields.date || "" };
      savedAt = now();
      dirty = false;
      kept.clear(doc.path);
      return reply;
    })();
    try {
      const reply = await saving;
      banner.replaceChildren();
      paint();
      if (intent === "publish") await sendOut(reply);
      else if (!quiet) toast("Saved as a draft.");
      return true;
    } catch (error) {
      await problem(error, intent);
      return false;
    } finally {
      saving = null;
      button.loading = false;
    }
  }

  // After a publish, send the site out if that's how this site works, and say what really happened.
  async function sendOut(reply) {
    const scheduled = doc.state === "scheduled";
    let publish = null;
    try {
      publish = await api.get("publish");
    } catch {
      // Can't tell: say only what we know.
    }
    if (!publish?.repo || !publish.remote) {
      lastPublish = { words: "Saved on your site's server. There's nowhere set up to send it out." };
      toast(scheduled ? `Scheduled for ${statusLine({ state: "scheduled", date: form.date }, now()).replace(/^Scheduled for /, "")}.` : "Published. It's on your site.");
    } else if (publish.auto) {
      lastPublish = { words: "Sent automatically by your site after saving." };
      toast(scheduled ? `${statusLine({ state: "scheduled", date: form.date }, now())}.` : "Published. Your readers will see it in about a minute.");
    } else {
      try {
        const sent = await api.post("publish", { summary: (form.title || "A post").slice(0, 120) });
        lastPublish = { words: sent.message || "", commit: sent.commit, pushed: sent.pushed, committed: sent.committed || [] };
        if (sent.pushed) toast(scheduled ? `${statusLine({ state: "scheduled", date: form.date }, now())}.` : "Published. Your readers will see it in about a minute.");
        else notSentOut(sent.message);
      } catch (error) {
        lastPublish = { words: error.message };
        notSentOut(error.message);
      }
    }
    paint();
    void reply;
  }

  function notSentOut(why) {
    toast("Published here, but it hasn't reached your readers yet.", { variant: "warning", duration: 0 });
    banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "Not sent out yet" },
      "Your post is safe. It just hasn't gone out to your readers. ", why ? h("span", { class: "studio-detail", text: why }) : null,
      h("action-button", { variant: "secondary", onClick: () => sendOut(null) }, "Send it out again")));
  }

  async function problem(error, intent) {
    if (error.status === 409 && doc.path) return conflict();
    if (error.status === 409) {
      banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "That title is taken" }, "There's already a post with that name. Change the title a little, then save again."));
      title.querySelector("input")?.focus();
      return;
    }
    const lines = Array.isArray(error.data?.problems) ? error.data.problems : [];
    banner.replaceChildren(h("alert-banner", { variant: "danger", heading: intent === "publish" ? "Not published" : "Not saved" },
      error.message, lines.length ? h("ul", {}, lines.map((line) => h("li", { text: String(line) }))) : null,
      error.message === "Not saved: you're signed out." ? h("action-button", { variant: "secondary", onClick: () => saveNow(intent) }, "Sign in and try again") : null));
  }

  // Someone else (or another device) changed the file while she had it open.
  async function conflict() {
    const mine = read();
    let theirs;
    try {
      theirs = await api.get(`document?path=${encodeURIComponent(doc.path)}`);
    } catch (error) {
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Not saved" }, error.message));
      return;
    }
    if (theirs.etag === doc.etag) {
      banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "Not saved yet" }, "Your site was busy. Your words are still here; press the button again in a moment."));
      return;
    }
    const name = mine.title.trim() || "This post";
    const choice = await ask({
      heading: "Changed somewhere else",
      text: [`${name} was changed on another device or by someone else while you had it open.`, "Your words are still here. Which do you want to keep?"],
      choices: [{ label: "Use my words", value: "mine" }, { label: "Show the other version", value: "theirs", variant: "secondary" }],
    });
    if (choice === "mine") {
      const sure = await ask({ heading: "Use your words?", text: `This replaces the other changes to ${name} with what you have here.`, choices: [{ label: "Yes, use my words", value: "yes" }, { label: "Go back", value: "no", variant: "secondary" }] });
      if (sure !== "yes") return;
      doc.etag = theirs.etag;
      doc.fields = { ...theirs.fields };
      await saveNow(isPublished() ? "publish" : "draft");
    } else if (choice === "theirs") {
      showMineAside(mine);
      doc.etag = theirs.etag;
      doc.fields = { ...theirs.fields };
      form = formFromDocument(theirs);
      fill(form);
      dirty = false;
      paint();
    }
  }

  function showMineAside(mine) {
    const text = `${mine.title}\n\n${mine.body}`;
    const copy = h("action-button", { variant: "secondary", onClick: async () => {
      try { await navigator.clipboard.writeText(text); toast("Copied. Paste it wherever you need it."); } catch { toast("Select the words and copy them yourself.", { variant: "warning" }); }
    } }, "Copy my words");
    banner.replaceChildren(h("alert-banner", { variant: "info", heading: "Your version" },
      h("p", { text: "Here's what you had, so you can take back anything you need." }),
      h("pre", { class: "studio-mine", text }), copy));
  }

  // ---- More and details
  function moreChoice(value) {
    if (value === "details") showDetails();
    if (value === "view" && doc.url) open(doc.url, "_blank", "noopener");
    if (value === "old" && doc.path) location.href = `/admin#/edit/${encodeURIComponent(doc.path)}`;
  }

  function showDetails() {
    const values = read();
    const wordsCount = values.body.trim() ? values.body.trim().split(/\s+/).length : 0;
    const row = (label, value, mono = false) => [h("dt", { text: label }), h("dd", { class: mono ? "studio-mono" : null, text: value || "—" })];
    details.replaceChildren(
      h("span", { slot: "heading", text: "About this post" }),
      h("dl", { class: "studio-details" },
        row("File", doc.path ? `content/${doc.path}` : "Not saved yet", true),
        row("Web address", doc.url || "Not published yet", true),
        row("Words", String(wordsCount)),
        row("Last saved", savedAt ? savedAt.toLocaleString() : "Not in this visit"),
        row("Last send-out", lastPublish ? [lastPublish.words, lastPublish.commit ? `commit ${String(lastPublish.commit).slice(0, 12)}` : "", lastPublish.pushed === false ? "not pushed" : lastPublish.pushed ? "pushed" : ""].filter(Boolean).join(" · ") : "Not in this visit"),
        ...(lastPublish?.committed?.length ? row("Sent with it", lastPublish.committed.join(", "), true) : []),
        row("Scheduled posts", "go up when your site next builds after their time.")));
    details.open = true;
  }

  // ---- leaving
  async function leave() {
    clearTimeout(timer);
    if (!dirty) return true;
    const values = read();
    if (doc.state === "new" && !values.title.trim()) {
      if (!values.body.trim() && !form.cover) return true;
      const choice = await ask({ heading: "Leave without a title?", text: "A post needs a title to be kept as a draft.", choices: [{ label: "Add a title", value: "stay" }, { label: "Leave and throw it away", value: "go", variant: "destructive" }] });
      if (choice === "stay") title.querySelector("input")?.focus();
      return choice === "go";
    }
    if (isPublished()) {
      const choice = await ask({ heading: "Your changes aren't on your site yet", text: "They stay on this device until you come back, or you can update now.", choices: [{ label: "Update now", value: "update" }, { label: "Leave for now", value: "go", variant: "secondary" }] });
      if (choice === "update") return saveNow("publish");
      return choice === "go";
    }
    return saveNow("draft", { quiet: true });
  }

  // ---- loading
  async function load() {
    if (path) {
      let reply;
      try {
        reply = await api.get(`document?path=${encodeURIComponent(path)}`);
      } catch (error) {
        banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "This post didn't open" }, error.message));
        return;
      }
      if (reply.raw !== undefined && !reply.fields) {
        banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "This post can't be changed here" }, "Something in it needs fixing first. Open it in the old Admin."));
        element.querySelector(".studio-write-grid").hidden = true;
        primary.hidden = true;
        save.hidden = true;
        return;
      }
      doc.etag = reply.etag;
      doc.fields = { ...reply.fields };
      form = formFromDocument(reply);
      doc.state = postState(reply, now());
      doc.url = reply.url || "";
      fill(form);
      const back = isPublished() ? kept.get(path) : null;
      if (back) offerKept(back);
    }
    await buildCover();
    for (const field of [title, words, time]) field.addEventListener("valuechange", changed);
    day.addEventListener("valuechange", changed);
    tags.addEventListener("valuechange", changed);
    title.addEventListener("focusout", () => { titleLeft = true; changed(); });
    element.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveNow(isPublished() ? "publish" : "draft");
      }
    });
    paint();
  }

  function offerKept(back) {
    banner.replaceChildren(h("alert-banner", { variant: "info", heading: "You have changes that aren't on your site yet" },
      "You changed this post on this device and didn't press Update.",
      h("cluster-layout", { gap: "0.5rem" },
        h("action-button", { onClick: () => { fill({ ...form, ...back.form }); form.cover = back.form.cover ?? form.cover; form.coverAlt = back.form.coverAlt ?? form.coverAlt; dirty = true; banner.replaceChildren(); paint(); } }, "Put my changes back"),
        h("action-button", { variant: "secondary", onClick: () => { kept.clear(path); banner.replaceChildren(); } }, "Use what's on the site"))));
  }

  return {
    title: path ? "Write" : "New post",
    element,
    load,
    leave,
    isDirty: () => dirty,
    focus: () => (path ? element.querySelector("h2").focus() : title.querySelector("input")?.focus()),
    palette: [
      { id: "save", label: "Save draft", group: "This post", hint: "Ctrl S" },
      { id: "publish", label: "Publish or update", group: "This post" },
      { id: "details", label: "Show details", group: "This post" },
    ],
    command(id) {
      if (id === "save") saveNow(isPublished() ? "publish" : "draft");
      if (id === "publish") saveNow("publish");
      if (id === "details") showDetails();
    },
  };
}

function safeJoin(date, time) {
  try {
    return joinInstant({ date, time }) || "";
  } catch {
    return date;
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
