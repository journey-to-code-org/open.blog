// Rules (Studio R14b, the reflection's ?sheet=rules): whose agreement counts and what each agreement
// covers, for whoever runs it; and, for {helper}, when parts are read, "never" included. A change
// asks once (it asks everyone to agree again), is sent against the revision read, and can be undone.
// What keeps the rule from being met is said in words, with who can fix it.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { createSheet } from "./sheet.js";
import { createDidLine } from "./did-line.js";
import { togetherProblem } from "./together-rules.js";
import { APPROVAL_REQUIREMENTS, APPROVAL_ROLE_CHOICES, approvalPeopleRows, approvalPolicyChoice, approvalPolicyPayload, approvalRuleText } from "./arrange-rules.js";

export async function createRulesSheet({ api, id, onChange }) {
  await use("action-button", "alert-banner", "choice-cards");
  const sheet = await createSheet({ label: say("rules.title"), wide: false });
  const did = createDidLine();
  const body = h("div", { class: "studio-together-shape" });
  let rule = null;
  let choice = null;
  let start = "";
  let summary = null;
  const dirty = () => Boolean(choice) && JSON.stringify(choice) !== start;

  async function open(next, opener) {
    summary = next;
    const title = summary.title || summary.guidingQuestion || say("together.untitled");
    sheet.show({ heading: say("rules.sheetTitle", { title }), opener, dirty, save: () => save(),
      question: { heading: say("together.leaveAsk"), text: say("rules.askChangeText"), save: say("rules.save"), leave: say("together.leaveGo") },
      children: [did.element, body], focus: () => body.querySelector("button, input")?.focus() });
    await load();
  }

  async function load(keep = false) {
    try {
      rule = await api.get(`collaboration/approval-policy?publicationId=${encodeURIComponent(id)}`);
    } catch (error) {
      if (error.status === 401) throw error;
      body.replaceChildren(h("p", { class: "studio-help", text: error.status === 404 ? say("rules.readOnly") : togetherProblem(error).words }));
      return;
    }
    if (!keep || !choice) choice = approvalPolicyChoice(rule.policy);
    if (!keep) start = JSON.stringify(choice);
    draw();
  }

  function box(label, checked, onChange, disabled = false) {
    const input = h("input", { type: "checkbox", checked, disabled, onChange: (e) => onChange(e.target.checked) });
    return h("label", { class: "studio-tick-label studio-row" }, input, h("span", { text: label }));
  }

  function draw() {
    const can = !rule.published;
    const kind = h("choice-cards", { label: say("rules.whoseAgreement"), value: choice.kind, items: APPROVAL_REQUIREMENTS.map((r) => ({ id: r.value, title: r.words(), detail: r.help() })),
      onValuechange: (e) => { choice.kind = e.detail || choice.kind; draw(); } });
    const people = choice.kind === "namedAuthors" ? h("fieldset", { class: "studio-together-ticks" }, h("legend", { text: say("rules.choosePeople") }),
      ...approvalPeopleRows(rule).map((row) => box(row.displayName, choice.named.includes(row.participantId), (on) => {
        choice.named = on ? [...choice.named, row.participantId] : choice.named.filter((x) => x !== row.participantId);
      }))) : null;
    const roles = choice.kind === "authorsWithRoles" ? h("fieldset", { class: "studio-together-ticks" }, h("legend", { text: say("rules.chooseRoles") }),
      ...APPROVAL_ROLE_CHOICES.map((role) => box(role.words(), choice.roles.includes(role.value), (on) => {
        choice.roles = on ? [...choice.roles, role.value] : choice.roles.filter((x) => x !== role.value);
      }))) : null;
    const scope = h("choice-cards", { label: say("rules.scope"), value: choice.scope, items: [
      { id: "ownSections", title: say("rules.ownParts"), detail: say("rules.ownPartsHelp") },
      { id: "wholePiece", title: say("rules.whole"), detail: say("rules.wholeHelp") },
    ], onValuechange: (e) => { choice.scope = e.detail || choice.scope; } });
    const unmet = approvalRuleText(rule);
    body.replaceChildren(
      unmet.length ? h("alert-banner", { variant: "warning" }, ...unmet.map((line) => h("p", { text: line }))) : null,
      kind, people, roles, scope,
      can ? h("div", { class: "studio-sheet-footer" }, h("p", { class: "studio-help", text: say("rules.askChangeText") }), h("action-button", { onClick: () => save() }, say("rules.save")))
        : h("p", { class: "studio-help", text: say("rules.published") }),
      helperDetails());
    if (!can) for (const node of [kind, scope]) node.setAttribute("inert", "");
  }

  /** For {helper}: the rule as stored, and "never" as a sharing choice, which her layer doesn't offer. */
  function helperDetails() {
    const never = summary?.you?.runsIt && summary?.policy !== "independent" ? h("action-button", { variant: "secondary", onClick: () => setNever() }, say("rules.never")) : null;
    return h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }),
      h("p", { class: "studio-mono", text: say("rules.details", { rule: JSON.stringify(rule.policy) }) }),
      h("p", { text: say("rules.sharingTitle") }), h("p", { text: say("rules.neverHelp") }), never);
  }

  async function setNever() {
    try {
      await api.put("collaboration/reveal/policy", { publicationId: id, policy: "independent", expectedPolicy: summary.policy, confirmed: true });
      did.tell(say("together.ruleChanged"));
      onChange?.();
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(togetherProblem(error).words, { variant: "problem" });
    }
  }

  async function save(undo = null) {
    const payload = approvalPolicyPayload(choice);
    if (payload.error) { did.tell(payload.error, { variant: "problem" }); return false; }
    if (!undo) {
      const answer = await ask({ heading: say("rules.askChange"), text: say("rules.askChangeText"),
        choices: [{ label: say("rules.askGo"), value: "go" }, { label: say("rules.askKeep"), value: "keep", variant: "secondary" }] });
      if (answer !== "go") return false;
    }
    const previous = undo ? null : JSON.parse(start);
    try {
      await api.put("collaboration/approval-policy", { publicationId: id, expectedRevision: rule.revision, policy: payload.policy, confirmed: true });
      did.tell(say("rules.saved"), previous ? { undo: async () => { choice = previous; await save(true); }, undoLabel: say("part.undo") } : {});
      await load();
      onChange?.();
      return true;
    } catch (error) {
      if (error.status === 401) throw error;
      const said = togetherProblem(error);
      if (said.code === "changed") { did.tell(say("together.changedElsewhere", { what: say("rules.title") }), { variant: "problem" }); await load(true); }
      else did.tell(error.status === 403 && error.data?.field === "policy" ? say("rules.ownerOnlyDrop") : said.words, { variant: "problem" });
      return false;
    }
  }

  return { sheet, open };
}
