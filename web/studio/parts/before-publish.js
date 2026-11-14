// Before you publish (Studio R7): one sheet that answers "Is there anything I should look at
// before people see this?". It opens by itself on a post's first Publish when it has something to
// show (shouldOpenOnPublish), and any time from the side card, More, Find or R6's Suggestions.
// Checks suggest; only what the build would refuse blocks, and then Publish says why it waits.
// Groups: Needs fixing first, When it's shared, Suggestions, Your video, Your trip, Research
// checks, Worth a look, and the details. Every server value is text.
import { h, toast } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { trapFocus } from "./focus-trap.js";
import { innerAria } from "./inner-button.js";
import { createShareCard } from "./share-card.js";
import { createResearchReview } from "./research-review.js";
import { adviceFor } from "./recipe-advice.js";
import { a11yItems, buildProblems, mergeSuggestions, readyLine, readyProblem, readyState, searchHints } from "./ready-rules.js";
import { researchReviewApplies } from "./review-rules.js";
import { releaseRow, releaseWords } from "./video-rules.js";
import { routeLine, tripSuggestions } from "./route-rules.js";

const LIMIT_MS = 8000;
const AGAIN_MS = 1500;
const within = (promise, ms) => Promise.race([promise, new Promise((_, no) => setTimeout(() => no(Object.assign(new Error("slow"), { status: 504 })), ms))]);

/**
 * `write` is Write's side: { state(), kind(), request(), form(), suggestions, jobCheck(fields),
 * publish(), verb(), goTo(target), describeCover(text), openSheet(name, from), device(), kit(),
 * exactWaiting(), stage(), snapshot() }.
 */
