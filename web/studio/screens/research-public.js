// What readers see (Studio R12, #/research/public): "What will readers see from my research?" The
// server's preview of what the next build publishes, part by part: each shown item opens to the
// exact values readers get, each item kept back says why, as a rule. Then the whole site's research
// checks (R7's review in site mode), each with Open it. Nothing here changes anything.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { boundaryCountsText, boundaryGroups, boundaryItemHash, boundaryReasonWords, boundaryStoreWords } from "../parts/boundary-rules.js";
import { curationFieldWords, curationValueText } from "../parts/curation-rules.js";
import { researchProblem, researchWords } from "../parts/research-rules.js";
import { forHelper, guardUnload, researchFrame } from "../parts/research-ui.js";
import { createResearchReview } from "../parts/research-review.js";

export async function createResearchPublic(context) {
  const { api } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "select-field", "skeleton-block", "status-badge");
  guardUnload();
  const frame = researchFrame({ screen: "public", go: (hash) => context.go(hash) });
  frame.crumbs([{ label: say("public.tab"), href: "" }]);
  const heading = h("h2", { id: "studio-public-h", class: "studio-question", tabindex: "-1", text: say("public.title") });
  const counts = h("p", { role: "status", "aria-live": "polite" });
  const again = h("action-button", { variant: "secondary", onClick: () => load({ again: true }) }, say("public.checkAgain"));
  const groups = h("div", { "aria-busy": "true" }, h("skeleton-block", { lines: 6 }));
  const checks = h("div");
  const review = createResearchReview({ api, site: true, context: () => ({ post: "", firstBodyLine: 1 }), show: () => {}, reload: () => loadChecks(), tell: () => {} });
  const element = h("section", { class: "studio-page studio-research-public", "aria-labelledby": "studio-public-h" },
    frame.element, heading, h("p", { class: "studio-help", text: say("public.lede") }), h("div", { class: "studio-row" }, counts, again), groups, checks);

  const fieldRows = (item) => {
    const content = item?.content && typeof item.content === "object" ? item.content : null;
    const names = content ? Object.keys(content) : Array.isArray(item?.fields) ? item.fields : [];
    return h("dl", { class: "studio-public-fields" }, names.flatMap((name) => [h("dt", { text: curationFieldWords(name) }),
      h("dd", { class: "studio-stranger", dir: "auto", text: content ? curationValueText(content[name]) : say("public.fieldShown") })]));
  };
  const openIt = (item, postPaths) => {
    const hash = boundaryItemHash(item, { postPaths });
    return hash ? h("action-button", { variant: "secondary", size: "sm", href: hash }, say("research.openIt")) : null;
  };
  const name = (item) => String(item?.label || item?.title || item?.id || "");

  function paint(manifest, postPaths) {
    groups.removeAttribute("aria-busy");
    counts.textContent = boundaryCountsText(manifest);
    fill(groups, ...boundaryGroups(manifest).map((group, g) => {
      const id = `studio-public-g${g}`;
      return h("section", { class: "studio-section studio-public-store", "data-store": group.projection, "aria-labelledby": id },
        h("h3", { id, text: `${boundaryStoreWords(group.projection)} (${group.published.length})` }),
        group.enabled ? null : h("p", { class: "studio-help", text: say("public.storeOff") }),
        group.blocked ? h("p", { class: "studio-help", text: say("public.storeBlocked") }) : null,
        group.published.length ? h("ul", { class: "studio-research-also" }, group.published.map((item) => h("li", { "data-public-item": `${item.kind}:${item.id}`, "data-state": "shown" },
          h("details", {}, h("summary", {}, h("status-badge", { variant: "success" }, say("public.shownBadge")), " ", h("bdi", { text: name(item) })),
            fieldRows(item), item.url ? h("p", { class: "studio-help" }, say("public.at"), " ", h("code", { text: String(item.url) })) : null,
            (item.withheldFields || []).length ? h("ul", { class: "studio-help" }, item.withheldFields.map((field) => h("li", { "data-public-field": field.field }, `${curationFieldWords(field.field)}: ${boundaryReasonWords(field.reason)}`))) : null,
            openIt(item, postPaths))))) : h("p", { class: "studio-help", text: say("public.nothingShown") }),
        group.withheld.length ? h("div", {}, h("h4", { text: say("public.held", { count: group.withheld.length }) }),
          h("ul", { class: "studio-research-also" }, group.withheld.map((item) => h("li", { "data-public-item": `${item.kind}:${item.id}`, "data-state": "held", "data-reason": item.reason },
            h("bdi", { text: name(item) }), " — ", h("span", { text: boundaryReasonWords(item.reason) }), " ", openIt(item, postPaths))))) : null,
        forHelper(...[...group.published, ...group.withheld].map((item) => `${item.kind}:${item.id} ${item.reason || "published"} ${item.message || ""}`), group.switch ? `switch: ${group.switch}` : ""));
    }), (manifest?.never || []).length ? h("section", { class: "studio-section" }, h("h3", { text: say("public.never") }),
      h("p", { class: "studio-help", text: say("public.neverText") }), forHelper(...manifest.never.map((item) => `${item.store}: ${item.count} — ${item.what || ""}`))) : null);
  }

  async function loadChecks() {
    review.waiting();
    fill(checks, review.element);
    try {
      review.show(await api.get("research/readiness"));
    } catch (error) {
      if (error?.status === 401) throw error;
      fill(checks, h("p", { class: "studio-help", text: say("public.checksFailed") }), h("action-button", { variant: "secondary", size: "sm", onClick: () => loadChecks() }, say("public.checkAgain")));
    }
  }

  async function load({ again: checkedAgain = false } = {}) {
    frame.paintKept();
    frame.paintBack();
    const [boundary, posts] = await Promise.allSettled([api.get("research/boundary"), api.get("documents?kind=posts")]);
    for (const result of [boundary, posts]) if (result.status === "rejected" && result.reason?.status === 401) throw result.reason;
    const postPaths = new Map();
    if (posts.status === "fulfilled") for (const item of posts.value?.items || []) if (item?.slug && item?.path) postPaths.set(String(item.slug), String(item.path));
    if (boundary.status === "rejected") {
      groups.removeAttribute("aria-busy");
      const problem = researchProblem(boundary.reason, "atlas");
      // A 422 here means the site itself couldn't be loaded, not that a store is damaged.
      const words = problem.signal || problem.id === "research.serverDown" ? researchWords(problem) : say("public.cantBuild");
      fill(groups, h("alert-banner", { variant: problem.signal ? "info" : "warning", role: "alert" }, h("p", { text: words }), forHelper(problem.details)));
    } else {
      paint(boundary.value?.manifest || boundary.value, postPaths);
      if (checkedAgain) counts.textContent = `${say("public.checked")} ${boundaryCountsText(boundary.value?.manifest || boundary.value)}`;
    }
    loadChecks();
  }

  return { title: say("public.tab"), element, load, reload: load, focus: () => heading.focus(), palette: [], keys: [], command: () => {} };
}
