// How the whole site is doing, for Home: in one calm line when all is well, and a card that says what
// needs her (and the one thing to do) when it isn't: the site couldn't be updated last time, changes
// are waiting to go out, or this server doesn't keep its files. The person who set up the site gets
// the particulars under a details line. Studio slice 5.
import { h, toast } from "./dom.js";
import { wentOutWords } from "./publish.js";
import { sayWhen } from "./dates.js";
import { say, wordsInEffect } from "./words.js";

/** What needs attention, from `GET status` and `GET publish`, in her words. Pure; exported for tests. */
export function needs(status, publish) {
  const out = [];
  // Never an all-clear Studio couldn't check.
  if (!status && !publish) return [{ id: "unknown", words: "Studio couldn't check whether everything's on your site. Your work is saved; try again in a minute.", action: "Check again" }];
  if (status?.lastError) out.push({ id: "build", words: "Your site couldn't be updated last time. Your work is saved.", action: "Try again" });
  const waiting = (publish?.changed || []).length;
  if (publish?.repo && publish.remote && !publish.auto && (waiting || publish.ahead > 0)) {
    out.push({ id: "send", words: waiting === 1 ? "1 change is saved here but isn't on your public site yet." : waiting ? `${waiting} changes are saved here but aren't on your public site yet.` : "Some saved changes aren't on your public site yet.", action: "Put them on my site" });
  }
  if (status?.filesMayVanish || publish?.filesMayVanish) out.push({ id: "vanish", words: say("home.filesVanish") });
  return out;
}

export function siteHealth({ api, meta }) {
  const element = h("section", { class: "studio-section studio-health", "aria-labelledby": "studio-health-h" });
  let status = null;
  let publish = null;
  let lastProblem = ""; // the server's words from the last failed rebuild or send, for details

  function draw() {
    const list = needs(status, publish);
    const more = h("details", { class: "studio-help" },
      h("summary", { text: say("common.forHelper") }),
      h("dl", { class: "studio-details" },
        ...row("Last updated", status?.lastBuilt ? `${sayWhen(status.lastBuilt)} (${status.lastBuilt})` : "Not since this server started"),
        ...(status?.lastError ? row("Last problem", status.lastError) : []),
        ...(lastProblem ? row("Studio was told", lastProblem) : []),
        ...(!status ? row("Status", "Couldn't be read") : []),
        ...row("Next scheduled post", status?.nextDue || "None"),
        ...(publish?.repo ? [
          ...row("Branch", `${publish.branch || "?"} → ${publish.remote || "no remote"}`),
          ...row("Sends itself out", publish.auto ? "Yes, after each save" : "No, Studio sends it"),
          ...row("Waiting to send", (publish.changed || []).join(", ") || "Nothing"),
          ...row("Ahead / behind", `${publish.ahead || 0} / ${publish.behind || 0}`),
        ] : row("Sending out", "No repository here, so nothing is sent out"))),
      wordsPart(),
      h("action-button", { variant: "secondary", size: "sm", onClick: () => rebuild() }, "Rebuild the site now"));
    element.replaceChildren(
      h("h3", { id: "studio-health-h", text: "Your site" }),
      list.length
        ? h("ul", { class: "studio-health-list" }, list.map((item) => h("li", {},
          h("span", { text: item.words }),
          item.action ? h("action-button", { variant: "secondary", onClick: () => act(item.id) }, item.action) : null)))
        : h("p", { class: "studio-lede", text: "Everything you've saved is on your site." }),
      more);
  }

  // The site's own words (docs/studio-words.md): what changed, and what was dropped and why.
  function wordsPart() {
    const words = wordsInEffect(meta?.studioWords);
    if (!words) return null;
    return h("div", { class: "studio-health-words" },
      h("h4", { text: "Words" }),
      h("p", { text: words.summary }),
      words.changes.length ? h("ul", { class: "studio-mono" }, words.changes.map((line) => h("li", { text: line }))) : null,
      words.problems.length ? h("ul", { class: "studio-health-word-problems" }, words.problems.map((line) => h("li", { text: line }))) : null);
  }

  function row(name, value) {
    return [h("dt", { text: name }), h("dd", { class: "studio-mono", text: String(value) })];
  }

  async function act(id) {
    if (id === "build") return rebuild();
    if (id === "unknown") return load();
    if (id === "send") {
      try {
        const reply = await api.post("publish", { summary: "Send out what's waiting" });
        const said = wentOutWords({ sent: reply.pushed ? "pushed" : "failed", message: reply.message || "" }, { meta, action: "saved" });
        toast(reply.pushed ? "Done. Your readers will see the changes in a few minutes." : said.words, { variant: reply.pushed ? "success" : "warning", duration: reply.pushed ? undefined : 0 });
        lastProblem = reply.pushed ? "" : String(reply.message || "");
      } catch (error) {
        lastProblem = `${error.status || "no connection"}: ${error.message || ""}`;
        toast("They didn't go out. Your work is saved; try again in a minute. The details are under Your site.", { variant: "warning", duration: 0 });
      }
      await load();
    }
  }

  async function rebuild() {
    try {
      await api.post("rebuild", {});
      lastProblem = "";
      toast("Your site is up to date.");
    } catch (error) {
      lastProblem = `${error.status || "no connection"}: ${error.message || ""}`;
      toast(say("home.notUpdated"), { variant: "warning", duration: 0 });
    }
    await load();
  }

  async function load() {
    status = await api.get("status").catch(() => null);
    publish = await api.get("publish").catch(() => null);
    draw();
  }

  return { element, load, rebuild, needs: () => needs(status, publish) };
}
