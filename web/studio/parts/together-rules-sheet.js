// Rules (Studio R14b, the reflection's ?sheet=rules): whose agreement counts and what each agreement
// covers, for whoever runs it; and, for {helper}, when parts are read, "never" included. A change
// asks once (it asks everyone to agree again), is sent against the revision read, and can be undone.
// What keeps the rule from being met is said in words, with who can fix it. Since #650 a change is
// a suggestion: it takes effect once everyone taking part agrees to it, so anyone in it can open
// this sheet to read the rule and agree to (or take back) a suggested one; only whoever runs it
// can suggest. A reflection that must be agreed as a whole doesn't offer "their own part".
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { createSheet } from "./sheet.js";
import { createDidLine } from "./did-line.js";
import { togetherProblem } from "./together-rules.js";
import { APPROVAL_REQUIREMENTS, APPROVAL_ROLE_CHOICES, approvalPeopleRows, approvalPolicyChoice, approvalPolicyPayload, approvalPolicyWords, approvalRuleText } from "./arrange-rules.js";
import { joinNames } from "./together-rules.js";

export async function createRulesSheet({ api, id, onChange }) {
  await use("action-button", "alert-banner", "choice-cards", "text-field");
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
    const can = !rule.published && rule.mayPropose !== false && Boolean(summary?.you?.runsIt);
    const whole = Boolean(rule.wholePieceRequired);
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
    const counted = APPROVAL_REQUIREMENTS.find((r) => r.value === choice.kind)?.counted
      ? h("text-field", { label: say("rules.howMany"), inputmode: "numeric", value: choice.count, onValuechange: (e) => { choice.count = String(e.detail ?? e.target?.value ?? ""); } })
      : null;
    const scope = whole
      ? h("p", { class: "studio-help", text: say("rules.wholeOnly") })
      : h("choice-cards", { label: say("rules.scope"), value: choice.scope, items: [
        { id: "ownSections", title: say("rules.ownParts"), detail: say("rules.ownPartsHelp") },
        { id: "wholePiece", title: say("rules.whole"), detail: say("rules.wholeHelp") },
      ], onValuechange: (e) => { choice.scope = e.detail || choice.scope; } });
    const unmet = approvalRuleText(rule);
    body.replaceChildren(
      unmet.length ? h("alert-banner", { variant: "warning" }, ...unmet.map((line) => h("p", { text: line }))) : null,
      proposalBanner(),
      kind, people, roles, counted, scope,
      can ? h("div", { class: "studio-sheet-footer" }, h("p", { class: "studio-help", text: say("rules.askChangeText") }), h("action-button", { onClick: () => save() }, say("rules.save")))
        : h("p", { class: "studio-help", text: rule.published ? say("rules.published") : say("rules.readOnly") }),
      helperDetails());
    if (!can) for (const node of [kind, scope, counted].filter(Boolean)) node.setAttribute("inert", "");
  }

  /** A suggested rule: what it is, who still has to agree, and her own yes (or taking it back). */
  function proposalBanner() {
    const proposal = rule.proposal;
    if (!proposal) return null;
    const asked = (proposal.awaiting || []).length + (proposal.consenting || []).length > 0;
    const button = !proposal.valid ? null : proposal.consentedByYou
      ? h("action-button", { variant: "secondary", onClick: () => takeBack(proposal) }, say("rules.takeBack"))
      : asked ? h("action-button", { onClick: () => agree(proposal) }, say("rules.agreeRule")) : null;
    return h("alert-banner", { variant: "info", heading: say("rules.proposalTitle") },
      h("p", { text: say("rules.proposalIs", { rule: approvalPolicyWords(proposal.policy) }) }),
      !proposal.valid ? h("p", { text: say("rules.proposalOld") })
        : (proposal.awaiting || []).length ? h("p", { text: say("rules.proposalWaiting", { names: joinNames(proposal.awaiting) }) }) : null,
      proposal.consentedByYou ? h("p", { text: say("rules.proposalYouAgreed") }) : null,
      button);
  }

  async function agree(proposal) {
    try {
      const answer = await api.post("collaboration/approval-policy/consent", { publicationId: id, proposalId: proposal.id, affirmed: true });
      did.tell(answer?.changed ? say("rules.ruleChanged") : say("rules.agreedRule"), answer?.changed ? {} : { undo: () => takeBack(proposal), undoLabel: say("part.undo") });
      await load();
      onChange?.();
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(error.status === 409 ? say("together.changedElsewhere", { what: say("rules.title") }) : togetherProblem(error).words, { variant: "problem" });
      await load();
    }
  }

  async function takeBack(proposal) {
    try {
      await api.post("collaboration/approval-policy/withdraw", { publicationId: id, proposalId: proposal.id });
      did.tell(say("rules.tookBack"));
      await load();
      onChange?.();
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(error.status === 409 ? say("together.changedElsewhere", { what: say("rules.title") }) : togetherProblem(error).words, { variant: "problem" });
      await load();
    }
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
    const payload = approvalPolicyPayload(choice, { wholePieceRequired: Boolean(rule?.wholePieceRequired) });
    if (payload.error) { did.tell(payload.error, { variant: "problem" }); return false; }
    if (!undo) {
      const answer = await ask({ heading: say("rules.askChange"), text: say("rules.askChangeText"),
        choices: [{ label: say("rules.askGo"), value: "go" }, { label: say("rules.askKeep"), value: "keep", variant: "secondary" }] });
      if (answer !== "go") return false;
    }
    const previous = undo ? null : JSON.parse(start);
    try {
      const answer = await api.put("collaboration/approval-policy", { publicationId: id, expectedRevision: rule.revision, expectedProposalId: rule.proposal?.id ?? null, policy: payload.policy, confirmed: true });
      // #650: a change is a suggestion until everyone taking part agrees; Undo suggests the old rule.
      did.tell(answer?.proposed ? say("rules.suggested") : say("rules.saved"), previous ? { undo: async () => { choice = previous; await save(true); }, undoLabel: say("part.undo") } : {});
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
