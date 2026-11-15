// Visitors, the Readers area's second place: is anybody reading, and what? Read-only. Counts visits,
// never people, and says what a visit is; up to a year (a year by month, 90 days by week); the posts
// they read most by title; the sites that sent them by name. Never a comparison with an earlier time,
// an arrow or a goal. Nothing here identifies a visitor. Studio R10; docs/specs/studio/r10/ux.md.
import { h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { sayDay } from "../parts/dates.js";
import { siteLink } from "../parts/publish.js";
import { say } from "../parts/words.js";
import { readerHeader } from "../parts/reader-tabs.js";
import { readersHash } from "../parts/reader-rules.js";
import { strangerInline } from "../parts/stranger.js";
import {
  RANGES, rangeLabel, rangeFind, buckets, periodWords, unitWords, chartLabel, barClass, headline, openedLine, visitsWords, sinceLine,
  keptLine, topReads, mergeHosts, howLines, visitorProblem, number,
} from "../parts/visitor-rules.js";

export async function createVisitors({ api, meta, posts, go }, days) {
  await use("alert-banner", "action-button", "breadcrumb-trail", "empty-state", "select-field", "skeleton-block");
  const hosted = meta.visitors === "hosted";
  const source = hosted ? "engagement/analytics" : "analytics";
  let summary = null;

  const { trail, tabs } = readerHeader({ tab: "visitors", last: say("readers.tabVisitors"), sent: Boolean(meta.engagementSetUp || meta.engagement) });
  const heading = h("h2", { id: "studio-visitors-h", class: "studio-question", tabindex: "-1", text: say("visitors.title") });
  const picker = h("select-field", {
    label: say("visitors.rangeLabel"),
    options: RANGES.map((d) => ({ value: String(d), label: rangeLabel(d) })),
    value: String(days),
    onValuechange: (e) => go(`#/readers/visitors${e.detail === "30" ? "" : `/${e.detail}`}`),
  });
  const body = h("div", { class: "studio-visitors", "aria-busy": "true" }, h("skeleton-block", { shape: "card" }), h("skeleton-block", { lines: 5 }));
  const details = h("details", { class: "studio-help" });
  const element = h("section", { class: "studio-page", "aria-labelledby": "studio-visitors-h" }, trail, tabs, h("div", { class: "studio-today" }, heading, picker), body, details);

  async function load() {
    body.setAttribute("aria-busy", "true");
    let list = [];
    try {
      summary = await api.get(`${source}?days=${days}`);
      list = await posts.list().catch(() => []);
    } catch (error) {
      if (error.status === 401) throw error;
      summary = null;
      body.removeAttribute("aria-busy");
      body.replaceChildren(h("alert-banner", { variant: error.status === 404 ? "info" : "danger", heading: visitorProblem(error) },
        error.status === 404 ? say("common.canTurnOn") : h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, say("visitors.tryAgain"))));
      drawDetails(error);
      return;
    }
    draw(list);
  }

  function draw(list) {
    body.removeAttribute("aria-busy");
    drawDetails();
    if (!summary.views && !summary.uniques) {
      body.replaceChildren(h("empty-state", { heading: say("visitors.emptyTitle") }, say("visitors.emptyText")));
      return;
    }
    const counter = summary.counter || (hosted ? "hosted" : "builtin");
    const drawn = buckets(summary.series, days, summary.firstDay);
    const most = Math.max(1, ...drawn.buckets.map((b) => b.visits));
    const reads = topReads(summary, list);
    const hosts = mergeHosts(summary.referrers).slice(0, 25);
    const since = sinceLine(summary, (d) => sayDay(d));
    const kept = keptLine(summary, days);

    const readRow = (r) => h("li", {}, h("a", { href: siteLink(meta, r.url), target: "_blank", rel: "noopener", text: r.title }), " ", h("span", { class: "studio-help", text: visitsWords(r.visits) }));
    const moreReads = h("ol", { class: "studio-visitor-list", start: String(reads.top.length + 1), hidden: true }, ...reads.more.map(readRow));
    const showMoreReads = reads.more.length ? h("action-button", { variant: "ghost", size: "sm", onClick: (e) => { moreReads.hidden = false; e.currentTarget.hidden = true; moreReads.querySelector("a")?.focus(); } }, say("visitors.showMore")) : null;
    const hostRow = (r) => h("li", {}, strangerInline(r.name), " ", h("span", { class: "studio-help", text: visitsWords(r.views) }));
    const moreHosts = h("ul", { class: "studio-visitor-list", hidden: true }, ...hosts.slice(5).map(hostRow));
    const showMoreHosts = hosts.length > 5 ? h("action-button", { variant: "ghost", size: "sm", onClick: (e) => { moreHosts.hidden = false; e.currentTarget.hidden = true; } }, say("visitors.showMore")) : null;

    const bars = drawn.buckets.map((b) => h("span", { class: `studio-visitor-bar ${b.notYet ? "studio-bar-notyet" : barClass(b.visits, most)}` }));
    const unit = unitWords(drawn.unit);
    const note = (b) => (b.notYet ? ` (${say("visitors.notYet")})` : b.partial ? ` (${(drawn.unit === "week" ? say("visitors.partWeek") : say("visitors.partMonth"))})` : "");
    const table = h("div", { class: "studio-table-scroll", role: "region", tabindex: "0", "aria-label": say("visitors.tableCaption", { unit }) },
      h("table", {}, h("caption", { text: say("visitors.tableCaption", { unit }) }),
        h("thead", {}, h("tr", {}, h("th", { scope: "col", text: say("visitors.colPeriod") }), h("th", { scope: "col", text: say("visitors.colVisits") }), h("th", { scope: "col", text: say("visitors.colOpened") }))),
        h("tbody", {}, ...drawn.buckets.map((b) => h("tr", {},
          h("th", { scope: "row", text: `${periodWords(b, drawn.unit, (d) => sayDay(d))}${note(b)}` }),
          h("td", { text: b.notYet ? say("visitors.notYet") : number(b.visits) }), h("td", { text: b.notYet ? say("visitors.notYet") : number(b.opened) }))))));

    body.replaceChildren(
      h("p", { class: "studio-visitor-number", text: headline(summary) }),
      h("p", { class: "studio-help", text: say("visitors.visitMeans") }),
      h("p", { class: "studio-lede", text: `${openedLine(summary)}${since ? ` ${since}` : ""}${kept ? ` ${kept}` : ""}` }),
      drawn.buckets.length ? h("div", { class: `studio-visitor-chart studio-chart-${drawn.unit}`, role: "img", "aria-label": chartLabel(drawn, (d) => sayDay(d)) }, ...bars) : null,
      drawn.buckets.length ? h("details", { class: "studio-help" }, h("summary", { text: say("visitors.seeNumbers") }), table) : null,
      h("div", { class: "studio-visitor-columns" },
        h("section", { class: "studio-section", "aria-labelledby": "studio-reads-h" },
          h("h3", { id: "studio-reads-h", text: say("visitors.readMost") }),
          reads.top.length ? h("ol", { class: "studio-visitor-list" }, ...reads.top.map(readRow)) : h("p", { class: "studio-help", text: say("visitors.readNone") }),
          moreReads, showMoreReads,
          reads.other ? h("p", { class: "studio-help", text: say("visitors.otherPages", { visits: visitsWords(reads.other) }) }) : null),
        hosts.length ? h("section", { class: "studio-section", "aria-labelledby": "studio-from-h" },
          h("h3", { id: "studio-from-h", text: say("visitors.cameFrom") }),
          h("ul", { class: "studio-visitor-list" }, ...hosts.slice(0, 5).map(hostRow)), moreHosts, showMoreHosts) : null),
      h("details", { class: "studio-help" }, h("summary", { text: say("visitors.howHeading") }), ...howLines(counter).map((l) => h("p", { text: l.text }))));
  }

  function drawDetails(error) {
    const s = summary || {};
    details.replaceChildren(h("summary", { text: say("common.forHelper") }),
      h("ul", { class: "studio-mono" }, ...[
        say("visitors.detailsSource", { source: hosted ? "hosted counter (engagement/analytics)" : "built-in counter (analytics; analytics.builtin)" }),
        error ? say("visitors.detailsError", { status: error.status, message: error.message }) : null,
        summary ? say("visitors.detailsRange", { from: s.from, to: s.to, views: s.views, visits: s.uniques, allTime: s.allTimeViews, first: s.firstDay || "none", kept: s.keptDays ?? "unknown", series: (s.series || []).length }) : null,
        ...(s.topPosts || []).map((p) => say("visitors.detailsPath", { path: p.path, views: p.views, visits: p.uniques, allTime: p.allTime })),
        ...(s.referrers || []).map((r) => say("visitors.detailsHost", { host: r.host, views: r.views })),
        s.agentRequests ? say("visitors.detailsAgents", { n: s.agentRequests, list: (s.agents || []).length ? ` (${s.agents.map((a) => `${a.name} ${a.requests}`).join(", ")})` : "" }) : null,
      ].filter(Boolean).map((t) => h("li", { class: "studio-stranger", dir: "auto", text: t }))));
  }

  return {
    title: say("readers.tabVisitors"),
    element,
    load,
    reload: load,
    focus: () => heading.focus(),
    get palette() {
      return RANGES.map((d) => ({ id: `days:${d}`, label: rangeFind(d), group: say("visitors.findGroup") }));
    },
    command(id) {
      if (id.startsWith("days:")) go(`#/readers/visitors${id.slice(5) === "30" ? "" : `/${id.slice(5)}`}`);
    },
  };
}

export { readersHash };
