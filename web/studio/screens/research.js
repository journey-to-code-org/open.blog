// Research home (Studio R11, #/research): "Where is my research, and what's next?" The steps from a
// source to a cited post, each with where it stands and the way in; the one primary action is the
// first step not done. Everything here is private, and says so. With nothing kept yet it invites
// the first source. Each store is read on its own, so one that can't be read never hides the other.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { workflowSteps } from "../parts/research-rules.js";
import { forHelper, guardUnload, leaveResearch, rememberPost, researchFrame, researchPost } from "../parts/research-ui.js";

export async function createResearchHome(context, route = {}) {
  const { api } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "select-field", "skeleton-block", "status-badge");
  guardUnload();
  if (route.query?.from) rememberPost({ path: route.query.from, title: route.query.title || "" });
  const frame = researchFrame({ screen: "overview", go: (hash) => context.go(hash) });
  const heading = h("h2", { id: "studio-research-h", class: "studio-question", tabindex: "-1", text: say("research.title") });
  const lede = h("p", { class: "studio-lede", hidden: true, text: say("research.ledeEmpty") });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const primary = h("div", { class: "studio-research-primary" });
  const steps = h("ol", { class: "studio-research-steps", "aria-busy": "true" }, h("li", {}, h("skeleton-block", { lines: 3 })));
  const details = h("div");
  const element = h("section", { class: "studio-page studio-research-home", "aria-labelledby": "studio-research-h" },
    frame.element, heading, lede, banner, primary, steps, h("p", { class: "studio-help", text: say("research.privateLine") }), details);

  const badge = (visibility) => h("status-badge", { variant: visibility === "readers" ? "success" : "neutral" }, visibility === "readers" ? say("research.readersSee") : say("research.private"));

  async function load() {
    frame.paintKept();
    frame.paintBack();
    const [library, notebook, atlas, alignments] = await Promise.allSettled([api.get("sources"), api.get("research/notebook"), api.get("research/atlas"), api.get("research/alignments")]);
    for (const result of [library, notebook, atlas, alignments]) if (result.status === "rejected" && result.reason?.status === 401) throw result.reason;
    const atlasData = atlas.status === "fulfilled" ? atlas.value : { failed: true };
    const alignmentsData = alignments.status === "fulfilled" ? alignments.value : { failed: true };
    const libraryData = library.status === "fulfilled" ? library.value : { failed: true, error: library.reason };
    const notebookData = notebook.status === "fulfilled" ? notebook.value : { failed: true, error: notebook.reason };
    const plan = workflowSteps({ library: libraryData, notebook: notebookData, atlas: atlasData, alignments: alignmentsData, post: researchPost() });
    heading.textContent = plan.empty ? say("research.titleEmpty") : say("research.title");
    lede.hidden = !plan.empty;
    fill(primary, h("action-button", { href: plan.primary.href, size: "lg", class: "studio-primary" }, plan.primary.label));
    steps.removeAttribute("aria-busy");
    fill(steps, ...plan.steps.map((step, index) => h("li", { class: "studio-research-step", "data-step": step.id },
      h("div", { class: "studio-research-step-head" }, h("span", { class: "studio-research-step-n", "aria-hidden": "true", text: String(index + 1) }),
        h("h3", { text: step.heading }), badge(step.visibility)),
      h("p", { text: step.text }),
      step.state ? h("p", { class: "studio-meta", text: step.state }) : null,
      step.optional ? h("p", { class: "studio-help", text: say("research.optional") }) : null,
      step.links ? h("div", { class: "studio-row" }, step.links.map((link) => h("action-button", { variant: "secondary", href: link.href }, link.label)))
        : step.id === plan.primary.step ? null : h("action-button", { variant: "secondary", href: step.open.href }, step.open.label))));
    const problems = [];
    for (const [data, what, file] of [[libraryData, say("research.whatLibrary"), ".openblog/private/research/sources.json"], [notebookData, say("research.whatNotebook"), ".openblog/private/research/notebook.json"]]) {
      if (!data.failed) continue;
      const error = data.error;
      const signal = !error?.status;
      problems.push(h("alert-banner", { variant: signal ? "info" : "warning", role: signal ? null : "alert" },
        h("p", { text: signal ? say("research.noSignal") : `${say("research.unreadable", { what })} ${say("common.tell")}` }),
        signal ? h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, say("research.tryAgain"))
          : forHelper(file, `${error?.data?.code || error?.status || ""}: ${(error?.data?.diagnostics || [])[0]?.code || ""} ${(error?.data?.diagnostics || [])[0]?.field || ""}`, error?.data?.error || error?.message || "", say("research.detailsRepair"))));
    }
    fill(banner, ...problems);
    const counts = (list) => ({ active: (list || []).filter((x) => !x.archived).length, archived: (list || []).filter((x) => x.archived).length });
    fill(details, forHelper(
      libraryData.failed ? null : say("research.detailsFile", { file: String(libraryData.file || ""), revision: String(libraryData.revision || "—") }),
      libraryData.failed ? null : say("research.detailsCounts", counts(libraryData.sources)),
      notebookData.failed ? null : say("research.detailsFile", { file: String(notebookData.file || ""), revision: String(notebookData.revision || "—") }),
      notebookData.failed ? null : say("research.detailsCounts", counts([...(notebookData.passages || []), ...(notebookData.notes || [])])),
    ));
  }

  return {
    title: say("research.nav"),
    element,
    load,
    reload: load,
    focus: () => heading.focus(),
    leave: () => leaveResearch({ dirty: () => false, keep: () => {} }),
    isDirty: () => false,
  };
}
