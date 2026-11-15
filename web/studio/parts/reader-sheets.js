// The side sheets a reader's note opens (Studio R10, "Shown notes", "Record what you decided",
// "Ideas for later"): Note what changed, Feature it on the post, Link to a later post, Links to later
// posts, Record what you decided, Link to what you made. One sheet at a time; it guards unsaved words
// and gives focus back to the button that opened it. Every request is the old Admin's, lifted; every
// word is said with `say()`. docs/specs/studio/r10/ux.md.
import { fill, h } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { createSheet } from "./sheet.js";
import { sendOut, wentOutWords } from "./publish.js";
import { strangerBody } from "./stranger.js";
import { claimsHash } from "./research-rules.js";
import {
  CHANGE_MAX, NOTE_MAX, RATIONALE_MAX, changeRequest, continuationRequest, continuationStandingText, decisionFields, decisionProblem, extrasProblem, featureConsentLine,
  featureRequest, featureStandingText, linkLine, linkRequest, localDay, noteWords, outcomeRequest, outcomeWords, relations,
} from "./reader-notes-rules.js";

/**
 * `{ change, feature, link, links, decide, ideaLink, sheet }`. `state()` gives
 * `{ features: Map, continuations: { links, works } }`; `tell(words, { undo })` says what happened
 * with Undo; `reload(ref)` reloads the list (and what the sheets read) keeping the card.
 */
