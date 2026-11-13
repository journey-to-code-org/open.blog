// A service or a customer review: its fields drawn by field-form, its rules the old Admin's model
// (/admin/services.js, /admin/proof.js), so a record can never pass here and fail there. One Save
// puts it on the site; More keeps it off the site, deletes it (with Undo) or shows details. A new
// review can be copied in from its link. Strangers' words are only ever field values or text.
// Studio slice 10a; docs/specs/studio/slice-10a/ux.md.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { form as fieldForm } from "../parts/field-form.js";
import { showPreview } from "../parts/preview.js";
import { sendOut, siteLink, wentOutWords } from "../parts/publish.js";
import { editHref } from "../parts/doc-kinds.js";
import { askWhichToKeep } from "../parts/conflict.js";
import { longDay } from "../parts/record-kinds.js";

/** The field specs and the adapters between the model's form and field-form's data. */
function shape(k, M) {
  if (k.kind === "services") {
    return {
      label: (form) => form.name.trim(),
      specs: [
        { kind: "text", name: "name", label: "Name", max: 120 },
        { kind: "textarea", name: "summary", label: "In one sentence", max: 300 },
        { kind: "list", name: "includes", label: "What's included", hint: "One short line each, like Tear-off of old shingles.", addLabel: "Add an item", max: 30, fields: [{ kind: "text", name: "item", label: "Included", max: 160 }] },
        { kind: "select", name: "priceBand", label: "Starting price", hint: "A guide, never a quote. Shown in words.", options: [["", "Don't show a price"], ...M.PRICE_BAND_CHOICES] },
        { kind: "text", name: "typicalTimeline", label: "How long it usually takes", max: 80 },
        { kind: "list", name: "faq", label: "Questions people ask", hint: "Each one shows on the service's page; search engines read them too.", addLabel: "Add a question", max: 20, fields: [{ kind: "text", name: "question", label: "Question", max: 200 }, { kind: "textarea", name: "answer", label: "Answer", max: 1000 }] },
        { kind: "richtext", name: "body", label: "More about it, in your words", hint: "Optional. Anything else a customer should know." },
      ],
      toData: (form) => ({ ...form, includes: form.includes.map((item) => ({ item })), faq: form.faq.map((f) => ({ ...f })) }),
      fromData: (data, form) => ({ ...form, ...data, includes: (data.includes || []).map((r) => String(r.item || "")), faq: (data.faq || []).map((r) => ({ question: String(r.question || ""), answer: String(r.answer || "") })), extra: form.extra }),
      body: (form) => form.body,
      newId: (form) => M.slugId(form.name),
      taken: "You already have a service called that. Change the name a little.",
    };
  }
  return {
    label: (form) => form.author.trim() ? `${form.author.trim()}'s review` : "",
    specs: [
      { kind: "text", name: "author", label: "Reviewer's name", hint: "As it shows on the review. Customers see it on your site.", max: 80 },
      { kind: "date", name: "date", label: "Day it was written" },
      { kind: "select", name: "platform", label: "Where it was left", options: [["", "Choose where"], ...M.PLATFORMS] },
      { kind: "url", name: "sourceUrl", label: "Link to the review", hint: "Your site links to it, so anyone can check." },
      { kind: "select", name: "rating", label: "Stars", hint: "Only what the reviewer gave.", options: [["", "No stars"], ["5", "5 stars"], ["4", "4 stars"], ["3", "3 stars"], ["2", "2 stars"], ["1", "1 star"]] },
      { kind: "richtext", name: "text", label: "The review", hint: "Their own words, as they wrote them." },
    ],
    toData: (form) => ({ ...form }),
    fromData: (data, form) => ({ ...form, ...data, extra: form.extra }),
    body: (form) => `${String(form.text || "").trim()}\n`,
    newId: (form) => M.reviewId(form.author, form.date),
    taken: "This review is already saved.",
  };
}

const LABELS = { name: "Name", summary: "In one sentence", includes: "What's included", priceBand: "Starting price", typicalTimeline: "How long it usually takes", faq: "Questions people ask", author: "Reviewer's name", date: "Day it was written", platform: "Where it was left", sourceUrl: "Link to the review", rating: "Stars", text: "The review", id: "Address" };

