// Write: a new post or an existing one. Title, the words (or, for a recipe, the recipe boxes),
// when it appears, tags and a cover photo. Drafts save themselves; a published post changes on the
// site only when she presses Update (until then her edits are kept on this device). Nothing she
// types is lost: not on a conflict, not when her session runs out, not when she leaves or reloads.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { coverPicker } from "../parts/cover-picker.js";
import { createKept } from "../parts/kept.js";
import { joinInstant, splitInstant } from "../parts/dates.js";
import { formFromDocument, postState, primaryAction, statusLine } from "../parts/post-fields.js";
import { afterSave, fieldsForSave, layoutOf, nothingToSave, sendPost } from "../parts/post-session.js";
import { howItGoesOut, sendOut, siteLink, wentOutWords } from "../parts/publish.js";
import { keptBanner, mineAside, postDetails } from "../parts/post-details.js";
import { isRecipe } from "../parts/recipe-fields.js";
import { recipeNumbers } from "../parts/recipe-numbers.js";
import { createBodyHost } from "../parts/body-host.js";
import { adviceFor } from "../parts/recipe-advice.js";
import { showPreview } from "../parts/preview.js";
import { takeOffQuestion } from "../parts/take-off.js";
import { askWhichToKeep, busyBanner, chooseLaterBanner } from "../parts/conflict.js";

const AUTOSAVE_MS = 3000;
const narrow = () => globalThis.matchMedia?.("(max-width: 40rem)").matches;

