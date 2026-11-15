// Join (Studio R14a, #/together/join): saying yes to an invitation. The token was taken out of the
// address by studio.js before any request (parts/join-rules.js) and lives only here, in memory:
// never in storage, a log, a toast or details; a reload loses it, and the page says to open the
// link again. Someone new chooses a password on a page of its own, before Studio opens; someone
// who already signs in says yes from inside Studio.
import { fill, h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { ask } from "../parts/dialogs.js";
import { joinProblem } from "../parts/join-rules.js";

const JOIN = "collaboration/invitations/join";
let held = "";

/** Keep the token in memory (studio.js, once, before anything else runs). */
export function holdJoinToken(token) {
  held = String(token || "");
}

/** The sign-in form's first line when the invitation is for an account that already signs in. */
export const signInFirstWords = (name) => say("join.signInFirst", { name });

/** Whether a token is waiting to be used. */
export const hasJoinToken = () => Boolean(held);

/** What the invitation is: `{ title, question, invitedBy, forName, newAccount, signInName, ... }`. */
export async function readInvitation(api) {
  return api.call("GET", JOIN, { headers: { "X-Openblog-Invitation": held }, retry: false });
}

function invitationFacts(view) {
  const title = view.title || view.question || say("together.untitled");
  const writes = (view.roles || []).includes("contributor");
  return [
    h("p", { text: view.invitedBy ? say("join.invitedYou", { name: view.invitedBy }) : say("join.someoneInvited") }),
    h("p", { class: "studio-question studio-join-title" }, h("bdi", { class: "studio-stranger", text: title })),
    view.title && view.question ? h("p", { class: "studio-lede" }, h("bdi", { class: "studio-stranger", dir: "auto", text: view.question })) : null,
    h("p", { text: writes ? say("join.youWrite", { name: view.forName }) : say("join.youRead", { name: view.forName }) }),
  ];
}

async function decline(api, problem) {
  const choice = await ask({ heading: say("join.noThanksAsk"), text: say("join.noThanksText"),
    choices: [{ label: say("join.noThanksBack"), value: "back" }, { label: say("join.noThanksGo"), value: "go", variant: "secondary" }] });
  if (choice !== "go") return false;
  try {
    await api.call("POST", JOIN, { json: { token: held, decline: true }, retry: false });
    held = "";
    return true;
  } catch (error) {
    problem(joinProblem(error));
    return false;
  }
}

/**
 * The page for someone new, before Studio opens: choose a password and say yes. Resolves with the
 * reflection's id once they are in (and signed in), or null after No thanks.
 */
export async function showJoinPage(root, api, view) {
  await use("text-field", "action-button", "alert-banner");
  return new Promise((resolve) => {
    const problem = h("div", { class: "studio-problem", "aria-live": "assertive" });
    const tell = (words) => problem.replaceChildren(h("alert-banner", { variant: "danger" }, words));
    const password = h("text-field", { label: say("join.password"), type: "password", autocomplete: "new-password", description: say("join.passwordHelp"), required: true });
    const again = h("text-field", { label: say("join.passwordAgain"), type: "password", autocomplete: "new-password", required: true });
    const yes = h("action-button", { type: "submit", size: "lg" }, say("join.sayYes"));
    const no = h("action-button", { variant: "secondary", onClick: async () => {
      if (await decline(api, tell)) { fill(form, h("h1", { class: "studio-title", text: say("join.title") }), h("p", { role: "status", text: say("join.declined") })); resolve(null); }
    } }, say("join.noThanks"));
    const form = h("form", { class: "studio-signin-form", "aria-labelledby": "studio-join-h", novalidate: true },
      h("h1", { id: "studio-join-h", class: "studio-title", text: say("join.title") }),
      ...invitationFacts(view),
      h("p", { class: "studio-help", text: say("join.signInNameIs", { name: view.signInName }) }),
      // The sign-in name, for password managers to save beside the new password.
      h("input", { type: "text", name: "username", autocomplete: "username", value: view.signInName, hidden: true, readonly: true }),
      problem, password, again, h("div", { class: "studio-row" }, no, yes));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      password.error = ""; again.error = "";
      const chosen = String(password.value || "");
      if ([...chosen].length < 12) { password.error = say("join.passwordShort"); password.querySelector("input")?.focus(); return; }
      if (chosen !== String(again.value || "")) { again.error = say("join.passwordsDiffer"); again.querySelector("input")?.focus(); return; }
      yes.loading = true;
      try {
        const reply = await api.call("POST", JOIN, { json: { token: held, password: chosen }, retry: false });
        held = "";
        api.csrf = reply.csrf;
        api.user = reply.user;
        resolve(reply.publicationId);
      } catch (error) {
        if (error.data?.code === "password") { password.error = say("join.passwordShort"); password.querySelector("input")?.focus(); }
        else tell(joinProblem(error));
      } finally {
        yes.loading = false;
      }
    });
    root.replaceChildren(h("main", { class: "studio-signin" }, h("p", { class: "studio-brand", text: rememberedSiteName() }), form));
    document.title = say("join.title");
    requestAnimationFrame(() => password.querySelector("input")?.focus());
  });
}

