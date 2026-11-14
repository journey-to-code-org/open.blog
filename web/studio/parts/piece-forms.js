// The form for each thing she can put in her words (Studio R6): fields in her words, a live sketch,
// and `read()`, which gives the Markdown to put in, or what's wrong (field by field), or that it is
// waiting for a signal. Tips, checklists, tables, headings, quotes, links, questions for readers and
// code are written here by the lifted writers; every piece and before-and-after pair is checked and
// written by the server (POST pieces). A form filled in from a card writes the card back untouched
// when nothing changed.
import { h } from "./dom.js";
import { say } from "./words.js";
import { CALLOUT_KINDS, calloutMarkdown, embedProblem, hasHtmlTag, parseCallout, parseEmbed, parsePieceFence, parseTable, parseTaskList, quoteMarkdown, tableMarkdown, taskListMarkdown } from "./block-forms.js";
import { coordsFromMapLink, formValues, hrefFor, hrefKind, pieceProblems, pieceValues, placeWords, videoLink, videoProvider } from "./piece-rules.js";
import { parseQuiz, quizMarkdown, quizProblems } from "./quiz-rules.js";
import { codeFenceMarkdown, codeFenceProblems, codeInteractionMarkdown, codeInteractionProblems, parseCodeFence, runnableLanguages } from "./code-rules.js";
import { imageMarkdown } from "./image-markdown.js";
import { cardSummary, parsePhoto } from "./piece-words.js";
import { photoProblem, pictureTile, sitePictures, uploadPhoto } from "./picture-picker.js";

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;
const text = (field) => String(field?.value ?? "");
const trimmed = (field) => text(field).trim();

/** A text field; `error` set on it says what's wrong (and the field is described by it). */
function field(label, { help = "", value = "", rows = 0, max = 0, mono = false, type = "", placeholder = "", name = "" } = {}) {
  return h("text-field", {
    label, description: help, value: String(value ?? ""), rows: rows || undefined, maxlength: max || undefined, type: type || undefined,
    placeholder: placeholder || undefined, class: mono ? "studio-mono-field" : "", "data-field": name || undefined,
  });
}

/** Focus a field's control now when it is drawn (so typing that follows lands in it), else on the next frame. */
const focusField = (control) => {
  const now = control?.querySelector?.("textarea, input, select, button");
  if (now) now.focus();
  else requestAnimationFrame(() => (control?.querySelector?.("textarea, input, select, button") || control)?.focus?.());
};

/** Rows of fields she can add to and take out (checklist things, questions, links, hours). */
function rowsEditor({ legend, rowName, fields, values = [{}], add, takeOut, max = 50, announce, onChange, checkbox = null }) {
  const holder = h("div", { class: "studio-form-rows" });
  const live = h("p", { class: "studio-help", "aria-live": "polite" });
  let rows = values.length ? values.map((v) => ({ ...v })) : [{}];
  let controls = [];
  const addButton = h("action-button", { variant: "secondary", size: "sm", onClick: () => insert(rows.length) }, add);
  function read() {
    return controls.map((row) => Object.fromEntries(Object.entries(row).map(([name, control]) => [name, control.type === "checkbox" ? control.checked : text(control)])));
  }
  function draw(focus = null) {
    controls = [];
    holder.replaceChildren(...rows.map((row, index) => {
      const set = {};
      const parts = fields.map((spec) => {
        const control = field(spec.label(index + 1), { value: row[spec.name] ?? "", rows: spec.rows || 0, help: index === 0 ? spec.help || "" : "", name: spec.name });
        control.addEventListener("valuechange", () => onChange?.());
        if (spec.enter) control.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && index === rows.length - 1) { event.preventDefault(); insert(rows.length); } });
        set[spec.name] = control;
        return control;
      });
      let tick = null;
      if (checkbox) {
        const id = nextId("studio-tick");
        tick = h("input", { type: "checkbox", id, class: "studio-tick" });
        tick.checked = Boolean(row[checkbox.name]);
        tick.addEventListener("change", () => onChange?.());
        set[checkbox.name] = tick;
        tick = h("label", { class: "studio-tick-label", for: id }, tick, h("span", { text: checkbox.label(index + 1) }));
      }
      controls.push(set);
      return h("fieldset", { class: "studio-form-row" }, h("legend", { text: rowName(index + 1) }), tick, ...parts,
        h("action-button", { variant: "ghost", size: "sm", onClick: () => remove(index) }, takeOut(index + 1)));
    }));
    addButton.disabled = rows.length >= max;
    if (focus) focusField(controls[focus.row]?.[focus.name || fields[0].name]);
  }
  function insert(at) {
    rows = read();
    rows.splice(at, 0, {});
    draw({ row: at });
    live.textContent = announce.added(at + 1);
    onChange?.();
  }
  function remove(index) {
    rows = read();
    rows.splice(index, 1);
    if (!rows.length) rows.push({});
    draw({ row: Math.max(0, index - 1) });
    live.textContent = announce.removed(index + 1);
    onChange?.();
  }
  draw();
  return {
    element: h("fieldset", { class: "studio-form-list" }, h("legend", { text: legend }), holder, addButton, live),
    read,
    control: (row, name) => controls[row]?.[name],
  };
}

/** A choice among a few, as a segmented control. */
const choice = (label, options, value, onChange) => h("segmented-control", { label, options, value, onValuechange: () => onChange?.() });

/** Details for the person who set up the site, holding the given controls. */
const details = (...children) => h("details", { class: "studio-form-details" }, h("summary", { text: say("common.forHelper") }), ...children);

/**
 * The form for `kind`. `ctx` is `{ api, meta, block (the card being changed, if any), selection,
 * maxBytes, onChange, link (an inline link being changed), heading, quote }`. Returns `{ element,
 * focus(), dirty(), values(), restore(v), read(), sketch(), serverBuilt, inline }`.
 */
export function buildForm(kind, ctx) {
  const make = FORMS[kind];
  if (!make) throw new Error(`no form for ${kind}`);
  const form = make(ctx);
  const start = JSON.stringify(form.values());
  return { kind, serverBuilt: false, inline: false, ...form, dirty: () => JSON.stringify(form.values()) !== start };
}

/** Ask the server to check and write a piece. `{ markdown }`, `{ problems }`, `{ waiting }` or `{ failed }`. */
async function serverPiece(api, kind, values) {
  try {
    const reply = await api.post("pieces", { kind, values });
    return { markdown: String(reply.markdown || "").replace(/\n+$/, "") };
  } catch (error) {
    if (error.status === 422) return { problems: pieceProblems(error.data) };
    if (error.status === 413) return { problems: [{ field: "", code: error.data?.code || "too-large" }] };
    if (error.status === 400) return { problems: [{ field: "", code: "bad-request" }] };
    if (error.status === 401) throw error;
    if (!error.status || error.status === 0 || error.offline) return { waiting: true };
    return { failed: true };
  }
}

