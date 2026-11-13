// Sign in: two fields and a button. Used for the first visit and, inside a dialog, when a session
// runs out mid-save (the save finishes once she's back in).
import { h } from "../parts/dom.js";
import { use } from "../zubra.js";

const SAYS = {
  401: "That name and password don't match. Check them and try again.",
  429: "Too many tries. Wait a minute, then try again.",
  0: "Studio can't reach your site. Check it's running, then try again.",
};

/** The sign-in form; `onDone` runs after a successful sign-in. */
export async function signInForm(api, { onDone, heading = "Sign in", intro = "" } = {}) {
  await use("text-field", "action-button", "alert-banner");
  const problem = h("div", { class: "studio-problem", "aria-live": "assertive" });
  const name = h("text-field", { label: "Your name", name: "username", autocomplete: "username", required: true });
  const password = h("text-field", { label: "Password", name: "password", type: "password", autocomplete: "current-password", required: true });
  const button = h("action-button", { type: "submit", size: "lg" }, "Sign in");
  const form = h("form", { class: "studio-signin-form", "aria-labelledby": "studio-signin-heading", novalidate: true },
    h("h1", { id: "studio-signin-heading", class: "studio-title", text: heading }),
    intro ? h("p", { class: "studio-lede", text: intro }) : null,
    problem, name, password, button,
    h("p", { class: "studio-help", text: "Forgot it? Ask the person who set up your site." }),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = String(name.value || "").trim();
    if (!username || !password.value) {
      problem.replaceChildren(h("alert-banner", { variant: "danger", heading: "Fill in both boxes" }, "Your name and your password are both needed."));
      (username ? password : name).querySelector("input")?.focus();
      return;
    }
    button.loading = true;
    try {
      await api.signIn(username, password.value);
      problem.replaceChildren();
      await onDone?.();
    } catch (error) {
      const words = SAYS[error.status] || error.message;
      problem.replaceChildren(h("alert-banner", { variant: "danger", heading: "Not signed in" }, words));
      password.value = "";
      password.querySelector("input")?.focus();
    } finally {
      button.loading = false;
    }
  });
  return form;
}

/** The whole-page sign-in; resolves once signed in. */
export function showSignIn(root, api, options = {}) {
  return new Promise((resolve) => {
    signInForm(api, { ...options, onDone: resolve }).then((form) => {
      document.title = "Sign in · Studio";
      root.replaceChildren(h("main", { class: "studio-signin" },
        h("p", { class: "studio-brand", text: "Studio" }),
        form));
      form.querySelector("input")?.focus();
    });
  });
}
