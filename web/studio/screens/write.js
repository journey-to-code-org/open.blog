// Write: a new post or an existing one. Title, the words (or, for a recipe, the recipe boxes),
// when it appears, tags, a cover photo, and About this post (R5: what kind of post, the line under
// the title, the summary, who wrote it, and the details). Drafts save themselves; a published post
// changes on the site only when she presses Update (until then her edits are kept on this device).
// Nothing she types is lost: not on a conflict, not when her session runs out, not when she leaves
// or reloads.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { coverPicker } from "../parts/cover-picker.js";
import { createKept } from "../parts/kept.js";
import { isFuture, joinInstant, sayDay, splitInstant } from "../parts/dates.js";
import { formFromDocument, postState, primaryAction, statusLine } from "../parts/post-fields.js";
import { afterSave, fieldsForSave, layoutOf, nothingToSave, sendPost } from "../parts/post-session.js";
import { howItGoesOut, servedHere, siteLink } from "../parts/publish.js";
import { keptBanner, postDetails } from "../parts/post-details.js";
import { createBodyHost } from "../parts/body-host.js";
import { adviceFor } from "../parts/recipe-advice.js";
import { showPreview } from "../parts/preview.js";
import { cantOpen, createTrouble, unreadable } from "../parts/write-trouble.js";
import { collectionOptions, crumbs, isMacLike, writeCommands, writePage } from "../parts/write-page.js";
import { postActions } from "../parts/write-actions.js";
import { localDay } from "../parts/job-rules.js";
import { createAboutPost } from "../parts/about-post.js";
import { createWhen } from "../parts/write-when.js";
import { createKindParts } from "../parts/write-kind.js";
import { fileSlug } from "../parts/about-rules.js";

const AUTOSAVE_MS = 3000;
const narrow = () => globalThis.matchMedia?.("(max-width: 40rem)").matches;
/** Recipe advice that Go to it takes to About this post › This recipe, by its field there. */
const ABOUT_TARGETS = { course: "course", cuisine: "cuisine", total: "totalTime", adaptedFrom: "adaptedFrom", yield: "yield", calories: "calories" };
const SHEET_GROUPS = { "about-search": "search", "about-credits": "credits", "about-recipe": "recipe", "about-details": "details" };

