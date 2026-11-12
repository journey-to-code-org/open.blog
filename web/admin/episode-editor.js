import { el } from "./block-forms.js";
import { createTranscribeBox, plainNotes } from "./capture-assistant.js";
import { newCaptureId } from "./job-capture.js";

export function chapterFields(text) {
  const result = {};
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length > 10) throw new Error("Use at most ten chapters in this editor.");
  lines.forEach((line, index) => {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 2 || parts.length > 3 || !/^\d+$/.test(parts[0]) || !parts[1]) {
      throw new Error(`Chapter ${index + 1} needs seconds | title, optionally followed by | link.`);
    }
    const prefix = `audio.chapters.${index + 1}`;
    result[`${prefix}.timeSeconds`] = parts[0];
    result[`${prefix}.title`] = parts[1];
    if (parts[2]) result[`${prefix}.link`] = parts[2];
  });
  return result;
}

export function createEpisodeEditor({ api, fields, onApply, onTranscript }) {
  const status = el("p", { role: "status", "aria-live": "polite" });
  const file = el("input", { id: "oba-episode-file", type: "file", accept: "audio/*" });
  const notes = el("select", { id: "oba-episode-note" }, el("option", { value: "" }, "Choose a saved voice note"));
  const duration = el("input", { id: "oba-episode-duration", type: "number", min: "1", step: "1", value: fields["audio.durationSeconds"] || "" });
  const chapters = el("textarea", { id: "oba-episode-chapters", rows: 4 });
  const transcript = el("textarea", { id: "oba-episode-transcript", rows: 6, maxlength: "20000" });
  const chapterIndices = [...new Set(Object.keys(fields).map((key) => /^audio\.chapters\.(\d+)\./.exec(key)?.[1]).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
  chapters.value = chapterIndices.map((index) => [fields[`audio.chapters.${index}.timeSeconds`] || "", fields[`audio.chapters.${index}.title`] || "", fields[`audio.chapters.${index}.link`] || ""].filter((part, i) => i < 2 || part).join(" | ")).join("\n");
  let source = fields["audio.sources.1.url"] ? {
    url: fields["audio.sources.1.url"],
    type: fields["audio.sources.1.type"],
    sizeBytes: fields["audio.sources.1.sizeBytes"],
  } : null;
  const transcriber = createTranscribeBox({ api, notes: transcript, limits: { maxNotesChars: 20000 }, announce: (message) => { status.textContent = message; } });
  const label = (id, text, control) => el("div", { class: "oba-field" }, el("label", { for: id }, text), control);
  const loadNotes = async () => {
    try {
      const result = await api.call("GET", "episode-voice-notes");
      notes.replaceChildren(el("option", { value: "" }, "Choose a saved voice note"), ...result.notes.map((note) => el("option", { value: note.id }, `${note.id.slice(0, 12)} (${note.format}, ${note.bytes} bytes)`)));
      status.textContent = result.notes.length ? "Select a voice note." : "No saved voice notes found.";
      notes._episodeNotes = result.notes;
    } catch (error) {
      status.textContent = `Could not list voice notes: ${error.message}`;
    }
  };
  file.addEventListener("change", () => {
    notes.value = "";
    const selected = file.files?.[0];
    if (!selected) return void transcriber.update(null);
    if (selected.size > 8 * 1024 * 1024) {
      transcriber.update(null);
      status.textContent = "This file can be uploaded, but transcription accepts at most 8 MB.";
    } else {
      transcriber.update({ captureId: newCaptureId(), blob: selected, size: selected.size });
    }
  });
  notes.addEventListener("change", () => {
    file.value = "";
    const note = notes._episodeNotes?.find((item) => item.id === notes.value);
    transcriber.update(note ? { captureId: note.id, blob: null, size: note.bytes } : null);
  });
  const upload = el("button", { type: "button", class: "oba-btn", onClick: async () => {
    const selected = file.files?.[0];
    if (!selected && !notes.value) {
      status.textContent = "Choose a file or voice note first.";
      return;
    }
    upload.disabled = true;
    try {
      source = selected
        ? await api.call("POST", "episode-audio", { body: selected, headers: { "Content-Type": "application/octet-stream" } })
        : await api.call("POST", `episode-audio?capture=${encodeURIComponent(notes.value)}`, { body: new Uint8Array(), headers: { "Content-Type": "application/octet-stream" } });
      status.textContent = "Audio copied to the site's public static files. Apply episode details and save the post.";
    } catch (error) {
      status.textContent = `Audio was not added: ${error.message}`;
    } finally {
      upload.disabled = false;
    }
  } }, "Copy audio to the site");
  const apply = el("button", { type: "button", class: "oba-btn", onClick: () => {
    try {
      if (!source?.url || !source.type || !source.sizeBytes) throw new Error("Copy an audio file to the site first.");
      if (!/^[1-9]\d*$/.test(duration.value)) throw new Error("Enter the duration in whole seconds.");
      onApply({ source, duration: duration.value, chapters: chapterFields(chapters.value) });
      status.textContent = "Episode details applied. Save the post; publication requires a transcript.";
    } catch (error) {
      status.textContent = error.message;
    }
  } }, "Apply episode details");
  const insert = el("button", { type: "button", class: "oba-btn", onClick: () => {
    const text = plainNotes(transcript.value);
    if (!text) {
      status.textContent = "Write or transcribe the words first.";
      return;
    }
    const error = onTranscript(text);
    status.textContent = error || "Transcript added to the draft. Review it in the editor.";
  } }, "Add transcript to draft");
  const element = el("details", { class: "oba-field", "data-episode-editor": "true" },
    el("summary", {}, "Audio episode"),
    el("p", { class: "oba-help" }, "Copying audio puts it in public static files, even if this post is still a draft. Review the recording and transcript before publishing."),
    label("oba-episode-file", "Audio file (maximum 64 MB)", file),
    el("button", { type: "button", class: "oba-btn", onClick: loadNotes }, "Find saved voice notes"),
    label("oba-episode-note", "Saved voice note", notes),
    upload,
    label("oba-episode-duration", "Duration in seconds", duration),
    label("oba-episode-chapters", "Chapters: seconds | title | optional link, one per line", chapters),
    apply,
    label("oba-episode-transcript", "Transcript text", transcript),
    transcriber.element,
    insert,
    status,
  );
  return { element };
}
