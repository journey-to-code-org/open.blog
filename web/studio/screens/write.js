// Write: a new post or an existing one. Title, words, when it appears, tags and a cover photo.
// Drafts save themselves; a published post changes on the site only when she presses Update (until
// then her edits are kept on this device). Nothing she types is lost: not on a conflict, not when
// her session runs out, not when she leaves or reloads.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { coverPicker } from "../parts/cover-picker.js";
import { createKept } from "../parts/kept.js";
import { joinInstant, splitInstant } from "../parts/dates.js";
import { fieldsToSend, formFromDocument, postState, primaryAction, statusLine } from "../parts/post-fields.js";
import { howItGoesOut, sendOut, siteLink } from "../parts/publish.js";

const AUTOSAVE_MS = 3000;
const NEW = "new"; // where a new post's words are kept before it has a file
const STATE_WORDS = { draft: "a draft", scheduled: "scheduled", published: "published" };

export async function createWrite(context, path) {
  const { api, meta } = context;
  await use("text-field", "date-field", "tag-input", "action-button", "dropdown-menu", "side-sheet", "breadcrumb-trail", "alert-banner", "cluster-layout", "loading-spinner");
  const kept = createKept(safeStorage(), api.user);
  const doc = { path: path || "", etag: "", fields: {}, url: "", state: path ? "draft" : "new" };
  let form = { title: "", date: "", tags: [], cover: "", coverAlt: "", draft: true, body: "" };
  let baseline = "";
  let dirty = false;
  let pending = false;
  let notSaved = "";
  let savedAt = null;
  let saving = null;
  let timer = 0;
  let titleLeft = false;
  let lastPublish = null;
  let goesOut = null; // howItGoesOut(), asked once when the screen opens

  // ---- the page
  const crumbs = (name) => [{ label: "Home", href: "#/" }, { label: "Posts", href: "#/posts" }, { label: name, href: "" }];
  const trail = h("breadcrumb-trail", { items: crumbs("New post") });
  const status = h("p", { class: "studio-status", role: "status" });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const title = h("text-field", { label: "Title", class: "studio-writing studio-writing-title", maxlength: 200 });
  const words = h("text-field", { label: "Words", class: "studio-writing", rows: 18, description: "Leave an empty line between paragraphs. For a list, start each line with a dash (-)." });
  const day = h("date-field", { label: "Date" });
  const time = h("text-field", { label: "Time (your time)", type: "time" });
  const tags = h("tag-input", { label: "Tags", max: 20, suggestions: meta.tags || [] });
  const cover = h("div");
  const saveLabel = h("span", { text: "Save draft" });
  const save = h("action-button", { variant: "secondary", onClick: () => saveNow("draft") }, saveLabel);
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
        h("div", { class: "studio-tags" }, h("p", { class: "studio-label", "aria-hidden": "true", text: "Tags" }), tags,
          h("p", { class: "studio-help", text: "Type a tag and press Enter." })),
        cover)),
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
  const snapshot = () => JSON.stringify({ ...read(), draft: undefined });
  const now = () => new Date();
  const isPublished = () => doc.state === "published" || doc.state === "scheduled";
  const isLocal = () => !goesOut || goesOut.kind === "none";
  const link = () => siteLink(meta, doc.url, { local: isLocal() });

  function paint() {
    const current = read();
    const action = doc.state === "published" ? "Update" : primaryAction(doc.state === "new" ? "draft" : doc.state, current.date, now());
    primaryLabel.textContent = action;
    saveLabel.textContent = doc.state === "scheduled" ? "Make it a draft again" : "Save draft";
    save.hidden = doc.state === "published";
    trail.items = crumbs(current.title.trim() || "New post");
    context.setTitle(current.title.trim() || "New post");
    if (notSaved) status.textContent = notSaved;
    else if (pending) status.textContent = doc.state === "new" ? "Not saved yet" : "Draft · saving in a moment…";
    else status.textContent = statusLine({ state: doc.state, savedAt, dirtyPublished: isPublished() && dirty, date: form.date || current.date }, now());
    if (doc.url && doc.state === "published" && !dirty) status.append(" ", h("a", { href: link(), target: "_blank", rel: "noopener", text: "See it on your site" }));
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

  function settle() {
    baseline = snapshot();
    dirty = false;
    pending = false;
  }

  async function buildCover() {
    const picker = await coverPicker({ api, cover: form.cover, coverAlt: form.coverAlt, maxBytes: meta.capture?.maxPhotoBytes || 0, onChange: (v) => { form.cover = v.cover; form.coverAlt = v.coverAlt; changed(); } });
    cover.replaceChildren(picker.element);
  }

  // ---- changes and saving
  // Dirty means different from what was last saved or opened, not "a field was touched".
  function changed() {
    dirty = snapshot() !== baseline;
    notSaved = "";
    clearTimeout(timer);
    timer = 0;
    pending = false;
    if (dirty && isPublished()) {
      if (doc.path) kept.keep(doc.path, doc.etag, read());
    } else if (dirty && doc.state === "new") {
      kept.keep(NEW, "", read());
      pending = true;
      if (ready()) timer = setTimeout(() => saveNow("draft", { quiet: true }), AUTOSAVE_MS);
    } else if (dirty) {
      pending = true;
      timer = setTimeout(() => saveNow("draft", { quiet: true }), AUTOSAVE_MS);
    }
    paint();
  }
  // A new post's first save waits for a real title: 3+ letters, and she's left it or started writing.
  const ready = () => read().title.trim().length >= 3 && (titleLeft || Boolean(read().body.trim()));

  async function saveNow(intent, { quiet = false } = {}) {
    clearTimeout(timer);
    timer = 0;
    if (saving) await saving.catch(() => {});
    // Nothing changed: nothing to send. Publishing a draft, or unscheduling, is still a change.
    if (!dirty && doc.path && !(intent === "publish" && doc.state === "draft") && !(intent === "draft" && doc.state === "scheduled")) {
      pending = false;
      paint();
      if (!quiet) toast(doc.state === "published" ? "Nothing's changed. Your site already has this." : "Everything's already saved.");
      return true;
    }
    const values = read();
    if (!values.title.trim()) {
      pending = false;
      title.error = "Give your post a title first.";
      if (!quiet) title.querySelector("input")?.focus();
      paint();
      return false;
    }
    title.error = "";
    const fields = fieldsToSend(doc.fields, { ...values, cover: form.cover, coverAlt: form.coverAlt }, intent, { now: now() });
    const button = intent === "publish" ? primary : save;
    const wasLive = doc.state === "published";
    if (!quiet) button.loading = true;
    saving = (async () => {
      const reply = doc.path
        ? await api.call("PUT", `document?path=${encodeURIComponent(doc.path)}`, { json: { fields, body: values.body, etag: doc.etag } })
        : await api.call("POST", "document", { json: { kind: "posts", fields, body: values.body } });
      if (!doc.path) {
        context.replaceRoute(`#/write/${encodeURIComponent(reply.path)}`);
        kept.clear(NEW);
      }
      doc.path = reply.path;
      doc.etag = reply.etag;
      doc.fields = { ...fields };
      for (const key of Object.keys(doc.fields)) if (doc.fields[key] === null) delete doc.fields[key];
      doc.url = reply.url || doc.url;
      doc.state = reply.status === "scheduled" ? "scheduled" : reply.status === "published" ? "published" : "draft";
      form = { ...values, cover: form.cover, coverAlt: form.coverAlt, date: fields.date || "" };
      savedAt = now();
      kept.clear(doc.path);
      return reply;
    })();
    try {
      await saving;
      // Typing during the save keeps those words unsaved: compare against what was sent.
      baseline = JSON.stringify({ ...values, cover: form.cover, coverAlt: form.coverAlt, draft: undefined });
      dirty = snapshot() !== baseline;
      pending = false;
      notSaved = "";
      banner.replaceChildren();
      paint();
      if (intent === "publish") await announce(wasLive);
      else if (!quiet) toast(doc.state === "draft" ? "Saved as a draft." : "Saved.");
      if (dirty) changed();
      return true;
    } catch (error) {
      pending = false;
      await problem(error, intent, quiet);
      return false;
    } finally {
      saving = null;
      button.loading = false;
    }
  }

  // After a publish: send the site out if Studio does that, and say only what's true.
  async function announce(wasLive = false) {
    const result = await sendOut(api, form.title);
    lastPublish = result;
    const when = doc.state === "scheduled" ? statusLine({ state: "scheduled", date: form.date }, now()) : "";
    if (result.sent === "failed") notSentOut(result.message);
    else if (result.sent === "none" && when) toast(`${when}. It goes up the next time your site is built after that.`);
    else if (result.sent === "none") toast("Published on your site's server. Nothing is set up to send it to your readers yet.", { variant: "warning" });
    else toast(when ? `${when}.` : wasLive ? "Updated. Your readers will see it in about a minute." : "Published. Your readers will see it in about a minute.");
    paint();
  }

  function notSentOut(why) {
    toast("Published here, but it hasn't reached your readers yet.", { variant: "warning", duration: 0 });
    banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "Not sent out yet" },
      "Your post is safe. It just hasn't gone out to your readers. ", why ? h("span", { class: "studio-detail", text: why }) : null,
      h("action-button", { variant: "secondary", onClick: () => announce() }, "Send it out again")));
  }

  async function problem(error, intent, quiet) {
    if (error.status === 409 && doc.path) return conflict(quiet);
    notSaved = "Not saved yet";
    if (error.status === 409) {
      const name = read().title.trim();
      title.error = "There's already a post with this title. Change it a little and it will save.";
      toast(`Not saved yet: there's already a post called “${name}”. Change the title a little.`, { variant: "warning", duration: 0 });
      paint();
      return;
    }
    const lines = Array.isArray(error.data?.problems) ? error.data.problems : [];
    banner.replaceChildren(h("alert-banner", { variant: "danger", heading: intent === "publish" ? "Not published" : "Not saved" },
      error.message, lines.length ? h("ul", {}, lines.map((line) => h("li", { text: String(line) }))) : null,
      error.status === 401 ? h("action-button", { variant: "secondary", onClick: () => saveNow(intent) }, "Sign in and try again") : null));
    if (quiet && error.status !== 401) toast("Not saved yet. Your words are still here.", { variant: "warning" });
    paint();
  }

  // Someone else (or another device) changed the file while she had it open.
  async function conflict(quiet) {
    let theirs;
    try {
      theirs = await api.get(`document?path=${encodeURIComponent(doc.path)}`);
    } catch (error) {
      notSaved = "Not saved yet";
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Not saved" }, error.message));
      paint();
      return;
    }
    notSaved = "Not saved yet";
    if (theirs.etag === doc.etag) {
      banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "Not saved yet" }, "Your site was busy. Your words are still here; press the button again in a moment."));
      paint();
      return;
    }
    paint();
    // An autosave never springs a question on her: it says so, and she chooses when she's ready.
    if (quiet) {
      banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "Changed somewhere else" },
        "This post was changed on another device or by someone else. Your words are still here.",
        h("action-button", { variant: "secondary", onClick: () => resolveConflict(theirs) }, "Choose which to keep")));
      return;
    }
    await resolveConflict(theirs);
  }

  async function resolveConflict(theirs) {
    const mine = read();
    const name = mine.title.trim() || "This post";
    const theirState = postState(theirs, now());
    const text = [`${name} was changed on another device or by someone else while you had it open.`];
    if (theirState !== doc.state && STATE_WORDS[theirState]) text.push(`The other version is ${STATE_WORDS[theirState]}. Using your words keeps it ${STATE_WORDS[theirState]}.`);
    text.push("Your words are still here. Which do you want to keep?");
    const choice = await ask({
      heading: "Changed somewhere else",
      text,
      choices: [{ label: "Use my words", value: "mine" }, { label: "Show the other version", value: "theirs", variant: "secondary" }],
    });
    if (choice === null) {
      banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "Not saved yet" },
        "This post was changed somewhere else. Your words are still here.",
        h("action-button", { variant: "secondary", onClick: () => resolveConflict(theirs) }, "Choose which to keep")));
      return;
    }
    if (choice === "mine") {
      const sure = await ask({ heading: "Use your words?", text: `This replaces the other changes to ${name} with what you have here.`, choices: [{ label: "Yes, use my words", value: "yes" }, { label: "Go back", value: "no", variant: "secondary" }] });
      if (sure !== "yes") return;
      doc.etag = theirs.etag;
      doc.fields = { ...theirs.fields };
      doc.state = theirState;
      dirty = true;
      await saveNow(theirState === "draft" ? "draft" : "publish");
    } else if (choice === "theirs") {
      showMineAside(mine);
      doc.etag = theirs.etag;
      doc.fields = { ...theirs.fields };
      doc.state = theirState;
      doc.url = theirs.url || doc.url;
      form = formFromDocument(theirs);
      fill(form);
      notSaved = "";
      settle();
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
    if (value === "view" && doc.url) open(link(), "_blank", "noopener");
    if (value === "old" && doc.path) location.href = `/admin#/edit/${encodeURIComponent(doc.path)}`;
  }

  function showDetails() {
    const values = read();
    const wordsCount = values.body.trim() ? values.body.trim().split(/\s+/).length : 0;
    const row = (label, value, mono = false) => [h("dt", { text: label }), h("dd", { class: mono ? "studio-mono" : null }, value || "—")];
    const sendWords = lastPublish
      ? [lastPublish.message, lastPublish.commit ? `commit ${String(lastPublish.commit).slice(0, 12)}` : "", lastPublish.sent === "pushed" ? "pushed" : lastPublish.sent === "failed" ? "not pushed" : ""].filter(Boolean).join(" · ")
      : !goesOut ? "Not known" : goesOut.kind === "none" ? "This site isn't set up to send posts out; they stay on its server." : goesOut.kind === "auto" ? "Your site sends itself out after each save." : "Studio sends your site out when you publish.";
    details.replaceChildren(
      h("span", { slot: "heading", text: "About this post" }),
      h("dl", { class: "studio-details" },
        row("File", doc.path ? `content/${doc.path}` : "Not saved yet", true),
        row("Web address", doc.url ? h("a", { href: link(), target: "_blank", rel: "noopener", class: "studio-mono", text: link() }) : "Not published yet"),
        row("Words", String(wordsCount)),
        row("Last saved", savedAt ? savedAt.toLocaleString() : "Not in this visit"),
        row(lastPublish ? "Last send-out" : "Sending out", sendWords),
        ...(lastPublish?.committed?.length ? row("Sent with it", lastPublish.committed.join(", "), true) : []),
        row("Scheduled posts", "go up when your site next builds after their time.")));
    details.open = true;
  }

  // ---- leaving
  async function leave() {
    clearTimeout(timer);
    timer = 0;
    if (!dirty) return true;
    const values = read();
    if (doc.state === "new" && !values.title.trim()) {
      if (!values.body.trim() && !form.cover) { kept.clear(NEW); return true; }
      const choice = await ask({ heading: "Leave without a title?", text: ["A post needs a title to be kept as a draft.", "If you leave, your words wait on this device for next time."], choices: [{ label: "Add a title", value: "stay" }, { label: "Leave for now", value: "go", variant: "secondary" }, { label: "Throw it away", value: "discard", variant: "destructive" }] });
      if (choice === "stay" || choice === null) { setTimeout(() => title.querySelector("input")?.focus(), 0); return false; }
      if (choice === "discard") kept.clear(NEW);
      return true;
    }
    if (isPublished()) {
      const verb = primaryLabel.textContent;
      const choice = await ask({ heading: "Your changes aren't on your site yet", text: `They stay on this device until you come back, or you can ${verb.toLowerCase()} now.`, choices: [{ label: `${verb} now`, value: "update" }, { label: "Leave for now", value: "go", variant: "secondary" }] });
      if (choice === "update") return saveNow("publish");
      return choice === "go";
    }
    return saveNow("draft", { quiet: true });
  }

  // ---- loading
  async function load() {
    const asking = howItGoesOut(api).then((how) => { goesOut = how; paint(); });
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
    }
    await buildCover();
    settle();
    const back = !path ? kept.get(NEW) : isPublished() ? kept.get(path) : null;
    if (back) offerKept(back, !path);
    for (const field of [title, words, time, day, tags]) field.addEventListener("valuechange", changed);
    title.addEventListener("focusout", () => {
      titleLeft = true;
      if (doc.state === "new" && dirty && ready() && !timer) changed();
    });
    paint();
    await asking;
  }

  function offerKept(back, fresh) {
    const restore = () => {
      fill({ ...form, ...back.form });
      form.cover = back.form.cover ?? form.cover;
      form.coverAlt = back.form.coverAlt ?? form.coverAlt;
      banner.replaceChildren();
      buildCover().then(changed).then(() => title.querySelector("input")?.focus());
    };
    const drop = () => { kept.clear(fresh ? NEW : path); banner.replaceChildren(); };
    banner.replaceChildren(fresh
      ? h("alert-banner", { variant: "info", heading: "You have words from last time" },
        "You started writing here before and left without saving.",
        h("cluster-layout", { gap: "0.5rem" },
          h("action-button", { onClick: restore }, "Put them back"),
          h("action-button", { variant: "secondary", onClick: drop }, "Start fresh")))
      : h("alert-banner", { variant: "info", heading: "You have changes that aren't on your site yet" },
        "You changed this post on this device and didn't press Update.",
        h("cluster-layout", { gap: "0.5rem" },
          h("action-button", { onClick: restore }, "Put my changes back"),
          h("action-button", { variant: "secondary", onClick: drop }, "Use what's on the site"))));
  }

  return {
    title: path ? "Write" : "New post",
    element,
    load,
    leave,
    isDirty: () => dirty,
    focus: () => (path ? element.querySelector("h2").focus() : title.querySelector("input")?.focus()),
    palette: [
      { id: "save", label: "Save", group: "This post", hint: isMacLike() ? "⌘S" : "Ctrl S" },
      { id: "publish", label: "Publish or update", group: "This post", hint: isMacLike() ? "⌘↵" : "Ctrl Enter" },
      { id: "details", label: "Show details", group: "This post" },
    ],
    command(id) {
      if (id === "save") saveNow(isPublished() ? "publish" : "draft");
      if (id === "publish") saveNow("publish");
      if (id === "details") showDetails();
    },
  };
}

function isMacLike() {
  return /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || "");
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
