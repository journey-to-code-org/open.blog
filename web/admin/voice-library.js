// <ob-voice-library>: the samples the author has, grouped by prompt pack (ADR 0373). Each pack shows how much
// of it is written, each prompt with a sample shows its stage as a badge (a word and a shape, not a color),
// its length, where it is kept and when it was written, and every pack offers a draw from just that pack. A
// file that cannot be read is listed with guidance and never hidden. The order is the catalog's, and newest
// first inside a pack, so the same files always give the same page.

import { el } from "./block-forms.js";
import { buildRoughView, createPolishedEditor, keepBarReachable } from "./voice-polished.js";
import { EMPTY_LIBRARY_TEXT, STAGE_BADGES, dateText, groupLibrary, libraryHash, visibilityText, voiceErrorText, voiceHash, wordsText } from "./voice.js";

let uid = 0;

const badge = (stage) =>
  el("span", { class: `oba-voice-badge oba-voice-badge-${stage}`, "data-stage": stage }, el("span", { "aria-hidden": "true" }, `${STAGE_BADGES[stage].symbol} `), STAGE_BADGES[stage].text);

function rowNode(row) {
  const meta = [wordsText(row.words), visibilityText(row.visibility), dateText(row.date)].filter(Boolean).join(" · ");
  return el(
    "li",
    { class: "oba-voice-row", "data-prompt": row.prompt },
    el(
      "div",
      { class: "oba-voice-row-head" },
      el("strong", { class: "oba-voice-row-title" }, row.title),
      el("span", { class: "oba-voice-badges" }, row.badges.map((stage) => badge(stage))),
    ),
    el("p", { class: "oba-small oba-voice-row-meta", "data-voice-meta": "true" }, meta),
    // A rough draft is read; a polished one is edited; a rough draft with no polished copy offers to make one.
    el(
      "div",
      { class: "oba-landing-actions oba-voice-row-actions" },
      row.rough
        ? el("a", { class: "oba-btn", href: libraryHash(row.rough.id), "data-action": "voice-open-rough", "aria-label": `Read the rough draft: ${row.title}` }, "Read rough draft")
        : null,
      row.polished
        ? el("a", { class: "oba-btn", href: libraryHash(row.polished.id), "data-action": "voice-open-polished", "aria-label": `Edit the polished draft: ${row.title}` }, "Edit polished draft")
        : row.rough
          ? el("a", { class: "oba-btn", href: libraryHash(row.rough.id), "data-action": "voice-polish", "aria-label": `Polish a copy of: ${row.title}` }, "Polish this")
          : null,
    ),
  );
}

function groupNode(group, ids) {
  const headingId = `${ids}-${group.id}`;
  return el(
    "section",
    { class: "oba-voice-group", "aria-labelledby": headingId, "data-pack": group.id },
    el("h3", { id: headingId }, group.title),
    group.summary ? el("p", { class: "oba-small oba-voice-group-summary" }, group.summary) : null,
    group.coverage ? el("p", { class: "oba-voice-coverage", "data-voice-coverage": "true" }, group.coverage) : null,
    group.rows.length
      ? el("ul", { class: "oba-voice-rows", "aria-label": `Your samples in ${group.title}` }, group.rows.map((row) => rowNode(row)))
      : el("p", { class: "oba-small", "data-voice-none": "true" }, "Nothing written in this pack yet."),
    group.pack && group.unwritten
      ? el("a", { class: "oba-btn", href: voiceHash(group.id), "data-action": "voice-draw-pack", "aria-label": `Draw from this pack: ${group.title}` }, "Draw from this pack")
      : null,
  );
}

/**
 * The one-time invitation to the Voice view, shown on the Admin home (ADR 0376). `onDismiss()` remembers the
 * dismissal (it resolves true when it did, false when it cannot) and `onGone()` runs once the card is removed.
 * Start is an ordinary link to the Voice view. A dismissal that could not be saved keeps the card and says so.
 */
