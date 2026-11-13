// Sharing's row sheets (R1): change a waiting share's words or time, check one that went out with
// no clear answer, and see what happened to a share. Each talks only to Admin's own social routes;
// her words and the account names are only ever text. docs/specs/studio/r1/ux.md.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { sayWhen, splitInstant } from "./dates.js";
import { localToInstant, eventText, REFRESH_CODES } from "./announcements-rules.js";
import { accountLabel, captionWords, checkQuestion, shareTrouble, historyLines, triedWords } from "./share-words.js";
import { createSharePreview } from "./share-preview.js";

/** What a refused change says, and whether the list must be read again. */
function refusal(error) {
  const code = error?.data?.code || "";
  if (code === "not-editable") return { refresh: true, close: true, words: "It started going out, so it can't be changed now." };
  if (REFRESH_CODES.includes(code)) return { refresh: true, close: true, words: "Something changed while you looked. Here's the list now." };
  return { refresh: false, close: false, words: shareTrouble(error) };
}

/**
 * Change this share. `onDone(words, id)` after a save; `onRefresh(words)` when the list must be
 * read again (it moved on while she looked).
 */
export async function openChange({ sheet, api, item, title, zone, opener, onDone, onRefresh }) {
  await use("action-button", "date-field", "text-field");
  const provider = item.destination?.provider;
  const start = splitInstant(item.scheduledFor, zone);
  const form = { caption: item.caption || "", date: start.date, time: start.time || "09:00" };
  const changed = () => ({ caption: form.caption !== (item.caption || ""), when: form.date !== start.date || form.time !== (start.time || "09:00") });
  const dirty = () => changed().caption || changed().when;
  const countId = `studio-change-count-${item.id}`;
  const count = h("p", { class: "studio-help", id: countId, "aria-live": "polite" });
  const caption = h("text-field", { label: "What to say", rows: 5, value: form.caption, onValuechange: (e) => { form.caption = e.detail; caption.error = ""; refresh(); } });
  caption.setAttribute("aria-describedby", countId);
  const day = h("date-field", { label: "Day", value: form.date, onValuechange: (e) => { form.date = e.detail; time.error = ""; refresh(); } });
  const time = h("text-field", { label: "Time", type: "time", value: form.time, onValuechange: (e) => { form.time = e.detail; time.error = ""; refresh(); } });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const save = h("action-button", { disabled: true, onClick: () => saveIt() }, "Save changes");
  const instant = () => localToInstant(`${form.date}T${form.time}`, zone);
  const preview = createSharePreview({
    api,
    read: () => ({ providers: [provider], caption: form.caption, work: item.work, scheduledFor: instant().ok ? instant().iso : undefined, timeZone: zone }),
    onProblems: (by) => {
      caption.error = by.caption ? `${captionWords(form.caption, [provider]).text}. Shorten it a little.` : caption.error;
      if (by.time && changed().when) time.error = "Pick a time from now on.";
    },
  });

  function refresh() {
    const words = captionWords(form.caption, [provider]);
    count.textContent = words.text;
    count.classList.toggle("studio-comment-trouble", words.over);
    save.disabled = !dirty();
    preview.schedule();
  }

  async function saveIt() {
    if (save.loading) return false;
    const now = changed();
    if (!now.caption && !now.when) return true;
    const body = { version: item.version, timeZone: zone };
    if (now.caption) {
      const words = captionWords(form.caption, [provider]);
      if (!form.caption.trim()) { caption.error = "Write something to go with the link."; caption.querySelector("textarea")?.focus(); return false; }
      if (words.over) { caption.error = `${words.text}. Shorten it a little.`; caption.querySelector("textarea")?.focus(); return false; }
      body.caption = form.caption;
    }
    let at = item.scheduledFor;
    if (now.when) {
      const converted = instant();
      if (!converted.ok || Date.parse(converted.iso) <= Date.now()) { time.error = "Pick a time from now on."; time.querySelector("input")?.focus(); return false; }
      body.scheduledFor = converted.iso;
      at = converted.iso;
    }
    save.loading = true;
    try {
      const reply = await api.patch(`social/announcements?id=${encodeURIComponent(item.id)}`, body);
      preview.stop();
      sheet.close();
      onDone(`Changed. It goes out ${sayWhen(reply?.announcement?.scheduledFor || at)}.`, item.id);
      return true;
    } catch (error) {
      if (error.status === 401) throw error;
      const code = error.data?.code || "";
      if (/^caption-/.test(code)) { caption.error = "This doesn't fit there. Shorten it a little."; caption.querySelector("textarea")?.focus(); return false; }
      if (/^time-/.test(code)) { time.error = "Pick a time from now on."; time.querySelector("input")?.focus(); return false; }
      const said = refusal(error);
      if (said.close) { preview.stop(); sheet.close(); onRefresh(said.words); return true; }
      status.textContent = said.words;
      return false;
    } finally {
      save.loading = false;
    }
  }

  refresh();
  sheet.show({
    heading: title,
    opener,
    children: [
      h("p", { class: "studio-help", text: `To ${accountLabel(item.destination)}` }),
      caption, count,
      h("div", { class: "studio-business-times" }, day, time),
      preview.element,
      status,
      h("div", { class: "studio-sheet-actions" }, save, h("action-button", { variant: "secondary", onClick: () => sheet.cancel() }, "Cancel")),
    ],
    dirty,
    save: saveIt,
    question: { heading: "Save your changes?", text: "You changed this share and didn't save it.", save: "Save changes", leave: "Leave without saving" },
    focus: () => caption.querySelector("textarea")?.focus(),
    onClose: () => preview.stop(),
  });
}

