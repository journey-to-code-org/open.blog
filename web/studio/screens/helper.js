// Writing helper (Studio R8, #/helper): "Is my helper on, and what does it know about me?" Her
// layer: whether it is on, and two notes (About you, About your blog) that save by themselves.
// Under For {helper}: Connection (company, model, the write-only key), What it can look for,
// Things it can read, and the status as the server gives it. Not in the navigation: reached from
// the account menu, Find, and the sheet in Write. Every server value is text.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { ask } from "../parts/dialogs.js";
import { companyName, helperState, reasonWords } from "../parts/helper-rules.js";
import { voiceGuideOf } from "../parts/helper-context-rules.js";
import { createNoteField } from "../parts/helper-notes.js";
import { createConnection } from "../parts/helper-connection.js";
import { createSkills } from "../parts/helper-skills.js";
import { createReads } from "../parts/helper-reads.js";

const DETAILS_KEY = "studio-helper-details";
const session = (() => { try { return globalThis.sessionStorage; } catch { return null; } })();

export async function createHelper(context, route = {}) {
  const { api, meta } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "cluster-layout", "select-field", "skeleton-block", "status-badge", "text-field", "modal-dialog");
  let status = null;
  let loadedDetails = false;

  const heading = h("h2", { id: "studio-helper-h", class: "studio-question", tabindex: "-1", text: say("hsetup.title") });
  const lede = h("p", { class: "studio-lede" });
  const badge = h("status-badge", { variant: "neutral" }, say("hsetup.badgeChecking"));
  const line = h("span", {});
  const setUp = h("action-button", { variant: "secondary", hidden: true, onClick: () => openDetails({ focus: true }) }, say("helper.setItUp"));
  const state = h("p", { class: "studio-helper-state studio-row", role: "status", "aria-live": "polite" }, badge, line);
  const warning = h("alert-banner", { variant: "warning", hidden: true });
  const sounds = h("p", { class: "studio-help", hidden: true, text: say("hnote.soundsLike") });
  const notes = [
    { type: "author", label: say("hnote.about"), field: createNoteField({ api, type: "author", label: say("hnote.about"), help: say("hnote.aboutHelp"), onSaved: () => reads.load() }) },
    { type: "site", label: say("hnote.site"), field: createNoteField({ api, type: "site", label: say("hnote.site"), help: say("hnote.siteHelp"), onSaved: () => reads.load() }) },
  ];

  const connection = createConnection({ api, onChanged: () => { loadStatus().catch(() => {}); context.refreshMeta?.(); } });
  const skills = createSkills({ api });
  const reads = createReads({ api, notes: () => notes, onChanged: () => loadNotes().catch(() => {}) });
  const raw = h("ul", { class: "studio-help studio-mono studio-helper-raw" });
  const reason = h("p", { class: "studio-help" });
  const details = h("details", { class: "studio-helper-setup" }, h("summary", { text: say("common.forHelper") }),
    reason, connection.element, skills.element, reads.element,
    h("section", { class: "studio-helper-section", "aria-labelledby": "studio-raw-h" }, h("h3", { id: "studio-raw-h", text: say("hsetup.raw") }), raw,
      h("p", { class: "studio-help", text: say("hsetup.engineGuide") }), h("p", { class: "studio-help", text: say("hsetup.twoAtOnce") })));
  details.addEventListener("toggle", () => {
    try { if (details.open) session?.setItem(DETAILS_KEY, "1"); else session?.removeItem(DETAILS_KEY); } catch { /* open for this visit only */ }
    if (details.open) loadDetails();
  });

  const element = h("section", { class: "studio-page studio-helper-page", "aria-labelledby": "studio-helper-h" },
    h("breadcrumb-trail", { items: [{ label: say("hsetup.home"), href: "#/" }, { label: say("hsetup.title"), href: "" }] }),
    heading, lede, state, h("div", {}, setUp), warning,
    h("section", { class: "studio-helper-notes", "aria-labelledby": "studio-helper-knows" }, h("h3", { id: "studio-helper-knows", text: say("hnote.knows") }),
      ...notes.map((note) => note.field.element), h("p", { class: "studio-help", text: say("hnote.goWith") }), sounds),
    details);

  function paint() {
    const s = helperState(status, { online: globalThis.navigator?.onLine !== false, loading: !status });
    const company = status ? companyName(status) : "";
    lede.textContent = s.state === "ready" && company ? say("hsetup.lede", { company }) : say("hsetup.ledeOff");
    badge.variant = s.state === "ready" ? "success" : s.state === "checking" ? "neutral" : "warning";
    badge.textContent = s.state === "ready" ? say("hsetup.badgeReady") : s.state === "checking" ? say("hsetup.badgeChecking") : say("hsetup.badgeOff");
    line.textContent = s.state === "ready" ? say("hsetup.on") : s.state === "off" ? say("hsetup.off") : s.state === "no-signal" ? say("hsetup.noSignal") : say("helper.checking");
    setUp.hidden = s.state !== "off";
    reason.textContent = s.state === "off" ? reasonWords(s.reason) : "";
    reason.hidden = s.state !== "off";
    const pairs = status ? [
      ["providerType", status.providerType], ["model", status.model], ["destination", status.destination], ["configured", status.configured], ["reason", status.reason],
      ["credential", status.credential?.state], ["capabilities", Object.entries(status.capabilities || {}).filter(([, on]) => on).map(([name]) => name).join(", ")], ["meta.quizGeneration", meta.quizGeneration],
    ] : [];
    fill(raw, ...pairs.map(([name, value]) => h("li", { text: `${name}: ${String(value ?? "—").slice(0, 160)}` })));
  }

  async function loadStatus() {
    try {
      status = await api.get("assistant/status");
    } catch (error) {
      if (error?.status === 401) throw error;
      status = status || null;
    }
    paint();
  }

  async function loadNotes() {
    await Promise.all(notes.map((note) => note.field.load().catch((error) => { if (error?.status === 401) throw error; })));
    try {
      const catalog = await api.get("assistant/context?content=none");
      sounds.hidden = !voiceGuideOf(catalog);
      const said = catalog?.privateSafety?.warning;
      warning.hidden = !said;
      // Her layer says what to do; the server's sentence (it may name a file) is for {helper}.
      if (said) fill(warning, h("span", { text: say("hnote.notPrivate") }), h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { text: String(said) })));
    } catch (error) {
      if (error?.status === 401) throw error;
    }
  }

  async function loadDetails() {
    if (loadedDetails) return;
    loadedDetails = true;
    await Promise.all([connection.load(), skills.load(), reads.load()]).catch(() => { loadedDetails = false; });
  }

  async function openDetails({ focus = false } = {}) {
    details.open = true;
    await loadDetails();
    if (focus) requestAnimationFrame(() => connection.focusCompany());
  }

  async function load() {
    paint();
    await Promise.all([loadStatus(), loadNotes()]);
    let open = route.query?.setup === "1";
    try { open ||= session?.getItem(DETAILS_KEY) === "1"; } catch { /* closed */ }
    if (open) await openDetails({ focus: route.query?.setup === "1" });
  }

  return {
    title: say("hsetup.title"),
    element,
    load,
    // A typed key counts as unsaved work, so reloading the page asks too.
    isDirty: () => connection.hasKeyTyped() || notes.some((note) => note.field.dirty()) || skills.dirty() || reads.dirty(),
    async leave() {
      // Notes save themselves: finish that first. A typed key is never kept, so leaving asks once;
      // the question never shows it.
      await Promise.all(notes.map((note) => note.field.flush()));
      if (connection.hasKeyTyped()) {
        const choice = await ask({
          heading: say("hsetup.leaveHeading"), text: say("hsetup.leaveText"),
          choices: [{ label: say("hsetup.leave"), value: "leave", variant: "secondary" }, { label: say("hsetup.stay"), value: "stay" }], focus: 1,
        });
        if (choice !== "leave") return false;
      }
      connection.clearKey();
      notes.forEach((note) => note.field.stop());
      return true;
    },
    focus: () => { if (route.query?.setup !== "1") heading.focus(); },
    palette: [{ id: "helper-setup", label: say("helper.findSetup"), group: "This screen" }],
    command: (id) => { if (id === "helper-setup") openDetails({ focus: true }); },
  };
}
