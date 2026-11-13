// An old Admin address for something Studio doesn't do yet (research, voice, jobs...). It says so
// plainly and, until the old Admin is retired, opens that part of it. Retirement plan R0: each
// later slice gives its screen a real home, and R15 removes this screen with the old Admin.
import { h } from "../parts/dom.js";
import { use } from "../zubra.js";

const NAMES = {
  capture: "Jobs", comparisons: "Comparisons", contributors: "Contributors", design: "Design a theme",
  distribution: "Where your posts went", paths: "Reading paths",
  research: "Research", shared: "Writing together", voice: "Voice",
};

export async function createNotYet(_context, route) {
  await use("empty-state", "action-button");
  const name = NAMES[route.arg] || "That part of the Admin";
  const heading = h("h2", { id: "studio-not-yet-h", class: "studio-question", tabindex: "-1", text: `${name} isn't in Studio yet` });
  const element = h("section", { class: "studio-page", "aria-labelledby": "studio-not-yet-h" },
    heading,
    h("empty-state", { heading: "It's on its way" },
      "Until then it's in the old Admin, where you stay signed in.",
      h("action-button", { slot: "actions", href: `/admin/#/${encodeURIComponent(route.arg || "")}`, target: "_blank" }, `Open ${name} in the old Admin`),
      h("action-button", { slot: "actions", variant: "secondary", href: "#/" }, "Go to Home")));
  return { title: name, element, focus: () => heading.focus() };
}
