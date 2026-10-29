// Capture's Assistant helpers (ADRs 0420 and 0422): turn the voice note into words and, after the author has
// seen what is sent, into a draft. Every call here goes through this site's own Admin, which owns the provider
// boundary; nothing is sent before the author confirms, nothing is saved or published by this module, and the
// text that comes back is untrusted, so it is made plain before it reaches the notes. The first half is plain
// functions (tests/web/admin-capture-assistant.test.mjs); the second builds the controls.

import { el } from "./block-forms.js";

const sizeText = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * A transcript made safe to sit in the notes, which become the post's Markdown. `<` becomes an entity, so no tag
 * can form; a line that starts a heading, quote, list, rule or fence is escaped, and a bracket cannot open a
 * link or image. It still reads as the words that were spoken.
 */
export function plainNotes(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/&(?=#?\w+;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\[/g, "\\[")
    .split("\n")
    .map((line) => line.replace(/^(\s*)([#>`~|]|[-+*](?=\s)|\d+[.)](?=\s)|={3,}|-{3,}|\*{3,}|_{3,})/, "$1\\$2"))
    .join("\n")
    .trim();
}

/** The notes after a transcript is added under what the author already typed, cut to the bound. */
export function appendTranscript(notes, transcript, maxChars) {
  const typed = String(notes ?? "").replace(/\s+$/, "");
  const added = plainNotes(transcript);
  const joined = typed ? `${typed}\n\n${added}` : added;
  if (joined.length <= maxChars) return { notes: joined, clipped: false };
  return { notes: joined.slice(0, maxChars).replace(/\s+$/, ""), clipped: true };
}

/** What the server says it would send, as lines for the author to read before confirming. */
export function disclosureLines(disclosure, audioBytes) {
  const lines = [];
  const where = disclosure.engine === "local" ? "this server's own transcription engine" : `${disclosure.destination}${disclosure.model ? ` (${disclosure.model})` : ""}`;
  lines.push(`Sent to: ${where}.`);
  const sends = Array.isArray(disclosure.sends) ? disclosure.sends : [];
  for (const line of sends) lines.push(`Sent: ${String(line).replace(/\(\d+ KB, (\w+)\)/, audioBytes ? `(${sizeText(audioBytes)}, $1)` : "($1)")}`);
  lines.push(disclosure.leavesServer ? "The recording leaves your server." : "The recording stays on your server.");
  if (disclosure.keeps) lines.push(String(disclosure.keeps));
  return lines;
}

/** Whether transcription is possible, read from the server. Anything unexpected counts as not available. */
export async function loadTranscribeAvailability(api) {
  try {
    const disclosure = await api.call("GET", "assistant/transcribe");
    return disclosure?.available ? { available: true, disclosure } : { available: false, reason: String(disclosure?.reason || "") };
  } catch {
    return { available: false, reason: "" };
  }
}

/** Keep the note on the server (the same id keeps the first copy), then transcribe it. Returns `{ transcript, truncated }`. */
export async function transcribeNote({ api, captureId, blob }) {
  await api.call("POST", `capture-audio?capture=${captureId}`, { body: blob, headers: { "Content-Type": "application/octet-stream" } });
  return api.call("POST", "assistant/transcribe", { json: { captureId, confirmed: true } });
}

/**
 * The transcription control under the voice note. `notes` is the Notes textarea; `limits.maxNotesChars` bounds it.
 * `update(note)` is told whether a voice note exists (`{ captureId, blob, size }`) or not (`null`).
 */
export function createTranscribeBox({ api, notes, limits, announce = () => {} }) {
  const root = el("div", { class: "oba-capture-ai", hidden: true, "data-capture-transcribe": "true" });
  let note = null;
  let availability = null;
  let step = "idle";
  let undo = null;
  let token = 0;

  const unavailableText = () => availability?.reason || "Transcription is not set up for this site. Type your notes instead.";

  const button = (label, attrs, onClick) => el("button", { type: "button", class: "oba-btn", ...attrs, onClick }, label);

  const render = () => {
    root.hidden = !note;
    if (!note) {
      root.replaceChildren();
      return;
    }
    if (!availability) {
      root.replaceChildren(el("p", { class: "oba-help" }, "Checking whether transcription is set up…"));
      return;
    }
    if (!availability.available) {
      root.replaceChildren(el("p", { class: "oba-help", "data-capture-transcribe-off": "true" }, unavailableText()));
      return;
    }
    if (step === "confirm") {
      const heading = el("h4", { class: "oba-capture-ai-title", tabindex: "-1" }, "Before anything is sent");
      root.replaceChildren(
        heading,
        el("ul", { class: "oba-capture-ai-sends", "data-capture-disclosure": "true" }, disclosureLines(availability.disclosure, note.size).map((line) => el("li", {}, line))),
        el("div", { class: "oba-capture-voice-actions" },
          button("Send the recording", { class: "oba-btn oba-btn-primary", "data-capture-transcribe-send": "true" }, run),
          button("Cancel", { "data-capture-transcribe-cancel": "true" }, () => {
            step = "idle";
            render();
            root.querySelector("[data-capture-transcribe-start]")?.focus();
          }),
        ),
      );
      heading.focus();
      return;
    }
    const parts = [
      button(step === "working" ? "Transcribing…" : "Transcribe with AI", { "data-capture-transcribe-start": "true", disabled: step === "working", "aria-busy": step === "working" ? "true" : null }, () => {
        step = "confirm";
        render();
      }),
      el("p", { class: "oba-help" }, "Optional. You see what is sent, and where, before anything leaves. You can always type your notes instead."),
    ];
    if (undo) parts.push(button("Undo the transcript", { "data-capture-transcribe-undo": "true" }, () => {
      notes.value = undo.before;
      undo = null;
      announce("Transcript removed. Your notes are as they were.");
      render();
      notes.focus();
    }));
    root.replaceChildren(...parts);
  };

  async function run() {
    const mine = ++token;
    const sending = note;
    step = "working";
    render();
    announce("Transcribing…");
    try {
      const { transcript, truncated } = await transcribeNote({ api, captureId: sending.captureId, blob: sending.blob });
      if (mine !== token) return;
      const before = notes.value;
      const next = appendTranscript(before, transcript, limits.maxNotesChars);
      notes.value = next.notes;
      notes.dispatchEvent?.(new Event("input", { bubbles: true }));
      undo = { before };
      announce(`Transcript added to your notes. It was written by a machine: read it and fix what it got wrong.${next.clipped || truncated ? " It was long, so the end was left out." : ""}`);
    } catch (error) {
      if (mine !== token) return;
      announce(error?.message || "Could not transcribe. Type your notes instead.");
    }
    step = "idle";
    render();
    (root.querySelector("[data-capture-transcribe-undo]") || root.querySelector("[data-capture-transcribe-start]"))?.focus();
  }

  return {
    element: root,
    /** Tell the box about the voice note (or its absence). A different note starts clean. */
    async update(next) {
      const changed = (next?.captureId || null) !== (note?.captureId || null) || next?.blob !== note?.blob;
      note = next;
      if (changed) {
        token += 1;
        step = "idle";
        undo = null;
      }
      render();
      if (note && !availability) {
        availability = await loadTranscribeAvailability(api);
        render();
      }
    },
  };
}