export function buildVoiceInvitation({ onDismiss, onGone = () => {} }) {
  const id = `oba-voice-invite-${++uid}`;
  const status = el("p", { class: "oba-small", role: "status", "aria-live": "polite", "data-voice-invitation-status": "true" });
  const dismiss = el(
    "button",
    {
      class: "oba-btn",
      type: "button",
      "data-action": "voice-dismiss",
      "aria-label": "Dismiss this invitation",
      onClick: async () => {
        dismiss.disabled = true;
        let saved = false;
        try {
          saved = (await onDismiss()) !== false;
        } catch {
          saved = false;
        }
        if (saved) {
          element.remove();
          onGone();
          return;
        }
        dismiss.disabled = false;
        status.textContent = "That could not be remembered just now, so the invitation stays. Try again later.";
      },
    },
    "Dismiss",
  );
  const element = el(
    "section",
    { class: "oba-notice oba-voice-invitation", "aria-labelledby": id, "data-voice-invitation": "true" },
    el("h2", { id }, "Gather your voice"),
    el("p", {}, "Draw three prompts, pick one and write for three minutes, the way you would say it. Your rough draft stays exactly as you wrote it, you can polish a copy, and nothing is ever published. It is private by default and takes about five minutes."),
    el(
      "div",
      { class: "oba-landing-actions" },
      el("a", { class: "oba-btn oba-btn-primary", href: voiceHash(), "data-action": "voice-invitation-start" }, "Try a voice session"),
      dismiss,
    ),
    status,
  );
  return { element };
}

