// Requests' two sheets (R1): download a spreadsheet of chosen days, and clean up archived requests
// (erase them by themselves after so many days, or the old ones now, always counted first and asked
// once). Customers' details only ever leave as the downloaded file. docs/specs/studio/r1/ux.md.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { ask } from "./dialogs.js";
import { exportDayProblem, exportWords, retentionWords, retentionDaysProblem, eraseOldQuestion, erasedOldWords, quoteTrouble } from "./quote-words.js";

const DEFAULT_DAYS = 30;

/** Hand the browser a file built here, never a link to the server. */
function saveFile(text, name) {
  const blob = new Blob([text], { type: "text/csv" });
  const link = h("a", { href: URL.createObjectURL(blob), download: name || "quote-requests.csv", hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export async function openDownload({ sheet, api, opener, say }) {
  await use("action-button", "date-field");
  const from = h("date-field", { label: "From" });
  const to = h("date-field", { label: "To" });
  const problem = h("p", { class: "studio-comment-trouble", id: "studio-export-to-problem", role: "alert", hidden: true });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const button = h("action-button", { onClick: () => download() }, "Download");
  to.addEventListener("valuechange", () => { problem.hidden = true; });

  async function download() {
    if (button.loading) return;
    const wrong = exportDayProblem(from.value, to.value);
    problem.textContent = wrong;
    problem.hidden = !wrong;
    if (wrong) { to.querySelector("input")?.focus(); return; }
    button.loading = true;
    try {
      const query = new URLSearchParams(Object.entries({ from: from.value, to: to.value }).filter(([, v]) => v)).toString();
      const file = await api.get(`quote/export${query ? `?${query}` : ""}`);
      const words = exportWords(file.count, from.value, to.value);
      if (file.count) saveFile(file.csv, file.filename);
      status.textContent = words;
      say(words);
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = quoteTrouble(error);
    } finally {
      button.loading = false;
    }
  }

  sheet.show({
    heading: "Download a spreadsheet",
    opener,
    children: [
      h("fieldset", { class: "studio-when" }, h("legend", { text: "Which days?" }), from, to, problem),
      h("p", { class: "studio-help", text: "Leave both empty for every request." }),
      h("p", { class: "studio-help", text: "It has customers' phone numbers, so keep it somewhere private." }),
      status,
      h("div", { class: "studio-sheet-actions" }, button, h("action-button", { variant: "secondary", onClick: () => sheet.close() }, "Done")),
    ],
    focus: () => from.querySelector("input")?.focus(),
  });
}

/**
 * `reply` is the requests reply (retentionDays, retentionSource); `onChanged(saved)` gets the new
 * setting, or nothing after old requests were erased (the list reloads).
 */
export async function openCleanup({ sheet, api, opener, reply, say, onChanged }) {
  await use("action-button", "text-field", "toggle-switch");
  let saved = { days: reply?.retentionDays ?? null, source: reply?.retentionSource ?? null };
  const host = saved.days && saved.source !== "admin";
  const state = { on: Boolean(saved.days), days: String(saved.days || DEFAULT_DAYS) };
  const baseline = () => ({ on: Boolean(saved.days), days: String(saved.days || DEFAULT_DAYS) });
  const dirty = () => !host && (state.on !== baseline().on || (state.on && state.days.trim() !== baseline().days));
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const details = h("details", { class: "studio-help" });
  let dryRun = null;

  const days = h("text-field", { label: "After how many days", inputmode: "numeric", value: state.days, description: "Counted from the day you archive one.",
    onValuechange: (e) => { state.days = e.detail; days.error = ""; } });
  const toggle = h("toggle-switch", { label: "Erase archived requests by themselves", checked: state.on,
    onCheckedchange: (e) => { state.on = e.detail; days.hidden = !state.on; } });
  days.hidden = !state.on;
  const save = h("action-button", { onClick: () => saveIt() }, "Save");
  const eraseNow = h("action-button", { variant: "secondary", hidden: !saved.days, onClick: () => eraseOld() }, "Erase the old ones now");

  async function saveIt() {
    if (save.loading) return false;
    let value = null;
    if (state.on) {
      const wrong = retentionDaysProblem(state.days);
      if (wrong) { days.error = wrong; days.querySelector("input")?.focus(); return false; }
      value = Number(state.days.trim());
    }
    save.loading = true;
    try {
      const done = await api.post("quote/retention", { days: value });
      saved = { days: done.retentionDays ?? null, source: done.retentionSource ?? null };
      const words = `Saved. ${retentionWords(saved.days, saved.source)}`;
      status.textContent = words;
      say(words);
      eraseNow.hidden = !saved.days;
      drawDetails();
      onChanged?.(saved);
      return true;
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = error.data?.code === "retention-set-by-host" ? "The person who set up your site chose this, so it can't be changed here." : quoteTrouble(error);
      drawDetails(error);
      return false;
    } finally {
      save.loading = false;
    }
  }

  async function eraseOld() {
    if (eraseNow.loading) return;
    eraseNow.loading = true;
    try {
      dryRun = await api.post("quote/retention/run", { dryRun: true });
      drawDetails();
      if (!dryRun.wouldErase) { status.textContent = "Nothing is old enough to erase yet."; return; }
      const question = eraseOldQuestion(dryRun, saved.days);
      const choice = await ask({ ...question, choices: [{ label: "Keep them", value: "keep" }, { label: "Erase for good", value: "erase", variant: "destructive" }] });
      if (choice !== "erase") { status.textContent = "Nothing was erased."; return; }
      const done = await api.post("quote/retention/run", {});
      const words = erasedOldWords(done);
      status.textContent = words;
      say(words);
      onChanged?.();
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = quoteTrouble(error);
      drawDetails(error);
    } finally {
      eraseNow.loading = false;
    }
  }

  function drawDetails(error = null) {
    details.replaceChildren(h("summary", { text: "For the person who set up your site" }),
      h("ul", { class: "studio-mono" }, ...[
        `retentionDays ${saved.days ?? "none"}, retentionSource ${saved.source || "none"}`,
        dryRun ? `dry run ${JSON.stringify(dryRun)}` : null,
        error ? `error ${error.status}${error.data?.code ? ` (${error.data.code})` : ""}: ${error.message}` : null,
      ].filter(Boolean).map((t) => h("li", { text: t }))));
  }
  drawDetails();

  sheet.show({
    heading: "Clean up archived requests",
    opener,
    children: host
      ? [h("p", { text: retentionWords(saved.days, "host") }), status, h("div", { class: "studio-sheet-actions" }, eraseNow), details]
      : [toggle, days, h("div", { class: "studio-sheet-actions" }, save), h("p", { class: "studio-help", text: "Your site does this once a day." }), eraseNow, status, details],
    dirty,
    save: saveIt,
    question: { heading: "Save this?", text: "You changed how archived requests are erased and didn't save it.", save: "Save", leave: "Leave without saving" },
    focus: () => (host ? eraseNow : toggle).querySelector?.("button, input")?.focus(),
  });
}
