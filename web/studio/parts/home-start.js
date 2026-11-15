// Home's lines about Getting started (Studio R9b): the card that takes her back to the step she
// left, a recording of a story still kept on this phone, and, for whoever helps with the site,
// where every account stands with "Show it again at next sign-in". Home never shows a failure
// here; the details say theirs in a sentence. Nothing here holds a story: rows are counts and dates.
import { fill, h } from "./dom.js";
import { say } from "./words.js";
import { innerAria } from "./inner-button.js";
import { createDidLine } from "./did-line.js";
import { homeCard, modeLine, startProblem, stepRoute } from "./onboarding-rules.js";
import { hasRecording } from "./story-store.js";

export function homeStart({ api, meta }) {
  const card = h("div", { class: "studio-home-start-card" });
  const kept = h("div", { class: "studio-home-story-kept" });
  const details = h("div", { class: "studio-home-start-details" });
  const element = h("div", { class: "studio-home-start-lines" }, card, kept, details);
  // One line for what a reset did; it outlives the list being drawn again.
  const said = createDidLine();

  function paintCard() {
    const at = homeCard(meta.onboarding);
    if (!at) { fill(card); return; }
    const headingId = "studio-home-start-h";
    fill(card, h("section", { class: "studio-comment studio-home-voice-card", "aria-labelledby": headingId },
      h("h3", { id: headingId, text: say("home.startCardHeading") }),
      h("p", { text: say("home.startCardText", { n: at.n, total: at.total, step: at.name }) }),
      h("div", { class: "studio-comment-actions" }, h("action-button", { href: stepRoute(at.step) }, say("home.startCardGo")))));
  }

  async function paintKept() {
    const has = await hasRecording(api.user).catch(() => false);
    fill(kept, has ? h("content-card", { heading: say("home.storyKept") }, h("action-button", { variant: "secondary", href: stepRoute("stories") }, say("home.storyKeptOpen"))) : null);
  }

  function row(account, said, reload) {
    const button = h("action-button", { variant: "secondary", size: "sm", onClick: async () => {
      button.loading = true;
      let reply;
      try {
        reply = await api.post("onboarding/reset", { user: account.user });
      } catch (error) {
        button.loading = false;
        if (error?.status === 401) throw error;
        said.tell(startProblem(error).code === "unknown-user" ? say("start.resetGone") : say("start.resetFailed"), { variant: "problem" });
        return;
      }
      button.loading = false;
      await reload();
      const was = reply?.record;
      said.tell(say("start.shownAgain", { user: account.user }), was ? { undoLabel: say("start.shownAgainUndo"), focus: true, undo: async () => {
        try {
          await api.put("onboarding/restore", { user: account.user, record: was });
        } catch (error) {
          if (error?.status === 401) throw error;
          said.tell(say("start.resetFailed"), { variant: "problem" });
          return;
        }
        await reload();
        said.tell(say("start.shownAgainUndone", { user: account.user }));
      } } : {});
    } }, say("start.showAgain"));
    innerAria(button, { "aria-label": say("start.showAgainName", { user: account.user }) });
    // The server's line: a name, where they stand, counts and dates. Placed as text.
    return h("li", { class: "studio-start-account" }, h("bdi", { class: "studio-mono", text: String(account.line || account.user) }), account.status === "not-started" ? null : button);
  }

  async function paintDetails() {
    let accounts;
    try {
      accounts = await api.get("onboarding/accounts");
    } catch {
      fill(details);
      return;
    }
    const rows = Array.isArray(accounts.accounts) ? accounts.accounts : [];
    // Nothing to say on a site that never used it.
    if (accounts.mode === "off" && !(accounts.problems || []).length && !rows.some((account) => account.status !== "not-started")) { fill(details); return; }
    const line = modeLine(accounts);
    const open = details.querySelector("details")?.open === true;
    fill(details, h("details", { class: "studio-help studio-start-details", open },
      h("summary", { text: say("common.forHelper") }),
      h("h3", { class: "studio-start-details-h", text: say("start.detailsHeading") }),
      h("p", { text: line.words }),
      line.problems.map((problem) => h("p", { class: "studio-mono", text: say("start.problemMode", { problem }) })),
      accounts.filesMayVanish === true ? h("p", { text: say("start.filesReset") }) : null,
      h("ul", { class: "studio-start-accounts" }, rows.map((account) => row(account, said, paintDetails))),
      h("p", { text: say("start.resetKeeps") }),
      said.element));
  }

  async function load() {
    paintCard();
    if (!meta.onboarding) return;
    paintKept();
    paintDetails();
  }

  return { element, load, owns: () => Boolean(meta.onboarding) && meta.onboarding.mode !== "off" };
}
