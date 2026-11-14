// Your route (Studio R7): "Show my route without showing where I live." A route file from a hiking
// app or watch is read on this phone (route-rules.js: regular expressions, no document parsing,
// no network) and its text lives only in this page's memory. Every route starts hidden; what
// readers will see is drawn from exactly the values that will be written, before anything is.
// The exact route needs a confirm, is cleaned on the phone, and is sent to the blog's private
// staging; the token rides with the next save (the server keeps the file private until the post
// is live, G47) and is discarded when not used. Use this route, a change and Take the route off
// each have Undo.
import { h, toast } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { trapFocus } from "./focus-trap.js";
import {
  DEFAULT_TRIM, MAX_GPX_BYTES, PRIVACY, ROUTE_KEYS, RouteError, analyzeGpx, cleanGpx, gpxProblem, numbersWords, routeChange, routeLine,
  routeValues, sendProblem, trimOptions, trimWords,
} from "./route-rules.js";

const SVG = "http://www.w3.org/2000/svg";
const STORE = "studio-track:";
const LABELS = () => ({ hidden: [say("route.hidden"), say("route.hiddenHelp")], trimmed: [say("route.trimmed"), say("route.trimmedHelp")], approximate: [say("route.approximate"), say("route.approximateHelp")], exact: [say("route.exact"), say("route.exactHelp")] });

/** A drawing in the published page's 1000 × 100 box, from `x,y` points (segments split by `|`). */
function drawing(points, label) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 1000 100");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.setAttribute("class", "studio-route-drawing");
  for (const segment of String(points).split("|")) {
    if (!/^[\d, ]+$/.test(segment.trim())) continue;
    const line = document.createElementNS(SVG, "polyline");
    line.setAttribute("points", segment.trim());
    svg.append(line);
  }
  return svg;
}

/**
 * `write`: { path(), state(), values() → the post's route fields now, apply(values) → write them,
 * device(), back() }. Owns the staged route file's token for the post (sessionStorage).
 */