export async function createWrite(context, arg) {
  const { api, meta } = context;
  await use("text-field", "date-field", "tag-input", "action-button", "dropdown-menu", "side-sheet", "breadcrumb-trail", "alert-banner", "cluster-layout", "loading-spinner");
  const starting = /^new\/(recipe|story)$/.exec(arg || "")?.[1] || (arg ? "" : "story");
  const path = starting ? "" : arg;
  const keptKey = starting ? `new-${starting}` : path;
  const kept = createKept(safeStorage(), api.user);
  const doc = { path, etag: "", fields: starting === "recipe" ? { profile: "recipe" } : {}, url: "", state: path ? "draft" : "new" };
  let form = { title: "", date: "", tags: [], cover: "", coverAlt: "", draft: true, body: "", extra: {} };
  let baseline = "";
  let dirty = false;
  let pending = false;
  let notSaved = "";
  let savedAt = null;
  let saving = null;
  let timer = 0;
  let titleLeft = false;
  let lastPublish = null;
  let lastLayout = null;
  let goesOut = null;
  let numbers = null; // Serves and the times, for a recipe

  // ---- the page
  const crumbs = (name) => [{ label: "Home", href: "#/" }, { label: "Posts", href: "#/posts" }, { label: name, href: "" }];
  const trail = h("breadcrumb-trail", { items: crumbs("New post") });
  const status = h("p", { class: "studio-status", role: "status" });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const title = h("text-field", { label: "Title", class: "studio-writing studio-writing-title", maxlength: 200 });
  const body = await createBodyHost({ api, maxBytes: meta.capture?.maxPhotoBytes || 0, onChange: () => changed() });
  const numbersHost = h("div");
  const day = h("date-field", { label: "Date" });
  const time = h("text-field", { label: "Time (your time)", type: "time" });
  const tags = h("tag-input", { label: "Tags", max: 20, suggestions: meta.tags || [] });
  const cover = h("div");
  const saveLabel = h("span", { text: "Save draft" });
  const save = h("action-button", { variant: "secondary", class: "studio-save", onClick: () => saveNow("draft") }, saveLabel);
  const primaryLabel = h("span", { text: "Publish" });
  const primary = h("action-button", { onClick: () => saveNow("publish") }, primaryLabel);
  const look = h("action-button", { variant: "secondary", onClick: (e) => preview(e.currentTarget) }, "See how it looks");
  const more = h("dropdown-menu", { label: "More", items: [], onItemselect: (e) => run(e.detail) });
  const details = h("side-sheet", { label: "About this post", side: "right" });
  const element = h("section", { class: "studio-page studio-write", "aria-labelledby": "studio-write-h" },
    h("div", { class: "studio-write-top" }, trail, more),
    h("h2", { id: "studio-write-h", class: "studio-visually-hidden", tabindex: "-1", text: "Write" }),
    status, banner,
    h("div", { class: "studio-write-grid" },
      h("div", { class: "studio-write-main" }, title, numbersHost, body.element),
      h("div", { class: "studio-write-side" },
        h("fieldset", { class: "studio-when" }, h("legend", { text: "When it appears" }),
          h("cluster-layout", { gap: "0.75rem" }, day, time),
          h("p", { class: "studio-help", text: "Leave it empty to use the day you publish." })),
        h("div", { class: "studio-tags" }, h("p", { class: "studio-label", "aria-hidden": "true", text: "Tags" }), tags,
          h("p", { class: "studio-help", text: "Type a tag and press Enter." })),
        cover)),
    h("div", { class: "studio-write-bar" }, look, save, primary),
    details);

  // ---- reading the form
  const bodyText = () => body.text();
  const read = () => ({
    ...form,
    title: String(title.value || ""),
    body: bodyText(),
    date: safeJoin(day.value || "", time.value || ""),
    tags: [...(tags.value || [])],
    extra: numbers ? numbers.values() : {},
  });
  const snapshot = () => JSON.stringify({ ...read(), draft: undefined });
  const now = () => new Date();
  const isPublished = () => doc.state === "published" || doc.state === "scheduled";
  const link = () => siteLink(meta, doc.url, { local: !goesOut || goesOut.kind === "none" });
  const isRecipePost = () => isRecipe(doc.fields);

  const fieldsFor = (values, intent) => fieldsForSave(doc.fields, form, values, intent, { now: now() });

  function paint() {
    const current = read();
    const action = doc.state === "published" ? "Update" : primaryAction(doc.state === "new" ? "draft" : doc.state, current.date, now());
    primaryLabel.textContent = action;
    saveLabel.textContent = doc.state === "scheduled" ? "Make it a draft again" : "Save draft";
    save.hidden = doc.state === "published";
    const name = current.title.trim() || (isRecipePost() ? "New recipe" : "New post");
    trail.items = crumbs(name);
    context.setTitle(name);
    if (notSaved) status.textContent = notSaved;
    else if (pending) status.textContent = doc.state === "new" ? "Not saved yet" : "Draft · saving in a moment…";
    else if (doc.state === "new") status.textContent = `${isRecipePost() ? "New recipe" : "New story"}. Add a title and your draft will save itself.`;
    else status.textContent = statusLine({ state: doc.state, savedAt, dirtyPublished: isPublished() && dirty, date: form.date || current.date }, now());
    if (doc.url && doc.state === "published" && !dirty) status.append(" ", h("a", { href: link(), target: "_blank", rel: "noopener", text: "See it on your site" }));
    more.items = menuItems();
  }

  // One list of what she can do with this post: More shows her items first and the ones for
  // whoever set up the site last; Find shows them all with their keys.
  function commands() {
    const mac = isMacLike();
    return [
      { id: "save", label: "Save", hint: mac ? "⌘S" : "Ctrl S", more: false },
      { id: "publish", label: "Publish or update", hint: mac ? "⌘↵" : "Ctrl Enter", more: false },
      { id: "preview", label: "See how it looks", more: false },
      { id: "takeoff", label: "Take it off my site", when: doc.state === "published" },
      { id: "draft", label: saveLabel.textContent, when: narrow() && doc.state !== "published", palette: false },
      { id: "about", label: "More about this recipe", when: isRecipePost() },
      { id: "view", label: "See it on your site", when: Boolean(doc.url) && isPublished() },
      { id: "delete", label: doc.path ? "Delete this post" : "Throw this away" },
      { id: "plain", label: "Write it all in one box", when: isRecipePost() && body.usesBoxes() },
      { id: "boxes", label: "Use the recipe boxes", when: isRecipePost() && !body.usesBoxes() },
      { id: "details", label: "Show details" },
      { id: "old", label: "Open in the old Admin", when: Boolean(doc.path) },
    ].filter((command) => command.when !== false);
  }
  const menuItems = () => commands().filter((c) => c.more !== false).map((c) => ({ value: c.id, label: c.label }));

  async function fill(values) {
    title.value = values.title;
    const parts = splitInstant(values.date || "");
    day.value = parts.date;
    time.value = parts.time;
    tags.value = [...values.tags];
    if (numbers && values.extra) numbers.set(values.extra);
    await body.set(values.body, { boxes: isRecipePost() });
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

  // ---- See how it looks
  async function preview(opener) {
    const values = read();
    await showPreview(api, {
      path: doc.path, title: values.title.trim(),
      fields: fieldsFor(values, "draft"), body: values.body, opener,
      problemsView: isRecipePost() ? recipeProblems : null,
    });
  }

  function recipeProblems(problems, close) {
    const items = problems.map((problem) => {
      const { words: said, target } = adviceFor(problem);
      return h("li", {}, said, " ", target ? h("action-button", { variant: "link", onClick: () => { close(); requestAnimationFrame(() => goTo(target)); } }, "Go to it") : null);
    });
    return h("alert-banner", { variant: "warning", heading: `A few things to check (${problems.length})` }, h("ul", { class: "studio-checks" }, items));
  }

  function goTo(target) {
    if (target.field && ["servings", "prep", "cook", "course", "cuisine", "series"].includes(target.field)) numbers?.focus(target.field);
    else body.focus(target);
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
      kept.keep(keptKey, "", read());
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

  async function saveNow(intent, { quiet = false, force = false } = {}) {
    clearTimeout(timer);
    timer = 0;
    if (saving) await saving.catch(() => {});
    // Nothing changed: nothing to send. Publishing a draft, or unscheduling, is still a change.
    if (nothingToSave({ dirty, path: doc.path, state: doc.state, intent, force })) {
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
    const fields = fieldsFor(values, intent);
    const button = intent === "publish" ? primary : save;
    const wasLive = doc.state === "published";
    if (!quiet) button.loading = true;
    saving = (async () => {
      const reply = await sendPost(api, doc, fields, values.body);
      if (!doc.path) {
        context.replaceRoute(`#/write/${encodeURIComponent(reply.path)}`);
        kept.clear(keptKey);
      }
      Object.assign(doc, afterSave(doc, reply, fields));
      form = { ...values, cover: form.cover, coverAlt: form.coverAlt, date: fields.date || "" };
      savedAt = now();
      lastLayout = layoutOf(reply);
      kept.clear(doc.path);
      context.posts?.stale();
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
      else if (!quiet && !force) toast(doc.state === "draft" ? "Saved as a draft." : "Saved.");
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
    else if (when) toast(`${when}.`);
    else {
      const said = wentOutWords(result, { meta, action: wasLive ? "updated" : "published" });
      toast(said.words, { variant: said.variant });
    }
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
    paint();
    if (theirs.etag === doc.etag) return banner.replaceChildren(busyBanner());
    const later = () => banner.replaceChildren(chooseLaterBanner(() => resolveConflict(theirs, later)));
    // An autosave never springs a question on her: it says so, and she chooses when she's ready.
    if (quiet) return later();
    await resolveConflict(theirs, later);
  }

  async function resolveConflict(theirs, later) {
    const mine = read();
    const theirState = postState(theirs, now());
    const choice = await askWhichToKeep({ name: mine.title.trim() || "This post", theirState, myState: doc.state });
    if (choice === null) return later();
    doc.etag = theirs.etag;
    doc.fields = { ...theirs.fields };
    doc.state = theirState;
    if (choice === "mine") {
      dirty = true;
      await saveNow(theirState === "draft" ? "draft" : "publish", { force: true });
      return;
    }
    banner.replaceChildren(mineAside(mine, copy));
    doc.url = theirs.url || doc.url;
    form = { ...formFromDocument(theirs), extra: theirs.fields || {} };
    await fill(form);
    notSaved = "";
    settle();
    paint();
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("Copied. Paste it wherever you need it."); } catch { toast("Select the words and copy them yourself.", { variant: "warning" }); }
  }

  // Ctrl/⌘ S. Saving a published post never puts half-done words on her site: they stay on this
  // device until she presses Update.
  function saveCommand() {
    if (doc.state !== "published") return saveNow(doc.state === "scheduled" ? "publish" : "draft");
    if (dirty) kept.keep(doc.path, doc.etag, read());
    toast(dirty ? "Kept on this device. Press Update to put your changes on your site." : "Nothing's changed. Your site already has this.");
  }

  // ---- More and Find
  async function run(value) {
    if (value === "save") saveCommand();
    if (value === "publish") saveNow("publish");
    if (value === "preview") preview(look.querySelector("button"));
    if (value === "details") showDetails();
    if (value === "view" && doc.url) open(link(), "_blank", "noopener");
    if (value === "old" && doc.path) location.href = `/admin#/edit/${encodeURIComponent(doc.path)}`;
    if (value === "draft") saveNow("draft");
    if (value === "about") numbers?.openAbout();
    if (value === "takeoff" && doc.state === "published") takeOff();
    if (value === "delete") remove();
    if (value === "plain") { await body.toPlain(); paint(); }
    if (value === "boxes") { await body.toBoxes(); paint(); }
  }

  function showDetails() {
    const values = read();
    details.replaceChildren(
      h("span", { slot: "heading", text: "About this post" }),
      postDetails({ path: doc.path, link: doc.url ? link() : "", words: values.body.trim() ? values.body.trim().split(/\s+/).length : 0, savedAt, layout: lastLayout, publish: lastPublish, goesOut }),
      ...(body.plainWhy() ? [h("p", { class: "studio-help", text: `Recipe boxes: not used, because ${body.plainWhy()}.` })] : []));
    details.open = true;
  }

  async function takeOff(asked = false) {
    if (!asked && (await ask(takeOffQuestion(read().title.trim() || "this post"))) !== "yes") return;
    // Her latest changes come along: it's saved as a draft with what's on screen.
    if (!(await saveNow("draft", { force: true }))) return;
    const sent = await sendOut(api, `Take ${form.title} off the site`);
    lastPublish = sent;
    const said = wentOutWords(sent, { meta, action: "takenOff" });
    toast(said.words, { variant: said.variant });
    paint();
  }

  async function remove() {
    const name = read().title.trim() || "this post";
    if (!doc.path) {
      const choice = await ask({ heading: "Throw this away?", text: "It hasn't been saved, so it can't be brought back.", choices: [{ label: "Throw it away", value: "yes", variant: "destructive" }, { label: "Keep writing", value: "no", variant: "secondary" }] });
      if (choice !== "yes") return;
      kept.clear(keptKey);
      settle();
      context.go("#/posts");
      return;
    }
    // Undo brings back what she saw, so a draft's pending changes are saved first.
    if (dirty && !isPublished() && !(await saveNow("draft", { quiet: true }))) return;
    const deleted = await context.undo.deletePost({
      path: doc.path, etag: doc.etag, title: name, state: doc.state, ask,
      fieldJournal: doc.fields.profile === "field-journal",
      takeOff: () => takeOff(true),
    });
    if (deleted) {
      kept.clear(doc.path);
      settle();
      context.go("#/posts");
    }
  }

  // ---- leaving
  async function leave() {
    clearTimeout(timer);
    timer = 0;
    if (!dirty) return true;
    const values = read();
    if (doc.state === "new" && !values.title.trim()) {
      if (!values.body.trim() && !form.cover) { kept.clear(keptKey); return true; }
      const choice = await ask({ heading: "Leave without a title?", text: ["A post needs a title to be kept as a draft.", "If you leave, your words wait on this device for next time."], choices: [{ label: "Add a title", value: "stay" }, { label: "Leave for now", value: "go", variant: "secondary" }, { label: "Throw it away", value: "discard", variant: "destructive" }] });
      if (choice === "stay" || choice === null) { setTimeout(() => title.querySelector("input")?.focus(), 0); return false; }
      if (choice === "discard") kept.clear(keptKey);
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
        banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "This post didn't open" }, error.message,
          h("action-button", { variant: "secondary", href: "#/posts" }, "Back to your posts")));
        element.querySelector(".studio-write-grid").hidden = true;
        element.querySelector(".studio-write-bar").hidden = true;
        return;
      }
      if (reply.raw !== undefined && !reply.fields) {
        banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "This post can't be changed here" }, "Something in it needs fixing first. Open it in the old Admin."));
        element.querySelector(".studio-write-grid").hidden = true;
        primary.hidden = true;
        save.hidden = true;
        look.hidden = true;
        return;
      }
      doc.etag = reply.etag;
      doc.fields = { ...reply.fields };
      form = { ...formFromDocument(reply), extra: {} };
      doc.state = postState(reply, now());
      doc.url = reply.url || "";
    }
    if (isRecipePost()) {
      const recipeFields = meta.profiles?.find((profile) => profile.id === "recipe")?.fields || [];
      numbers = await recipeNumbers(doc.fields, { onChange: changed, suggestions: Object.fromEntries(recipeFields.map((field) => [field.key, field.suggestions])) });
      numbersHost.replaceChildren(numbers.element);
      form.extra = numbers.values();
    }
    await fill(form);
    await buildCover();
    settle();
    const back = kept.get(keptKey);
    if (back && (!path || isPublished())) {
      banner.replaceChildren(keptBanner(!path, {
        restore: async () => {
          await fill({ ...form, ...back.form });
          form.cover = back.form.cover ?? form.cover;
          form.coverAlt = back.form.coverAlt ?? form.coverAlt;
          banner.replaceChildren();
          await buildCover();
          changed();
          title.querySelector("input")?.focus();
        },
        drop: () => { kept.clear(keptKey); banner.replaceChildren(); },
      }));
    }
    for (const field of [title, time, day, tags]) field.addEventListener("valuechange", changed);
    title.addEventListener("focusout", () => {
      titleLeft = true;
      if (doc.state === "new" && dirty && ready() && !timer) changed();
    });
    paint();
    await asking;
  }

  return {
    title: path ? "Write" : starting === "recipe" ? "New recipe" : "New post",
    element,
    load,
    leave,
    isDirty: () => dirty,
    focus() {
      // Open at the top of the post, whatever was scrolled before. Only the screen's own scroller
      // moves; the page itself never does, so the top bar stays put.
      for (let box = element.parentElement; box; box = box.parentElement) {
        if (box.scrollHeight > box.clientHeight && getComputedStyle(box).overflowY !== "visible") { box.scrollTop = 0; break; }
      }
      if (path) element.querySelector("h2").focus({ preventScroll: true });
      else title.querySelector("input")?.focus({ preventScroll: true });
    },
    get palette() {
      return commands().filter((c) => c.palette !== false).map((c) => ({ id: c.id, label: c.label, group: "This post", hint: c.hint }));
    },
    command: run,
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
