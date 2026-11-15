// How readers reach you, the Readers area's third place: do comments work, the one switch, what else
// readers can send, the robot check, and clearing out old notes (always a check first, then one
// question). For the person who set the site up: the checklist and the connection, with the key
// write-only. Studio R10; docs/specs/studio/r10/ux.md.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { sayDay } from "../parts/dates.js";
import { sendOut, wentOutWords } from "../parts/publish.js";
import { say } from "../parts/words.js";
import { readerHeader } from "../parts/reader-tabs.js";
import { createConnection } from "../parts/reader-connection.js";
import { readerProblem, problemWords } from "../parts/reader-rules.js";
import {
  setupState, setupStateWords, robotLine, kindsList, setupChecklist, checkWords, retentionLines, retentionCount, retentionRequest, retentionDone,
} from "../parts/reader-setup-rules.js";

export async function createReaderSetup({ api, meta, go }) {
  await use("action-button", "alert-banner", "breadcrumb-trail", "cluster-layout", "select-field", "skeleton-block", "text-field", "toggle-switch", "modal-dialog");
  let settings = null;
  let health = null;
  let report = null;
  let problem = false;

  const { trail, tabs } = readerHeader({ tab: "setup", last: say("readers.tabSetup"), sent: Boolean(meta.engagementSetUp || meta.engagement), visitors: Boolean(meta.visitors) });
  const heading = h("h2", { id: "studio-setup-h", class: "studio-question", tabindex: "-1", text: say("readers.setupTitle") });
  const stateLine = h("p", { class: "studio-lede", role: "status", "aria-live": "polite" });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const switcher = h("toggle-switch", { label: say("readers.setupSwitch"), description: say("readers.setupSwitchHelp"), hidden: true, onCheckedchange: (e) => setComments(e.detail) });
  const trouble = h("p", { class: "studio-help", hidden: true }, say("readers.setupSwitchTrouble"), " ", h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, say("readers.tryAgain")));
  const commentsSection = h("section", { class: "studio-section", "aria-labelledby": "studio-setup-comments-h" },
    h("h3", { id: "studio-setup-comments-h", text: say("readers.setupCommentsHeading") }), switcher, trouble, h("p", { class: "studio-help", text: say("readers.setupPerPost") }));
  const elseList = h("ul", {});
  const elseSection = h("section", { class: "studio-section", hidden: true, "aria-labelledby": "studio-setup-else-h" },
    h("h3", { id: "studio-setup-else-h", text: say("readers.setupElseHeading") }), elseList, h("p", { class: "studio-help", text: say("common.canChange") }));
  const robotLineEl = h("p", {});
  const robotSection = h("section", { class: "studio-section", hidden: true, "aria-labelledby": "studio-setup-robots-h" }, h("h3", { id: "studio-setup-robots-h", text: say("readers.setupRobotsHeading") }), robotLineEl);
  const oldLast = h("p", { class: "studio-help" });
  const oldList = h("ul", { hidden: true });
  const oldAuditBox = h("label", { class: "studio-help", hidden: true }, h("input", { type: "checkbox", checked: true }), " ");
  const oldClear = h("action-button", { hidden: true, onClick: () => clearOut() }, say("readers.oldClear"));
  const oldCheck = h("action-button", { variant: "secondary", onClick: () => checkDue() }, say("readers.oldCheck"));
  const oldSection = h("section", { class: "studio-section", "aria-labelledby": "studio-setup-old-h" },
    h("h3", { id: "studio-setup-old-h", text: say("readers.setupOldHeading") }), h("p", { text: say("readers.setupOldText") }), oldLast, oldCheck, oldList, oldAuditBox, oldClear);
  const checklist = h("ul", { class: "studio-mono" });
  const connection = createConnection({
    api,
    onSaved: async (next, said) => {
      settings = next;
      draw();
      const out = await sendOut(api, "Comment settings");
      const sent = wentOutWords(out, { meta, action: "saved" }).words.replace(/^Saved\.\s*/, "");
      status.textContent = `${said} ${sent}`.trim();
      toast(status.textContent);
    },
    onConflict: async () => { await load(); status.textContent = say("readers.setupConflict"); },
    onFail: (error) => { status.textContent = problemWords(readerProblem(error, "card")); },
  });
  const details = h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }),
    h("section", {}, h("h3", { text: say("readers.detailsChecklist") }), checklist), connection.element);
  const element = h("section", { class: "studio-page", "aria-labelledby": "studio-setup-h" },
    trail, tabs, h("div", { class: "studio-today" }, heading, stateLine), status, commentsSection, elseSection, robotSection, oldSection, details);

  // ---- loading ------------------------------------------------------------------------------------

  async function load() {
    try {
      settings = await api.get("engagement/settings");
      problem = false;
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.status !== 404) problem = true;
      settings = null;
    }
    draw();
    if (settings) connection.paint(settings);
    loadHealth();
  }

  async function loadHealth() {
    try {
      health = await api.get("engagement/health");
    } catch (error) {
      if (error.status === 401) throw error;
      health = null;
    }
    drawChecklist();
  }

  function drawChecklist() {
    checklist.replaceChildren(...setupChecklist(settings, health, meta).map((row) => h("li", { text: `${row.mark} ${checkWords(row)}` })));
  }

  function draw() {
    stateLine.textContent = setupStateWords(setupState(settings, meta));
    trouble.hidden = !problem;
    switcher.hidden = problem || !settings || !settings.enabled || !settings.endpoint;
    if (settings) switcher.checked = settings.comments !== false;
    const kinds = kindsList(settings);
    elseSection.hidden = !kinds.length;
    elseList.replaceChildren(...kinds.map((k) => h("li", { text: k })));
    const robots = robotLine(settings);
    robotSection.hidden = !robots;
    robotLineEl.textContent = robots;
    oldLast.textContent = report?.lastRunAt ? say("readers.setupOldLast", { day: sayDay(report.lastRunAt) }) : say("readers.setupOldNever");
    drawChecklist();
  }

  // ---- the switch ---------------------------------------------------------------------------------

  let saving = false;
  async function setComments(on) {
    if (saving) { requestAnimationFrame(() => { switcher.checked = !on; }); return; }
    if (!settings || on === (settings.comments !== false)) return;
    if (!on) {
      const choice = await ask({
        heading: say("readers.setupOffTitle"), text: say("readers.setupOffText"),
        choices: [{ label: say("readers.setupKeepOn"), value: "keep" }, { label: say("readers.setupTurnOff"), value: "off", variant: "secondary" }],
      });
      if (choice !== "off") { switcher.checked = true; return; }
    }
    saving = true;
    try {
      const reply = await api.put("engagement/settings", { ...settingsBody(on), });
      settings = { ...settings, ...reply };
      draw();
      const out = await sendOut(api, on ? "Turn comments on" : "Turn comments off");
      const sent = wentOutWords(out, { meta, action: "saved" }).words.replace(/^Saved\.\s*/, "");
      status.textContent = `${on ? say("readers.setupIsOn") : say("readers.setupIsOff")} ${sent}`.trim();
      toast(status.textContent, { variant: wentOutWords(out, { meta, action: "saved" }).variant });
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.status === 409) {
        await load();
        status.textContent = say("readers.setupConflict");
      } else {
        switcher.checked = settings.comments !== false;
        status.textContent = say("readers.setupNotSaved");
      }
    } finally {
      saving = false;
    }
  }

  const settingsBody = (on) => ({
    enabled: settings.enabled, comments: on, analytics: settings.analytics, endpoint: settings.endpoint, etag: settings.etag, credentialAction: "keep",
    ...(typeof settings.feedback === "boolean" ? { feedback: settings.feedback } : {}),
    ...(settings.captcha ? { captcha: { provider: settings.captcha.provider || "", scope: settings.captcha.scope || "", siteKey: settings.captcha.siteKey || "" } } : {}),
  });

  // ---- old notes: a check first, then one question, then exactly what was checked ------------------

  async function checkDue() {
    oldCheck.loading = true;
    try {
      report = await api.get("engagement/retention");
      oldList.replaceChildren(...retentionLines(report).map((t) => h("li", { text: t })));
      oldList.hidden = false;
      const count = retentionCount(report);
      oldClear.hidden = count === 0;
      oldAuditBox.hidden = !Object.values(report.audit || {}).some((n) => n > 0);
      oldAuditBox.lastChild.textContent = say("readers.oldRecords", { n: Object.values(report.audit || {}).reduce((a, b) => a + (Number(b) || 0), 0), days: report.periods?.auditDays ?? "" });
      status.textContent = retentionLines(report)[0];
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = error.status === 403 || error.status === 404 ? say("readers.oldNotHere") : problemWords(readerProblem(error, "card"));
    } finally {
      oldCheck.loading = false;
    }
  }

  async function clearOut() {
    if (!report) return;
    const count = retentionCount(report);
    const choice = await ask({
      heading: say("readers.oldAskTitle", { n: count }), text: say("readers.oldAskText"),
      choices: [{ label: say("readers.oldKeep"), value: "keep", variant: "secondary" }, { label: say("readers.oldClear"), value: "clear", variant: "destructive" }],
    });
    if (choice !== "clear") return;
    oldClear.loading = true;
    try {
      const audit = oldAuditBox.querySelector("input")?.checked !== false;
      const result = await api.post("engagement/retention", retentionRequest(report, audit));
      status.textContent = retentionDone(result);
      toast(status.textContent);
      report = null;
      oldList.hidden = true;
      oldClear.hidden = true;
      oldAuditBox.hidden = true;
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = error.status === 409 || error.status === 422 ? say("readers.oldChanged") : say("readers.oldFailed");
      if (error.status === 409 || error.status === 422) await checkDue();
    } finally {
      oldClear.loading = false;
    }
  }

  return {
    title: say("readers.tabSetup"),
    element,
    load,
    reload: load,
    focus: () => heading.focus(),
    isDirty: () => connection.hasKeyTyped(),
    async leave() {
      if (connection.hasKeyTyped()) {
        const choice = await ask({
          heading: say("readers.leaveHeading"), text: say("readers.leaveText"),
          choices: [{ label: say("readers.leave"), value: "leave", variant: "secondary" }, { label: say("readers.stay"), value: "stay" }], focus: 1,
        });
        if (choice !== "leave") return false;
      }
      connection.clearKey();
      return true;
    },
    get palette() {
      return [{ id: "old", label: say("readers.oldCheck"), group: say("readers.findGroup") }, ...(settings ? [{ id: "switch", label: settings.comments === false ? say("readers.findSwitchOn") : say("readers.findSwitchOff"), group: say("readers.findGroup") }] : [])];
    },
    command(id) {
      if (id === "old") checkDue();
      else if (id === "switch" && settings) setComments(settings.comments === false);
    },
    go,
  };
}