/** The card is unchanged: give its Markdown back exactly. */
const same = (ctx, values, start) => (ctx.block && JSON.stringify(values) === start ? { markdown: ctx.block.source.replace(/\n+$/, "") } : null);

// ---- the photo picker inside a form

function photoPicker(ctx, { initial = "", onChosen }) {
  const holder = h("div", { class: "studio-form-picker" });
  let url = initial;
  function chosen(address) {
    url = address;
    holder.replaceChildren(
      h("img", { class: "studio-form-photo", src: url, alt: "" }),
      h("action-button", { variant: "secondary", size: "sm", onClick: () => pick() }, say("form.photoAnother")));
    onChosen?.(url);
  }
  function pick() {
    const problem = h("div", { "aria-live": "assertive" });
    const drop = h("file-drop", { label: say("form.photoAdd"), hint: say("form.photoAddHelp"), accept: "image/*", multiple: false, "max-size": ctx.maxBytes ? Math.floor(ctx.maxBytes / 1048576) : 0 });
    drop.addEventListener("fileschange", async (event) => {
      const [file] = event.detail || [];
      if (file) await upload(file, problem);
    });
    const grid = h("ul", { class: "studio-picture-grid", "aria-label": say("form.photoOnSite") }, h("li", {}, h("loading-spinner", { label: say("form.photoLoading") })));
    holder.replaceChildren(problem, drop, h("p", { class: "studio-label", text: say("form.photoOnSite") }), grid);
    sitePictures(ctx.api).then(({ images }) => {
      grid.replaceChildren(...(images.length ? images.map((img) => pictureTile(img, (picked) => chosen(picked.url))) : [h("li", { text: say("form.photoNone") })]));
    }).catch(() => grid.replaceChildren(h("li", { text: say("form.photoNoSignal") })));
  }
  async function upload(file, problem = null) {
    holder.replaceChildren(h("p", { class: "studio-row" }, h("loading-spinner", { label: say("form.photoAdding"), inline: true }), " ", say("form.photoAdding")));
    try {
      chosen(await uploadPhoto(ctx.api, file));
    } catch (error) {
      pick();
      (problem || holder.querySelector("[aria-live]"))?.replaceChildren(photoProblem(file, error));
    }
  }
  if (url) chosen(url); else pick();
  return { element: holder, url: () => url, set: (address) => (address ? chosen(address) : (url = "", pick())), upload, focus: () => focusField(holder) };
}

// ---- the forms