export async function createReaderSheets({ api, meta, state, tell, reload }) {
  await use("choice-cards", "date-field", "select-field", "text-field", "action-button");
  const sheet = await createSheet({ label: say("readers.title") });
  const went = async (summary) => wentOutWords(await sendOut(api, summary), { meta, action: "saved" }).words.replace(/^Saved\.\s*/, "");
  const problemLine = () => h("p", { class: "studio-comment-trouble", role: "alert", tabindex: "-1", hidden: true });
  const show = (line, problem, field) => {
    const words = noteWords(problem);
    if (field) { field.error = words; field.querySelector?.("input, textarea, select")?.focus(); }
    line.textContent = words;
    line.hidden = false;
    if (!field) line.focus();
  };
  const ref = (item) => `${item.source}:${item.id}`;
  const textOf = (field) => String(field.value ?? "");

  // ---- Note what changed (engagement/feedback/revision-note)
  function change(item, opener, { post = item.post?.source, then = null } = {}) {
    const note = h("text-field", { label: say("readers.changeWhat"), rows: 2, maxlength: CHANGE_MAX });
    const date = h("date-field", { label: say("readers.changeDay"), value: localDay() });
    const claim = h("text-field", { label: say("readers.changeClaim"), maxlength: 64, autocomplete: "off" });
    const line = problemLine();
    const go = h("action-button", { onClick: async () => {
      const request = changeRequest(post, { note: textOf(note), date: String(date.value || ""), claim: textOf(claim) });
      if (!request.ok) return show(line, request, request.field === "claim" ? claim : note);
      go.loading = true;
      try {
        await api.post("engagement/feedback/revision-note", request.body);
        const words = `${say("readers.changeAdded")} ${await went("A note about what changed")}`.trim();
        if (then) { then(request.body.note); return; }
        sheet.close();
        tell(words);
        await reload(ref(item));
      } catch (error) {
        if (error.status === 401) throw error;
        const code = error?.data?.code;
        show(line, code === "problems" || error.status === 422 ? { id: "readers.changeEmpty" } : extrasProblem(error, "change"), error.status === 422 ? note : null);
      } finally {
        go.loading = false;
      }
    } }, say("readers.changeAdd"));
    const fields = [h("p", { class: "studio-help", text: say("readers.changeHelp") }), note, date, h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), claim), line, h("div", { class: "studio-sheet-actions" }, go)];
    if (then) return fields;
    sheet.show({ heading: say("readers.changeTitle"), opener, children: fields, dirty: () => textOf(note).trim() !== "", focus: () => note.querySelector("textarea, input")?.focus() });
    return null;
  }

  // ---- Feature it on the post (engagement/community/*)
  function feature(item, opener) {
    const featured = state().features.get(item.id) || null;
    const noteField = h("text-field", { label: say("readers.featureNote"), description: say("readers.featureNoteHelp"), rows: 3, maxlength: NOTE_MAX, value: featured?.context || "" });
    const line = problemLine();
    const preview = h("div", { "aria-live": "polite", class: "studio-reader-preview" });
    const title = item.post?.title || "";
    const children = [h("p", { text: featured ? featureStandingText(featured) : featureConsentLine(item.featureConsent) })];
    const call = async (control, path, body, done) => {
      control.loading = true;
      try {
        const reply = await api.post(path, body);
        await done(reply);
      } catch (error) {
        if (error.status === 401) throw error;
        show(line, extrasProblem(error, "feature"), error?.data?.code === "note-refused" ? noteField : null);
      } finally {
        control.loading = false;
      }
    };
    const featureIt = async (note, words) => {
      await api.post("engagement/community/feature", featureRequest({ ...item }, note));
      tell(`${words} ${await went("A featured reflection")}`.trim(), { undo: () => unfeature(note, true) });
      await reload(ref(item));
    };
    const unfeature = async (note, undoing = false) => {
      await api.post("engagement/community/unfeature", { id: item.id });
      tell(`${say("readers.featureTakenOff")} ${await went("A feature taken off")}`.trim(), undoing ? {} : { undo: () => featureIt(note, say("readers.featuredAgain")).catch((error) => tell(noteWords(extrasProblem(error, "feature")))) });
      await reload(ref(item));
    };
    if (featured) {
      const saveNote = h("action-button", { onClick: () => call(saveNote, "engagement/community/note", { id: item.id, context: textOf(noteField) }, async () => { sheet.close(); tell(`${say("readers.featureNoteSaved")} ${await went("A featured reflection's note")}`.trim()); await reload(ref(item)); }) }, say("readers.featureSaveNote"));
      const off = h("action-button", { variant: "secondary", onClick: async () => { off.loading = true; try { await unfeature(featured.context || ""); sheet.close(); } catch (error) { if (error.status === 401) throw error; show(line, extrasProblem(error, "feature")); } finally { off.loading = false; } } }, say("readers.featureOff"));
      children.push(noteField, line, h("div", { class: "studio-sheet-actions" }, saveNote, off));
    } else if (item.featureConsent === "agreed") {
      const see = h("action-button", { variant: "secondary", onClick: () => call(see, "engagement/community/preview", { id: item.id, context: textOf(noteField).trim() }, (reply) => {
        const shown = reply?.preview || {};
        fill(preview, h("p", { class: "studio-label", text: say("readers.featureSee") }), strangerBody(shown.response?.body || ""),
          shown.context ? h("p", { class: "studio-stranger", dir: "auto", text: shown.context }) : null,
          reply?.willPublish ? h("p", { class: "studio-help", text: say("readers.featureAlsoShows") }) : null);
      }) }, say("readers.featureSee"));
      const go = h("action-button", { onClick: async () => {
        go.loading = true;
        try {
          await featureIt(textOf(noteField), say("readers.featured", { title }));
          sheet.close();
        } catch (error) {
          if (error.status === 401) throw error;
          show(line, extrasProblem(error, "feature"), error?.data?.code === "note-refused" ? noteField : null);
        } finally {
          go.loading = false;
        }
      } }, say("readers.featureGo"));
      children.push(noteField, preview, line, h("div", { class: "studio-sheet-actions" }, see, go));
    }
    sheet.show({ heading: say("readers.featureTitle"), opener, children, dirty: () => textOf(noteField) !== String(featured?.context || ""), focus: () => noteField.querySelector("textarea")?.focus() });
  }

  // ---- Link to a later post (engagement/continuations/*)
  function link(item, opener) {
    const { links, works } = state().continuations;
    const existing = links.filter((l) => l.origin === item.id);
    const to = h("select-field", { label: say("readers.linkTo"), options: [{ value: "", label: say("readers.linkChoose") }, ...works.map((w) => ({ value: w.path, label: String(w.title || w.path) }))] });
    const relation = h("select-field", { label: say("readers.linkRelation"), options: relations(item), value: "takes-up" });
    const note = h("text-field", { label: say("readers.linkNote"), description: say("readers.linkNoteHelp", { max: NOTE_MAX }), rows: 2, maxlength: NOTE_MAX });
    const line = problemLine();
    const preview = h("div", { "aria-live": "polite", class: "studio-reader-preview" });
    const form = () => ({ to: String(to.value || ""), relation: String(relation.value || "takes-up"), note: textOf(note) });
    const linkIt = async (fields, undoing = false) => {
      const reply = await api.post("engagement/continuations/link", continuationRequest(item, fields));
      tell(`${say("readers.linked")} ${await went("A link to a later post")}`.trim(), undoing ? {} : { undo: async () => { await api.post("engagement/continuations/unlink", { id: reply?.link?.id || reply?.id }); tell(say("readers.unlinked")); await reload(ref(item)); } });
      await reload(ref(item));
    };
    const run = async (control, choose) => {
      if (!form().to) return show(line, { id: "readers.linkNeedPost" }, to);
      control.loading = true;
      try {
        if (choose) { await linkIt(form()); sheet.close(); return; }
        const reply = await api.post("engagement/continuations/preview", continuationRequest(item, form()));
        const p = reply?.preview || {};
        fill(preview, h("p", { class: "studio-help", text: linkLine({ from: p.from, to: p.to, relation: form().relation, linked: localDay() }) }), p.note ? h("p", { class: "studio-stranger", dir: "auto", text: p.note }) : null);
      } catch (error) {
        if (error.status === 401) throw error;
        show(line, extrasProblem(error, "link"), error?.data?.code === "note-refused" ? note : null);
      } finally {
        control.loading = false;
      }
    };
    const see = h("action-button", { variant: "secondary", onClick: (e) => run(e.currentTarget, false) }, say("readers.linkSee"));
    const go = h("action-button", { onClick: (e) => run(e.currentTarget, true) }, say("readers.linkGo"));
    sheet.show({ heading: say("readers.linkTitle"), opener, dirty: () => Boolean(form().to || form().note.trim()), focus: () => to.querySelector("select")?.focus(),
      children: [h("p", { class: "studio-help", text: say("readers.linkHelp") }),
        existing.length ? h("p", { class: "studio-help", text: say("readers.linkExisting", { list: existing.map((l) => l.to).join(", ") }) }) : null,
        to, relation, note, preview, line, h("div", { class: "studio-sheet-actions" }, see, go)] });
  }

  // ---- Links to later posts (the list, remove, sweep)
  function links(opener) {
    const list = h("ul", { class: "studio-reader-lines" });
    const line = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
    const draw = () => {
      const all = state().continuations.links;
      list.replaceChildren(...(all.length ? all.map((l) => {
        const remove = h("action-button", { variant: "secondary", size: "sm", onClick: async () => {
          remove.loading = true;
          try {
            await api.post("engagement/continuations/unlink", { id: l.id });
            const words = `${say("readers.unlinked")} ${await went("A link to a later post removed")}`.trim();
            line.textContent = words;
            tell(words, { undo: async () => {
              await api.post("engagement/continuations/link", continuationRequest({ id: l.origin, version: l.originVersion ?? l.expectedVersion }, { to: l.toPath || l.to, relation: l.relation, note: l.note || "" }));
              tell(say("readers.linked"));
              await reload("");
            } });
            await reload("");
            draw();
          } catch (error) {
            if (error.status === 401) throw error;
            line.textContent = noteWords(extrasProblem(error, "link"));
          } finally {
            remove.loading = false;
          }
        } }, say("readers.linkRemove"));
        return h("li", { "data-link": l.id }, h("p", { class: "studio-stranger", dir: "auto", text: linkLine(l) }), h("p", { class: "studio-help", text: continuationStandingText(l) }), remove);
      }) : [h("li", { text: say("readers.linksNone") })]));
    };
    const sweep = h("action-button", { variant: "secondary", onClick: async () => {
      sweep.loading = true;
      try {
        const reply = await api.post("engagement/continuations/sweep", {});
        line.textContent = reply?.dropped ? say("readers.sweepDropped", { n: reply.dropped }) : say("readers.sweepNone");
        await reload("");
        draw();
      } catch (error) {
        if (error.status === 401) throw error;
        line.textContent = noteWords(extrasProblem(error, "link"));
      } finally {
        sweep.loading = false;
      }
    } }, say("readers.linksSweep"));
    draw();
    sheet.show({ heading: say("readers.linksTitle"), opener, children: [list, h("div", { class: "studio-sheet-actions" }, sweep), line] });
  }

  // ---- Record what you decided (engagement/moderation/decision)
  function decide(item, opener) {
    const offer = item.recordDecision || {};
    const values = { decided: localDay() };
    const line = problemLine();
    const outcome = h("choice-cards", { label: say("readers.decideWhat"), items: (offer.outcomes || []).map((o) => ({ id: o.id, title: String(o.label || o.id), detail: String(o.guidance || "") })), onValuechange: (e) => { values.outcome = e.detail; paint(); } });
    const extent = h("choice-cards", { label: say("readers.decideExtent"), items: (offer.extents || []).map((o) => ({ id: o.id, title: String(o.label || o.id) })), onValuechange: (e) => { values.extent = e.detail; paint(); } });
    const reason = h("select-field", { label: say("readers.decideWhyNot"), options: [{ value: "", label: say("readers.decideChooseWhy") }, ...(offer.declineReasons || []).map((r) => ({ value: r.id, label: String(r.label || r.id) }))], onValuechange: (e) => { values.declineReason = e.detail; } });
    const rationale = h("text-field", { label: say("readers.decideWords"), description: say("readers.decideWordsHelp"), rows: 4, maxlength: RATIONALE_MAX, onValuechange: () => { values.rationale = textOf(rationale); } });
    const noteChoice = h("select-field", { label: say("readers.decideNote"), options: [{ value: "", label: say("readers.decideNoNote") }, ...(offer.revisionNotes || []).map((t) => ({ value: String(t), label: String(t) }))], onValuechange: (e) => { values.revisionNote = e.detail; } });
    const addNote = h("details", { class: "studio-help" }, h("summary", { text: say("readers.changeButton") }), ...(offer.post ? change(item, null, { post: offer.post, then: (added) => {
      noteChoice.options = [...noteChoice.options, { value: added, label: added }];
      noteChoice.value = added;
      values.revisionNote = added;
      addNote.open = false;
    } }) : []));
    // R12: the evidence she recorded opens in this post's Claims and evidence, on the chosen claim.
    const evidenceLink = claimsHash(item.post?.source)
      ? h("action-button", { variant: "secondary", size: "sm", href: claimsHash(item.post.source) }, say("readers.decideOpenEvidence")) : null;
    const evidenceSelect = (offer.claimEvidence || []).length
      ? h("select-field", { label: say("readers.decideEvidence"), options: [{ value: "", label: say("readers.decideChooseWhy") }, ...offer.claimEvidence.map((c) => ({ value: `${c.claim} ${c.link}`, label: String(c.label) }))], onValuechange: (e) => {
        values.claimEvidence = e.detail;
        if (evidenceLink) evidenceLink.href = claimsHash(item.post.source, String(e.detail || "").split(" ")[0]);
      } })
      : null;
    const evidence = h("div", {}, evidenceSelect || h("p", { class: "studio-help", text: say("readers.decideNoEvidence") }), evidenceLink);
    const addressed = h("text-field", { label: say("readers.decideAddressed"), maxlength: 64, onValuechange: () => { values.addressedBy = textOf(addressed); } });
    const day = h("date-field", { label: say("readers.decideDay"), value: values.decided, onValuechange: (e) => { values.decided = String(e.detail || "") || localDay(); } });
    const confirm = h("input", { type: "checkbox", id: `studio-decide-confirm-${item.id}` });
    confirm.addEventListener("change", () => { values.confirmed = confirm.checked; });
    const confirmRow = h("label", { class: "studio-select-toggle", for: confirm.id }, confirm, " ", say("readers.decideConfirm"));
    const summary = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
    const parts = { outcome, extent, declineReason: reason, rationale, revisionNote: h("div", {}, noteChoice, addNote), claimEvidence: evidence, addressedBy: addressed, decided: day, confirmed: confirmRow };
    function paint() {
      const shown = new Set(decisionFields(offer, values));
      for (const [name, node] of Object.entries(parts)) node.hidden = !shown.has(name);
      const chosen = (offer.outcomes || []).find((o) => o.id === values.outcome);
      summary.textContent = chosen ? say("readers.decideSummary", { outcome: String(chosen.label || chosen.id).toLowerCase() }) : "";
    }
    const go = h("action-button", { onClick: async () => {
      const problem = decisionProblem(item, values);
      if (problem) {
        const field = { outcome, extent, declineReason: reason, rationale, revisionNote: noteChoice, claimEvidence: evidenceSelect, addressedBy: addressed, confirmed: null }[problem.field];
        if (field && "error" in field) field.error = noteWords(problem);
        return show(line, problem, null);
      }
      go.loading = true;
      try {
        const reply = await api.post("engagement/moderation/decision", outcomeRequest(item, values));
        sheet.close();
        tell(`${outcomeWords(reply)}${reply?.outcomePublished ? ` ${await went("A recorded decision")}` : ""}`.trim());
        await reload(ref(item));
      } catch (error) {
        if (error.status === 401) throw error;
        const code = error?.data?.code;
        if (code === "missing" && error.data?.field) return show(line, decisionProblem(item, { ...values, [error.data.field]: "" }) || { id: "readers.fixFailed" });
        show(line, extrasProblem(error, "decide"));
        if (error.status === 409) await reload(ref(item));
      } finally {
        go.loading = false;
      }
    } }, say("readers.decideGo"));
    paint();
    sheet.show({ heading: say("readers.decideTitle"), opener, dirty: () => Boolean(values.outcome || String(values.rationale || "").trim()),
      focus: () => outcome.querySelector("[role=radio]")?.focus(),
      children: [h("p", { class: "studio-help", text: say("readers.decideHelp") }), ...Object.values(parts), summary, line,
        h("div", { class: "studio-sheet-actions" }, go), h("p", { class: "studio-help", text: say("readers.decideNoUndo") })] });
  }

  // ---- Link to what you made (engagement/suggestions/link)
  function ideaLink(item, opener) {
    const offer = item.suggestion?.link || {};
    const kind = h("select-field", { label: say("readers.ideaLinkWhat"), options: [{ value: "", label: say("readers.ideaLinkChoose") }, ...(offer.kinds || []).map((k) => ({ value: k.id, label: String(k.label || k.id) }))] });
    const target = h("text-field", { label: say("readers.ideaLinkWhich"), description: say("readers.ideaLinkWhichHelp"), maxlength: 64, autocomplete: "off", spellcheck: false });
    const line = problemLine();
    const go = h("action-button", { disabled: Boolean(offer.full), onClick: async () => {
      const request = linkRequest(item, String(kind.value || ""), textOf(target));
      if (!request.ok) return show(line, request, request.field === "kind" ? kind : target);
      go.loading = true;
      try {
        await api.post("engagement/suggestions/link", request.body);
        sheet.close();
        tell(say("readers.ideaLinked"));
        await reload(ref(item));
      } catch (error) {
        if (error.status === 401) throw error;
        show(line, extrasProblem(error, "ideaLink"), target);
        if (error.status === 409 && error?.data?.code !== "already-linked" && error?.data?.code !== "alreadyLinked") await reload(ref(item));
      } finally {
        go.loading = false;
      }
    } }, say("readers.ideaLinkGo"));
    sheet.show({ heading: say("readers.ideaLinkTitle"), opener, dirty: () => Boolean(kind.value || textOf(target).trim()), focus: () => kind.querySelector("select")?.focus(),
      children: [offer.full ? h("p", { class: "studio-help", text: say("readers.ideaLinkFull") }) : null, kind, target,
        offer.credit?.line ? h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-stranger", dir: "auto", text: String(offer.credit.line) })) : null,
        line, h("div", { class: "studio-sheet-actions" }, go)] });
  }

  return { sheet, change: (item, opener) => change(item, opener), feature, link, links, decide, ideaLink };
}