/** A link that doesn't work, before Studio opens: one sentence, and signing in is still there. */
export async function showJoinRefused(root, words, onSignIn) {
  await use("action-button", "alert-banner");
  root.replaceChildren(h("main", { class: "studio-signin" }, h("p", { class: "studio-brand", text: rememberedSiteName() }),
    h("h1", { class: "studio-title", text: say("join.title") }), h("alert-banner", { variant: "info" }, words),
    h("action-button", { variant: "secondary", onClick: onSignIn }, say("join.signIn"))));
}

function rememberedSiteName() {
  try { return localStorage.getItem("studio:site-name") || ""; } catch { return ""; }
}

/** Join inside Studio, signed in: Say yes or No thanks. */
export async function createTogetherJoin(context) {
  const { api } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "skeleton-block");
  const heading = h("h2", { id: "studio-join-in-h", class: "studio-question", tabindex: "-1", text: say("join.title") });
  const host = h("div", { "aria-busy": "true" }, h("skeleton-block", { lines: 4 }));
  const problem = h("div", { "aria-live": "assertive" });
  const tell = (words) => problem.replaceChildren(h("alert-banner", { variant: "danger" }, words));
  const element = h("section", { class: "studio-page", "aria-labelledby": "studio-join-in-h" },
    h("breadcrumb-trail", { items: [{ label: say("together.nav"), href: "#/together" }, { label: say("join.title"), href: "" }] }), heading, problem, host);

  async function load() {
    if (!held) { fill(host, h("alert-banner", { variant: "info" }, say("join.reopen"))); host.removeAttribute("aria-busy"); return; }
    let view;
    try {
      view = await readInvitation(api);
    } catch (error) {
      host.removeAttribute("aria-busy");
      fill(host, h("alert-banner", { variant: "info" }, joinProblem(error)));
      return;
    }
    host.removeAttribute("aria-busy");
    if (view.signInName !== api.user) {
      fill(host, h("alert-banner", { variant: "warning" }, say("join.wrongPerson", { name: view.signInName })),
        h("action-button", { variant: "secondary", onClick: () => signOut() }, say("join.signOut")));
      return;
    }
    const yes = h("action-button", { onClick: async () => {
      yes.loading = true;
      try {
        await api.post("collaboration/invitations/accept", { token: held, contributorId: view.contributorId });
        held = "";
        toast(say("join.joined"));
        await context.refreshMeta?.();
        context.go(`#/together/${encodeURIComponent(view.publicationId)}`);
      } catch (error) {
        if (error.status === 401) throw error;
        tell(joinProblem(error));
      } finally {
        yes.loading = false;
      }
    } }, say("join.sayYes"));
    const no = h("action-button", { variant: "secondary", onClick: async () => {
      try {
        if (!(await askDecline())) return;
        await api.post("collaboration/invitations/decline", { token: held });
        held = "";
        toast(say("join.declined"));
        context.go("#/together");
      } catch (error) {
        if (error.status === 401) throw error;
        tell(joinProblem(error));
      }
    } }, say("join.noThanks"));
    fill(host, ...invitationFacts(view), h("div", { class: "studio-row" }, no, yes));
  }

  async function askDecline() {
    const choice = await ask({ heading: say("join.noThanksAsk"), text: say("join.noThanksText"),
      choices: [{ label: say("join.noThanksBack"), value: "back" }, { label: say("join.noThanksGo"), value: "go", variant: "secondary" }] });
    return choice === "go";
  }

  async function signOut() {
    try { localStorage.removeItem("studio:last-start"); } catch { /* nothing kept */ }
    await api.signOut();
    location.reload();
  }

  return { title: say("join.title"), element, load, focus: () => heading.focus() };
}