export async function createRouteSheet({ api, write }) {
  await use("side-sheet", "action-button", "file-drop", "select-field", "toggle-switch", "text-field", "alert-banner");
  const heading = h("span", { slot: "heading", tabindex: "-1", text: say("route.sheet") });
  const back = h("action-button", { variant: "link", class: "studio-step-back", hidden: true, onClick: () => goBack() }, `‹ ${say("route.back")}`);
  const body = h("div", { class: "studio-ready-body" });
  const status = h("p", { class: "studio-ready-did", role: "status" });
  const cancel = h("action-button", { variant: "secondary", onClick: () => leaveSheet() }, say("route.neverMind"));
  const use_ = h("action-button", { onClick: () => useRoute() }, say("route.use"));
  const element = h("side-sheet", { label: say("route.sheet"), side: "right", class: "studio-ready-sheet" },
    heading, back, body, status, h("div", { slot: "actions", class: "studio-ready-actions" }, cancel, use_));
  trapFocus(element, () => element.open);
  element.addEventListener("openchange", async (event) => {
    if (event.target !== element || event.detail) return;
    if (file && shown) { element.open = true; await leaveSheet(); return; }
    finish();
  });
  element.addEventListener("keydown", (event) => {
    if (event.altKey && event.key === "ArrowLeft" && !back.hidden) { event.preventDefault(); goBack(); }
    if (event.key === "Escape" && file) { event.preventDefault(); event.stopPropagation(); leaveSheet(); }
  });

  let shown = false;
  let opener = null;
  let fromReady = false;
  let file = null; // { name, source, size } in memory only
  let choice = "hidden";
  let trim = DEFAULT_TRIM;
  let climb = false;
  let climbTouched = false;
  let problem = "";
  let waiting = null; // a cleaned exact file waiting for a signal: { name, text }
  let undo = null;

  const key = () => `${STORE}${write.path() || "new"}`;
  function staged() { try { return JSON.parse(sessionStorage.getItem(key()) || "null"); } catch { return null; } }
  function stage(value) { try { if (value) sessionStorage.setItem(key(), JSON.stringify(value)); else sessionStorage.removeItem(key()); } catch { /* this page only */ } }

  function analysis() {
    if (!file) return null;
    try {
      return analyzeGpx(file.source, { privacy: choice, trimMeters: trim });
    } catch (error) {
      if (error instanceof RouteError) { problem = gpxProblem(error); return null; }
      throw error;
    }
  }

  function draw() {
    problem = "";
    const current = write.values();
    const a = analysis();
    const drop = h("file-drop", { label: say("route.choose"), accept: ".gpx,application/gpx+xml,application/xml,text/xml", multiple: false });
    drop.addEventListener("fileschange", (e) => { const [chosen] = e.detail || []; if (chosen) read(chosen); });
    const parts = [h("p", { class: "studio-help", text: say("route.lede", { phone: write.device() }) }), drop, h("p", { class: "studio-help", text: say("route.appsHelp") })];
    if (problem) parts.push(h("p", { class: "studio-field-error", role: "alert", text: problem }));
    if (a) {
      parts.push(h("p", { "aria-live": "polite" }, h("span", { text: say("route.from", { name: file.name }) }), " ", h("strong", { text: numbersWords(a) })));
      if (differs(a, current)) parts.push(h("p", { class: "studio-help", text: say("route.replaces") }));
      if (!a.hasTimes) parts.push(h("p", { class: "studio-help", text: say("route.noTimes") }));
    }
    parts.push(choices(), climbSwitch(), readersSee(a, current), details(a));
    body.replaceChildren(...parts);
    use_.hidden = !file;
    cancel.replaceChildren(file ? say("route.neverMind") : say("route.done"));
  }

  const differs = (a, current) => String(a.distanceKm) !== String(current.distanceKm || "") || (a.elevationGainM !== null && String(a.elevationGainM) !== String(current.elevationGainM || ""));

  function choices() {
    const labels = LABELS();
    const name = "studio-route-privacy";
    const box = h("fieldset", { class: "studio-field-group studio-choices studio-route-choices" }, h("legend", { text: say("route.howMuch") }));
    for (const value of PRIVACY) {
      const id = `${name}-${value}`;
      const input = h("input", { type: "radio", name, id, value, class: "studio-radio", checked: value === choice, "aria-describedby": `${id}-help` });
      input.addEventListener("change", () => choose(value));
      box.append(h("div", { class: "studio-choice" }, input, h("label", { for: id, text: labels[value][0] }), h("p", { class: "studio-help", id: `${id}-help`, text: labels[value][1] })));
      if (value === "trimmed" && choice === "trimmed") {
        const select = h("select-field", { label: say("route.leaveOff"), options: trimOptions(), value: String(trim) });
        select.addEventListener("valuechange", (e) => { trim = Number(e.detail) || DEFAULT_TRIM; draw(); });
        box.append(select);
      }
    }
    return box;
  }

  function climbSwitch() {
    const toggle = h("toggle-switch", { label: say("route.climb"), checked: climb });
    toggle.addEventListener("checkedchange", (event) => { climb = Boolean(event.detail); climbTouched = true; draw(); requestAnimationFrame(() => body.querySelector("toggle-switch button, toggle-switch input")?.focus()); });
    return toggle;
  }

  /** What readers see, from exactly the values that will be written. */
  function readersSee(a, current) {
    const values = a ? routeValues(a, choice, { climb }) : { ...current };
    const shown_ = [];
    if (values.routeShape) shown_.push(drawing(values.routeShape, choice === "trimmed" ? say("route.drawTrimmed", { trim: trimWords(trim) }) : say("route.drawWhole")));
    if (values.elevationProfile) shown_.push(drawing(values.elevationProfile, say("route.drawClimb")));
    const numbers = a ? numbersWords(a) : [current.distanceKm ? `${current.distanceKm} km` : "", current.elevationGainM ? `${current.elevationGainM} m climb` : "", current.duration || ""].filter(Boolean).join(" · ");
    return h("section", { class: "studio-ready-group", "aria-labelledby": "studio-route-see-h" },
      h("h3", { id: "studio-route-see-h", text: say("route.whatReadersSee") }),
      ...(shown_.length ? shown_ : [h("p", { class: "studio-help", text: say("route.noDrawing") })]),
      h("p", { "aria-live": "polite", text: values.routeShape || values.elevationProfile ? routeLine({ ...values, distanceKm: values.distanceKm || "1", trim }) : say("route.numbersOnly", { numbers: numbers || "—" }) }),
      choice === "exact" ? h("p", { class: "studio-help", text: say("route.canDownload") }) : null);
  }

  function details(a) {
    const rows = [];
    if (a) rows.push(say("route.detailsPoints", { points: String(a.pointCount), kept: String(a.keptPointCount), parts: String(a.segmentCount) }));
    if (a) rows.push(say("route.detailsKeys", { keys: Object.keys(routeValues(a, choice, { climb })).join(", ") }));
    const s = staged();
    if (s?.token) rows.push(say("route.detailsStaged", { token: `${s.token.slice(0, 8)}…` }));
    if (s?.size) rows.push(say("route.detailsCleaned", { size: `${Math.ceil(s.size / 1024)} KB`, points: String(s.points ?? "") }));
    rows.push(say("route.detailsWhere", { address: s?.url || "/tracks/uploads/<year>/<name>.gpx" }));
    const metres = h("text-field", { label: say("route.detailsTrim"), description: say("route.detailsTrimHelp"), inputmode: "numeric", value: String(trim) });
    metres.addEventListener("change", () => { const n = Math.round(Number(metres.value)); if (Number.isFinite(n) && n >= 0 && n <= 5000) { trim = n; draw(); } });
    return h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("ul", {}, ...rows.map((row) => h("li", { class: "studio-mono", text: row }))), choice === "trimmed" ? metres : null);
  }

  async function read(chosen) {
    if (chosen.size > MAX_GPX_BYTES) { problem = gpxProblem(new RouteError("too-big", { bytes: chosen.size })); paintProblem(); return; }
    let source;
    try { source = await chosen.text(); } catch { problem = gpxProblem("unreadable"); paintProblem(); return; }
    try {
      analyzeGpx(source, { privacy: "hidden" });
    } catch (error) {
      problem = gpxProblem(error instanceof RouteError ? error : "unreadable");
      paintProblem();
      return;
    }
    // Every new file starts hidden, whatever was chosen before.
    file = { name: chosen.name || "route.gpx", source, size: chosen.size };
    choice = "hidden";
    climb = false;
    climbTouched = false;
    draw();
    requestAnimationFrame(() => body.querySelector("input[type=radio]:checked")?.focus());
  }

  function paintProblem() {
    draw();
    const at = body.querySelector("file-drop");
    at?.after(h("p", { class: "studio-field-error", role: "alert", text: problem }));
  }

  async function choose(to) {
    const from = choice;
    if (to === from) return;
    if (to === "exact") {
      const answer = await ask({ heading: say("route.askExact"), text: say("route.askExactText"), focus: 1, choices: [{ label: say("route.showIt"), value: "yes" }, { label: say("route.keepHidden"), value: "no", variant: "secondary" }] });
      if (answer !== "yes") { draw(); body.querySelector(`input[value="${from}"]`)?.focus(); return; }
    }
    if (!file) {
      const change = routeChange(write.values().locationPrivacy || "hidden", to, { haveFile: false, published: write.state() === "published", climb: Boolean(write.values().elevationProfile) && climb });
      if (!change.ok) { draw(); status.textContent = change.words; return; }
      choice = to;
      applyWithUndo(change.values, say("route.changed", { line: routeLine({ ...write.values(), ...change.values }) }) + (change.words ? ` ${change.words}` : ""));
      return;
    }
    choice = to;
    if (!climbTouched) climb = to !== "hidden";
    draw();
    if (problem) body.querySelector("[role=alert]")?.focus?.();
    else body.querySelector(`input[value="${to}"]`)?.focus();
  }

  function applyWithUndo(values, words, discard = null) {
    const before = Object.fromEntries(ROUTE_KEYS.map((k) => [k, write.values()[k] ?? ""]));
    write.apply(values);
    undo = { before, discard };
    status.replaceChildren(h("span", { text: words }), " ", h("action-button", { variant: "secondary", size: "sm", onClick: () => undoLast() }, say("did.undo")));
    toast(words);
    draw();
  }

  async function undoLast() {
    if (!undo) return;
    const { before, discard } = undo;
    undo = null;
    write.apply(before);
    if (discard) await discardStaged();
    status.textContent = say("route.undone");
    draw();
  }

  async function useRoute() {
    const a = analysis();
    if (!a) { paintProblem(); return; }
    const values = routeValues(a, choice, { climb });
    let words = say("route.added", { line: routeLine({ ...values, trim: choice === "trimmed" ? trim : 0, route: choice === "exact" ? "pending" : "" }) });
    if (choice === "exact") {
      const sent = await sendExact(cleanGpx(file.source), file.name);
      if (sent === false) return;
      words += ` ${sent === "waiting" ? say("route.waitsSignal") : say("route.waitsPrivate")}`;
    } else {
      await discardStaged();
    }
    file = null;
    applyWithUndo(values, words, choice === "exact");
  }

  /** Send the cleaned file to the blog's private staging: true, "waiting" (no signal), or false. */
  async function sendExact(text, name) {
    try {
      const reply = await api.call("POST", `track-upload?name=${encodeURIComponent(name)}`, { body: text, headers: { "Content-Type": "application/gpx+xml" } });
      await discardStaged();
      stage({ token: reply.token, name, size: text.length, points: reply.points ?? null });
      waiting = null;
      return true;
    } catch (error) {
      if (error?.status === 401) throw error;
      if (error?.status === 0) {
        waiting = { text, name };
        globalThis.addEventListener("online", retry, { once: true });
        return "waiting";
      }
      problem = sendProblem(error);
      paintProblem();
      return false;
    }
  }

  async function retry() {
    if (!waiting) return;
    const { text, name } = waiting;
    const sent = await sendExact(text, name).catch(() => false);
    if (sent === true) toast(say("route.waitsPrivate"));
  }

  async function discardStaged() {
    const s = staged();
    stage(null);
    if (!s?.token) return;
    for (let tries = 0; tries < 2; tries += 1) {
      try { await api.call("DELETE", `track-upload?token=${encodeURIComponent(s.token)}`); return; } catch (error) { if (error?.status === 401) return; }
    }
  }

  /** Take the route off (More): the sheet opens so its Undo is where she is. */
  async function takeOff(from = document.activeElement) {
    const values = { distanceKm: "", elevationGainM: "", duration: "", routeShape: "", elevationProfile: "", route: "", locationPrivacy: "hidden" };
    if (!shown) open({ from });
    await discardStaged();
    choice = "hidden";
    applyWithUndo(values, say("route.takenOff"));
    requestAnimationFrame(() => status.querySelector("action-button button")?.focus());
  }

  /** Leaving with a file read and not used asks once. True when it may close. */
  async function leaveSheet() {
    if (!file) { close(); return true; }
    const answer = await ask({ heading: say("route.askUse"), text: say("route.askUseText"), choices: [{ label: say("route.useIt"), value: "use" }, { label: say("route.leaveOut"), value: "leave", variant: "secondary" }] });
    if (answer === "use") { await useRoute(); if (!file) close(); return !file; }
    if (answer === "leave") { file = null; close(); return true; }
    requestAnimationFrame(() => heading.focus());
    return false;
  }

  function open({ from = document.activeElement, ready = false, focusChoice = false } = {}) {
    opener = from;
    fromReady = ready;
    back.hidden = !ready;
    const current = write.values();
    choice = PRIVACY.includes(String(current.locationPrivacy || "").toLowerCase()) ? String(current.locationPrivacy).toLowerCase() : "hidden";
    climb = Boolean(current.elevationProfile);
    climbTouched = false;
    status.textContent = "";
    if (!element.isConnected) document.body.append(element);
    element.open = true;
    shown = true;
    draw();
    requestAnimationFrame(() => requestAnimationFrame(() => (focusChoice ? body.querySelector("input[type=radio]:checked") : heading)?.focus()));
  }

  function finish() {
    if (!shown) return;
    shown = false;
    file = null;
    write.closed?.();
    const to = opener;
    opener = null;
    if (to?.isConnected) requestAnimationFrame(() => (to.querySelector?.("button, a, input") || to).focus?.());
  }

  function close() { if (!shown) return; element.open = false; finish(); }

  function goBack() {
    if (file) return leaveSheet().then((ok) => { if (ok && fromReady) write.back(); });
    opener = null;
    close();
    if (fromReady) write.back();
    return Promise.resolve();
  }

  return {
    element, open, close, takeOff,
    get isOpen() { return shown; },
    /** The token a save sends (any save: the server keeps the file private until the post is live). */
    token: () => staged(),
    /** After a save that used the token: it's spent. */
    spent() { stage(null); },
    /** Whether an exact route file waits to go with the next save. */
    waiting: () => Boolean(staged()?.token || waiting),
    /** Leaving Write: an unused staged file is thrown away. */
    async leave() {
      if (shown && !(await leaveSheet())) return false;
      await discardStaged();
      waiting = null;
      return true;
    },
  };
}
