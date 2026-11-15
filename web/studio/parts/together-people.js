// People in a reflection (Studio R14a, the People sheet): who is in it and what each does (change it,
// or stop their access, each asking once when it takes something away), the invitations (Withdraw,
// Make a new link), and Invite someone: their name from People, a new sign-in or one they already
// have, and what they do. The link is shown once, with Copy the link and, on a phone, Send it…;
// nothing is emailed. Co-writers who help run it see the list and the invitations; inviting is an
// owner account's (the server holds the line, G110/G112).
import { h, toast } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { createSheet } from "./sheet.js";
import { createDidLine } from "./did-line.js";
import { sayDay } from "./dates.js";
import {
  ROLE_CHOICES, canInvite, invitationPayload, invitationShareLink, invitationStatusText, memberWarnings, removalImpact,
  roleChangeImpact, roleChoice, roleWords, suggestSignInName, togetherProblem, validateInvitationDraft,
} from "./together-rules.js";

export async function createPeopleSheet({ api, context, id, onChange }) {
  await use("action-button", "alert-banner", "choice-cards", "dropdown-menu", "select-field", "text-field");
  const sheet = await createSheet({ label: say("together.peopleButton"), wide: false });
  const coWriter = context.meta?.account === "co-writer";
  let summary = null;
  let members = { revision: 0, members: [] };
  let invitations = [];
  let contributors = {};
  let typed = false;
  const did = createDidLine();
  const membersHost = h("ul", { class: "studio-together-people" });
  const invitesHost = h("div", { class: "studio-together-invites" });
  const inviteHost = h("div", { class: "studio-together-invite" });
  const linkHost = h("div", { "aria-live": "polite" });

  async function open(next, opener) {
    summary = next;
    typed = false;
    const title = summary.title || summary.guidingQuestion || say("together.untitled");
    sheet.show({
      heading: say("people.sheetTitle", { title }),
      opener,
      dirty: () => typed,
      question: { heading: say("together.leaveAsk"), text: say("together.leaveText"), save: say("together.leaveStay"), leave: say("together.leaveGo") },
      save: () => false,
      children: [did.element, membersHost, h("h3", { class: "studio-together-h3", text: say("people.invitations") }), invitesHost, linkHost,
        h("h3", { class: "studio-together-h3", text: say("people.inviteSomeone") }), inviteHost,
        h("div", { class: "studio-sheet-footer" }, h("action-button", { variant: "secondary", onClick: () => sheet.cancel() }, say("people.close")))],
      focus: () => sheet.element.querySelector("button, a")?.focus(),
    });
    await load();
  }

  async function load() {
    try {
      const [m, i] = await Promise.all([
        api.get(`collaboration/members?publicationId=${encodeURIComponent(id)}`),
        api.get(`collaboration/invitations?publicationId=${encodeURIComponent(id)}`),
      ]);
      members = m || members;
      invitations = i?.invitations || [];
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(togetherProblem(error).words, { variant: "problem" });
      return;
    }
    if (!coWriter && !Object.keys(contributors).length) {
      try { contributors = (await api.get("contributors"))?.contributors || {}; } catch (error) { if (error.status === 401) throw error; }
    }
    drawMembers();
    drawInvitations();
    drawInvite();
  }

  const nameOf = (key) => contributors[key]?.name || "";

  function drawMembers() {
    membersHost.replaceChildren(...(members.members || []).map((member) => {
      const name = member.isYou ? say("together.you") : member.displayName;
      const warnings = memberWarnings(member);
      const choices = ROLE_CHOICES.filter((c) => !c.ownerOnly || (summary.roles || []).includes("siteOwner"));
      const items = member.canChangeRoles && !member.isYou ? [
        ...choices.filter((c) => !roleChoice(member.roles)?.value || c.value !== roleChoice(member.roles).value).map((c) => ({ value: `role:${c.value}`, label: c.words() })),
        ...(member.canRemove ? [{ value: "remove", label: say("people.stopAccess") }] : []),
      ] : [];
      const menu = items.length ? h("dropdown-menu", { class: "studio-row-menu", items, onItemselect: (e) => choose(member, e.detail, menu) },
        h("span", { slot: "label" }, say("together.doChange"), h("span", { class: "studio-visually-hidden", text: ` ${say("people.changeLabel", { name: member.displayName })}` }))) : null;
      return h("li", { class: "studio-together-person studio-row" },
        h("bdi", { class: "studio-stranger", text: name }), h("span", { class: "studio-help", text: roleWords(member.roles) }), menu,
        ...warnings.map((w) => h("p", { class: "studio-help", text: w })));
    }));
  }

  async function choose(member, value, opener) {
    if (value === "remove") return stop(member, opener);
    const choice = ROLE_CHOICES.find((c) => `role:${c.value}` === value);
    if (choice) return changeRoles(member, [...choice.roles]);
    return null;
  }

  async function changeRoles(member, roles, undoing = false) {
    const impact = undoing ? [] : roleChangeImpact(member, roles);
    if (impact.length) {
      const choice = await ask({ heading: say("people.changeAsk", { name: member.displayName }), text: impact,
        choices: [{ label: say("people.changeGo"), value: "go" }, { label: say("people.changeKeep"), value: "keep", variant: "secondary" }] });
      if (choice !== "go") return;
    }
    const previous = [...member.roles];
    try {
      const reply = await api.post("collaboration/members/roles", { publicationId: id, participantId: member.participantId, expectedRevision: members.revision, roles });
      members.revision = reply?.revision ?? members.revision;
      did.tell(say("people.changed", { name: member.displayName, what: roleWords(roles) }),
        undoing ? {} : { undo: () => changeRoles({ ...member, roles }, previous, true), undoLabel: say("part.undo") });
      await load();
      onChange?.();
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(togetherProblem(error).words, { variant: "problem" });
      await load();
    }
  }

  async function stop(member) {
    const title = summary.title || summary.guidingQuestion || say("together.untitled");
    const choice = await ask({ heading: say("people.stopAsk", { name: member.displayName, title }), text: removalImpact(member),
      choices: [{ label: say("people.stopKeep"), value: "keep" }, { label: say("people.stopGo"), value: "go", variant: "secondary" }] });
    if (choice !== "go") return;
    try {
      await api.post("collaboration/members/remove", { publicationId: id, participantId: member.participantId, expectedRevision: members.revision });
      toast(say("people.stopped", { name: member.displayName }));
      did.tell(say("people.stopped", { name: member.displayName }));
      await load();
      onChange?.();
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(togetherProblem(error).words, { variant: "problem" });
    }
  }

  function drawInvitations() {
    const shown = invitations.filter((i) => i.state === "pending" || i.state === "expired");
    if (!shown.length) { invitesHost.replaceChildren(h("p", { class: "studio-help", text: say("people.noInvitations") })); return; }
    invitesHost.replaceChildren(h("ul", { class: "studio-together-people" }, ...shown.map((invitation) => {
      const name = nameOf(invitation.contributorId) || invitation.adminUser;
      return h("li", { class: "studio-together-person" },
        h("p", {}, h("bdi", { class: "studio-stranger", text: `${name} · ${roleWords(invitation.roles)}` })),
        h("p", { class: "studio-help", text: invitationStatusText(invitation, name) }),
        h("div", { class: "studio-row" },
          invitation.state === "pending" ? h("action-button", { variant: "secondary", size: "sm", label: say("people.withdrawLabel", { name }), onClick: () => withdraw(invitation, name) }, say("people.withdraw")) : null,
          h("action-button", { variant: "secondary", size: "sm", label: say("people.newLinkLabel", { name }), onClick: () => newLink(invitation, name) }, say("people.newLink"))));
    })));
  }

  async function withdraw(invitation, name, quiet = false) {
    if (!quiet) {
      const choice = await ask({ heading: say("people.withdrawAsk", { name }), text: say("people.withdrawText"),
        choices: [{ label: say("people.withdrawKeep"), value: "keep" }, { label: say("people.withdraw"), value: "go", variant: "secondary" }] });
      if (choice !== "go") return;
    }
    try {
      await api.post("collaboration/invitations/revoke", { publicationId: id, invitationId: invitation.id });
      linkHost.replaceChildren();
      did.tell(say("people.withdrawn"));
      await load();
      onChange?.();
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(togetherProblem(error, "invite").words, { variant: "problem" });
    }
  }

  async function newLink(invitation, name) {
    try {
      const reply = await api.post("collaboration/invitations/reissue", { publicationId: id, invitationId: invitation.id });
      showLink(reply, name, say("people.newLinkMade"));
      await load();
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(togetherProblem(error, "invite").words, { variant: "problem" });
    }
  }

  /** The link, shown this once, with Copy and (on a phone) Send it… */
  function showLink(reply, name, said) {
    const link = invitationShareLink(location.origin, reply?.link);
    const when = reply?.invitation?.expiresAt ? sayDay(new Date(reply.invitation.expiresAt * 1000).toISOString()) : "";
    const field = h("text-field", { label: say("people.theLink"), value: link, readonly: true, class: "studio-together-link" });
    const copy = h("action-button", { onClick: async () => {
      try {
        await navigator.clipboard.writeText(link);
        did.tell(say("people.copied"));
      } catch {
        const input = field.querySelector("input");
        input?.focus();
        input?.select();
        did.tell(say("people.copyYourself"));
      }
    } }, say("people.copyLink"));
    const share = typeof navigator.share === "function" && globalThis.matchMedia?.("(pointer: coarse)").matches
      ? h("action-button", { variant: "secondary", onClick: () => navigator.share({ url: link }).catch(() => {}) }, say("people.sendLink")) : null;
    linkHost.replaceChildren(h("div", { class: "studio-together-linkcard" },
      h("p", { text: say("people.linkMade", { name, when }) }), field, h("div", { class: "studio-row" }, copy, share),
      h("p", { class: "studio-help", text: say("people.onlyNow") })));
    did.tell(said, reply?.invitation ? { undo: () => withdraw(reply.invitation, name, true), undoLabel: say("part.undo") } : {});
    requestAnimationFrame(() => copy.querySelector("button")?.focus());
  }

  function drawInvite() {
    const roles = summary.roles || [];
    if (coWriter || !canInvite({ coWriter, roles }, { choice: "writes" })) {
      inviteHost.replaceChildren(h("p", { class: "studio-help", text: coWriter ? say("people.ownerOnly") : say("people.readOnlyHelp") }));
      return;
    }
    const bound = new Set([...(members.members || []).map((m) => m.contributorId), ...invitations.filter((i) => i.state === "pending").map((i) => i.contributorId)]);
    const options = Object.entries(contributors).filter(([key]) => !bound.has(key)).map(([key, person]) => ({ value: key, label: person.name || key }));
    const who = h("select-field", { label: say("people.theirName"), description: say("people.theirNameHelp"), options: [{ value: "", label: say("people.chooseName") }, ...options], value: "",
      onValuechange: () => { typed = true; if (newOne.value === "new" && !signInTouched) signIn.value = suggestSignInName(nameOf(who.value)); } });
    const newOne = h("choice-cards", { label: say("people.howSignIn"), value: "new", items: [
      { id: "new", title: say("people.newSignIn"), detail: say("people.newSignInHelp") },
      { id: "has", title: say("people.hasSignIn", {}) },
    ], onValuechange: () => { paintSignIn(); typed = true; } });
    let signInTouched = false;
    const signIn = h("text-field", { label: say("people.signInName"), description: say("people.signInNameHelp"), maxlength: 32, autocomplete: "off",
      onValuechange: () => { signInTouched = true; typed = true; } });
    const choices = ROLE_CHOICES.filter((c) => canInvite({ coWriter, roles }, { choice: c.value }));
    const what = h("choice-cards", { label: say("people.whatTheyDo"), value: "writes", items: choices.map((c) => ({ id: c.value, title: c.words() })), onValuechange: () => { typed = true; } });
    const days = h("text-field", { label: say("people.daysLabel"), description: say("people.daysHelp"), inputmode: "numeric", value: "7" });
    const make = h("action-button", { onClick: () => submit() }, say("people.makeLink"));
    function paintSignIn() {
      const isNew = newOne.value !== "has";
      signIn.label = isNew ? say("people.signInName") : say("people.existingName");
      signIn.description = isNew ? say("people.signInNameHelp") : say("people.existingNameHelp");
    }
    async function submit() {
      who.error = ""; signIn.error = ""; days.error = "";
      const draft = { contributorId: String(who.value || ""), newAccount: newOne.value !== "has", signInName: String(signIn.value || "").trim(), choice: String(what.value || "writes"), lifetimeDays: String(days.value || "").trim() };
      const problem = validateInvitationDraft(draft);
      if (problem) {
        const field = { name: who, signIn, days }[problem.field];
        if (field) { field.error = problem.words; field.querySelector("input, select")?.focus(); }
        if (problem.field === "days") inviteHost.querySelector("details")?.setAttribute("open", "");
        return;
      }
      make.loading = true;
      try {
        const reply = await api.post("collaboration/invitations", invitationPayload(id, { ...draft, lifetimeDays: Number(draft.lifetimeDays) || undefined }));
        typed = false;
        showLink(reply, nameOf(draft.contributorId), say("people.invited"));
        await load();
        onChange?.();
      } catch (error) {
        if (error.status === 401) throw error;
        const said = togetherProblem(error, "invite");
        const field = said.field === "signInName" || said.code === "name-taken" || said.field === "adminUser" ? signIn : said.field === "contributorId" ? who : null;
        if (field) { field.error = said.code === "already-invited" ? say("people.alreadyIn", { name: nameOf(draft.contributorId) }) : said.words; field.querySelector("input, select")?.focus(); }
        else did.tell(said.words, { variant: "problem" });
      } finally {
        make.loading = false;
      }
    }
    paintSignIn();
    inviteHost.replaceChildren(who, h("a", { class: "studio-more-link", href: "#/people", text: say("people.someoneNew") }),
      newOne, signIn, what, h("p", { class: "studio-help", text: say("people.roleHelp") }), make,
      coWritersDetails(),
      h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { text: say("people.details", { days: days.value }) }), days,
        h("ul", {}, ...(members.members || []).map((m) => h("li", { class: "studio-mono", text: `${m.adminUser} · ${m.contributorId} · ${m.participantId} · ${(m.roles || []).join(", ")}${m.bindingCurrent === false ? ` · ${say("people.bindingGone")}` : ""}` })))));
  }

  /** R14b (G120): the sign-ins of everyone writing with her, for an owner account, with Remove. */
  function coWritersDetails() {
    const host = h("div");
    const details = h("details", { class: "studio-help" }, h("summary", { text: say("people.coWriters") }), host);
    details.addEventListener("toggle", async () => {
      if (!details.open) return;
      let list = [];
      try { list = (await api.get("collaboration/co-writers"))?.coWriters || []; } catch (error) { if (error.status === 401) throw error; }
      host.replaceChildren(list.length ? h("ul", {}, ...list.map((one) => h("li", { class: "studio-row" },
        h("span", { class: "studio-mono", text: one.waiting ? say("people.coWriterWaiting", { name: one.name }) : say("people.coWriterRow", { name: one.name, count: (one.reflections || []).map((r) => r.title || r.publicationId).join(", ") }) }),
        h("action-button", { variant: "ghost", size: "sm", onClick: () => removeCoWriter(one.name, details) }, say("people.coWriterRemove", { name: one.name })))))
        : h("p", { text: say("people.coWritersNone") }));
    });
    return details;
  }

  async function removeCoWriter(name, details) {
    const choice = await ask({ heading: say("people.coWriterRemoveAsk", { name }), text: say("people.coWriterRemoveText"),
      choices: [{ label: say("people.coWriterRemoveKeep"), value: "keep" }, { label: say("people.coWriterRemoveGo"), value: "go", variant: "secondary" }] });
    if (choice !== "go") return;
    try {
      await api.post("collaboration/co-writers/remove", { name });
      did.tell(say("people.coWriterRemoved", { name }));
      details.open = false;
      await load();
      onChange?.();
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(togetherProblem(error).words, { variant: "problem" });
    }
  }

  return { sheet, open };
}