const FORMS = {
  photo(ctx) {
    const fromPiece = ctx.block?.kind === "piece" ? formValues(null, parsePieceFence(ctx.block.source)?.values || []).top : null;
    const fromLine = ctx.block && !fromPiece ? parsePhoto(ctx.block.source) : null;
    const describe = field(say("form.describe"), { help: say("photo.altHelp"), value: fromPiece?.alt ?? fromLine?.alt ?? "", name: "alt" });
    const under = field(say("form.wordsUnder"), { help: say("form.wordsUnderHelp"), value: fromPiece?.caption ?? "", name: "caption" });
    const address = field(say("form.pictureAddress"), { value: fromPiece?.src ?? fromLine?.url ?? "", name: "src" });
    const picker = photoPicker(ctx, { initial: fromPiece?.src ?? fromLine?.url ?? "", onChosen: (url) => { address.value = url; ctx.onChange?.(); } });
    address.addEventListener("valuechange", () => ctx.onChange?.());
    if (ctx.file) picker.upload(ctx.file);
    for (const control of [describe, under]) control.addEventListener("valuechange", () => ctx.onChange?.());
    const values = () => ({ src: trimmed(address), alt: trimmed(describe), caption: trimmed(under) });
    const start = JSON.stringify(values());
    return {
      element: h("div", { class: "studio-form-fields" }, picker.element, describe, under, details(address)),
      focus: () => (ctx.file || picker.url() ? focusField(describe) : picker.focus()),
      values,
      restore(v) { describe.value = v.alt || ""; under.value = v.caption || ""; address.value = v.src || ""; if (v.src) picker.set(v.src); },
      get serverBuilt() { return Boolean(trimmed(under)) || !trimmed(address).startsWith("/images/uploads/"); },
      async read() {
        const v = values();
        const kept = same(ctx, v, start);
        if (kept) return kept;
        const problems = [];
        if (!v.src) problems.push({ field: "src", code: "photo", control: picker });
        if (!v.alt) problems.push({ field: "alt", code: "describe" });
        if (problems.length) return { problems };
        if (!v.caption && v.src.startsWith("/images/uploads/")) {
          try { return { markdown: imageMarkdown(v.src, v.alt) }; } catch { /* the server says why */ }
        }
        return serverPiece(ctx.api, "image", [["src", v.src], ["alt", v.alt], ...(v.caption ? [["caption", v.caption]] : [])]);
      },
      controls: { alt: describe, caption: under, src: address },
      sketch: () => ({ name: say("card.photo", { words: trimmed(describe) }), badge: "", lines: [trimmed(describe), trimmed(under) ? say("card.wordsUnder", { words: trimmed(under) }) : ""], thumbs: [{ src: trimmed(address), alt: "", label: "" }], more: "", tone: "", mono: false }),
    };
  },

  tip(ctx) {
    const parsed = ctx.block ? parseCallout(ctx.block.source) : null;
    const kinds = [{ value: "TIP", label: say("thing.tip") }, { value: "NOTE", label: say("thing.note") }, { value: "WARNING", label: say("thing.watchOut") }];
    if (parsed && !kinds.some((k) => k.value === parsed.kind)) kinds.push({ value: parsed.kind, label: parsed.kind === "IMPORTANT" ? say("thing.important") : say("thing.caution") });
    const kind = choice(say("form.tipKind"), kinds, parsed?.kind || "TIP", ctx.onChange);
    const every = h("select-field", { label: say("form.tipEvery"), options: CALLOUT_KINDS.map(([value, label]) => ({ value, label })), value: parsed?.kind || "TIP",
      onValuechange: () => { kind.value = every.value; if (!kinds.some((k) => k.value === every.value)) kind.options = [...kinds, { value: every.value, label: CALLOUT_KINDS.find(([v]) => v === every.value)[1] }]; ctx.onChange?.(); } });
    const max = ctx.meta?.pieces?.find((p) => p.kind === "callout")?.fields?.find((f) => f.name === "title")?.max || 60;
    const title = field(say("form.tipTitle"), { help: say("form.tipTitleHelp"), value: parsed?.title || "", max, name: "title" });
    const body = field(say("form.tipText"), { rows: 4, value: parsed?.text || "", name: "text" });
    for (const control of [title, body]) control.addEventListener("valuechange", () => ctx.onChange?.());
    const values = () => ({ kind: String(kind.value || "TIP"), title: trimmed(title), text: text(body).replace(/^\s*\n/, "").replace(/\s+$/, "") });
    const start = JSON.stringify(values());
    return {
      element: h("div", { class: "studio-form-fields" }, kind, title, body, details(every)),
      focus: () => focusField(body),
      values,
      restore(v) { kind.value = v.kind; title.value = v.title; body.value = v.text; },
      async read() {
        const v = values();
        const kept = same(ctx, v, start);
        if (kept) return kept;
        const problems = [];
        if (!v.text.trim()) problems.push({ field: "text", code: "tip" });
        if (hasHtmlTag(v.title)) problems.push({ field: "title", code: "html" });
        if (hasHtmlTag(v.text)) problems.push({ field: "text", code: "html" });
        return problems.length ? { problems } : { markdown: calloutMarkdown(v) };
      },
      controls: { text: body, title },
      sketch: () => cardSummary({ kind: "callout", source: calloutMarkdown({ ...values(), text: values().text || " " }) }),
    };
  },

  checklist(ctx) {
    const items = ctx.block ? parseTaskList(ctx.block.source) || [] : [];
    const rows = rowsEditor({
      legend: say("form.checklistThings"), rowName: (n) => say("form.thing", { n }), fields: [{ name: "text", label: (n) => say("form.thing", { n }), enter: true }],
      checkbox: { name: "checked", label: () => say("form.ticked") },
      values: items.length ? items.map((item) => ({ text: item.text, checked: item.checked })) : [{}, {}],
      add: say("form.addThing"), takeOut: (n) => say("form.takeOutThing", { n }),
      announce: { added: (n) => say("form.thingAdded", { n }), removed: (n) => say("form.thingGone", { n }) }, onChange: ctx.onChange,
    });
    const values = () => rows.read().map((row) => ({ checked: Boolean(row.checked), text: row.text.trim() }));
    const start = JSON.stringify(values());
    return {
      element: h("div", { class: "studio-form-fields" }, rows.element),
      focus: () => focusField(rows.control(0, "text")),
      values,
      restore() {},
      async read() {
        const v = values();
        const kept = same(ctx, v, start);
        if (kept) return kept;
        const empty = v.findIndex((row) => !row.text);
        if (empty >= 0) return { problems: [{ field: "text", item: empty, code: "checklist", control: rows.control(empty, "text") }] };
        return { markdown: taskListMarkdown(v) };
      },
      sketch: () => cardSummary({ kind: "tasklist", source: taskListMarkdown(values().map((row) => ({ ...row, text: row.text || "…" }))) }),
    };
  },

  table(ctx) {
    const parsed = ctx.block ? parseTable(ctx.block.source) : null;
    let header = parsed ? [...parsed.header] : ["", ""];
    let align = parsed ? [...parsed.align] : ["", ""];
    let rows = parsed ? parsed.rows.map((row) => [...row]) : [["", ""], ["", ""]];
    const holder = h("div", { class: "studio-form-table" });
    const live = h("p", { class: "studio-help", "aria-live": "polite" });
    const aligns = h("div", { class: "studio-form-fields" });
    let names = [];
    let cells = [];
    const sync = () => {
      header = names.map((control) => text(control));
      rows = cells.map((row) => row.map((control) => text(control)));
    };
    function draw(focus = null) {
      names = header.map((value, column) => {
        const control = field(say("form.column", { n: column + 1 }), { value });
        // Each cell is named by its column: the names follow as she types them.
        control.addEventListener("valuechange", () => { sync(); relabel(); ctx.onChange?.(); });
        return control;
      });
      cells = rows.map((row, r) => row.map((value, column) => {
        const control = field(say("form.cell", { row: r + 1, column: header[column] || say("form.column", { n: column + 1 }) }), { value });
        control.addEventListener("valuechange", () => { sync(); ctx.onChange?.(); });
        return control;
      }));
      holder.replaceChildren(
        h("fieldset", { class: "studio-form-row studio-table-names" }, h("legend", { text: say("form.columnNames") }), ...names,
          h("div", { class: "studio-table-tools" }, header.map((_, column) => h("action-button", { variant: "ghost", size: "sm", disabled: header.length < 2, onClick: () => removeColumn(column) }, say("form.takeOutColumn", { n: column + 1 }))))),
        ...cells.map((row, r) => h("fieldset", { class: "studio-form-row" }, h("legend", { text: say("form.row", { n: r + 1 }) }), ...row,
          h("action-button", { variant: "ghost", size: "sm", onClick: () => removeRow(r) }, say("form.takeOutRow", { n: r + 1 })))));
      aligns.replaceChildren(...header.map((_, column) => h("select-field", { label: say("form.align", { n: column + 1 }), value: align[column] || "",
        options: [{ value: "", label: say("form.alignNone") }, { value: "left", label: say("form.alignLeft") }, { value: "center", label: say("form.alignCenter") }, { value: "right", label: say("form.alignRight") }],
        onValuechange: (event) => { align[column] = event.detail; ctx.onChange?.(); } })));
      if (focus) focusField(focus.row < 0 ? names[focus.column] : cells[focus.row]?.[focus.column]);
    }
    function relabel() {
      cells.forEach((row, r) => row.forEach((control, column) => { control.label = say("form.cell", { row: r + 1, column: header[column] || say("form.column", { n: column + 1 }) }); }));
    }
    function removeRow(r) { sync(); rows.splice(r, 1); draw({ row: Math.max(0, r - 1), column: 0 }); live.textContent = say("form.rowGone", { n: r + 1 }); ctx.onChange?.(); }
    function removeColumn(column) { sync(); header.splice(column, 1); align.splice(column, 1); rows.forEach((row) => row.splice(column, 1)); draw({ row: -1, column: Math.max(0, column - 1) }); live.textContent = say("form.columnGone", { n: column + 1 }); ctx.onChange?.(); }
    const addRow = h("action-button", { variant: "secondary", size: "sm", onClick: () => { sync(); rows.push(header.map(() => "")); draw({ row: rows.length - 1, column: 0 }); live.textContent = say("form.rowAdded", { n: rows.length }); ctx.onChange?.(); } }, say("form.addRow"));
    const addColumn = h("action-button", { variant: "secondary", size: "sm", onClick: () => { sync(); header.push(""); align.push(""); rows.forEach((row) => row.push("")); draw({ row: -1, column: header.length - 1 }); live.textContent = say("form.columnAdded", { n: header.length }); ctx.onChange?.(); } }, say("form.addColumn"));
    draw();
    const values = () => { sync(); return { header: [...header], align: [...align], rows: rows.map((row) => [...row]) }; };
    const start = JSON.stringify(values());
    return {
      element: h("div", { class: "studio-form-fields" }, holder, h("cluster-layout", { gap: "0.5rem" }, addRow, addColumn), live, details(aligns)),
      focus: () => focusField(names[0]),
      values,
      restore() {},
      async read() {
        const v = values();
        const kept = same(ctx, v, start);
        if (kept) return kept;
        if (!v.header.some((cell) => cell.trim())) return { problems: [{ field: "header", code: "table", control: names[0] }] };
        return { markdown: tableMarkdown(v) };
      },
      sketch: () => cardSummary({ kind: "table", source: tableMarkdown(values()) }),
    };
  },

  video(ctx) {
    const bare = ctx.block?.kind === "video-link";
    const piece = ctx.block && !bare ? formValues(null, parsePieceFence(ctx.block.source)?.values || []).top : {};
    const link = field(say("form.videoLink"), { help: say("form.videoLinkHelp"), value: bare ? ctx.block.source.trim() : piece.video ? videoLink(piece.provider, piece.video) : "", type: "url", name: "video" });
    const about = field(say("form.videoAbout"), { help: say("form.videoAboutHelp"), value: piece.title || "", name: "title" });
    for (const control of [link, about]) control.addEventListener("valuechange", () => ctx.onChange?.());
    const values = () => ({ video: trimmed(link), title: trimmed(about) });
    const start = JSON.stringify(values());
    return {
      element: h("div", { class: "studio-form-fields" }, link, bare ? null : about),
      focus: () => focusField(link),
      values,
      restore(v) { link.value = v.video || ""; about.value = v.title || ""; },
      serverBuilt: !bare,
      async read() {
        const v = values();
        const kept = same(ctx, v, start);
        if (kept) return kept;
        const provider = videoProvider(v.video);
        const problems = [];
        if (bare ? embedProblem("youtube", v.video) : !provider) problems.push({ field: "video", code: "bad-video" });
        if (!bare && !v.title) problems.push({ field: "title", code: "video-about" });
        if (problems.length) return { problems };
        if (bare) return { markdown: v.video };
        return serverPiece(ctx.api, "video", [["provider", provider], ["video", v.video], ["title", v.title]]);
      },
      controls: { video: link, title: about },
      sketch: () => ({ name: say("card.video", { words: trimmed(about) }), badge: say("thing.video"), lines: [trimmed(about), videoProvider(trimmed(link)) === "vimeo" ? say("card.fromVimeo") : say("card.fromYouTube")], thumbs: [], more: "", tone: "", mono: false }),
    };
  },

  link(ctx) {
    const was = ctx.link || null;
    const words = field(say("form.linkWords"), { value: was?.words ?? ctx.selection ?? "", name: "words" });
    const start_ = hrefKind(was?.href || "");
    const where = choice(say("form.linkWhere"), [{ value: "post", label: say("form.onePost") }, { value: "website", label: say("form.website") }], start_.kind === "post" ? "post" : "website", () => { show(); ctx.onChange?.(); });
    const post = h("select-field", { label: say("form.yourPosts"), options: [{ value: "", label: say("form.choosePost") }], value: start_.kind === "post" ? start_.value : "", onValuechange: () => ctx.onChange?.() });
    const site = field(say("form.webAddress"), { value: start_.kind === "website" ? start_.value : "", type: "url", placeholder: "https://", name: "href" });
    const any = field(say("form.anyAddress"), { value: start_.kind === "any" || start_.kind === "email" || start_.kind === "phone" ? was?.href || "" : "", name: "any" });
    const postsNote = h("p", { class: "studio-help", "aria-live": "polite" });
    for (const control of [words, site, any]) control.addEventListener("valuechange", () => ctx.onChange?.());
    function show() { post.hidden = where.value !== "post"; site.hidden = where.value === "post"; postsNote.hidden = where.value !== "post"; }
    ctx.posts?.().then((items) => {
      post.options = [{ value: "", label: say("form.choosePost") }, ...items.map((item) => ({ value: item.url, label: item.title }))];
      if (start_.kind === "post") post.value = start_.value;
    }).catch(() => { postsNote.textContent = say("form.postsNeedSignal"); });
    show();
    const href = () => (trimmed(any) ? hrefFor("any", trimmed(any)) : where.value === "post" ? hrefFor("post", String(post.value || "")) : hrefFor("website", trimmed(site)));
    const values = () => ({ words: trimmed(words), where: where.value, post: String(post.value || ""), site: trimmed(site), any: trimmed(any) });
    return {
      element: h("div", { class: "studio-form-fields" }, words, where, post, postsNote, site, details(any)),
      focus: () => focusField(words),
      values,
      restore(v) { words.value = v.words || ""; where.value = v.where || "website"; site.value = v.site || ""; any.value = v.any || ""; show(); },
      inline: true,
      async read() {
        const v = values();
        const problems = [];
        if (!v.words) problems.push({ field: "words", code: "link-words" });
        const target = href();
        if (target.problem) problems.push({ field: trimmed(any) ? "any" : where.value === "post" ? "post" : "href", code: "bad-address", control: trimmed(any) ? any : where.value === "post" ? post : site });
        if (problems.length) return { problems };
        return { markdown: `[${v.words.replace(/[\\[\]]/g, (c) => `\\${c}`)}](${target.href})` };
      },
      controls: { words, href: site, any },
      sketch: () => ({ name: say("thing.link"), badge: "", lines: [trimmed(words), href().href ? say("card.goesTo", { words: href().href }) : ""], thumbs: [], more: "", tone: "", mono: false }),
    };
  },

  heading(ctx) {
    const was = ctx.heading || null;
    const words = field(say("form.heading"), { value: was?.words || "", max: 120, name: "words" });
    const level = h("select-field", { label: say("form.headingLevel"), value: String(was?.level || 2), options: [2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) })), onValuechange: () => ctx.onChange?.() });
    words.addEventListener("valuechange", () => ctx.onChange?.());
    const values = () => ({ words: trimmed(words).replace(/\s+/g, " "), level: Number(level.value || 2) });
    return {
      element: h("div", { class: "studio-form-fields" }, words, details(level)),
      focus: () => focusField(words),
      values,
      restore(v) { words.value = v.words || ""; level.value = String(v.level || 2); },
      async read() {
        const v = values();
        if (!v.words) return { problems: [{ field: "words", code: "heading" }] };
        return { markdown: `${"#".repeat(v.level)} ${v.words}` };
      },
      controls: { words },
      sketch: () => ({ name: say("thing.heading"), badge: "", lines: [trimmed(words)], thumbs: [], more: "", tone: "", mono: false }),
    };
  },

  compare(ctx) {
    const parsed = ctx.block ? formValues(null, parsePieceFence(ctx.block.source)?.values || []).top : {};
    const side = (name) => {
      const describe = field(say("form.describeSide"), { value: parsed[`${name}-alt`] || "", name: `${name}-alt` });
      const under = field(say("form.wordsUnder"), { value: parsed[`${name}-caption`] || "", name: `${name}-caption` });
      const label = field(say("form.sideName"), { value: parsed[`${name}-label`] || "", placeholder: name === "before" ? say("form.before") : say("form.after"), name: `${name}-label` });
      const picker = photoPicker(ctx, { initial: parsed[name] || "", onChosen: () => ctx.onChange?.() });
      for (const control of [describe, under, label]) control.addEventListener("valuechange", () => ctx.onChange?.());
      return { picker, describe, under, label, element: h("fieldset", { class: "studio-form-row" }, h("legend", { text: name === "before" ? say("form.before") : say("form.after") }), picker.element, describe, under, label) };
    };
    const sides = { before: side("before"), after: side("after") };
    const values = () => Object.fromEntries(["before", "after"].flatMap((name) => [[name, sides[name].picker.url()], [`${name}-alt`, trimmed(sides[name].describe)], [`${name}-caption`, trimmed(sides[name].under)], [`${name}-label`, trimmed(sides[name].label)]]));
    const start = JSON.stringify(values());
    return {
      element: h("div", { class: "studio-form-fields" }, sides.before.element, sides.after.element),
      focus: () => sides.before.picker.focus(),
      values,
      restore(v) { for (const name of ["before", "after"]) { sides[name].describe.value = v[`${name}-alt`] || ""; sides[name].under.value = v[`${name}-caption`] || ""; sides[name].label.value = v[`${name}-label`] || ""; if (v[name]) sides[name].picker.set(v[name]); } },
      serverBuilt: true,
      async read() {
        const v = values();
        const kept = same(ctx, v, start);
        if (kept) return kept;
        const problems = [];
        for (const name of ["before", "after"]) {
          if (!v[name]) problems.push({ field: name, code: `${name}-photo`, control: sides[name].picker });
          else if (!v[`${name}-alt`]) problems.push({ field: `${name}-alt`, code: `${name}-describe` });
        }
        if (problems.length) return { problems };
        return serverPiece(ctx.api, "compare", Object.entries(v).filter(([name, value]) => value || !/-(caption|label)$/.test(name)));
      },
      controls: { "before-alt": sides.before.describe, "after-alt": sides.after.describe, "before-caption": sides.before.under, "after-caption": sides.after.under, "before-label": sides.before.label, "after-label": sides.after.label },
      sketch: () => ({ name: say("thing.compare"), badge: "", lines: [], thumbs: ["before", "after"].map((name) => ({ src: sides[name].picker.url(), alt: "", label: trimmed(sides[name].label) || (name === "before" ? say("form.before") : say("form.after")) })), more: "", tone: "", mono: false }),
    };
  },

  quote(ctx) {
    const was = ctx.quote || null;
    const words = field(say("form.quoteWords"), { rows: 4, value: was?.words || "", name: "words" });
    const who = field(say("form.quoteWho"), { value: was?.who || "", name: "who" });
    for (const control of [words, who]) control.addEventListener("valuechange", () => ctx.onChange?.());
    const values = () => ({ words: text(words).trim(), who: trimmed(who).replace(/\s+/g, " ") });
    return {
      element: h("div", { class: "studio-form-fields" }, words, who),
      focus: () => focusField(words),
      values,
      restore(v) { words.value = v.words || ""; who.value = v.who || ""; },
      async read() {
        const v = values();
        if (!v.words) return { problems: [{ field: "words", code: "quote" }] };
        return { markdown: quoteMarkdown(v) };
      },
      controls: { words },
      sketch: () => ({ name: say("thing.quote"), badge: "", lines: [...text(words).split("\n").slice(0, 3), trimmed(who) ? `— ${trimmed(who)}` : ""], thumbs: [], more: "", tone: "", mono: false }),
    };
  },

  quiz(ctx) {
    const parsed = ctx.block ? parseQuiz(ctx.block.source) : null;
    const list = h("div", { class: "studio-form-fields" });
    const questions = [];
    const live = h("p", { class: "studio-help", "aria-live": "polite" });
    function question(initial) {
      const q = field(say("form.quizQuestion"), { value: initial?.question || "", name: "question" });
      const after = field(say("form.quizAfter"), { value: initial?.explanation || "", name: "explanation" });
      const group = nextId("studio-quiz");
      let answers = initial?.answers?.length ? [...initial.answers] : ["", ""];
      let right = initial ? initial.right : -1;
      const holder = h("div");
      const entry = { q, after, holder, answers: () => answers, right: () => right, controls: [] };
      function draw(focus = -1) {
        entry.controls = answers.map((value, index) => {
          const control = field(say("form.quizAnswer", { n: index + 1 }), { value, name: "answer" });
          control.addEventListener("valuechange", () => { answers[index] = text(control); ctx.onChange?.(); });
          return control;
        });
        holder.replaceChildren(...entry.controls.map((control, index) => {
          const id = nextId("studio-right");
          const radio = h("input", { type: "radio", name: group, id, class: "studio-tick" });
          radio.checked = index === right;
          radio.addEventListener("change", () => { right = index; ctx.onChange?.(); });
          return h("fieldset", { class: "studio-form-row" }, h("legend", { text: say("form.quizAnswer", { n: index + 1 }) }), control,
            h("label", { class: "studio-tick-label", for: id }, radio, h("span", { text: say("form.quizRight") })),
            answers.length > 2 ? h("action-button", { variant: "ghost", size: "sm", onClick: () => { answers.splice(index, 1); if (right === index) right = -1; else if (right > index) right -= 1; draw(Math.max(0, index - 1)); ctx.onChange?.(); } }, say("form.quizTakeOut", { n: index + 1 })) : null);
        }), answers.length < 4 ? h("action-button", { variant: "secondary", size: "sm", onClick: () => { answers.push(""); draw(answers.length - 1); live.textContent = say("form.quizAnswerAdded", { n: answers.length }); ctx.onChange?.(); } }, say("form.quizAddAnswer")) : null);
        if (focus >= 0) focusField(entry.controls[focus]);
      }
      for (const control of [q, after]) control.addEventListener("valuechange", () => ctx.onChange?.());
      draw();
      entry.read = () => ({ question: trimmed(q), answers: answers.map((a) => String(a).trim()), right, explanation: trimmed(after) });
      entry.element = h("fieldset", { class: "studio-form-list" }, h("legend", { text: say("form.quizNumber", { n: questions.length + 1 }) }), q, holder, after);
      questions.push(entry);
      list.append(entry.element);
      return entry;
    }
    question(parsed);
    const another = ctx.block ? null : h("action-button", { variant: "secondary", size: "sm", onClick: () => { const entry = question(null); focusField(entry.q); if (questions.length >= 3) another.hidden = true; ctx.onChange?.(); } }, say("form.quizAnother"));
    const values = () => questions.map((entry) => entry.read());
    const start = JSON.stringify(values());
    return {
      element: h("div", { class: "studio-form-fields" }, list, another, live),
      focus: () => focusField(questions[0].q),
      values,
      restore() {},
      async read() {
        const v = values();
        const kept = same(ctx, v, start);
        if (kept) return kept;
        const problems = [];
        v.forEach((one, index) => {
          for (const problem of quizProblems(one)) {
            const entry = questions[index];
            const control = problem.field === "question" ? entry.q : problem.field === "explanation" ? entry.after : problem.field === "answer" && problem.item !== undefined ? entry.controls[problem.item] : entry.controls[0];
            problems.push({ ...problem, code: `quiz-${problem.code}`, control });
          }
        });
        if (problems.length) return { problems };
        return { markdown: v.map((one) => quizMarkdown(one)).join("\n\n") };
      },
      sketch: () => ({ name: say("card.quiz", { words: trimmed(questions[0].q) }), badge: "", lines: [trimmed(questions[0].q), say("card.answers", { count: questions[0].answers().length })], thumbs: [], more: "", tone: "", mono: false }),
    };
  },

  code(ctx) {
    const parsed = ctx.block ? parseCodeFence(ctx.block.source) : null;
    const language = field(say("form.codeLanguage"), { value: parsed?.language || "", name: "language" });
    const title = field(say("form.codeTitle"), { value: parsed?.title || "", name: "title" });
    const body = field(say("form.code"), { rows: 12, mono: true, value: parsed?.body || "", name: "body" });
    const highlight = field(say("form.codeHighlight"), { help: say("form.codeHighlightHelp"), value: parsed?.highlight || "", name: "highlight" });
    const numbersStart = /^\d+$/.test(parsed?.lineNumbers || "") ? parsed.lineNumbers : "";
    const numbers = choice(say("form.codeNumbers"), [{ value: "", label: say("form.codeAuto") }, { value: "on", label: say("form.codeOn") }, { value: "from", label: say("form.codeFrom") }, { value: "off", label: say("form.codeOff") }],
      numbersStart ? "from" : parsed?.lineNumbers || "", () => { from.hidden = numbers.value !== "from"; ctx.onChange?.(); });
    const from = field(say("form.codeStart"), { value: numbersStart || "1", type: "number", name: "lineNumbers" });
    from.hidden = numbers.value !== "from";
    const runnable = h("toggle-switch", { label: say("thing.runnable"), checked: Boolean(parsed?.runnable), onCheckedchange: () => ctx.onChange?.() });
    for (const control of [language, title, body, highlight, from]) control.addEventListener("valuechange", () => ctx.onChange?.());
    const values = () => ({ language: trimmed(language), title: trimmed(title), body: text(body), highlight: trimmed(highlight), lineNumbers: numbers.value === "from" ? trimmed(from) : String(numbers.value || ""), runnable: Boolean(runnable.checked) });
    const start = JSON.stringify(values());
    return {
      element: h("div", { class: "studio-form-fields" }, language, title, body, highlight, numbers, from, runnable),
      focus: () => focusField(language),
      values,
      restore(v) { language.value = v.language || ""; title.value = v.title || ""; body.value = v.body || ""; highlight.value = v.highlight || ""; },
      async read() {
        const v = values();
        const kept = same(ctx, v, start);
        if (kept) return kept;
        const problems = codeFenceProblems(v).map((p) => ({ ...p, code: p.code === "bad-lines" ? "code-lines" : p.field === "body" ? "code-body" : p.code }));
        return problems.length ? { problems } : { markdown: codeFenceMarkdown(v) };
      },
      controls: { language, title, body, highlight, lineNumbers: from },
      sketch: () => cardSummary({ kind: "code", source: codeFenceMarkdown({ ...values(), body: text(body) || " " }) }),
    };
  },

  runnable(ctx) {
    const kind = choice(say("form.runKind"), [{ value: "example", label: say("form.runExample") }, { value: "challenge", label: say("form.runChallenge") }], "example", () => { sync(); ctx.onChange?.(); });
    const language = h("select-field", { label: say("form.codeLanguage"), value: "rust", options: runnableLanguages(ctx.meta).map((value) => ({ value, label: value === "web" ? say("form.runWeb") : value })), onValuechange: () => ctx.onChange?.() });
    const title = field(say("form.codeTitle"), { max: 120, name: "title" });
    const instructions = field(say("form.runTry"), { rows: 3, name: "instructions" });
    const code = field(say("form.code"), { rows: 12, mono: true, value: "fn main() {\n    println!(\"Hello!\");\n}", name: "code" });
    const expected = field(say("form.runExpected"), { rows: 2, name: "expectedOutput" });
    const hint = field(say("form.runHint"), { rows: 2, name: "hint" });
    const explanation = field(say("form.runExplain"), { rows: 3, name: "explanation" });
    const sync = () => { expected.hidden = kind.value !== "challenge"; hint.hidden = kind.value !== "challenge"; };
    sync();
    for (const control of [title, instructions, code, expected, hint, explanation]) control.addEventListener("valuechange", () => ctx.onChange?.());
    const values = () => ({ kind: String(kind.value || "example"), language: String(language.value || "rust"), title: text(title), instructions: text(instructions), code: text(code), expectedOutput: text(expected), hint: kind.value === "challenge" ? text(hint) : "", explanation: text(explanation) });
    return {
      element: h("div", { class: "studio-form-fields" }, kind, language, title, instructions, code, expected, hint, explanation),
      focus: () => focusField(title),
      values,
      restore(v) { title.value = v.title || ""; instructions.value = v.instructions || ""; code.value = v.code || ""; },
      async read() {
        const v = values();
        const problems = codeInteractionProblems(v).map((p) => ({ ...p, code: `run-${p.code}` }));
        return problems.length ? { problems } : { markdown: codeInteractionMarkdown(v) };
      },
      controls: { title, instructions, code, expectedOutput: expected },
      sketch: () => ({ name: say("thing.runnable"), badge: say("thing.runnable"), lines: [trimmed(title)], thumbs: [], more: "", tone: "", mono: false }),
    };
  },

  codepen(ctx) {
    const address = field(say("form.penAddress"), { value: ctx.block ? ctx.block.source.trim() : "", type: "url", name: "url" });
    address.addEventListener("valuechange", () => ctx.onChange?.());
    const values = () => ({ url: trimmed(address) });
    const start = JSON.stringify(values());
    return {
      element: h("div", { class: "studio-form-fields" }, address),
      focus: () => focusField(address),
      values,
      restore(v) { address.value = v.url || ""; },
      async read() {
        const v = values();
        const kept = same(ctx, v, start);
        if (kept) return kept;
        return embedProblem("codepen", v.url) || !parseEmbed(v.url) ? { problems: [{ field: "url", code: "codepen" }] } : { markdown: v.url };
      },
      controls: { url: address },
      sketch: () => ({ name: say("card.codepen", { words: trimmed(address) }), badge: "", lines: [trimmed(address)], thumbs: [], more: "", tone: "", mono: true }),
    };
  },

  footnote(ctx) {
    const was = ctx.block ? /^\[\^(\d+)\]: (.*)$/.exec(ctx.block.source.trim()) : null;
    const note = field(say("form.footnote"), { rows: 3, value: was?.[2] || "", name: "note" });
    note.addEventListener("valuechange", () => ctx.onChange?.());
    const values = () => ({ note: trimmed(note).replace(/\s+/g, " ") });
    const start = JSON.stringify(values());
    return {
      element: h("div", { class: "studio-form-fields" }, note),
      focus: () => focusField(note),
      values,
      restore(v) { note.value = v.note || ""; },
      footnote: true,
      async read() {
        const v = values();
        const kept = same(ctx, v, start);
        if (kept) return kept;
        if (!v.note) return { problems: [{ field: "note", code: "footnote" }] };
        return was ? { markdown: `[^${was[1]}]: ${v.note}` } : { note: v.note, markdown: "" };
      },
      controls: { note },
      sketch: () => ({ name: say("thing.footnote"), badge: "", lines: [trimmed(note)], thumbs: [], more: "", tone: "", mono: false }),
    };
  },
};