/** Check it: she looks at the account and says whether it's there (G7: no post id needed). */
export async function openCheck({ sheet, api, item, title, opener, onDone, onRefresh }) {
  await use("action-button", "segmented-control", "text-field");
  let outcome = "";
  let postId = "";
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const save = h("action-button", { disabled: true, onClick: () => saveIt() }, "Save");
  const choice = h("segmented-control", { label: "Is it there?", value: "", options: [{ value: "published", label: "It's there" }, { value: "not-posted", label: "It isn't there" }],
    onValuechange: (e) => { outcome = e.detail; save.disabled = !outcome; } });
  const id = h("text-field", { label: "The post's id", description: "Only if you have it, from the post's address.", onValuechange: (e) => { postId = e.detail.trim(); id.error = ""; } });

  async function saveIt() {
    if (save.loading || !outcome) return false;
    const body = { version: item.version, outcome };
    if (outcome === "published" && postId) body.providerPostId = postId;
    save.loading = true;
    try {
      await api.post(`social/announcements/resolve?id=${encodeURIComponent(item.id)}`, body);
      sheet.close();
      onDone(outcome === "published" ? "Marked as shared." : "Marked as not shared. You can try again.", item.id);
      return true;
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.data?.code === "invalid-provider-post-id") { id.error = "That isn't a post id. Leave it empty if you don't have it."; id.closest("details").open = true; id.querySelector("input")?.focus(); return false; }
      const said = refusal(error);
      if (said.close) { sheet.close(); onRefresh(said.words); return true; }
      status.textContent = said.words;
      return false;
    } finally {
      save.loading = false;
    }
  }

  sheet.show({
    heading: title,
    opener,
    children: [
      h("p", { text: checkQuestion(item.destination) }),
      choice, status,
      h("div", { class: "studio-sheet-actions" }, save, h("action-button", { variant: "secondary", onClick: () => sheet.cancel() }, "Cancel")),
      h("details", { class: "studio-help" }, h("summary", { text: "For the person who set up the site" }), id),
    ],
    dirty: () => Boolean(outcome || postId),
    save: saveIt,
    question: { heading: "Save this?", text: "You said whether it's there and didn't save it.", save: "Save", leave: "Leave without saving" },
    focus: () => choice.querySelector("button, input")?.focus(),
  });
}

/** What happened to this share: one line each, newest last, from the attempts route. */
export async function openHistory({ sheet, api, item, title, zone, opener }) {
  await use("skeleton-block");
  const body = h("div", { "aria-busy": "true" }, h("skeleton-block", { lines: 3 }));
  const details = h("details", { class: "studio-help" }, h("summary", { text: "For the person who set up your site" }));
  sheet.show({ heading: "What happened to this share", opener, children: [h("p", { class: "studio-help", text: `${title}, to ${accountLabel(item.destination)}` }), body, details] });
  try {
    const reply = await api.get(`social/announcements/attempts?id=${encodeURIComponent(item.id)}`);
    const lines = historyLines(reply.timeline, { provider: item.destination?.provider, timeZone: zone });
    body.removeAttribute("aria-busy");
    body.replaceChildren(
      ...(reply.timelineExact === false ? [h("p", { class: "studio-help", text: "The history isn't kept on this site." })] : []),
      lines.length ? h("ol", { class: "studio-history" }, ...lines.map((line) => h("li", { text: line }))) : h("p", { text: "Nothing has happened to it yet." }),
      triedWords(reply.attempts) ? h("p", { text: triedWords(reply.attempts) }) : null);
    details.append(h("ul", { class: "studio-mono" }, ...[
      ...(reply.timeline || []).map((event) => eventText(event, zone)),
      ...(reply.attempts || []).map((a) => `try ${a.attemptNo} ${a.outcome || "?"}${a.httpStatus ? ` HTTP ${a.httpStatus}` : ""}${a.errorCode ? ` ${a.errorCode}` : ""}${a.errorDetail ? `: ${a.errorDetail}` : ""}`),
    ].map((t) => h("li", { text: t }))));
  } catch (error) {
    if (error.status === 401) throw error;
    body.removeAttribute("aria-busy");
    body.replaceChildren(h("p", { text: shareTrouble(error) }));
    details.append(h("p", { class: "studio-mono", text: `error ${error.status}${error.data?.code ? ` (${error.data.code})` : ""}: ${error.message}` }));
  }
}
