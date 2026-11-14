// Add to Home Screen (Studio R3): a side sheet with the one way this phone or computer puts her blog
// on its Home Screen or installs it, only that way's steps, Add it when the browser can ask, the
// address with Copy where she has to switch to Safari or Chrome, and Mikey's details.
// docs/specs/studio/r3/ux.md, "Add to Home Screen".
import { h } from "./dom.js";
import { installPrompt } from "./install-state.js";
import { copiedWords, installSteps, installWay, promptOutcomeWords, sheetLabel } from "./install-rules.js";
import { detailsBox } from "./account-details.js";

const SVG = "http://www.w3.org/2000/svg";

/** Safari's Share icon (a box with an arrow up), drawn beside the word "Share"; hidden from screen readers. */
function shareIcon() {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "studio-share-icon");
  for (const d of ["M12 3v12", "M7.5 7.5 12 3l4.5 4.5", "M8 10H5.5v10.5h13V10H16"]) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  return svg;
}

function stepItem(step) {
  if (!step.share) return h("li", { text: step.text });
  const [before, after] = step.text.split("Share");
  return h("li", {}, before, h("strong", { text: "Share" }), " ", shareIcon(), after, step.more ? h("span", { class: "studio-help studio-block", text: step.more }) : null);
}

/** The sheet's own heading (side-sheet draws it from the label), focused on open. */
export function focusSheetHeading(sheet) {
  const node = sheet.element.querySelector("h2");
  if (!node) return;
  node.tabIndex = -1;
  node.focus();
}

/** `here`: herePhone(); `toast(words)` after it was added. */
export function createHomeScreen({ sheet, here, toast }) {
  const address = () => `${location.origin}/admin/studio/`;

  function copyRow(status) {
    const code = h("code", { class: "studio-mono studio-address", text: address() });
    const copy = h("action-button", { variant: "secondary", onClick: () => {
      const done = () => { status.textContent = copiedWords(here, true); };
      const select = () => {
        const range = document.createRange();
        range.selectNodeContents(code);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
        status.textContent = copiedWords(here, false);
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(address()).then(done, select);
      else select();
    } }, "Copy the address");
    return h("p", { class: "studio-account-redirect" }, code, " ", copy);
  }

  /** Open the sheet; from the icon it only says she's already using it. `way` overrides the detected one. */
  function open({ opener = document.activeElement, way = installWay(here, installPrompt.has()) } = {}) {
    const plan = installSteps(way, here);
    const heading = sheetLabel(here);
    const status = h("p", { class: "studio-help studio-account-sheet-status", role: "status", "aria-live": "polite" });
    const ask = plan.ask ? h("action-button", { onClick: async (event) => {
      const button = event.currentTarget;
      button.loading = true;
      const outcome = await installPrompt.ask().catch(() => "dismissed");
      button.loading = false;
      // The question went (asked elsewhere, or installed meanwhile): show this phone's own steps instead.
      if (outcome === null) { open({ opener, way: installWay(here, false) }); return; }
      const words = promptOutcomeWords(outcome, here);
      if (outcome === "accepted") { sheet.close(); toast?.(words); } else status.textContent = words;
    } }, "Add it") : null;
    sheet.show({
      heading,
      opener,
      children: [
        plan.intro ? h("p", { text: plan.intro }) : null,
        plan.before ? h("p", { class: "studio-help", text: plan.before }) : null,
        plan.steps.length ? h("ol", { class: "studio-steps" }, ...plan.steps.map(stepItem)) : null,
        ask,
        plan.words ? h("p", { text: plan.words }) : null,
        plan.copy ? copyRow(status) : null,
        status,
        detailsBox([
          `way: ${way}`,
          `display mode: ${here.standalone ? "standalone (opened from the icon)" : "browser tab"}`,
          `beforeinstallprompt fired: ${installPrompt.fired() ? "yes" : "no"}`,
          "manifest id /admin/, start_url /admin/studio/, scope /admin/",
          "An iPhone app keeps its own sign-in and its own notifications. Adding a second icon makes a second app that has to turn notifications on by itself. The old icon keeps working; there is no need to add it again.",
        ]),
      ],
      focus: () => focusSheetHeading(sheet),
    });
  }

  return { open };
}