export async function createBeforePublish({ api, meta, write }) {
  await use("side-sheet", "action-button", "alert-banner", "loading-spinner", "skeleton-block", "text-field");
  const heading = h("span", { slot: "heading", tabindex: "-1" });
  const status = h("p", { class: "studio-ready-status", role: "status", tabindex: "-1" });
  const did = h("p", { class: "studio-ready-did", hidden: true });
  const groups = h("div", { class: "studio-ready-body" });
  const note = h("p", { class: "studio-help studio-ready-note", id: "studio-ready-note", hidden: true, text: say("ready.blockedNote") });
  const keep = h("action-button", { variant: "secondary", onClick: () => close() }, say("ready.keepWriting"));
  const primary = h("action-button", { onClick: () => go() });
  const element = h("side-sheet", { label: say("ready.sheet"), side: "right", class: "studio-ready-sheet" },
    heading, status, did, groups, h("div", { slot: "actions", class: "studio-ready-actions" }, note, keep, primary));
  trapFocus(element, () => element.open);
  element.addEventListener("openchange", (event) => { if (event.target === element && !event.detail) finish(); });
  element.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); go(); }
  });
  const card = createShareCard({ meta, onNote: (target) => { close(); write.goTo({ field: target }); } });
  const research = createResearchReview({
    api, context: () => ({ post: write.request().path, firstBodyLine: lastServer?.firstBodyLine || 1, body: write.form().body }),
    show: (target) => { close(); write.goTo(target); }, reload: () => run({ again: true }), tell: (words, undo) => tell(words, undo),
  });

  // The side card under About this post: its name and readyLine.
  const lineText = h("span", { class: "studio-about-line" });
  const cardName = h("span", { class: "studio-about-name" });
  const sideCard = h("action-button", { variant: "secondary", class: "studio-about-open studio-ready-open", onClick: (e) => open({ from: e.currentTarget }) }, cardName, lineText);

  let opener = null;
  let shown = false;
  let turn = 0;
  let timer = 0;
  let checkedAt = null; // the snapshot of the post at the last finished check
  let ranFor = null; // the snapshot the last check started from
  let lineTimer = 0;
  let lastServer = null;
  let result = { blocks: 0, suggestions: 0, worth: 0, failure: "" };
  let view = null;

  // ---- running the checks
  async function run({ again = false } = {}) {
    const mine = ++turn;
    ranFor = write.snapshot();
    const request = write.request();
    const kind = write.kind();
    const research_ = researchReviewApplies(request.fields, kind === "research" ? "research" : "");
    view = { checking: true, again, request, kind, research: research_ };
    paint();
    const asks = {
      server: within(api.post("preview", { ...request, only: "checks" }), LIMIT_MS),
      job: kind === "job" ? write.jobCheck(request.fields) : Promise.resolve(null),
      research: research_ ? within(api.post("research/review", request), LIMIT_MS) : Promise.resolve(null),
      video: kind === "video" && request.path ? within(api.post("video/release", request), LIMIT_MS) : Promise.resolve(null),
    };
    const [server, job, review, video] = await Promise.allSettled([asks.server, asks.job, asks.research, asks.video]);
    if (mine !== turn) return result;
    for (const answer of [server, review, video]) if (answer.status === "rejected" && answer.reason?.status === 401) throw answer.reason;
    lastServer = server.status === "fulfilled" ? server.value : null;
    view = { ...view, checking: false, server: lastServer, serverError: server.status === "rejected" ? server.reason : null,
      job: job.status === "fulfilled" ? job.value : null, review: review.status === "fulfilled" ? review.value : null,
      reviewError: review.status === "rejected" ? review.reason : null, video: video.status === "fulfilled" ? video.value : null };
    checkedAt = write.snapshot();
    paint();
    return result;
  }

  /** Everything to show, from `view`: blocks, suggestions, worth, and what failed. */
  function gather() {
    const form = write.form();
    const kind = write.kind();
    const failure = view.serverError ? readyProblem(view.serverError) : "";
    const blocks = (view.job || []).map((problem) => ({ words: problem.words, target: { job: problem.field }, details: problem.message }));
    // A job the check stops is also a post the build refuses: said once, by the job's own words.
    if (failure === "build" && !blocks.length) blocks.push({ words: say("ready.build"), details: buildProblems(view.serverError).join(" ") });
    const local = write.suggestions.items();
    const hints = searchHints({ title: form.title, subtitle: form.subtitle, description: form.description, tags: form.tags, body: form.body, credited: form.credited }, meta);
    const engine = view.server ? a11yItems(view.server.accessibility, { body: form.body, firstBodyLine: view.server.firstBodyLine, coverAlt: form.coverAlt }) : { suggestions: [], worth: [], details: [] };
    const recipe = (view.server?.recipeProblems || []).map((problem) => ({ id: `recipe:${problem.code}`, problem, ...adviceFor(problem, form.fields) }));
    const has = { noName: hints.her.some((x) => x.id === "no-name"), noPicture: !form.cover };
    const merged = mergeSuggestions(local.filter((x) => !x.details), [...hints.her, ...engine.suggestions, ...recipe], { has });
    const trip = kind === "field-journal" ? tripSuggestions({ ...form.fields, profile: "field-journal" }) : [];
    const kit = kind === "video" ? write.kit(view.video) : null;
    const researchFailure = view.research && view.reviewError ? (view.reviewError.status === 422 ? "unreadable" : "failed") : "";
    const total = [...merged, ...trip, ...(kit ? kit.problems : [])];
    const state = readyState({
      suggestions: total, worth: engine.worth, blocks, research: view.review,
      failure: researchFailure === "failed" ? "research" : ["offline", "server", "too-long"].includes(failure) ? failure : failure === "not-found" ? "server" : "",
      checking: view.checking && !view.again, device: write.device(),
    });
    return { form, kind, blocks, merged, trip, kit, engine, hints, local, state, failure, researchFailure };
  }

  function paint() {
    const published = write.state() === "published";
    const name = published ? say("ready.sheetPublished") : say("ready.sheet");
    heading.textContent = name;
    element.label = name;
    cardName.textContent = name;
    if (!view || view.checking && !view.again && !shown) { paintCard(); paintPrimary(false); return; }
    const g = gather();
    result = { blocks: g.state.blocks, suggestions: g.state.suggestions, worth: g.state.worth, failure: view.checking ? "" : g.failure === "build" ? "" : g.failure, blocked: g.state.blocked, exactRoute: write.exactWaiting() };
    status.replaceChildren(view.checking ? h("loading-spinner", { label: say("ready.checking"), inline: true, class: "studio-ready-spinner" }) : "", " ",
      view.checking && view.again ? say("ready.checkingAgain") : g.state.words);
    if (!view.checking && (g.state.state === "partial" || g.researchFailure === "failed")) status.append(" ", h("action-button", { variant: "link", onClick: () => run({ again: true }) }, say("ready.checkAgain")));
    if (!view.checking && g.state.state === "nothing") status.append(h("span", { class: "studio-help studio-ready-nothing", text: ` ${say("ready.nothingHelp")}` }));
    groups.replaceChildren(...[blocksGroup(g), sharedGroup(g), suggestionsGroup(g), videoGroup(g), tripGroup(g), researchGroup(g), worthGroup(g), detailsGroup(g)].filter(Boolean));
    paintPrimary(g.state.blocked);
    paintCard();
  }

  // ---- groups
  const section = (id, title, ...children) => h("section", { class: `studio-ready-group studio-ready-${id}`, "aria-labelledby": `studio-ready-${id}-h` }, h("h3", { id: `studio-ready-${id}-h`, text: title }), ...children);
  const button = (label, onClick, extra = {}) => h("action-button", { variant: "secondary", size: "sm", onClick, ...extra }, label);
  const leaveTo = (target) => { close(); write.goTo(target); };

  function blocksGroup(g) {
    if (!g.blocks.length) return null;
    return section("blocks", say("ready.needsFixing", { count: String(g.state.blocks) }),
      h("ul", { class: "studio-ready-list" }, ...g.blocks.map((block) => h("li", { class: "studio-ready-item studio-ready-blocker" },
        h("p", { text: block.words }),
        block.target ? h("div", { class: "studio-ready-actions" }, button(say("ready.goToIt"), () => leaveTo(block.target), { label: `${say("ready.goToIt")}: ${block.words}` })) : null,
        block.details ? h("details", { class: "studio-help" }, h("summary", { text: say("common.detailsFor") }), h("p", { class: "studio-mono", text: block.details })) : null))));
  }

  function sharedGroup(g) {
    if (view.server?.social) card.show(view.server.social, { description: g.form.description, cover: g.form.cover });
    else if (view.checking) card.loading();
    else card.rough(write.roughCard(), { blocked: readyProblem(view.serverError) === "build" });
    return section("shared", say("ready.whenShared"), view.checking && !view.server ? h("skeleton-block", { class: "studio-ready-skeleton", lines: 4 }) : card.element);
  }

  function suggestionsGroup(g) {
    if (!g.merged.length) return null;
    return section("suggestions", say("ready.suggestionsHeading", { count: String(g.merged.length) }),
      h("ul", { class: "studio-ready-list" }, ...g.merged.map((item) => suggestionView(item))));
  }

  function suggestionView(item) {
    const words = item.words;
    const actions = h("div", { class: "studio-ready-actions" });
    const li = h("li", { class: "studio-ready-item" }, h("p", { text: words }), actions);
    const show = (target) => button(say("ready.showMe"), () => leaveTo(target), { label: say("ready.showMeLabel", { what: words }) });
    if (item.from === "local") {
      actions.append(button(say("ready.showMe"), () => { close(); item.show(); }, { label: say("ready.showMeLabel", { what: words }) }));
      if (item.fixLabel) actions.append(button(item.fixLabel, () => (item.describe ? askWords(actions, item.describeLabel, (text) => fixLocal(item, text)) : fixLocal(item, ""))));
    } else if (item.fix === "describe-cover") {
      actions.append(button(say("ready.describeIt"), () => askWords(actions, say("ready.describeLabel"), (text) => describeCover(text)), { label: say("ready.describeCoverLabel") }));
    } else if (item.fix === "title" || item.fix === "tags") {
      actions.append(button(item.fix === "tags" ? say("ready.addTag") : say("ready.showMe"), () => leaveTo({ field: item.fix })));
    } else if (item.target !== undefined) {
      if (item.target) actions.append(button(say("ready.goToIt"), () => leaveTo(item.target), { label: `${say("ready.goToIt")}: ${words}` }));
    } else if (item.line || item.field) {
      actions.append(show(item.line ? { line: item.line } : { field: item.field }));
    }
    if (!actions.childNodes.length) actions.remove();
    return li;
  }

  /** "Describe it": a box for her words in place, then the fix. */
  function askWords(actions, label, done) {
    const answer = h("text-field", { label });
    const use_ = button(say("ready.useWords"), () => {
      const text = String(answer.value || "").trim();
      if (!text) { answer.error = say("ready.fillThis"); return; }
      done(text);
    });
    actions.replaceChildren(h("div", { class: "studio-suggestion-fix" }, answer, use_));
    requestAnimationFrame(() => answer.querySelector("input")?.focus());
  }

  function fixLocal(item, text) {
    const out = item.fix(text);
    if (!out) return;
    const { box, before } = out;
    tell(say("ready.fixed"), () => { box.set(before, {}); box.notify?.(); write.changed(); tell(say("ready.undone")); run({ again: true }); });
    write.changed();
    run({ again: true });
  }

  function describeCover(text) {
    const before = write.form().coverAlt;
    write.describeCover(text);
    tell(say("ready.fixed"), () => { write.describeCover(before); tell(say("ready.undone")); run({ again: true }); });
    run({ again: true });
  }

  function videoGroup(g) {
    if (!g.kit) return null;
    const row = h("p", { text: releaseRow(g.kit) });
    return section("video", say("ready.yourVideo"), row,
      h("p", {}, say("youtube.whereAt", { stage: write.stage() || "—" }), " ", h("action-button", { variant: "link", onClick: () => leaveTo({ field: "productionStatus" }) }, say("youtube.change"))),
      g.kit.problems.length ? h("ul", { class: "studio-ready-list" }, ...g.kit.problems.map((p) => h("li", { text: releaseWords(p.code, p) }))) : null,
      h("div", { class: "studio-ready-actions" }, button(say("youtube.sheet"), () => write.openSheet("youtube", primary))),
      write.state() !== "published" ? h("p", { class: "studio-help", text: say("youtube.keepPrivate") }) : null);
  }

  function tripGroup(g) {
    if (g.kind !== "field-journal") return null;
    const fields = g.form.fields;
    const hasRoute = Boolean(String(fields.distanceKm || fields.routeShape || "").trim());
    const items = g.trip.map((s) => {
      const fix = s.fix === "show-less" ? button(say("trip.showLess"), () => write.openSheet("route", primary))
        : s.fix === "route" ? button(say("route.addRoute"), () => write.openSheet("route", primary))
          : button(say("ready.goToIt"), () => leaveTo({ field: s.fix }), { label: `${say("ready.goToIt")}: ${s.words}` });
      return s.warning
        ? h("li", {}, h("alert-banner", { variant: "warning" }, s.words, h("div", { class: "studio-ready-actions" }, fix)))
        : h("li", { class: "studio-ready-item" }, h("p", { text: s.words }), h("div", { class: "studio-ready-actions" }, fix));
    });
    return section("trip", say("ready.yourTrip"),
      h("p", {}, routeLine(fields), " ", h("action-button", { variant: "link", onClick: () => write.openSheet("route", primary) }, hasRoute ? say("route.changeRoute") : say("route.addRoute"))),
      items.length ? h("ul", { class: "studio-ready-list" }, ...items) : null);
  }

  function researchGroup(g) {
    if (!view.research) return null;
    if (view.checking && !view.review) research.waiting();
    else if (g.researchFailure) research.failed(g.researchFailure === "unreadable" ? "unreadable" : "failed", () => run({ again: true }));
    else if (view.review) research.show(view.review);
    return research.element;
  }

  function worthGroup(g) {
    if (!g.engine.worth.length) return null;
    return h("details", { class: "studio-ready-worth" }, h("summary", { text: say("ready.worth", { count: String(g.engine.worth.length) }) }),
      h("ul", { class: "studio-ready-list" }, ...g.engine.worth.map((item) => suggestionView({ ...item, fix: "show" }))));
  }

  function detailsGroup(g) {
    const s = view.server?.social;
    const raw = (list) => list.map((text) => h("li", { class: "studio-mono", text: String(text) }));
    const findings = (view.server?.accessibility || []).map((f) => {
      const where = f.source?.line ? `${f.source.path}:${f.source.line}${f.source.column ? `:${f.source.column}` : ""}` : `${f.source?.path || ""} · ${f.source?.field || ""}`;
      return `${f.code} · ${f.outcome} · ${where} · ${f.message} ${f.repair} ${(f.references || []).join(" ")}`;
    });
    const details = h("details", { class: "studio-help studio-ready-details", open: sessionOpen() },
      h("summary", { text: say("common.forHelper") }),
      s ? h("p", { class: "studio-mono" }, `${say("ready.detailsCard")}: `, say("ready.detailsCardRows", { type: String(s.type || ""), card: String(s.card || ""), image: String(s.image || "—"), url: String(s.url || "") })) : null,
      h("p", { text: `${say("ready.detailsA11y")}: ${say("ready.detailsCertify")}` }), findings.length ? h("ul", {}, ...raw(findings)) : null,
      h("p", { text: `${say("ready.detailsPage")}: ${say("ready.detailsPageList")}` }),
      g.hints.hints.length ? h("p", { text: say("ready.detailsSearch") }) : null, g.hints.hints.length ? h("ul", {}, ...raw(g.hints.hints.map((x) => `${x.id}: ${x.words}`))) : null,
      view.server?.recipeProblems?.length ? h("p", { text: say("ready.detailsRecipe") }) : null,
      view.server?.recipeProblems?.length ? h("ul", {}, ...raw(view.server.recipeProblems.map((p) => `${p.code}: ${p.message || ""}`))) : null,
      view.server?.warnings?.length ? h("p", { text: say("ready.detailsBuild") }) : null, view.server?.warnings?.length ? h("ul", {}, ...raw(view.server.warnings)) : null,
      g.engine.details.length || g.local.some((x) => x.details) ? h("p", { text: say("ready.detailsRaw") }) : null,
      h("ul", {}, ...raw([...g.engine.details.map((d) => `${d.id}: ${d.words}`), ...g.local.filter((x) => x.details).map((x) => x.words)])));
    details.addEventListener("toggle", () => { try { sessionStorage.setItem("studio-ready-details", details.open ? "1" : ""); } catch { /* per visit only */ } });
    return details;
  }

  const sessionOpen = () => { try { return sessionStorage.getItem("studio-ready-details") === "1"; } catch { return false; } };

  // ---- the footer and the side card
  function paintPrimary(blocked) {
    const verb = write.verb();
    const published = write.state() === "published";
    const unchanged = published && !write.dirty();
    primary.hidden = unchanged;
    const keepWords = unchanged ? say("ready.close") : say("ready.keepWriting");
    // Only a real change is drawn, so the buttons stay put while the checks run again.
    if (keep.textContent.trim() !== keepWords) keep.replaceChildren(keepWords);
    if (primary.textContent.trim() !== verb) primary.replaceChildren(verb);
    note.hidden = !blocked;
    innerAria(primary, { "aria-disabled": blocked ? "true" : null, "aria-describedby": blocked ? "studio-ready-note" : null });
  }

  function paintCard() {
    const changed = checkedAt !== null && checkedAt !== write.snapshot();
    const line = readyLine({ checked: checkedAt !== null, changed, blocks: result.blocks, suggestions: result.suggestions, local: write.suggestions.count() });
    lineText.textContent = line;
    sideCard.label = say("ready.cardName", { name: cardName.textContent, line });
  }

  function tell(words, undo = null) {
    did.hidden = false;
    did.replaceChildren(h("span", { text: words }), undo ? " " : "", undo ? h("action-button", { variant: "secondary", size: "sm", onClick: () => undo() }, say("did.undo")) : "");
    toast(words);
  }

  async function go() {
    if (result.blocked) {
      const first = groups.querySelector(".studio-ready-blocker action-button, .studio-review-blocking action-button, .studio-ready-blocks action-button");
      (first?.querySelector("button") || groups.querySelector(".studio-ready-blocks h3, .studio-review-blocking h4"))?.focus?.();
      toast(say("ready.fixFirst"));
      return;
    }
    close();
    await write.publish();
  }

  // ---- opening and closing
  function open({ from = document.activeElement, fromPublish = false, checked = false } = {}) {
    opener = from;
    did.hidden = true;
    if (!element.isConnected) document.body.append(element);
    element.open = true;
    shown = true;
    if (!checked) run().catch((error) => { if (error?.status === 401) write.signedOut(); });
    else paint();
    requestAnimationFrame(() => requestAnimationFrame(() => (fromPublish ? status : heading).focus()));
  }

  function finish() {
    if (!shown) return;
    shown = false;
    clearTimeout(timer);
    write.closed?.();
    const back = opener;
    opener = null;
    if (back?.isConnected) requestAnimationFrame(() => (back.querySelector?.("button, a, input") || back).focus?.());
  }

  function close() { if (!shown) return; element.open = false; finish(); }

  paint();
  return {
    element, card: sideCard,
    open, close,
    get isOpen() { return shown; },
    /** The checks before Publish: the result for shouldOpenOnPublish. Opens nothing. */
    check: () => run(),
    /** After the first check before Publish: show what it found. */
    show: ({ from }) => open({ from, fromPublish: true, checked: true }),
    /** Something in Write changed: the card's line follows, and an open sheet checks again soon. */
    changed() {
      // The card's line counts R6's suggestions: a moment after she stops typing, not per key.
      clearTimeout(lineTimer);
      lineTimer = setTimeout(paintCard, 600);
      if (!shown || write.snapshot() === ranFor) return;
      clearTimeout(timer);
      timer = setTimeout(() => run({ again: true }).catch(() => {}), AGAIN_MS);
    },
    repaint: () => paint(),
    get result() { return result; },
    /** The last check's suggestions, for See how it looks. */
    lastSuggestions: () => (checkedAt === null ? 0 : result.suggestions + result.blocks),
  };
}