export async function createWrite(context, arg, route = {}) {
  const { api, meta } = context;
  await use("text-field", "date-field", "tag-input", "select-field", "action-button", "dropdown-menu", "side-sheet", "breadcrumb-trail", "alert-banner", "cluster-layout", "loading-spinner");
  const starting = /^new\/(recipe|story|job)$/.exec(arg || "")?.[1] || (arg ? "" : "story");
  const path = starting ? "" : arg;
  const keptKey = starting ? `new-${starting}` : path;
  const kept = createKept(safeStorage(), api.user);
  const doc = { path, etag: "", fields: starting === "recipe" ? { profile: "recipe" } : starting === "job" ? newJobFields(meta) : {}, url: "", state: path ? "draft" : "new", creditEtag: null, wasPublished: undefined, excerpt: "", slug: "" };
  let form = { title: "", date: "", tags: [], cover: "", coverAlt: "", draft: true, body: "", extra: {} };
  let baseline = "";
  let dirty = false;
  let pending = false;
  let notSaved = "";
  let goToProblem = null; // "Go to it" for a problem in About this post
  let savedAt = null;
  let saving = null;
  let timer = 0;
  let titleLeft = false;
  let lastPublish = null;
  let lastLayout = null;
  let goesOut = null;
  let writeUpReady = false;
  let picker = null;
  let sheetOnOpen = null; // ?sheet=about: opened once the screen has focus

  // ---- the page
  const body = await createBodyHost({ api, maxBytes: meta.capture?.maxPhotoBytes || 0, onChange: () => changed() });
  const { trail, status, banner, title, numbersHost, day, time, tags, cover, collection, saveLabel, save, primaryLabel, primary, look, more, whenHelp, about: aboutButton, aboutLine, element } = writePage({
    meta, body, on: { save: () => saveNow("draft"), publish: () => saveNow("publish"), preview: (opener) => preview(opener), command: (id) => run(id), about: (opener) => about.open({ from: opener }) },
  });
  const when = createWhen({ day, time, help: whenHelp, state: () => doc.state, schedule: () => scheduleTruth() });
  const about = await createAboutPost({
    api, meta, maxBytes: meta.capture?.maxPhotoBytes || 0,
    post: () => ({ state: doc.state, wasPublished: doc.wasPublished, path: doc.path, fields: doc.fields, title: String(title.value || "").trim(), url: doc.url,
      excerpt: doc.excerpt, cover: form.cover, coverAlt: form.coverAlt, collection: collectionName(), body: bodyText(), dirty, facts: facts() }),
    onChange: () => changed(), onKind: (from, to, options) => switchKind(from, to, options), addParts: () => addRecipeParts(),
    goPeople: (options) => goPeople(options), setCoverAddress: (url) => picker?.setAddress(url),
  });
  // A recipe's numbers and a job's About this job (R4), under the title.
  const kindPart = createKindParts({ api, meta, doc, host: numbersHost, body, banner, title, say: (words) => { status.textContent = words; }, changed: () => changed(),
    capture: () => captureOf, onWriteUp: (ready) => { writeUpReady = ready; paint(); } });
  const numbers = () => kindPart.numbers();
  const job = () => kindPart.job();
  element.append(about.element);
  about.onLine((line) => { aboutLine.textContent = line; aboutButton.label = `About this post: ${line}`; });

  // ---- reading the form
  const bodyText = () => body.text();
  const kind = () => about.kind();
  const isRecipePost = () => kind() === "recipe";
  const isJob = () => kind() === "job";
  const read = () => ({
    ...form,
    title: String(title.value || ""),
    body: bodyText(),
    date: safeJoin(day.value || "", time.value || ""),
    tags: [...(tags.value || [])],
    extra: { ...kindPart.values((summary) => about.setValue("description", summary)), ...(collection.hidden ? {} : { series: String(collection.value || "") }), ...about.extra() },
    aboutKept: about.keep(),
  });
  const snapshot = () => JSON.stringify({ ...read(), draft: undefined });
  const now = () => new Date();
  const isPublished = () => doc.state === "published" || doc.state === "scheduled";
  const link = () => siteLink(meta, doc.url, { local: !goesOut || goesOut.kind === "none" });
  const collectionName = () => (collection.hidden || !collection.value ? "" : (collection.options || []).find((o) => o.value === collection.value)?.label?.replace(/ \(no page of its own yet\)$/, "") || String(collection.value));
  // A promise about when a post goes up is made only when it's kept (G37): a site whose public
  // address is elsewhere and that nothing sends out is "the next time it's sent out".
  const scheduleTruth = () => (meta.schedule === "self" && goesOut?.kind === "none" && !servedHere(meta) ? "next-send" : meta.schedule ?? null);

  const fieldsFor = (values, intent) => fieldsForSave(doc.fields, form, values, intent, { now: now() });

  function paint() {
    const current = read();
    const action = doc.state === "published" ? "Update" : primaryAction(doc.state === "new" ? "draft" : doc.state, current.date, now());
    primaryLabel.textContent = action;
    saveLabel.textContent = doc.state === "scheduled" ? "Make it a draft again" : "Save draft";
    save.hidden = doc.state === "published";
    const name = current.title.trim() || (isRecipePost() ? "New recipe" : isJob() ? "New job" : "New post");
    trail.items = crumbs(name);
    context.setTitle(name);
    if (notSaved) status.textContent = notSaved;
    else if (pending) status.textContent = doc.state === "new" ? "Not saved yet" : "Draft · saving in a moment…";
    else if (doc.state === "new") status.textContent = `${isRecipePost() ? "New recipe" : isJob() ? "New job" : "New story"}. Add a title and your draft will save itself.`;
    else status.textContent = statusLine({ state: doc.state, savedAt, dirtyPublished: isPublished() && dirty, date: form.date || current.date }, now());
    if (notSaved && goToProblem) status.append(" ", h("action-button", { variant: "link", onClick: goToProblem }, "Go to it"));
    if (doc.url && doc.state === "published" && !dirty) status.append(" ", h("a", { href: link(), target: "_blank", rel: "noopener", text: "See it on your site" }));
    if (doc.path && doc.state === "published" && !dirty && isJob()) status.append(" · ", h("a", { href: shareJobHref(), text: "Share this job" }));
    aboutLine.textContent = about.line({ unsent: isPublished() && dirty });
    aboutButton.label = `About this post: ${aboutLine.textContent}`;
    when.paint();
    about.paintFooter();
    more.items = menuItems();
  }

  const commands = () => writeCommands({
    state: doc.state, path: doc.path, url: doc.url, recipe: isRecipePost(), boxes: body.usesBoxes(),
    saveLabel: saveLabel.textContent, narrow: narrow(), mac: isMacLike(), job: isJob(), writeUp: writeUpReady,
  });
  const shareJobHref = () => `#/sharing/job/${encodeURIComponent(doc.path)}?from=write`;
  const menuItems = () => commands().filter((c) => c.more !== false).map((c) => ({ value: c.id, label: c.label }));

  /** What kind of post changed (or was undone): the boxes follow, and her words stay hers. */
  async function switchKind(from, to, options) {
    const said = await kindPart.switch(from, to, bodyText(), options);
    changed();
    return said;
  }

  async function addRecipeParts() {
    await kindPart.addRecipeParts(bodyText());
    changed();
  }

  async function fill(values) {
    title.value = values.title;
    const parts = splitInstant(values.date || "");
    day.value = parts.date;
    time.value = parts.time;
    when.reset();
    tags.value = [...values.tags];
    kindPart.set(values.extra);
    await body.set(values.body, kindPart.bodyOptions());
  }

  function settle() {
    baseline = snapshot();
    dirty = false;
    pending = false;
  }

  async function buildCover() {
    picker = await coverPicker({ api, cover: form.cover, coverAlt: form.coverAlt, coverCredit: about.value("coverCredit"), maxBytes: meta.capture?.maxPhotoBytes || 0,
      onChange: (v) => { form.cover = v.cover; form.coverAlt = v.coverAlt; about.setValue("coverCredit", v.coverCredit); about.paintCard(); changed(); } });
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
    if (target.field && numbers()?.has(target.field)) numbers().focus(target.field);
    else if (target.field && ABOUT_TARGETS[target.field]) about.open({ group: "recipe", focusName: ABOUT_TARGETS[target.field], from: look });
    else if (target.field === "series") collection.querySelector("select")?.focus();
    else if (target.field === "cover") cover.querySelector("input, button")?.focus();
    else body.focus(target);
  }

  // ---- changes and saving
  // Dirty means different from what was last saved or opened, not "a field was touched".
  function changed() {
    dirty = snapshot() !== baseline;
    notSaved = "";
    goToProblem = null;
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

  // Her checks before any save (an autosave too): a problem stops it, and says where.
  function checksStop(quiet) {
    const whenWrong = when.problem();
    if (whenWrong) {
      notSaved = `Not saved yet: ${whenWrong.charAt(0).toLowerCase()}${whenWrong.slice(1)}`;
      goToProblem = () => when.focusTime();
      if (!quiet) when.focusTime();
      return true;
    }
    const [first] = about.problems();
    if (!first) { about.clearProblems(); return false; }
    notSaved = "Not saved yet: one thing in About this post needs a look.";
    goToProblem = () => about.showProblem(first.name, first.words, { from: aboutButton });
    if (!quiet) goToProblem();
    return true;
  }

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
    if (checksStop(quiet)) { pending = false; paint(); return false; }
    const fields = fieldsFor(values, intent);
    const button = intent === "publish" ? primary : save;
    // A job is checked the way the build checks it before it goes up; a draft always saves.
    if (intent === "publish" && job() && !(await job().check(fields))) {
      pending = false;
      paint();
      if (!quiet) banner.querySelector("alert-banner")?.scrollIntoView?.({ block: "nearest" });
      return false;
    }
    // A post on her site moved to a later day comes off until then: asked once.
    if (intent === "publish" && doc.state === "published" && isFuture(fields.date || "", now()) && !(await when.confirmMove())) { pending = false; paint(); return false; }
    const wasLive = doc.state === "published";
    const wasScheduled = doc.state === "scheduled";
    const credits = about.credits();
    const aboutSent = about.extra();
    if (!quiet) button.loading = true;
    saving = (async () => {
      const reply = await sendPost(api, doc, fields, values.body, { credits });
      if (!doc.path) {
        context.replaceRoute(`#/write/${encodeURIComponent(reply.path)}`);
        kept.clear(keptKey);
      }
      Object.assign(doc, afterSave(doc, reply, fields));
      if (doc.state === "published") doc.wasPublished = true;
      if (!doc.slug) doc.slug = fileSlug(doc.path);
      about.saved({ fields: doc.fields, sentCredits: credits, sent: values.aboutKept.about });
      form = { ...values, cover: form.cover, coverAlt: form.coverAlt, date: fields.date || "" };
      savedAt = now();
      lastLayout = layoutOf(reply);
      kept.clear(doc.path);
      context.posts?.stale();
      return reply;
    })();
    try {
      await saving;
      // Typing during the save keeps those words unsaved: compare against what was sent. What the
      // sheet sent is now the post's own, so it no longer shows as a change.
      const extra = Object.fromEntries(Object.entries(values.extra).filter(([key]) => !(key in aboutSent)));
      baseline = JSON.stringify({ ...values, extra, aboutKept: { about: values.aboutKept.about }, cover: form.cover, coverAlt: form.coverAlt, draft: undefined });
      dirty = snapshot() !== baseline;
      pending = false;
      notSaved = "";
      when.reset(); // the time is hers now: the help says when it really goes up
      banner.replaceChildren();
      paint();
      if (intent === "publish") await announce(wasLive);
      else if (wasScheduled && doc.state === "draft") toast(`It won't go up on ${sayDay(form.date, { now: now() }).replace(/^(Today|Yesterday)/, (w) => w.toLowerCase()) || "its day"}. It's a draft again.`);
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

  const trouble = createTrouble({
    api, banner, title, day, doc, read, now, paint, saveNow, about,
    notSaved: (words) => { notSaved = words; },
    markDirty: () => { dirty = true; },
    aboutProblem: (name, words, quiet) => {
      goToProblem = () => about.showProblem(name, words, { from: aboutButton });
      notSaved = "Not saved yet: one thing in About this post needs a look.";
      if (!quiet) goToProblem();
    },
    saveAsNew: async () => {
      doc.path = ""; doc.etag = ""; doc.state = "new"; doc.creditEtag = null;
      banner.replaceChildren();
      await saveNow("draft", { force: true });
    },
    takeTheirs: async (theirs) => {
      doc.url = theirs.url || doc.url;
      form = { ...formFromDocument(theirs), extra: theirs.fields || {} };
      about.load(doc.fields, theirs);
      doc.creditEtag = theirs.creditEtag ?? null;
      await kindPart.ensure(kind());
      await fill(form);
      await buildCover();
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
    if (value === "about-post") about.open({ from: aboutButton });
    if (SHEET_GROUPS[value]) about.open({ group: SHEET_GROUPS[value], from: aboutButton });
    if (value === "people") context.go("#/people");
    if (value === "view" && doc.url) open(link(), "_blank", "noopener");
    if (value === "share-job" && doc.path) context.go(shareJobHref());
    if (value === "write-up" && job()) job().writeUp(more.querySelector("button"));
    if (value === "draft") saveNow("draft");
    if (value === "takeoff" && doc.state === "published") takeOff();
    if (value === "delete") remove();
    if (value === "plain") { await body.toPlain(); paint(); }
    if (value === "boxes") { await body.toBoxes(); paint(); }
  }

  /** The file's facts, for Details in About this post. */
  function facts() {
    const values = { body: bodyText() };
    return h("div", {},
      postDetails({ path: doc.path, link: doc.url ? link() : "", words: values.body.trim() ? values.body.trim().split(/\s+/).length : 0, savedAt, layout: lastLayout, publish: lastPublish, goesOut, schedule: scheduleTruth(), nextDue: goesOut?.info?.nextDue ?? null }),
      body.plainWhy() ? h("p", { class: "studio-help", text: `Recipe boxes: not used, because ${body.plainWhy()}.` }) : null);
  }

  // People, to add someone who isn't listed: a new post saves first, so there's a way back to it.
  async function goPeople({ add = false } = {}) {
    if (!doc.path && !(await saveNow("draft"))) return;
    about.close();
    context.go(`#/people?from=${encodeURIComponent(doc.path)}${add ? "&add=1" : ""}`);
  }

  const { takeOff, remove, announce, leave: leaveNow } = postActions({
    api, meta, ask, kept, keptKey, doc, context,
    title: () => read().title.trim(), formTitle: () => form.title,
    isDirty: () => dirty, isPublished, saveNow, settle, paint,
    published: (sent) => { lastPublish = sent; },
    banner, form: () => form, now, schedule: () => scheduleTruth(), read, verb: () => primaryLabel.textContent, focusTitle: () => title.querySelector("input")?.focus(),
  });
  const leave = () => { clearTimeout(timer); timer = 0; return leaveNow(); };

  // ---- loading
  let captureOf = null; // the job's capture: its voice note (R4 G30)
  async function load() {
    const asking = howItGoesOut(api).then((how) => { goesOut = how; paint(); });
    let reply = {};
    if (path) {
      try {
        reply = await api.get(`document?path=${encodeURIComponent(path)}`);
      } catch (error) {
        cantOpen(banner, error);
        for (const part of [element.querySelector(".studio-write-grid"), element.querySelector(".studio-write-bar")]) part.hidden = true;
        return;
      }
      if (reply.raw !== undefined && !reply.fields) {
        // The file's settings at the top can't be read: the server's reason and the file, never the old Admin.
        unreadable(banner, path, reply);
        for (const part of [element.querySelector(".studio-write-grid"), primary, save, look, more]) part.hidden = true;
        return;
      }
      doc.etag = reply.etag;
      doc.fields = { ...reply.fields };
      doc.creditEtag = reply.creditEtag ?? null;
      doc.wasPublished = typeof reply.wasPublished === "boolean" ? reply.wasPublished : undefined;
      doc.excerpt = String(reply.excerpt || "");
      doc.slug = String(reply.slug || fileSlug(path));
      captureOf = reply.capture && typeof reply.capture.id === "string" ? reply.capture : null;
      form = { ...formFromDocument(reply), extra: {} };
      doc.state = postState(reply, now());
      doc.url = reply.url || "";
    }
    about.load(doc.fields, reply);
    if (!path && isJob() && !form.body) form.body = meta.job?.scaffold || "";
    await kindPart.ensure(kind());
    if (numbers()) form.extra = numbers().values();
    // The collections as they are now (one added a minute ago is there), and this post's own.
    const series = (await api.get("documents?kind=series").catch(() => null))?.items || [];
    const offer = collectionOptions(series, Array.isArray(doc.fields.series) ? doc.fields.series[0] : doc.fields.series);
    collection.options = offer.options;
    collection.value = offer.value;
    collection.hidden = offer.options.length < 2;
    await fill(form);
    await buildCover();
    about.refresh();
    settle();
    const back = kept.get(keptKey);
    if (back && (!path || isPublished())) {
      banner.replaceChildren(keptBanner(!path, {
        restore: async () => {
          // A copy kept before About this post has only its fields: the sheet reads them from there.
          about.restore(back.form.aboutKept || { about: about.fromFields({ ...doc.fields, ...(back.form.extra || {}) }) });
          await kindPart.ensure(kind());
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
    collection.addEventListener("valuechange", () => { about.refresh(); changed(); });
    title.addEventListener("valuechange", () => about.paintCard());
    title.addEventListener("focusout", () => {
      titleLeft = true;
      if (doc.state === "new" && dirty && ready() && !timer) changed();
    });
    // ?sheet=about (an old Settings link, Find, People's Back): opened once Write has focus.
    const query = route.query || {};
    if (query.add) about.addPerson(String(query.add));
    if (query.sheet === "about") sheetOnOpen = { sheet: query.sheet, group: query.group || (query.add ? "credits" : "") };
    paint();
    await asking;
  }

  // Closing a sheet a link opened takes the query off the address, so Back and reload don't reopen it.
  const plainAddress = () => { if (doc.path) context.replaceRoute(`#/write/${encodeURIComponent(doc.path)}`); };

  return {
    title: path ? "Write" : starting === "recipe" ? "New recipe" : starting === "job" ? "New job" : "New post",
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
      if (sheetOnOpen) {
        const { sheet, group } = sheetOnOpen;
        sheetOnOpen = null;
        if (sheet === "about") about.open({ group, from: aboutButton, closed: plainAddress });
      }
    },
    get palette() {
      return commands().filter((c) => c.palette !== false).map((c) => ({ id: c.id, label: c.label, group: "This post", hint: c.hint }));
    },
    command: run,
  };
}

/** A job started at a desk: today for Started and Finished, and the site's trade. */
function newJobFields(meta) {
  const today = localDay(new Date());
  return { profile: "job", "job.started": today, "job.finished": today, ...(meta.job?.siteTrade ? { "job.trade": meta.job.siteTrade } : {}) };
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