export async function createRecordEdit(context, k, arg) {
  const { api, meta } = context;
  await use("text-field", "select-field", "date-field", "toggle-switch", "action-button", "dropdown-menu", "breadcrumb-trail", "alert-banner", "side-sheet");
  const M = await import(k.model);
  const S = shape(k, M);
  let path = arg && arg !== "new" ? arg : "";
  let form = k.kind === "services" ? M.blankService() : M.blankReview();
  let etag = "";
  let url = "";
  let fields = null; // field-form
  let baseline = "";
  let busy = false;
  let lastSaid = "";

  const trail = h("breadcrumb-trail", { items: [{ label: "Home", href: "#/" }, { label: k.heading.replace("Your ", "").replace(/^./, (c) => c.toUpperCase()), href: `#/${k.list}` }, { label: k.newTitle, href: "" }] });
  const status = h("p", { class: "studio-status", role: "status" });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const host = h("div", { class: "studio-card-form" });
  const copyBox = h("section", { class: "studio-section", hidden: true });
  const provenance = h("p", { class: "studio-help" });
  const save = h("action-button", { onClick: () => saveNow() }, "Save");
  const see = k.preview ? h("action-button", { variant: "secondary", onClick: (e) => preview(e.currentTarget) }, "See how it looks") : null;
  const more = h("dropdown-menu", { label: "More", items: [], onItemselect: (e) => run(e.detail) });
  const details = h("side-sheet", { label: `About this ${k.one}`, side: "right" });
  const heading = h("h2", { id: "studio-record-h", class: "studio-visually-hidden", tabindex: "-1", text: k.newTitle });
  const element = h("section", { class: "studio-page studio-write", "aria-labelledby": "studio-record-h" },
    h("div", { class: "studio-write-top" }, trail, more), heading, status, banner, copyBox, host, provenance,
    h("div", { class: "studio-write-bar" }, k.kind === "proof" ? h("span", { class: "studio-help", text: "Only save what a customer wrote." }) : null, see, save), details);

  // Only the drawn fields come from the form; the rest (id, draft, provenance) stay as they are now.
  const names = S.specs.map((spec) => spec.name);
  const current = () => {
    if (!fields) return form;
    const data = fields.value();
    return S.fromData(Object.fromEntries(names.map((n) => [n, data[n] ?? (Array.isArray(form[n]) ? [] : "")])), form);
  };
  const snapshot = () => JSON.stringify(M.fieldsFromForm(current())) + S.body(current());
  const isDirty = () => Boolean(baseline) && snapshot() !== baseline;
  const label = () => S.label(current()) || k.newTitle;

  function paint() {
    trail.items = [...trail.items.slice(0, 2), { label: label(), href: "" }];
    heading.textContent = label();
    context.setTitle?.(label());
    const f = current();
    status.replaceChildren(!path ? `A new ${k.one}. Fill it in, then Save.`
      : isDirty() ? "Changes not saved yet." : lastSaid || (f.draft ? "Off your site. It's kept here." : "Changes you make go on your site when you Save."));
    if (path && url && !isDirty() && !lastSaid && !f.draft) status.append(" ", h("a", { href: siteLink(meta, url), target: "_blank", rel: "noopener", text: "See it on your site" }));
    more.items = [
      ...(path ? [{ value: "draft", label: f.draft ? "Put it on your site" : "Keep it off your site for now" }, { value: "delete", label: `Delete this ${k.one}` }] : []),
      { value: "details", label: "Show details" },
      ...(path ? [{ value: "old", label: "Open in the old Admin" }] : []),
    ];
    if (k.kind === "proof") {
      provenance.textContent = f.provenance === "snapshot"
        ? `Copied${f.platform ? ` from ${M.PLATFORMS.find(([v]) => v === f.platform)?.[1] || "the page"}` : ""}${f.retrievedAt ? ` on ${longDay(f.retrievedAt)}` : ""}. Your site says so.`
        : "Typed in by you. Your site says so.";
    }
  }

  function draw() {
    fields = fieldForm(S.specs, S.toData(form), { onChange: () => { banner.replaceChildren(); paint(); } });
    host.replaceChildren(fields.element);
    paint();
  }

  // ---- copy a review from its link (new reviews only) -----------------------------------------

  function drawCopy() {
    if (k.kind !== "proof" || path) { copyBox.hidden = true; return; }
    const link = h("text-field", { label: "Link to the review", type: "url", description: "Studio reads the page once, now, and never again. Pages that need a sign-in usually can't be copied." });
    const said = h("div", {});
    const go = h("action-button", { variant: "secondary", onClick: async () => {
      go.loading = true;
      try {
        const snap = await api.post(M.SNAPSHOT_ROUTE, M.snapshotRequest(link.value || ""));
        const problem = M.snapshotProblem(current(), snap);
        if (problem) { said.replaceChildren(h("p", { class: "studio-comment-trouble", role: "alert", text: problem })); return; }
        form = M.formFromSnapshot(current(), snap);
        draw();
        said.replaceChildren(h("text-field", { label: "What the page said", rows: 8, readonly: true, value: String(snap.text || "") }));
        status.textContent = "Copied. Check each line against the page, then Save.";
        requestAnimationFrame(() => host.querySelector("input")?.focus());
      } catch (error) {
        if (error.status === 401) throw error;
        said.replaceChildren(h("p", { class: "studio-comment-trouble", role: "alert", text: M.snapshotErrorText(error) }));
      } finally {
        go.loading = false;
      }
    } }, "Copy the review");
    copyBox.hidden = false;
    copyBox.replaceChildren(h("h3", { text: "Copy it from its link" }), link, go, said);
  }

  // ---- saving ---------------------------------------------------------------------------------

  function problemsBanner(problems) {
    banner.replaceChildren(h("alert-banner", { variant: "danger", heading: problems.length === 1 ? "1 thing needs fixing" : `${problems.length} things need fixing` },
      h("ul", {}, problems.map((p) => {
        const name = p.part ? (p.part === "answer" ? "Answer" : "Question") : LABELS[p.field];
        return h("li", { text: `${name ? `${name}${p.index !== undefined ? ` (number ${p.index + 1})` : ""}: ` : ""}${p.message}` });
      }))));
    banner.scrollIntoView?.({ block: "nearest" });
  }

  async function saveNow({ force = false } = {}) {
    if (busy) return false;
    form = current();
    if (!path && !form.id) form.id = S.newId(form);
    // The address is Studio's to make; only say so when it couldn't make one.
    const problems = M.validateForm(form).map((p) => (p.field === "id" ? { ...p, message: k.kind === "services" ? "Give it a name with some letters or numbers, so it can have an address." : "Add the reviewer's name and the day first, so it can have an address." } : p));
    if (problems.length) { problemsBanner(problems); return false; }
    if (path && !isDirty() && !force) { toast("Nothing's changed. Your site already has this."); return true; }
    busy = true;
    save.loading = true;
    const sent = M.fieldsFromForm(form);
    const body = S.body(form);
    try {
      const reply = path
        ? await api.call("PUT", `document?path=${encodeURIComponent(path)}`, { json: { fields: sent, body, etag, kind: k.kind } })
        : await api.call("POST", "document", { json: { kind: k.kind, fields: sent, body } });
      const wasNew = !path;
      path = reply.path;
      etag = reply.etag;
      url = reply.url || url;
      baseline = snapshot();
      if (wasNew) { context.replaceRoute?.(editHref(k, path)); drawCopy(); }
      const out = await sendOut(api, `${wasNew ? "Add" : "Change"} the ${k.one} ${label()}`);
      const said = wentOutWords(out, { meta, action: "saved" });
      lastSaid = form.draft ? "Saved. It's off your site, kept here." : said.words;
      toast(lastSaid, { variant: said.variant });
      paint();
      return true;
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.status === 409 && path) return conflict();
      if (error.status === 409) { banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "Not saved" }, S.taken)); form.id = ""; return false; }
      const server = M.problemsFromServer(error.data?.problems || [], k.kind === "services" ? M.faqSlots(form) : undefined);
      if (error.status === 422 && server.length) { problemsBanner(server); return false; }
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Not saved" },
        !error.status ? "Check your connection and try again. Your words are still here."
          : error.status === 413 ? "It's too long to save. Shorten it a little; your words are still here."
            : "Something went wrong on your site. Your words are still here; try again in a moment."));
      return false;
    } finally {
      busy = false;
      save.loading = false;
    }
  }

  async function conflict() {
    const theirs = await api.get(`document?path=${encodeURIComponent(path)}`).catch(() => null);
    if (!theirs) { banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Not saved" }, "Check your connection and try again.")); return false; }
    const choice = await askWhichToKeep({ name: label(), what: "changes", them: "it", were: false });
    if (choice === "mine") { etag = theirs.etag; return saveNow({ force: true }); }
    if (choice === "theirs") { fill(theirs); heading.focus(); toast("Here's the version from the other device."); }
    return false;
  }

  function preview(opener) {
    const f = current();
    return showPreview(api, { kind: k.kind, path, title: label(), fields: M.fieldsFromForm(f), body: S.body(f), opener });
  }

  async function run(value) {
    if (value === "draft") {
      const f = current();
      form = { ...f, draft: !f.draft };
      draw();
      if (await saveNow({ force: true })) status.textContent = form.draft ? "Off your site. It's kept here." : "On your site.";
    }
    if (value === "details") {
      const f = current();
      details.replaceChildren(h("span", { slot: "heading", text: `About this ${k.one}` }),
        h("dl", { class: "studio-details" },
          h("dt", { text: "File" }), h("dd", { class: "studio-mono", text: path ? `content/${path}` : "Not saved yet" }),
          h("dt", { text: "Id" }), h("dd", { class: "studio-mono", text: f.id || S.newId(f) || "Made when it's saved" }),
          h("dt", { text: "Address" }), h("dd", { class: "studio-mono", text: url || "After it's saved" }),
          ...(k.kind === "proof" ? [h("dt", { text: "Copied" }), h("dd", { class: "studio-mono", text: `${f.provenance}${f.retrievedAt ? ` at ${f.retrievedAt}` : ""}` })] : []),
          h("dt", { text: "Other settings kept" }), h("dd", { class: "studio-mono", text: Object.keys(f.extra || {}).join(", ") || "None" })));
      details.open = true;
    }
    if (value === "old") open(`/admin/#/${k.list}`, "_blank", "noopener");
    if (value === "delete") {
      const done = await context.undo.deletePost({ path, etag, title: label(), state: "published", ask, list: k.many, one: k.one,
        note: [k.kind === "services" ? "Jobs that name it keep their words." : "If a job shows it, that job will need another review.", isDirty() ? "Changes you haven't saved go with it." : ""].filter(Boolean).join(" ") });
      if (done) { baseline = ""; context.go(`#/${k.list}`); }
    }
  }

  function fill(reply) {
    form = M.formFromDocument(reply.fields || {}, String(reply.body ?? ""));
    etag = reply.etag || "";
    url = reply.url || url;
    draw();
    baseline = snapshot();
    paint();
  }

  async function leave() {
    if (!isDirty()) return true;
    const choice = await ask({ heading: `Save this ${k.one}?`, text: "You changed it and didn't save.", choices: [{ label: "Save", value: "save" }, { label: "Leave without saving", value: "go", variant: "secondary" }] });
    if (choice === "save") return saveNow();
    return choice === "go";
  }

  async function load() {
    if (!path) { draw(); baseline = snapshot(); drawCopy(); paint(); return; }
    try {
      fill(await api.get(`document?path=${encodeURIComponent(path)}`));
    } catch (error) {
      if (error.status === 401) throw error;
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: error.status === 404 ? `That ${k.one} isn't there any more` : `This ${k.one} didn't open` },
        error.status === 404 ? "" : "Check your connection and try again. ",
        h("action-button", { variant: "secondary", href: `#/${k.list}` }, `Back to your ${k.many}`)));
      element.querySelector(".studio-write-bar").hidden = true;
    }
  }

  return {
    title: k.newTitle,
    element,
    load,
    leave,
    isDirty,
    focus: () => (path ? heading.focus() : (copyBox.hidden ? host : copyBox).querySelector("input")?.focus()),
    get palette() {
      return [{ id: "save", label: `Save this ${k.one}`, group: `This ${k.one}`, hint: "Ctrl S" }, ...(k.preview ? [{ id: "preview", label: "See how it looks", group: `This ${k.one}` }] : [])];
    },
    keys: ["save", "publish"],
    command(id) {
      if (id === "save" || id === "publish") saveNow();
      if (id === "preview" && k.preview) preview();
    },
  };
}
