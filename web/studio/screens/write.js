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
import { keptBanner, postDetails } from "../parts/post-details.js";
import { isRecipe } from "../parts/recipe-fields.js";
import { recipeNumbers } from "../parts/recipe-numbers.js";
import { createBodyHost } from "../parts/body-host.js";
import { adviceFor } from "../parts/recipe-advice.js";
import { showPreview } from "../parts/preview.js";
import { createTrouble } from "../parts/write-trouble.js";
import { collectionOptions, crumbs, isMacLike, writeCommands, writePage } from "../parts/write-page.js";
import { postActions } from "../parts/write-actions.js";

const AUTOSAVE_MS = 3000;
const narrow = () => globalThis.matchMedia?.("(max-width: 40rem)").matches;

export async function createWrite(context, arg) {
  const { api, meta } = context;
  await use("text-field", "date-field", "tag-input", "select-field", "action-button", "dropdown-menu", "side-sheet", "breadcrumb-trail", "alert-banner", "cluster-layout", "loading-spinner");
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
  const body = await createBodyHost({ api, maxBytes: meta.capture?.maxPhotoBytes || 0, onChange: () => changed() });
  const { trail, status, banner, title, numbersHost, day, time, tags, cover, collection, saveLabel, save, primaryLabel, primary, look, more, details, element } = writePage({
    meta, body, on: { save: () => saveNow("draft"), publish: () => saveNow("publish"), preview: (opener) => preview(opener), command: (id) => run(id) },
  });

  // ---- reading the form
  const bodyText = () => body.text();
  const read = () => ({
    ...form,
    title: String(title.value || ""),
    body: bodyText(),
    date: safeJoin(day.value || "", time.value || ""),
    tags: [...(tags.value || [])],
    extra: { ...(numbers ? numbers.values() : {}), ...(collection.hidden ? {} : { series: String(collection.value || "") }) },
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

  const commands = () => writeCommands({
    state: doc.state, path: doc.path, url: doc.url, recipe: isRecipePost(), boxes: body.usesBoxes(),
    saveLabel: saveLabel.textContent, narrow: narrow(), mac: isMacLike(),
  });
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
      await trouble.problem(error, intent, quiet);
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

  const trouble = createTrouble({
    api, banner, title, doc, read, now, paint, saveNow,
    notSaved: (words) => { notSaved = words; },
    markDirty: () => { dirty = true; },
    takeTheirs: async (theirs) => {
      doc.url = theirs.url || doc.url;
      form = { ...formFromDocument(theirs), extra: theirs.fields || {} };
      await fill(form);
      notSaved = "";
      settle();
      paint();
    },
  });

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

  const { takeOff, remove } = postActions({
    api, meta, ask, kept, keptKey, doc, context,
    title: () => read().title.trim(), formTitle: () => form.title,
    isDirty: () => dirty, isPublished, saveNow, settle, paint,
    published: (sent) => { lastPublish = sent; },
  });

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
    // The collections as they are now (one added a minute ago is there), and this post's own.
    const series = (await api.get("documents?kind=series").catch(() => null))?.items || [];
    const offer = collectionOptions(series, Array.isArray(doc.fields.series) ? doc.fields.series[0] : doc.fields.series);
    collection.options = offer.options;
    collection.value = offer.value;
    collection.hidden = offer.options.length < 2;
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
    for (const field of [title, time, day, tags, collection]) field.addEventListener("valuechange", changed);
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
