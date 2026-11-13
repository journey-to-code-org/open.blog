// "About this post": the facts for whoever set up the site. Which file, its web address, whether the
// last save kept the file as written, and where the last publish went.
import { h } from "./dom.js";

const row = (label, value, mono = false) => [h("dt", { text: label }), h("dd", { class: mono ? "studio-mono" : null }, value || "—")];

/** The details list. `link` is the post's address on the site ("" before it's published). */
export function postDetails({ path, link, words, savedAt, layout, publish, goesOut }) {
  const sending = publish
    ? [publish.message, publish.commit ? `commit ${String(publish.commit).slice(0, 12)}` : "", publish.sent === "pushed" ? "pushed" : publish.sent === "failed" ? "not pushed" : ""].filter(Boolean).join(" · ")
    : !goesOut ? "Not known"
      : goesOut.kind === "none" ? "This site isn't set up to send posts out; they stay on its server."
        : goesOut.kind === "auto" ? "Your site sends itself out after each save."
          : "Studio sends your site out when you publish.";
  return h("dl", { class: "studio-details" },
    row("File", path ? `content/${path}` : "Not saved yet", true),
    row("Web address", link ? h("a", { href: link, target: "_blank", rel: "noopener", class: "studio-mono", text: link }) : "Not published yet"),
    row("Words", String(words)),
    row("Last saved", savedAt ? savedAt.toLocaleString() : "Not in this visit"),
    ...(layout ? row("File kept as written", layout.kept ? "Yes: only what you changed was written." : `No, it was written in the usual layout, because ${layout.reason || "it couldn't be kept"}.`) : []),
    row(publish ? "Last send-out" : "Sending out", sending),
    ...(publish?.committed?.length ? row("Sent with it", publish.committed.join(", "), true) : []),
    row("Scheduled posts", "go up when your site next builds after their time."));
}

/** Her own words, set aside after she chose the other version in a conflict. */
export function mineAside(mine, onCopy) {
  const text = `${mine.title}\n\n${mine.body}`;
  return h("alert-banner", { variant: "info", heading: "Your version" },
    h("p", { text: "Here's what you had, so you can take back anything you need." }),
    h("pre", { class: "studio-mine", text }),
    h("action-button", { variant: "secondary", onClick: () => onCopy(text) }, "Copy my words"));
}

/** "You have changes that aren't on your site yet" / "You have words from last time". */
export function keptBanner(fresh, { restore, drop }) {
  return fresh
    ? h("alert-banner", { variant: "info", heading: "You have words from last time" },
      "You started writing here before and left without saving.",
      h("cluster-layout", { gap: "0.5rem" },
        h("action-button", { onClick: restore }, "Put them back"),
        h("action-button", { variant: "secondary", onClick: drop }, "Start fresh")))
    : h("alert-banner", { variant: "info", heading: "You have changes that aren't on your site yet" },
      "You changed this post on this device and didn't press Update.",
      h("cluster-layout", { gap: "0.5rem" },
        h("action-button", { onClick: restore }, "Put my changes back"),
        h("action-button", { variant: "secondary", onClick: drop }, "Use what's on the site")));
}
