// Words for YouTube (Studio R7): "Copy what YouTube needs, right." The title, description, tags
// and chapters for a video post, as `openblog video` writes them: from the server's preview (G50)
// when there is a signal, else from video-rules.js, which mirrors the engine. Problems are listed
// above and never stop Copy (YouTube decides). Nothing here changes the video or the post.
import { glyph, h, toast } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { trapFocus } from "./focus-trap.js";
import { chapterCountWords, releaseWords } from "./video-rules.js";

/**
 * `write`: { kit(server) → the kit, request(), goTo(target), stage(), state(), back() } where
 * `back()` reopens Before you publish.
 */
export async function createYoutubeSheet({ api, write }) {
  await use("side-sheet", "action-button", "text-field");
  const heading = h("span", { slot: "heading", tabindex: "-1", text: say("youtube.sheet") });
  const back = h("action-button", { variant: "link", class: "studio-step-back", hidden: true, onClick: () => goBack() }, glyph("‹ "), say("route.back"));
  const body = h("div", { class: "studio-ready-body" });
  const done = h("action-button", { onClick: () => close() }, say("youtube.done"));
  const element = h("side-sheet", { label: say("youtube.sheet"), side: "right", class: "studio-ready-sheet" },
    heading, back, h("p", { class: "studio-help", text: say("youtube.lede") }), body, h("div", { slot: "actions", class: "studio-ready-actions" }, done));
  trapFocus(element, () => element.open);
  element.addEventListener("openchange", (event) => { if (event.target === element && !event.detail) finish(); });
  element.addEventListener("keydown", (event) => {
    if (event.altKey && event.key === "ArrowLeft" && !back.hidden) { event.preventDefault(); goBack(); }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); copy("description"); }
  });
  let shown = false;
  let opener = null;
  let fromReady = false;
  let server = null;
  let turn = 0;
  let kit = null;
  const boxes = {};

  async function ask() {
    const mine = ++turn;
    const request = write.request();
    if (!request.path) { server = null; return; }
    try {
      server = await api.post("video/release", request);
    } catch (error) {
      if (error?.status === 401) throw error;
      server = null;
    }
    if (mine === turn && shown) draw();
  }

  function draw() {
    kit = write.kit(server);
    const problems = kit.problems;
    const parts = [];
    if (problems.length) {
      parts.push(h("section", { class: "studio-ready-group", "aria-labelledby": "studio-youtube-problems-h" },
        h("h3", { id: "studio-youtube-problems-h", text: say("youtube.problems", { count: String(problems.length) }) }),
        h("ul", { class: "studio-ready-list" }, ...problems.map((p) => {
          const words = releaseWords(p.code, p);
          const target = p.line !== undefined ? { line: p.line + 1 } : p.field ? { field: p.field } : null;
          return h("li", { class: "studio-ready-item" }, h("p", { text: words }),
            target ? h("div", { class: "studio-ready-actions" }, h("action-button", { variant: "secondary", size: "sm", label: say("ready.showMeLabel", { what: words }), onClick: () => { close(); write.goTo(target); } }, say("youtube.showMe"))) : null);
        }))));
    }
    boxes.title = h("text-field", { label: say("youtube.title"), readonly: true, value: kit.title, description: say("youtube.titleCount", { count: String([...kit.title].length) }) });
    boxes.description = h("text-field", { label: say("youtube.description"), readonly: true, rows: 10, value: kit.description, class: "studio-youtube-description" });
    parts.push(boxes.title, actions(h("action-button", { variant: "secondary", onClick: () => copy("title") }, say("youtube.copyTitle"))));
    parts.push(boxes.description, actions(h("action-button", { onClick: () => copy("description") }, say("youtube.copyDescription"))));
    if (!kit.hasAddress) parts.push(h("p", { class: "studio-help", text: say("youtube.noAddress") }));
    if (kit.tags.length) {
      boxes.tags = h("text-field", { label: say("youtube.tags"), readonly: true, value: kit.tags.join(", ") });
      parts.push(boxes.tags, actions(h("action-button", { variant: "secondary", onClick: () => copy("tags") }, say("youtube.copyTags"))));
    } else delete boxes.tags;
    const count = kit.chapters.length;
    parts.push(h("p", { text: count ? (count === 1 ? say("youtube.oneChapter") : say("youtube.chapters", { count: String(count) })) : say("youtube.noChapters") }),
      h("p", { class: "studio-help", text: say("youtube.chapterHelp") }),
      h("p", {}, say("youtube.whereAt", { stage: write.stage() || "—" }), " ", h("action-button", { variant: "link", onClick: () => { close(); write.goTo({ field: "productionStatus" }); } }, say("youtube.change"))));
    if (kit.notes.length) parts.push(h("p", { class: "studio-help", text: say("youtube.keepPrivate") }));
    parts.push(details());
    body.replaceChildren(...parts);
  }

  const actions = (...children) => h("div", { class: "studio-ready-actions" }, ...children);

  function details() {
    const rows = [];
    if (kit.status) rows.push(say("youtube.detailsStatus", { status: kit.status, digest: kit.digest || "" }));
    else rows.push(say("youtube.detailsLocal"));
    for (const p of kit.problems) rows.push(p.code);
    for (const p of kit.other || []) rows.push(`${p.code}: ${p.message || ""}`);
    for (const step of kit.steps || []) rows.push(step);
    rows.push(say("youtube.detailsCli", { slug: kit.slug || "<slug>" }));
    rows.push(chapterCountWords(kit.chapters.length));
    return h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("ul", {}, ...rows.map((row) => h("li", { class: "studio-mono", text: row }))));
  }

  async function copy(which) {
    kit ||= write.kit(server);
    const text = which === "title" ? kit.title : which === "tags" ? kit.tags.join(", ") : kit.description;
    try {
      await navigator.clipboard.writeText(text);
      toast(which === "title" ? say("youtube.titleCopied") : which === "tags" ? say("youtube.tagsCopied") : say("youtube.descriptionCopied"));
    } catch {
      const box = boxes[which]?.querySelector("input, textarea");
      box?.focus();
      box?.select?.();
      toast(say("youtube.copyRefused"), { variant: "warning" });
    }
  }

  function open({ from = document.activeElement, ready = false } = {}) {
    opener = from;
    fromReady = ready;
    back.hidden = !ready;
    if (!element.isConnected) document.body.append(element);
    element.open = true;
    shown = true;
    draw();
    ask().catch(() => {});
    requestAnimationFrame(() => requestAnimationFrame(() => heading.focus()));
  }

  function finish() {
    if (!shown) return;
    shown = false;
    write.closed?.();
    const to = opener;
    opener = null;
    if (to?.isConnected) requestAnimationFrame(() => (to.querySelector?.("button, a, input") || to).focus?.());
  }

  function close() { if (!shown) return; element.open = false; finish(); }

  function goBack() {
    opener = null;
    close();
    if (fromReady) write.back();
  }

  return {
    element, open, close,
    get isOpen() { return shown; },
    copyDescription: () => copy("description"),
    /** Her words changed: the words follow (the server's copy is asked again). */
    changed() { if (shown) { draw(); ask().catch(() => {}); } },
  };
}
