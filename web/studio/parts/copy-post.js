// Copy it for another blog (Write › More): the post as it will go to Medium, Ghost, Hashnode, DEV,
// WordPress, a web page or plain words, made by the server from what's on her screen (`POST
// preview`), with Copy and Download, the differences there in her words, and, for the person who
// set up the site, the engine's findings and "Mark as checked". Nothing here saves the post. The
// web-page copy shows in a sandboxed frame with no same-origin; everything else is text. Studio R5.
import { h, toast } from "./dom.js";
import { use } from "../zubra.js";
import {
  DESTINATIONS, checkedState, differenceHeading, differences, downloadName, htmlFrame, portabilityAcknowledgementScope,
  portabilityGroups, portableDiagnosticsForDisplay, portablePreviewArtifact, previewDestinationPolicy,
} from "./portable-rules.js";

/**
 * `post()` → { path, kind, fields (as a save would send them), body, title, slug, credits, unsent };
 * `goTo(range)` puts her in her words at a difference.
 */
export async function createCopyPost({ api, post, goTo }) {
  await use("side-sheet", "select-field", "action-button", "alert-banner", "loading-spinner");
  let preview = null;
  let asked = 0;
  let opener = null;
  let onClose = null;
  const mode = h("select-field", { label: "Where to", options: DESTINATIONS.map(({ value, label }) => ({ value, label })), value: DESTINATIONS[0].value, onValuechange: () => show() });
  const note = h("div");
  const shown = h("div", { class: "studio-copy-shown" });
  const diff = h("div", { class: "studio-copy-diff" });
  const more = h("details", { class: "studio-help studio-copy-details" });
  const copy = h("action-button", { slot: "actions", disabled: true, onClick: () => copyIt() }, "Copy");
  const download = h("action-button", { slot: "actions", variant: "secondary", disabled: true, onClick: () => downloadIt() }, "Download");
  const element = h("side-sheet", { label: "Copy it for another blog", side: "right", class: "studio-about-sheet studio-copy-sheet" },
    h("span", { slot: "heading", tabindex: "-1", text: "Copy it for another blog" }),
    h("div", { class: "studio-about-body" }, mode, note, shown, diff, more), download, copy);
  // Closed by Escape or the × (openchange), or from here (setting `open` fires no openchange).
  element.addEventListener("openchange", (event) => {
    if (event.target !== element || event.detail) return;
    finish();
  });
  let shownNow = false;
  function finish() {
    if (!shownNow) return;
    shownNow = false;
    const back = opener;
    opener = null;
    const after = onClose;
    onClose = null;
    after?.();
    if (back?.isConnected) requestAnimationFrame(() => (back.querySelector?.("button, a") || back).focus?.());
  }

  const destination = () => DESTINATIONS.find((d) => d.value === mode.value) || DESTINATIONS[0];

  async function load() {
    const turn = ++asked;
    preview = null;
    copy.disabled = true;
    download.disabled = true;
    shown.replaceChildren(h("loading-spinner", { label: "Getting it ready…", inline: true }), h("span", { text: " Getting it ready…" }));
    diff.replaceChildren();
    const p = post();
    try {
      const reply = await api.post("preview", { kind: "posts", path: p.path, fields: p.fields, body: p.body, ...(p.credits !== undefined ? { credits: p.credits, creditEtag: p.creditEtag ?? null } : {}) });
      if (turn !== asked) return;
      preview = reply;
      show();
    } catch (error) {
      if (turn !== asked) return;
      shown.replaceChildren(h("alert-banner", { variant: "warning", heading: "It can't be copied right now" },
        "Something in this post stops your blog from making the copy. Tell the person who set up your site.",
        h("p", { class: "studio-detail", text: error.message || "" }),
        h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again")));
      more.replaceChildren();
    }
  }

  function show() {
    const p = post();
    const d = destination();
    note.replaceChildren(
      p.unsent ? h("p", { class: "studio-help", text: "This copies what's on your screen, including changes not on your site yet." }) : null,
      d.value === "destination:medium" ? h("p", { class: "studio-help", text: "Medium can't take it directly. In Medium choose Import a story, or paste this in." }) : null);
    if (!preview) return;
    const artifact = portablePreviewArtifact(preview, d.value);
    copy.disabled = !artifact;
    download.disabled = !artifact;
    if (!artifact) {
      shown.replaceChildren(h("alert-banner", { variant: "warning", heading: "That one isn't ready" }, "Your blog can't make a copy for it right now. Try another, or tell the person who set up your site."));
    } else if (artifact.extension === "html") {
      // A sandbox with scripts and no same-origin: the copy can't reach Studio or the session.
      const frame = h("iframe", { class: "studio-copy-frame", title: "What will be copied", sandbox: "allow-scripts" });
      frame.srcdoc = htmlFrame(p.title, artifact.content);
      shown.replaceChildren(frame);
    } else {
      shown.replaceChildren(h("pre", { class: "studio-copy-text", tabindex: "0", "aria-label": "What will be copied", text: artifact.content }));
    }
    const lines = differences(preview, d.value);
    diff.replaceChildren(
      h("p", { class: "studio-label", text: differenceHeading(lines.length) }),
      lines.length ? h("ul", { class: "studio-checks" }, lines.map((line) => h("li", {}, line.words, " ",
        line.range ? h("action-button", { variant: "link", onClick: () => { opener = null; element.open = false; finish(); requestAnimationFrame(() => goTo?.(line.range)); } }, "Go to it") : null))) : null);
    drawDetails(d);
  }

  function drawDetails(d) {
    const portable = preview?.portablePreview;
    const scope = portabilityAcknowledgementScope(portable?.destinations, d.value);
    const policy = previewDestinationPolicy(portable?.destinations, d.value);
    const findings = portabilityGroups(preview, d.value).flatMap((group) => group.diagnostics.map((diagnostic) => {
      const said = h("span", { class: "studio-help", "aria-live": "polite" });
      const state = scope && diagnostic.capabilityId && diagnostic.severity === "warning" && portable?.sourceRevision ? checkedState(portable, scope, diagnostic) : "";
      const mark = state && state !== "checked"
        ? h("action-button", { variant: "secondary", size: "sm", onClick: (e) => markChecked(e.currentTarget, diagnostic, scope, said) }, "Mark as checked") : null;
      return h("li", {},
        h("span", { class: "studio-detail", text: `${group.capabilityId} · ${group.level} · ${group.representation} · ${group.destination}` }), " ",
        portableDiagnosticsForDisplay([diagnostic])[0] || diagnostic.message || "", " ",
        state === "checked" ? h("span", { class: "studio-help", text: "Marked as checked for this version." }) : null,
        state === "stale" ? h("span", { class: "studio-help", text: "Checked for an earlier version; check again." }) : null,
        mark, said);
    }));
    const plan = (portable?.destinationTagPlans || []).find((p) => p?.policy?.version === 1 && `destination:${p.policy.provider}` === d.value);
    more.replaceChildren(h("summary", { text: "Details for the person who set up your site" }),
      h("dl", { class: "studio-details" },
        h("dt", { text: "Representation" }), h("dd", { class: "studio-mono", text: policy?.representation || d.value }),
        policy ? [h("dt", { text: "Destination policy" }), h("dd", { text: [policy.canonicalBehavior, policy.workflow, policy.conversionReview].filter(Boolean).join(" ") })] : null,
        plan ? [h("dt", { text: "Tags" }), h("dd", { text: `Sent: ${(plan.tags || []).join(", ") || "(none)"}. Left out: ${(plan.omittedTags || []).join(", ") || "(none)"}.` })] : null,
        h("dt", { text: "Source revision" }), h("dd", { class: "studio-mono", text: portable?.sourceRevision || "—" })),
      findings.length ? h("ul", { class: "studio-checks" }, findings) : h("p", { text: "No findings." }));
  }

  async function markChecked(button, diagnostic, scope, said) {
    const portable = preview.portablePreview;
    button.loading = true;
    try {
      const result = await api.post("portability/acknowledge", {
        path: post().path, sourceRevision: portable.sourceRevision, capabilityId: diagnostic.capabilityId,
        representation: scope.representation, destination: scope.destination, expectedEtag: portable.acknowledgementEtag,
      });
      portable.acknowledgements = result.acknowledgements;
      portable.acknowledgementEtag = result.etag;
      drawDetails(destination());
      toast("Marked as checked for this version.");
    } catch (error) {
      button.loading = false;
      if (error.status === 409) { said.textContent = "Changed on another computer; showing it again."; await load(); return; }
      said.textContent = `Not marked: ${error.message || "try again"}.`;
    }
  }

  async function copyIt() {
    const artifact = portablePreviewArtifact(preview, destination().value);
    if (!artifact) return;
    try {
      await navigator.clipboard.writeText(artifact.content);
      toast(destination().value.startsWith("destination:") ? `Copied. Paste it into ${destination().name}.` : "Copied. Paste it wherever you need it.");
    } catch {
      toast("Select the words and copy them.", { variant: "warning" });
      shown.querySelector("pre, iframe")?.focus();
    }
  }

  function downloadIt() {
    const artifact = portablePreviewArtifact(preview, destination().value);
    if (!artifact) return;
    const url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mime }));
    try {
      const link = h("a", { href: url, download: downloadName(post().slug, artifact.extension), hidden: true });
      document.body.append(link);
      link.click();
      link.remove();
      toast("Downloaded.");
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  return {
    element,
    open({ from = document.activeElement, closed = null } = {}) {
      opener = from;
      onClose = closed;
      if (!element.isConnected) document.body.append(element);
      more.open = false;
      element.open = true;
      shownNow = true;
      load();
      requestAnimationFrame(() => mode.querySelector("select")?.focus());
    },
    close() { element.open = false; finish(); },
    get isOpen() { return element.open; },
  };
}
