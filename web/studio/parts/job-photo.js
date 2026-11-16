// A finished job's after photo for a Facebook Page (#656, ADR 0426): she describes it, Show what goes
// asks the server for the exact photo it inspected (no location in it) with her description, and she
// says yes to that photo and those words before Post to her Page can go. The approval the server gave
// rides with the post; a changed photo or description stops it instead of posting without it. The
// photo comes as a data: image the page shows as a picture only.
import { h } from "./dom.js";
import { say } from "./words.js";

/** `job` is the job-share answer (`path`), `place` its Facebook destination (`digest`, `photo`). */
export function createJobPhoto({ api, job, place, pageName }) {
  let approval = null;
  let ticket = 0;
  const describe = h("text-field", { label: say("jobphoto.describe"), description: say("jobphoto.describeHelp"), maxlength: 1500,
    onValuechange: () => clear() });
  const shown = h("div", { class: "studio-share-picture-row", "aria-live": "polite" });
  const agree = h("toggle-switch", { label: say("jobphoto.agree"), hidden: true });
  const show = h("action-button", { variant: "secondary", onClick: () => look() }, say("jobphoto.show"));
  const element = h("div", { class: "studio-share-picture-row" },
    h("p", { class: "studio-label", text: say("jobphoto.title", { page: pageName }) }),
    describe, h("p", { class: "studio-help", text: say("jobphoto.ifNot") }), show, shown, agree);

  function clear() {
    ticket += 1;
    approval = null;
    agree.checked = false;
    agree.hidden = true;
    shown.replaceChildren();
  }

  async function look() {
    clear();
    const mine = ticket;
    const description = String(describe.value || "").trim();
    describe.error = description ? "" : say("jobphoto.needWords");
    if (!description) { describe.querySelector("input")?.focus(); return; }
    show.loading = true;
    shown.replaceChildren(h("p", { class: "studio-help", text: say("jobphoto.checking") }));
    try {
      const answer = await api.post("social/job-photo-preview", { path: job.path, digest: place.digest, description });
      if (mine !== ticket) return;
      const src = String(answer?.imageDataUrl || "");
      if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(src)) throw Object.assign(new Error("no picture"), { status: 422 });
      approval = { approvalDigest: String(answer.approvalDigest || ""), description };
      shown.replaceChildren(h("img", { class: "studio-share-picture", src, alt: description }), h("p", { class: "studio-help", text: say("picture.described", { description }) }));
      agree.hidden = false;
    } catch (error) {
      if (error.status === 401) throw error;
      if (mine === ticket) shown.replaceChildren(h("p", { class: "studio-comment-trouble", role: "status", text: say("jobphoto.trouble") }));
    } finally {
      show.loading = false;
    }
  }

  return {
    element,
    /** What goes with the post when she said yes to the photo she saw; null otherwise. */
    approval: () => (approval && agree.checked ? approval : null),
    clear,
  };
}
