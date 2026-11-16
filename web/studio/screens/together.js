// Writing together (Studio R14a, #/together): what she is writing with other people and what is
// waiting on her. One card per reflection, each with its state in words, the next step in one
// sentence, and one button for that step. Views: Now, On your blog, Put away (owners only). The
// addresses under #/together open the other screens from here (`createTogetherScreen`). For a
// co-writer sign-in this is Home and the only screen there is.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say, isolating } from "../parts/words.js";
import { partsNodes } from "../parts/stranger.js";
import { createDidLine } from "../parts/did-line.js";
import { joinNames, kindWords, peopleWords, sourceWords, stepButtonWords, togetherProblem, togetherStep } from "../parts/together-rules.js";
import { roleWords } from "../parts/together-rules.js";

const coWriterOf = (context) => context.meta?.account === "co-writer";

/** Where one step's button goes, or null when the button acts here. */
export function stepHref(summary, action) {
  const id = encodeURIComponent(summary.publicationId);
  switch (action) {
    case "invite": return `#/together/${id}?sheet=people`;
    case "write":
    case "share": return `#/together/${id}/write`;
    case "read": return `#/together/${id}/read`;
    case "open": return summary.path ? `#/write/${encodeURIComponent(summary.path)}` : `#/together/${id}`;
    case "bringBack": return null;
    default: return `#/together/${id}`;
  }
}

/** The Find entries for one reflection. */
export function reflectionPalette(summary) {
  const title = summary.title || summary.guidingQuestion || say("together.untitled");
  const id = encodeURIComponent(summary.publicationId);
  const items = [{ id: `together-open-${summary.publicationId}`, label: title, group: say("together.nav"), href: `#/together/${id}` }];
  if (summary.you?.drafter) {
    items.push({ id: `together-part-${summary.publicationId}`, label: say("together.findPart", { title }), group: say("together.nav"), href: `#/together/${id}/write` });
    items.push({ id: `together-read-${summary.publicationId}`, label: say("together.findRead", { title }), group: say("together.nav"), href: `#/together/${id}/read` });
  }
  // R14b: shaping it, by name.
  items.push({ id: `together-layout-${summary.publicationId}`, label: `${say("layout.title")}: ${title}`, group: say("together.nav"), href: `#/together/${id}?sheet=layout` });
  items.push({ id: `together-collection-${summary.publicationId}`, label: `${say("collection.title")}: ${title}`, group: say("together.nav"), href: `#/together/${id}?sheet=collection` });
  if (summary.you?.runsIt || summary.ruleProposal?.asksYou) items.push({ id: `together-rules-${summary.publicationId}`, label: `${say("rules.title")}: ${title}`, group: say("together.nav"), href: `#/together/${id}?sheet=rules` });
  if (summary.you?.drafter && summary.you?.credit != null) items.push({ id: `together-name-${summary.publicationId}`, label: `${say("name.title")}: ${title}`, group: say("together.nav"), href: `#/together/${id}?sheet=name` });
  if (summary.you?.drafter) {
    items.push({ id: `together-talk-${summary.publicationId}`, label: say("talk.find", { title }), group: say("together.nav"), href: `#/together/${id}/together` });
    items.push({ id: `together-moments-${summary.publicationId}`, label: `${say("moments.title")}: ${title}`, group: say("together.nav"), href: `#/together/${id}/write?sheet=moments` });
  }
  if (summary.you?.canInvite) {
    items.push({ id: `together-people-${summary.publicationId}`, label: say("together.findPeople", { title }), group: say("together.nav"), href: `#/together/${id}?sheet=people` });
    items.push({ id: `together-invite-${summary.publicationId}`, label: say("together.findInvite", { title }), group: say("together.nav"), href: `#/together/${id}?sheet=people` });
  }
  return items;
}

/** The screen for an address under #/together. */
export async function createTogetherScreen(context, route) {
  const arg = String(route.arg || "");
  if (arg === "new") return (await import("./together-new.js")).createTogetherNew(context, route);
  if (arg === "join" || arg.startsWith("join/")) return (await import("./together-join.js")).createTogetherJoin(context, route);
  const [id, page = ""] = arg.split("/");
  if (id && page === "write") return (await import("./together-part.js")).createTogetherPart(context, id, route);
  if (id && page === "read") return (await import("./together-read.js")).createTogetherRead(context, id, route);
  if (id && page === "together") return (await import("./together-talk.js")).createTogetherTalk(context, id, route);
  if (id) return (await import("./together-one.js")).createTogetherOne(context, id, route);
  return createTogetherList(context, route);
}

