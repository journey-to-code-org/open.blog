// "Where it went": Sharing's second view (#/sharing?view=posts, R1). Every post and each place it
// ended up, from the owner's own records (`GET distribution`) and her shares in the hosted queue,
// with visits from there when the site counts them. It only reads. A platform's own numbers are
// never shown; place names and post titles are only ever text. docs/specs/studio/r1/ux.md.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { announcementRow, mergeReport, placeWords, reachedWords, unreadableWords } from "./distribution-rules.js";
import { sayWhen } from "./dates.js";

/** `days` is 30, 90 or 365; `social` says whether the hosted queue exists (meta.social). */
export async function createWhereItWent({ api, days, social, posts: store = null }) {
  await use("action-button", "alert-banner", "auto-grid", "empty-state", "skeleton-block", "status-badge");
  const element = h("div", { class: "studio-where", "aria-busy": "true" }, h("skeleton-block", { shape: "card" }));
  const details = h("details", { class: "studio-help" });
  let lastError = null;

  async function load() {
    element.setAttribute("aria-busy", "true");
    let report;
    try {
      report = await api.get(`distribution?days=${days}`);
    } catch (error) {
      if (error.status === 401) throw error;
      lastError = error;
      element.removeAttribute("aria-busy");
      element.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your blog couldn't read that" }, "Try again. ",
        h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again")));
      drawDetails(null);
      return;
    }
    let rows = [];
    let socialState = social ? "read" : "absent";
    if (social) {
      try {
        rows = ((await api.get("social/announcements")).announcements || []).map(announcementRow).filter(Boolean);
      } catch (error) {
        if (error.status === 401) throw error;
        socialState = "unreadable";
      }
    }
    const arrivals = report?.arrivals && typeof report.arrivals === "object" ? report.arrivals : null;
    const visits = report?.visitsAvailable ? (url, destination) => Number(arrivals?.[destination]?.[url] ?? 0) : null;
    // A post the records don't list is named by its title from the posts list, else its address.
    let titles = new Map();
    try { titles = new Map(((await store?.list()) || []).filter((p) => p.url).map((p) => [p.url, p.title])); } catch { /* addresses will do */ }
    const merged = mergeReport(report, rows, visits).map((post) => (post.title === post.url && titles.get(post.url) ? { ...post, title: titles.get(post.url) } : post));
    draw(report, merged, socialState);
  }

  function draw(report, posts, socialState) {
    element.removeAttribute("aria-busy");
    const all = posts.flatMap((post) => post.rows);
    const warnings = [
      ...(Array.isArray(report.families) ? report.families : []).filter((f) => f.state === "unreadable")
        .map((f) => h("alert-banner", { variant: "warning", heading: "Something is missing here" }, unreadableWords(String(f.label || "one place")))),
      ...(socialState === "unreadable" ? [h("alert-banner", { variant: "warning", heading: "Your shares didn't load" },
        "Your shares to Facebook and others didn't load, so they aren't here. ",
        h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again"))] : []),
    ];
    drawDetails(report, posts);
    if (!posts.length) {
      element.replaceChildren(...warnings, h("empty-state", { heading: "Nothing has gone anywhere yet" },
        "When you share a post, or post a job somewhere yourself, it shows up here.",
        social ? h("action-button", { slot: "actions", href: "#/sharing/new" }, "Share a post") : null), details);
      return;
    }
    element.replaceChildren(...warnings,
      h("h3", { id: "studio-where-h", text: reachedWords(all, report.days || days) }),
      h("auto-grid", { min: "20rem" }, ...posts.map(card)),
      h("p", { class: "studio-help", text: report.visitsAvailable === false
        ? "Your site isn't counting visits, so there are no visit numbers."
        : "Visits are estimates; some people's browsers hide where they came from." }),
      details);
  }

  function card(post) {
    return h("section", { class: "studio-comment", "data-url": post.url, "aria-label": post.title || post.url },
      h("h4", { class: "studio-comment-who" }, h("a", { href: post.url, target: "_blank", rel: "noopener", text: post.title || post.url })),
      h("ul", { class: "studio-where-places" }, ...post.rows.map((row) => {
        const words = placeWords(row);
        const check = row.status === "unknown" && row.announcement
          ? h("action-button", { variant: "secondary", size: "sm", href: `#/sharing?check=${encodeURIComponent(row.announcement)}`, label: `Check it: ${words.place}` }, "Check it")
          : null;
        return h("li", { "data-destination": row.destination, "data-status": row.status },
          h("p", { class: "studio-where-line" }, h("span", { text: `${words.place} · ` }), h("strong", { text: words.status }), check ? " " : "", check),
          words.visits ? h("p", { class: "studio-help", text: words.visits }) : null,
          h("details", { class: "studio-help" }, h("summary", { text: "Details" }),
            h("ul", { class: "studio-mono" }, ...[
              `rests on: ${words.evidence}`,
              row.remoteId ? `id ${row.remoteId}` : null,
              row.permalink ? `link ${row.permalink}` : null,
              row.attempts > 1 ? `tries ${row.attempts}` : null,
              row.lastUpdateAt ? `last change ${sayWhen(row.lastUpdateAt)}` : null,
              row.problem ? `problem ${row.problem}` : null,
            ].filter(Boolean).map((t) => h("li", { text: t })))));
      })));
  }

  function drawDetails(report, posts = []) {
    details.replaceChildren(h("summary", { text: "For the person who set up your site" }),
      h("ul", { class: "studio-mono" }, ...[
        lastError ? `error ${lastError.status}: ${lastError.message}` : null,
        report ? `days ${report.days}, visits ${report.visitsAvailable ? "counted" : "off"}` : null,
        ...(report?.families || []).map((f) => `record ${f.id}: ${f.state}`),
        `${posts.length} posts`,
      ].filter(Boolean).map((t) => h("li", { text: t }))));
  }

  return { element, load };
}
