// Visitors: is anybody reading, and which recipes do they like? Read-only: how many people came over
// the last 7, 30 or 90 days, which posts they read most (by title), one plain bar per day, and the
// sites that sent them. Nothing here identifies a visitor; the counter keeps nothing that could.
// Studio slice 9; docs/specs/studio/slice-9/ux.md.
import { h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { sayDay } from "../parts/dates.js";
import { siteLink } from "../parts/publish.js";
import { routeHash } from "../router.js";
import { RANGES, rangeOf, headline, pagesLine, topReads, peopleWords, seriesLabel, sinceLine, visitorTrouble } from "../parts/visitor-words.js";
import { say } from "../parts/words.js";

export async function createVisitors({ api, meta, posts, go }, route) {
  await use("alert-banner", "action-button", "empty-state", "select-field", "skeleton-block");
  const days = rangeOf(route.arg);
  const source = meta.visitors === "hosted" ? "engagement/analytics" : "analytics";
  let summary = null;

  const heading = h("h2", { id: "studio-visitors-h", class: "studio-question", tabindex: "-1", text: "Who's been reading?" });
  const picker = h("select-field", {
    label: "Over the last",
    options: RANGES.map((d) => ({ value: String(d), label: `${d} days` })),
    value: String(days),
    onValuechange: (e) => go(routeHash("visitors", e.detail === "30" ? "" : e.detail)),
  });
  const body = h("div", { class: "studio-visitors", "aria-busy": "true" }, h("skeleton-block", { shape: "card" }), h("skeleton-block", { lines: 5 }));
  const details = h("details", { class: "studio-help" });
  const element = h("section", { class: "studio-page", "aria-labelledby": "studio-visitors-h" },
    h("div", { class: "studio-today" }, heading, picker), body, details);

  async function load() {
    body.setAttribute("aria-busy", "true");
    let list = [];
    try {
      summary = await api.get(`${source}?days=${days}`);
      list = await posts.list().catch(() => []);
    } catch (error) {
      if (error.status === 401) throw error;
      body.removeAttribute("aria-busy");
      body.replaceChildren(h("alert-banner", { variant: error.status === 404 ? "info" : "danger", heading: visitorTrouble(error) },
        error.status === 404 ? say("common.canTurnOn") : h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again")));
      drawDetails(error);
      return;
    }
    draw(list);
  }

  function draw(list) {
    body.removeAttribute("aria-busy");
    drawDetails();
    if (!summary.views) {
      body.replaceChildren(h("empty-state", { heading: "No visits counted yet" }, "When people read your recipes, the numbers show up here, a day or so later."));
      return;
    }
    const since = sinceLine(summary, (d) => sayDay(d));
    const reads = topReads(summary, list);
    const label = seriesLabel(summary.series, (d) => sayDay(d));
    const most = Math.max(1, ...(summary.series || []).map((d) => d.views || 0));
    const readRow = (r) => h("li", {}, h("a", { href: siteLink(meta, r.url), target: "_blank", rel: "noopener", text: r.title }), " ", h("span", { class: "studio-help", text: peopleWords(r.people) }));
    const moreList = h("ol", { class: "studio-visitor-list", start: String(reads.top.length + 1), hidden: true }, ...reads.more.map(readRow));
    const showMore = reads.more.length ? h("action-button", { variant: "ghost", size: "sm", onClick: (e) => { moreList.hidden = false; e.currentTarget.hidden = true; moreList.querySelector("a")?.focus(); } }, "Show more") : null;
    const referrers = (summary.referrers || []).slice(0, 5);
    body.replaceChildren(
      h("p", { class: "studio-visitor-number", text: headline(summary) }),
      h("p", { class: "studio-lede", text: `${pagesLine(summary)}${since ? ` ${since}` : ""}` }),
      label ? h("div", { class: "studio-visitor-chart", role: "img", "aria-label": label },
        // Heights in twentieths, as classes: Studio sets no inline styles.
        ...(summary.series || []).map((d) => h("span", { class: `studio-visitor-bar studio-bar-${Math.round(((d.views || 0) / most) * 20)}` }))) : null,
      h("div", { class: "studio-visitor-columns" },
        h("section", { class: "studio-section", "aria-labelledby": "studio-reads-h" },
          h("h3", { id: "studio-reads-h", text: "What they read most" }),
          reads.top.length ? h("ol", { class: "studio-visitor-list" }, ...reads.top.map(readRow)) : h("p", { class: "studio-help", text: "No recipes or stories yet; the visits were to other pages." }),
          moreList, showMore,
          reads.other ? h("p", { class: "studio-help", text: `Other pages: ${reads.other === 1 ? "1 visit" : `${reads.other} visits`}` }) : null),
        referrers.length ? h("section", { class: "studio-section", "aria-labelledby": "studio-from-h" },
          h("h3", { id: "studio-from-h", text: "Where they came from" }),
          h("ul", { class: "studio-visitor-list" }, ...referrers.map((r) => h("li", {}, h("span", { text: r.host }), " ", h("span", { class: "studio-help", text: r.views === 1 ? "1 visit" : `${r.views} visits` }))))) : null));
  }

  function drawDetails(error) {
    const s = summary || {};
    details.replaceChildren(h("summary", { text: say("common.forHelper") }),
      h("ul", { class: "studio-mono" }, ...[
        `source ${meta.visitors === "hosted" ? "hosted counter (engagement/analytics)" : "built-in counter (analytics; analytics.builtin)"}`,
        error ? `error ${error.status}: ${error.message}` : null,
        summary ? `from ${s.from} to ${s.to}, views ${s.views}, uniques ${s.uniques}, all time ${s.allTimeViews}, first day ${s.firstDay || "none"}` : null,
        ...(s.topPosts || []).map((p) => `${p.path}  views ${p.views}  uniques ${p.uniques}  all time ${p.allTime}`),
        ...(s.referrers || []).map((r) => `from ${r.host}  ${r.views}`),
        s.agentRequests != null ? `bots and AI agents: ${s.agentRequests} requests${(s.agents || []).length ? ` (${s.agents.map((a) => `${a.name} ${a.requests}`).join(", ")})` : ""}` : null,
        meta.visitors === "counter" ? "The built-in counter counts what reaches this server; a site served elsewhere may count only part of its visits here." : null,
      ].filter(Boolean).map((t) => h("li", { text: t }))),
      h("p", {}, h("a", { href: "/admin/#/analytics/365", target: "_blank", rel: "noopener" }, "Analytics in the old Admin (up to a year)")));
  }

  return {
    title: "Visitors",
    element,
    load,
    reload: load,
    focus: () => heading.focus(),
    get palette() {
      return RANGES.map((d) => ({ id: `days:${d}`, label: `Visitors in the last ${d} days`, group: "Visitors" }));
    },
    command(id) {
      if (id.startsWith("days:")) go(routeHash("visitors", id.slice(5) === "30" ? "" : id.slice(5)));
    },
  };
}