// The pieces the server writes from a schema: a button, links to other pages, questions and
// answers, a map, opening hours, how to reach her.
for (const kind of ["button", "social", "faq", "map", "hours", "contact"]) FORMS[kind] = (ctx) => schemaForm(kind, ctx);

const LIST_WORDS = {
  social: { legend: () => say("item.social"), row: (n) => say("form.socialRow", { n }), add: () => say("form.socialAdd"), takeOut: (n) => say("form.socialTakeOut", { n }), added: (n) => say("form.socialAdded", { n }), removed: (n) => say("form.socialGone", { n }) },
  faq: { legend: () => say("item.faq"), row: (n) => say("form.faqRow", { n }), add: () => say("form.faqAdd"), takeOut: (n) => say("form.faqTakeOut", { n }), added: (n) => say("form.faqAdded", { n }), removed: (n) => say("form.faqGone", { n }) },
  hours: { legend: () => say("item.hours"), row: (n) => say("form.hoursRow", { n }), add: () => say("form.hoursAdd"), takeOut: (n) => say("form.hoursTakeOut", { n }), added: (n) => say("form.hoursAdded", { n }), removed: (n) => say("form.hoursGone", { n }) },
};
const FIELD_WORDS = {
  "social.label": () => ({ label: say("form.socialName"), help: say("form.socialNameHelp") }),
  "social.href": () => ({ label: say("form.socialAddress"), help: "" }),
  "faq.question": () => ({ label: say("form.faqQuestion"), help: "" }),
  "faq.answer": () => ({ label: say("form.faqAnswer"), help: "", rows: 3 }),
  "hours.days": () => ({ label: say("form.hoursDays"), help: "" }),
  "hours.hours": () => ({ label: say("form.hoursHours"), help: "" }),
  "hours.note": () => ({ label: say("form.hoursNote"), help: "" }),
  "contact.email": () => ({ label: say("form.contactEmail"), help: "" }),
  "contact.phone": () => ({ label: say("form.contactPhone"), help: "" }),
  "contact.address": () => ({ label: say("form.contactAddress"), help: "" }),
  "map.label": () => ({ label: say("form.mapPlace"), help: say("form.mapPlaceHelp") }),
  "button.label": () => ({ label: say("form.buttonWords"), help: "" }),
};

