// How the whole site is doing, for Home: in one calm line when all is well, and a card that says what
// needs her (and the one thing to do) when it isn't: the site couldn't be updated last time, changes
// are waiting to go out, or this server doesn't keep its files. The person who set up the site gets
// the particulars under a details line. Studio slice 5.
import { h, toast } from "./dom.js";
import { wentOutWords } from "./publish.js";
import { sayWhen } from "./dates.js";

/** What needs attention, from `GET status` and `GET publish`, in her words. Pure; exported for tests. */
export function needs(status, publish) {
  const out = [];
  if (status?.lastError) out.push({ id: "build", words: "Your site couldn't be updated last time. Your work is saved.", action: "Try again" });
  const waiting = (publish?.changed || []).length;
  if (publish?.repo && publish.remote && !publish.auto && (waiting || publish.ahead > 0)) {
    out.push({ id: "send", words: waiting === 1 ? "1 change is saved here but isn't on your public site yet." : waiting ? `${waiting} changes are saved here but aren't on your public site yet.` : "Some saved changes aren't on your public site yet.", action: "Put them on my site" });
  }
  if (status?.filesMayVanish || publish?.filesMayVanish) out.push({ id: "vanish", words: "This server doesn't keep its files when it restarts. Ask the person who set up your site to fix that." });
  return out;
}

export function siteHealth({ api, meta }) {
  const element = h("section", { class: "studio-section studio-health", "aria-labelledby": "studio-health-h" });
  let status = null;
  let publish = null;

  function draw() {
    const list = needs(status, publish);
    const more = h("details", { class: "studio-help" },
      h("summary", { text: "For the person who set up your site" }),
      h("dl", { class: "studio-details" },
        ...row("Last updated", status?.lastBuilt ? `${sayWhen(status.lastBuilt)} (${status.lastBuilt})` : "Not since this server started"),
        ...(status?.lastError ? row("Last problem", status.lastError) : []),
        ...row("Next scheduled post", status?.nextDue || "None"),
        ...(publish?.repo ? [
          ...row("Branch", `${publish.branch || "?"} → ${publish.remote || "no remote"}`),
          ...row("Sends itself out", publish.auto ? "Yes, after each save" : "No, Studio sends it"),
          ...row("Waiting to send", (publish.changed || []).join(", ") || "Nothing"),
          ...row("Ahead / behind", `${publish.ahead || 0} / ${publish.behind || 0}`),
        ] : row("Sending out", "No repository here, so nothing is sent out"))),
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

  function row(name, value) {
    return [h("dt", { text: name }), h("dd", { class: "studio-mono", text: String(value) })];
  }

  async function act(id) {
    if (id === "build") return rebuild();
    if (id === "send") {
      try {
        const reply = await api.post("publish", { summary: "Send out what's waiting" });
        const said = wentOutWords({ sent: reply.pushed ? "pushed" : "failed", message: reply.message || "" }, { meta, action: "saved" });
        toast(reply.pushed ? "Done. Your readers will see the changes in a few minutes." : said.words, { variant: reply.pushed ? "success" : "warning", duration: reply.pushed ? undefined : 0 });
      } catch {
        toast("They didn't go out. Your work is saved; try again in a minute.", { variant: "warning", duration: 0 });
      }
      await load();
    }
  }

  async function rebuild() {
    try {
      await api.post("rebuild", {});
      toast("Your site is up to date.");
    } catch {
      toast("Your site couldn't be updated. Your work is saved. Let the person who set up your site know.", { variant: "warning", duration: 0 });
    }
    await load();
  }

  async function load() {
    status = await api.get("status").catch(() => null);
    publish = await api.get("publish").catch(() => null);
    draw();
  }

  return { element, load, needs: () => needs(status, publish) };
}
