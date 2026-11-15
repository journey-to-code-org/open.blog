// The reflection (Studio R14a, #/together/<id>): where it stands and the one next step. The
// question, what started it (a link only when it is http(s)), the state in words, Everyone (one row
// per person, as text), People and invitations (a sheet, for whoever may invite), when you read
// each other's parts (for whoever runs it; changing it asks once and can be undone), and More.
// Publishing and putting away live in parts/together-publish.js. Everything anyone typed is text.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say, isolating } from "../parts/words.js";
import { partsNodes } from "../parts/stranger.js";
import { ask } from "../parts/dialogs.js";
import { createDidLine } from "../parts/did-line.js";
import { guardedLeave } from "../parts/sheet.js";
import { REVEAL_POLICIES, roleWords, sharedSourceHref, sourceWords, stepButtonWords, togetherPeopleRows, togetherProblem, togetherStep } from "../parts/together-rules.js";
import { reflectionPalette, stepHref } from "./together.js";
import { createPublishing } from "../parts/together-publish.js";
import { createPeopleSheet } from "../parts/together-people.js";
import { createLayoutSheet } from "../parts/together-layout.js";
import { createRulesSheet } from "../parts/together-rules-sheet.js";
import { createCollectionSheet } from "../parts/together-collection.js";

export async function createTogetherOne(context, id, route = {}) {
  const { api } = context;
  const coWriter = context.meta?.account === "co-writer";
  await use("action-button", "alert-banner", "breadcrumb-trail", "dropdown-menu", "segmented-control", "skeleton-block", "status-badge");
  const heading = h("h2", { id: "studio-together-one-h", class: "studio-question", tabindex: "-1", text: say("together.nav") });
  const crumb = h("breadcrumb-trail", { items: [] });
  const back = h("a", { class: "studio-more-link studio-back", href: "#/together", text: say("together.backTo", { title: say("together.backToList") }) });
  const question = h("p", { class: "studio-lede" });
  const source = h("p", { class: "studio-help studio-row" });
  const badge = h("p", { class: "studio-row" });
  const step = h("p", { class: "studio-together-step", role: "status", "aria-live": "polite" });
  const actions = h("div", { class: "studio-row studio-together-actions" });
  const did = createDidLine();
  const everyone = h("ul", { class: "studio-together-people" });
  const peopleButton = h("div");
  const sharing = h("div", { class: "studio-together-sharing" });
  const more = h("div");
  const details = h("details", { class: "studio-help" });
  const main = h("div", { class: "studio-together-main" }, question, source, badge, step, actions, did.element);
  const side = h("div", { class: "studio-together-side" }, h("h3", { class: "studio-together-h3", text: say("together.everyone") }), everyone, peopleButton, sharing);
  const body = h("div", { class: "studio-together-layout", "aria-busy": "true" }, h("skeleton-block", { lines: 6 }));
  const element = h("section", { class: "studio-page studio-together-one", "aria-labelledby": "studio-together-one-h" },
    crumb, h("div", { class: "studio-row studio-together-head" }, back, more), heading, body, details);
  let summary = null;
  const people = await createPeopleSheet({ api, context, id, onChange: () => load() });
  const publishing = createPublishing({ api, context, id, did, reload: () => load() });
  // R14b: shaping it. Each sheet saves its own shared record, with Undo.
  const layout = await createLayoutSheet({ api, id, onChange: () => load() });
  const rules = await createRulesSheet({ api, id, onChange: () => load() });
  const collection = await createCollectionSheet({ api, id, onChange: () => load() });
  const sheets = { people, layout, rules, collection };
  const screen = { title: say("together.nav"), element, load, palette: [], focus: () => heading.focus(),
    leave: () => guardedLeave(people.sheet, layout.sheet, rules.sheet, collection.sheet),
    isDirty: () => [people, layout, rules, collection].some((s) => s.sheet.isDirty()) };

  async function load() {
    body.setAttribute("aria-busy", "true");
    let found = null;
    try {
      const [now, away] = await Promise.all([
        api.get("collaboration/publications"),
        coWriter ? Promise.resolve({ publications: [] }) : api.get("collaboration/publications?archived=1"),
      ]);
      found = [...(now.publications || []), ...(away.publications || [])].find((s) => s.publicationId === id) || null;
    } catch (error) {
      if (error.status === 401) throw error;
      fill(body, h("alert-banner", { variant: error.status === 0 ? "info" : "danger" }, togetherProblem(error).words,
        h("action-button", { variant: "secondary", onClick: () => load() }, say("common.tryAgain"))));
      body.removeAttribute("aria-busy");
      return;
    }
    body.removeAttribute("aria-busy");
    if (!found) {
      heading.textContent = say("together.nav");
      fill(body, h("alert-banner", { variant: "info" }, h("p", { text: say("together.gone") }), h("action-button", { href: "#/together", variant: "secondary" }, say("together.backToList"))));
      return;
    }
    summary = found;
    draw();
    const asked = route.query?.sheet;
    const allowed = { people: summary.you?.canInvite, layout: summary.you?.drafter || summary.you?.runsIt, rules: summary.you?.runsIt, collection: true };
    if (asked && allowed[asked] && sheets[asked] && !sheets[asked].sheet.isOpen) {
      route.query.sheet = "";
      sheets[asked].open(summary, more);
    }
  }

  function draw() {
    const title = summary.title || summary.guidingQuestion || say("together.untitled");
    heading.replaceChildren(h("bdi", { class: "studio-stranger", text: title }));
    context.setTitle?.(title);
    crumb.items = coWriter
      ? [{ label: say("together.nav"), href: "#/together" }, { label: title, href: "" }]
      : [{ label: say("together.home"), href: "#/" }, { label: say("together.nav"), href: "#/together" }, { label: title, href: "" }];
    question.replaceChildren(summary.title && summary.guidingQuestion ? h("bdi", { class: "studio-stranger", dir: "auto", text: summary.guidingQuestion }) : "");
    question.hidden = !(summary.title && summary.guidingQuestion);
    const first = (summary.sources || [])[0];
    const href = first ? sharedSourceHref(first.url) : "";
    source.replaceChildren(...(first ? [h("span", {}, ...partsNodes(sourceWords(first, isolating))),
      href ? h("a", { href, target: "_blank", rel: "noopener noreferrer nofollow", referrerpolicy: "no-referrer", "aria-label": say("together.openSourceLabel", { title: first.title }), text: say("together.openSource") }) : null] : []));
    const at = togetherStep(summary, { coWriter });
    badge.replaceChildren(h("status-badge", { variant: at.variant }, at.badge));
    step.textContent = at.step;
    fill(actions, ...[at.primary, at.secondary].filter(Boolean).map((action, index) => stepButton(action, index === 0, title)));
    fill(everyone, ...togetherPeopleRows(summary, {}, isolating).map((row) => h("li", { class: "studio-together-person" }, ...partsNodes(row.text))));
    fill(peopleButton, summary.you?.canInvite ? h("action-button", { variant: "secondary", onClick: (e) => people.open(summary, e.currentTarget) }, say("together.peopleButton")) : null);
    drawSharing();
    drawMore(title);
    fill(body, h("div", { class: "studio-together-cols" }, main, side));
    screen.palette = reflectionPalette(summary);
    fill(details, h("summary", { text: say("common.forHelper") }),
      h("dl", { class: "studio-details" },
        h("dt", { text: say("together.detailId") }), h("dd", { class: "studio-mono", text: summary.publicationId }),
        h("dt", { text: say("together.detailState") }), h("dd", { class: "studio-mono", text: summary.state }),
        h("dt", { text: say("together.detailRoles") }), h("dd", { class: "studio-mono", text: `${(summary.roles || []).join(", ")} (${roleWords(summary.roles || [])})` }),
        h("dt", { text: say("together.detailSharing") }), h("dd", { class: "studio-mono", text: summary.policy }),
        h("dt", { text: say("together.detailFile") }), h("dd", { class: "studio-mono", text: `.openblog/private/collaboration/publications/${summary.publicationId}.json` })));
  }

  function stepButton(action, primary, title) {
    const words = stepButtonWords(action);
    const variant = primary ? "primary" : "secondary";
    const label = `${words}: ${title}`;
    if (action === "publish") return h("action-button", { variant, label, onClick: (e) => publishing.publish(summary, e.currentTarget) }, words);
    if (action === "schedule") return h("action-button", { variant, label, onClick: (e) => publishing.scheduleForm(summary, actions, e.currentTarget) }, words);
    if (action === "unschedule") return h("action-button", { variant, label, onClick: (e) => publishing.unschedule(summary, e.currentTarget) }, words);
    if (action === "bringBack") return h("action-button", { variant, label, onClick: (e) => publishing.putAway(summary, false, e.currentTarget) }, words);
    if (action === "change") return h("action-button", { variant, label, onClick: () => requestAnimationFrame(() => sharing.querySelector("button")?.focus()) }, words);
    if (action === "invite") return h("action-button", { variant, label, onClick: (e) => people.open(summary, e.currentTarget) }, words);
    return h("action-button", { variant, label, href: stepHref(summary, action) }, words);
  }

  function drawSharing() {
    if (!summary.you?.runsIt || summary.state === "published") { sharing.replaceChildren(); return; }
    const current = summary.policy;
    const control = h("segmented-control", { label: say("together.whenRead"), value: current === "independent" ? "" : current,
      options: REVEAL_POLICIES.map((p) => ({ value: p.value, label: p.words() })), onValuechange: (e) => changePolicy(current, e.detail, control) });
    fill(sharing, h("h3", { class: "studio-together-h3", text: say("together.whenRead") }),
      current === "independent" ? h("p", { class: "studio-help", text: say("together.ruleNever") }) : null, control);
  }

  async function changePolicy(from, to, control, undoing = false) {
    if (!to || to === from) return;
    if (!undoing) {
      const choice = await ask({ heading: say("together.ruleChangeAsk"), text: say("together.ruleChangeText"),
        choices: [{ label: say("together.ruleChangeGo"), value: "go" }, { label: say("together.ruleChangeKeep"), value: "keep", variant: "secondary" }] });
      if (choice !== "go") { control.value = from === "independent" ? "" : from; return; }
    }
    try {
      await api.put("collaboration/reveal/policy", { publicationId: id, policy: to, expectedPolicy: from, confirmed: true });
      did.tell(say("together.ruleChanged"), undoing ? {} : { undo: () => changePolicy(to, from, control, true), undoLabel: say("part.undo") });
      await load();
    } catch (error) {
      if (error.status === 401) throw error;
      const said = togetherProblem(error);
      did.tell(error.status === 409 ? say("together.changedElsewhere", { what: say("together.whenReadShort") }) : said.words, { variant: "problem" });
      await load();
    }
  }

  function drawMore(title) {
    const items = [
      summary.you?.drafter ? { value: "read", label: say("together.doRead") } : null,
      summary.you?.drafter ? { value: "preview", label: say("read.seeAsReaders") } : null,
      summary.you?.canInvite ? { value: "people", label: say("together.peopleButton") } : null,
      { value: "layout", label: say("layout.title") },
      summary.you?.runsIt ? { value: "rules", label: say("rules.title") } : null,
      { value: "collection", label: say("collection.title") },
      summary.you?.drafter ? { value: "talk", label: say("talk.title") } : null,
      summary.you?.inCharge && !coWriter && summary.state !== "published" && !summary.archived ? { value: "away", label: say("together.putAwayItem") } : null,
    ].filter(Boolean);
    const menu = h("dropdown-menu", { class: "studio-row-menu", items, onItemselect: (e) => choose(e.detail, menu) },
      h("span", { slot: "label" }, say("together.more"), h("span", { class: "studio-visually-hidden", text: ` ${title}` })));
    fill(more, items.length ? menu : null);
  }

  function choose(value, opener) {
    const enc = encodeURIComponent(id);
    if (value === "read") context.go(`#/together/${enc}/read`);
    if (value === "preview") context.go(`#/together/${enc}/read?preview=1`);
    if (value === "people") people.open(summary, opener);
    if (value === "layout") layout.open(summary, opener);
    if (value === "rules") rules.open(summary, opener);
    if (value === "collection") collection.open(summary, opener);
    if (value === "talk") context.go(`#/together/${enc}/together`);
    if (value === "away") publishing.putAway(summary, true, opener);
  }

  return screen;
}