function schemaForm(kind, ctx) {
  const schema = ctx.meta?.pieces?.find((piece) => piece.kind === kind);
  const parsed = ctx.block ? formValues(schema, parsePieceFence(ctx.block.source, schema)?.values || []) : { top: {}, rows: [] };
  const controls = {};
  const parts = [];
  const extras = [];
  const changed = () => ctx.onChange?.();
  // Top-level fields she sees, in her words; the rest are worked out (map) or in details (button look).
  for (const spec of schema?.fields || []) {
    const words = FIELD_WORDS[`${kind}.${spec.name}`]?.();
    if (!words) continue;
    const control = field(words.label, { help: words.help, value: parsed.top[spec.name] || "", rows: words.rows || 0, max: spec.max || 0, name: spec.name });
    control.addEventListener("valuechange", changed);
    controls[spec.name] = control;
    parts.push(control);
  }
  let rows = null;
  if (schema?.list && LIST_WORDS[kind]) {
    const words = LIST_WORDS[kind];
    rows = rowsEditor({
      legend: words.legend(), rowName: words.row,
      fields: schema.list.fields.map((spec) => ({ name: spec.name, label: (n) => `${FIELD_WORDS[`${kind}.${spec.name}`]?.().label || spec.label} ${n}`, rows: FIELD_WORDS[`${kind}.${spec.name}`]?.().rows || 0, help: FIELD_WORDS[`${kind}.${spec.name}`]?.().help || "" })),
      values: parsed.rows.length ? parsed.rows : [{}], add: words.add(), takeOut: words.takeOut, max: schema.list.max,
      announce: { added: words.added, removed: words.removed }, onChange: changed,
    });
    parts.push(rows.element);
  }
  // Map: a map link says where; latitude and longitude are in details.
  let found = null;
  if (kind === "map") {
    const link = field(say("form.mapLink"), { help: say("form.mapLinkHelp"), type: "url", name: "link" });
    const lat = field(say("form.mapLat"), { value: parsed.top.lat || "", name: "lat" });
    const lon = field(say("form.mapLon"), { value: parsed.top.lon || "", name: "lon" });
    found = h("p", { class: "studio-help", "aria-live": "polite" });
    link.addEventListener("valuechange", () => {
      const place = coordsFromMapLink(trimmed(link));
      found.textContent = place.problem ? "" : say("form.mapFound", { place: placeWords(place) });
      if (!place.problem) { lat.value = String(place.lat); lon.value = String(place.lon); }
      changed();
    });
    for (const control of [lat, lon]) control.addEventListener("valuechange", changed);
    Object.assign(controls, { link, lat, lon });
    parts.push(link, found);
    extras.push(lat, lon);
  }
  // Button: where it goes, and its look in details.
  if (kind === "button") {
    const was = hrefKind(parsed.top.href || "");
    const where = choice(say("form.linkWhere"), [{ value: "post", label: say("form.onePost") }, { value: "website", label: say("form.website") }, { value: "email", label: say("form.email") }, { value: "phone", label: say("form.phone") }],
      ["post", "website", "email", "phone"].includes(was.kind) ? was.kind : "website", () => { show(); changed(); });
    const post = h("select-field", { label: say("form.yourPosts"), options: [{ value: "", label: say("form.choosePost") }], value: was.kind === "post" ? was.value : "", onValuechange: changed });
    const target = field(say("form.buttonTarget"), { value: ["website", "email", "phone"].includes(was.kind) ? was.value : "", name: "href" });
    const any = field(say("form.anyAddress"), { value: was.kind === "any" ? was.value : "", name: "any" });
    const look = choice(say("form.buttonLook"), [{ value: "primary", label: say("form.buttonFilled") }, { value: "secondary", label: say("form.buttonOutlined") }], parsed.top.style || "primary", changed);
    const show = () => { post.hidden = where.value !== "post"; target.hidden = where.value === "post"; };
    ctx.posts?.().then((items) => { post.options = [{ value: "", label: say("form.choosePost") }, ...items.map((item) => ({ value: item.url, label: item.title }))]; if (was.kind === "post") post.value = was.value; }).catch(() => {});
    show();
    for (const control of [target, any]) control.addEventListener("valuechange", changed);
    Object.assign(controls, { where, post, href: target, any, look });
    parts.push(where, post, target);
    extras.push(look, any);
  }
  const href = () => {
    const any = trimmed(controls.any);
    if (any) return hrefFor("any", any);
    const where = String(controls.where.value);
    return hrefFor(where === "website" ? "website" : where, where === "post" ? String(controls.post.value || "") : trimmed(controls.href));
  };
  const top = () => {
    const out = {};
    for (const spec of schema?.fields || []) if (controls[spec.name] && !["href", "style", "lat", "lon"].includes(spec.name)) out[spec.name] = trimmed(controls[spec.name]);
    if (kind === "map") Object.assign(out, { provider: "openstreetmap", lat: trimmed(controls.lat), lon: trimmed(controls.lon) });
    if (kind === "button") Object.assign(out, { href: href().href || "", style: controls.look.value === "secondary" ? "secondary" : "" });
    return out;
  };
  const values = () => ({ top: top(), rows: rows ? rows.read() : [] });
  const start = JSON.stringify(values());
  return {
    element: h("div", { class: "studio-form-fields" }, ...parts, extras.length ? details(...extras) : null),
    focus: () => focusField(parts[0] instanceof Element && parts[0].matches("fieldset") ? rows.control(0, schema.list.fields[0].name) : parts[0]),
    values,
    restore(v) { for (const [name, value] of Object.entries(v.top || {})) if (controls[name] && "value" in controls[name] && name !== "href") controls[name].value = value; },
    serverBuilt: true,
    async read() {
      const v = values();
      const kept = same(ctx, v, start);
      if (kept) return kept;
      const problems = [];
      if (kind === "map" && (!v.top.lat || !v.top.lon)) {
        const place = coordsFromMapLink(trimmed(controls.link));
        problems.push({ field: "link", code: place.problem === "short" ? "map-short" : place.problem === "range" ? "out-of-range" : "map-none" });
      }
      if (kind === "button" && href().problem && href().problem !== "empty") problems.push({ field: "href", code: href().problem === "email" ? "bad-email" : href().problem === "phone" ? "bad-phone" : "bad-address" });
      if (kind === "contact" && !v.top.email && !v.top.phone && !v.top.address) problems.push({ field: "email", code: "contact" });
      if (problems.length) return { problems };
      return serverPiece(ctx.api, kind, pieceValues(schema, v.top, v.rows));
    },
    controls,
    rowControl: (item, name) => rows?.control(item, name),
    sketch: () => sketchFor(kind, values()),
  };
}

function sketchFor(kind, v) {
  const out = { name: "", badge: "", lines: [], thumbs: [], more: "", tone: "", mono: false };
  if (kind === "button") { out.name = say("card.button", { words: v.top.label || "" }); out.lines.push(v.top.label || "", v.top.href ? say("card.goesTo", { words: v.top.href }) : ""); }
  if (kind === "social") { out.name = say("card.social", { words: v.rows.map((row) => row.label).filter(Boolean).join(", ") }); out.lines.push(v.rows.map((row) => row.label).filter(Boolean).join(" · ")); }
  if (kind === "faq") { out.name = say("card.faq", { count: v.rows.length }); out.lines.push(...v.rows.map((row) => row.question).filter(Boolean).slice(0, 3)); }
  if (kind === "map") { out.name = say("card.map", { words: v.top.label || "" }); out.lines.push(out.name); }
  if (kind === "hours") { out.name = say("thing.hours"); out.lines.push(...v.rows.slice(0, 4).map((row) => `${row.days || ""}: ${row.hours || ""}`), v.top.note || ""); }
  if (kind === "contact") { out.name = say("thing.contact"); out.lines.push(v.top.email || "", v.top.phone || "", v.top.address || ""); }
  return out;
}