/** Returns `{ element, load, isDirty, isBusy, destroy }`. */
export function createVoiceLibrary({ api, user = "", storage, clock, onDirty = () => {} }) {
  const root = el("ob-voice-library", { class: "oba-voice oba-voice-library", "data-voice-library": "true" });
  const ids = `oba-voice-lib-${++uid}`;
  let generation = 0;
  let editor = null;
  const timers = clock ? { setTimer: clock.setTimeout, clearTimer: clock.clearTimeout } : {};

  /** Open the list, or one sample when `openId` is given. */
  async function load(openId = "") {
    if (openId) return open(openId);
    editor = null;
    const mine = ++generation;
    root.replaceChildren(el("p", { class: "oba-small", role: "status", "data-voice-loading": "true" }, "Loading your samples…"));
    let data;
    try {
      data = await api.call("GET", "voice/samples");
    } catch (error) {
      if (mine !== generation) return;
      root.replaceChildren(
        el("h2", { tabindex: "-1" }, "Your voice samples"),
        el("p", { class: "oba-error", role: "alert", "data-voice-error": "true" }, voiceErrorText(error)),
        el("button", { class: "oba-btn", type: "button", "data-action": "voice-retry", onClick: () => load() }, "Try again"),
      );
      return;
    }
    if (mine !== generation) return;
    show(data);
  }

  function show(data) {
    const library = groupLibrary(data);
    if (library.empty) {
      root.replaceChildren(
        el("h2", { id: `${ids}-title`, tabindex: "-1", "data-voice-heading": "true" }, "Your voice samples"),
        el(
          "section",
          { class: "oba-notice oba-voice-empty", "aria-labelledby": `${ids}-empty`, "data-voice-empty": "true" },
          el("strong", { id: `${ids}-empty` }, "No samples yet"),
          el("p", {}, EMPTY_LIBRARY_TEXT),
          el("a", { class: "oba-btn oba-btn-primary", href: voiceHash(), "data-action": "voice-start-session" }, "Start a session"),
        ),
      );
      return;
    }
    const sampled = library.groups.reduce((n, g) => n + g.rows.length, 0) + (library.other?.rows.length || 0);
    const polished = [...library.groups, library.other].filter(Boolean).reduce((n, g) => n + g.rows.filter((r) => r.polished).length, 0);
    const parts = [
      el("h2", { id: `${ids}-title`, tabindex: "-1", "data-voice-heading": "true" }, "Your voice samples"),
      el("p", { class: "oba-voice-summary", "data-voice-summary": "true" }, `${sampled} ${sampled === 1 ? "prompt" : "prompts"} written, ${polished} polished. Rough drafts stay as you wrote them; polished drafts are yours to edit.`),
      el("div", { class: "oba-landing-actions" }, el("a", { class: "oba-btn oba-btn-primary", href: voiceHash(), "data-action": "voice-start-session" }, "Start a session")),
      library.groups.map((group) => groupNode(group, ids)),
      library.other ? groupNode(library.other, ids) : null,
      library.invalid.length
        ? el(
            "section",
            { class: "oba-voice-group oba-voice-invalid", "aria-labelledby": `${ids}-invalid`, "data-voice-invalid": "true" },
            el("h3", { id: `${ids}-invalid` }, "Files that need attention"),
            el("p", { class: "oba-small" }, "These files are in your voice folders but cannot be used as samples. Nothing was changed."),
            el(
              "ul",
              { class: "oba-voice-rows" },
              library.invalid.map((file) =>
                el(
                  "li",
                  { class: "oba-voice-row", "data-file": file.file },
                  el("strong", { class: "oba-voice-row-title" }, file.file),
                  el("p", { class: "oba-small" }, `${visibilityText(file.visibility)}. ${file.guidance || ""}`),
                ),
              ),
            ),
          )
        : null,
    ];
    // A real DOM turns null and arrays into text, so only nodes are passed on.
    root.replaceChildren(...parts.flat().filter(Boolean));
  }

  // ----- one sample
  const back = () => el("p", {}, el("a", { href: libraryHash(), "data-action": "voice-back" }, "Back to your samples"));

  async function open(id) {
    const mine = ++generation;
    editor = null;
    root.replaceChildren(el("p", { class: "oba-small", role: "status", "data-voice-loading": "true" }, "Opening…"));
    try {
      const sample = await api.call("GET", `voice/samples/${id}`);
      if (mine !== generation) return;
      if (!sample.valid) return showInvalid(sample);
      // Either stage opens with both drafts: the rough one to read and the polished one to edit.
      const partner = sample.partner ? await api.call("GET", `voice/samples/${sample.partner.id}`) : null;
      if (mine !== generation) return;
      const rough = sample.stage === "rough" ? sample : partner;
      const polished = sample.stage === "polished" ? sample : partner;
      if (!rough || !rough.valid || rough.stage !== "rough") return showInvalid({ ...sample, guidance: "Its rough draft is missing, so it cannot be opened. Put the rough draft back, or erase this polished draft." });
      showSample(sample, rough, polished?.valid ? polished : null, mine);
    } catch (error) {
      if (mine !== generation) return;
      root.replaceChildren(
        back(),
        el("h2", { tabindex: "-1", "data-voice-heading": "true" }, "Sample"),
        el("p", { class: "oba-error", role: "alert", "data-voice-error": "true" }, error?.status === 404 ? "There is no such voice sample. It may have been moved or erased." : voiceErrorText(error)),
      );
    }
  }

  function showInvalid(sample) {
    root.replaceChildren(
      back(),
      el("h2", { tabindex: "-1", "data-voice-heading": "true" }, "This file cannot be opened"),
      el("p", { class: "oba-error", role: "alert", "data-voice-invalid-file": "true" }, sample.guidance || "This file cannot be used as a voice sample."),
      el("p", { class: "oba-small" }, `${sample.file}. Nothing was changed.`),
    );
  }

  function showSample(sample, rough, polished, mine) {
    const heading = el("h2", { id: `${ids}-open`, tabindex: "-1", "data-voice-heading": "true" }, rough.promptTitle || rough.title);
    const roughView = buildRoughView({ api, sample: rough });
    editor = createPolishedEditor({
      api,
      user,
      storage,
      ...timers,
      rough: { file: rough.file, title: rough.title, body: rough.body },
      polished,
      onChange: (dirty) => onDirty(dirty),
    });
    root.replaceChildren(
      back(),
      heading,
      el("p", { class: "oba-small", "data-voice-open-meta": "true" }, `${polished ? "Rough and polished drafts" : "Rough draft only"}. ${dateText(rough.date)}`.trim()),
      roughView.element,
      el("h3", { class: "oba-voice-polish-heading", "data-voice-polish-heading": "true" }, polished ? "Edit your polished draft" : "Polish a copy"),
      editor.element,
    );
    keepBarReachable(editor.bar(), () => mine === generation);
    // The stage names where the author goes next: a polished draft to its editor, a rough one to its heading.
    if (sample.stage === "polished") editor.focus();
    else heading.focus();
  }

  return {
    element: root,
    load,
    isDirty: () => Boolean(editor?.isDirty()),
    isBusy: () => Boolean(editor?.isBusy()),
    destroy() {
      generation += 1;
    },
  };
}

if (typeof HTMLElement !== "undefined" && globalThis.customElements && !globalThis.customElements.get("ob-voice-library")) {
  globalThis.customElements.define("ob-voice-library", class ObVoiceLibrary extends HTMLElement {});
}