export async function createTogetherList(context, route = {}) {
  const { api } = context;
  const coWriter = coWriterOf(context);
  await use("action-button", "alert-banner", "breadcrumb-trail", "content-card", "empty-state", "segmented-control", "skeleton-block", "status-badge");
  const views = [{ value: "now", label: say("together.viewNow") }, { value: "published", label: say("together.viewPublished") }, ...(coWriter ? [] : [{ value: "away", label: say("together.viewPutAway") }])];
  let view = views.some((v) => v.value === route.query?.view) ? route.query.view : "now";
  let all = [];
  const heading = h("h2", { id: "studio-together-h", class: "studio-question", tabindex: "-1", text: say("together.title") });
  const did = createDidLine();
  const start = coWriter || context.meta?.together?.canStart === false ? null : h("action-button", { href: "#/together/new" }, say("together.startButton"));
  const picker = h("segmented-control", { label: say("together.viewsLabel"), value: view, options: views, onValuechange: (e) => { view = e.detail; context.replaceRoute?.(view === "now" ? "#/together" : `#/together?view=${view}`); load(); } });
  const list = h("div", { class: "studio-together-cards", "aria-busy": "true" }, h("skeleton-block", { shape: "card" }));
  const details = h("details", { class: "studio-help" });
  const element = h("section", { class: "studio-page studio-together-page", "aria-labelledby": "studio-together-h" },
    h("breadcrumb-trail", { items: coWriter ? [{ label: say("together.nav"), href: "" }] : [{ label: say("together.home"), href: "#/" }, { label: say("together.nav"), href: "" }] }),
    heading,
    h("div", { class: "studio-together-top" }, h("p", { class: "studio-lede", text: say("together.lede") }), start),
    picker, did.element, list, details);
  const screen = { title: say("together.title"), element, load, palette: [], focus: () => heading.focus() };

  async function load() {
    list.setAttribute("aria-busy", "true");
    try {
      const reply = await api.get(view === "away" ? "collaboration/publications?archived=1" : "collaboration/publications");
      all = Array.isArray(reply?.publications) ? reply.publications : [];
    } catch (error) {
      if (error.status === 401) throw error;
      list.removeAttribute("aria-busy");
      const problem = togetherProblem(error, "page");
      fill(list, h("alert-banner", { variant: error.status === 0 ? "info" : "danger" },
        h("p", { text: error.status === 0 ? say("together.noSignalList") : say("together.listFailed") }),
        h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: `${problem.code || error.status}: ${error.message}` })),
        h("action-button", { variant: "secondary", onClick: () => load() }, say("common.tryAgain"))));
      return;
    }
    draw();
  }

  function draw() {
    list.removeAttribute("aria-busy");
    const shown = view === "away" ? all : all.filter((s) => (view === "published") === (s.state === "published"));
    screen.palette = all.flatMap(reflectionPalette);
    if (!shown.length) {
      const words = view === "published" ? say("together.emptyPublished") : view === "away" ? say("together.emptyPutAway") : coWriter ? say("together.emptyGuest") : say("together.empty");
      fill(list, h("empty-state", { heading: view === "now" && !coWriter ? say("together.emptyTitle") : say("together.title") }, words,
        view === "now" && start ? h("action-button", { slot: "actions", href: "#/together/new" }, say("together.startButton")) : null));
    } else {
      fill(list, h("ul", { class: "studio-together-list", onKeydown: rove }, ...shown.map(card)));
    }
    fill(details, h("summary", { text: say("common.forHelper") }),
      h("p", { text: say("together.findDetails") }),
      ...all.map((s) => h("p", { class: "studio-mono", text: say("together.detailsLine", { id: s.publicationId, state: s.state, roles: `${(s.roles || []).join(", ")} (${roleWords(s.roles || [])})`, policy: s.policy, n: s.invitationsWaiting || 0, file: `.openblog/private/collaboration/publications/${s.publicationId}.json` }) })));
  }

  function card(summary) {
    const step = togetherStep(summary, { coWriter });
    const title = summary.title || summary.guidingQuestion || say("together.untitled");
    const id = encodeURIComponent(summary.publicationId);
    const source = (summary.sources || [])[0];
    const label = say("together.cardName", { title, badge: step.badge, step: step.step });
    const button = step.primary ? actionButton(summary, step.primary, title) : null;
    return h("li", { class: "studio-together-card" },
      h("content-card", {},
        h("h3", { class: "studio-together-card-title" }, h("a", { class: "studio-together-open", href: `#/together/${id}`, "aria-label": label }, h("bdi", { class: "studio-stranger", text: title }))),
        source ? h("p", { class: "studio-help" }, ...partsNodes(sourceWords(source, isolating))) : null,
        h("p", { class: "studio-help" }, ...partsNodes(peopleWords(summary, isolating))),
        h("p", { class: "studio-row studio-together-state" }, h("status-badge", { variant: step.variant }, step.badge)),
        step.step ? h("p", { text: step.step }) : null,
        button));
  }

  function actionButton(summary, action, title) {
    const href = stepHref(summary, action);
    if (href) return h("action-button", { href, variant: "secondary", label: `${stepButtonWords(action)}: ${title}` }, stepButtonWords(action));
    return h("action-button", { variant: "secondary", onClick: (e) => bringBack(summary, e.currentTarget) }, stepButtonWords(action));
  }

  async function bringBack(summary, button) {
    button.loading = true;
    const put = (archived) => api.post("collaboration/publications/archive", { publicationId: summary.publicationId, archived });
    try {
      await put(false);
      did.tell(say("together.broughtBack"), { undo: async () => { await put(true); did.tell(say("together.putAway")); load(); }, undoLabel: say("part.undo") });
      load();
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(togetherProblem(error).words, { variant: "problem" });
    } finally {
      button.loading = false;
    }
  }

  /** ↑/↓ move between the cards; Enter opens the one in focus (it is a link). */
  function rove(event) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const links = [...list.querySelectorAll("a.studio-together-open")];
    const at = links.indexOf(document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    links[Math.max(0, Math.min(links.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))].focus();
  }

  return screen;
}

// Used by the reflection page too.
export { joinNames, kindWords };
