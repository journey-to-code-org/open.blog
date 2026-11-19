// Things set down on a picture: the editor for a `places` setting of a theme component (ADR 0434).
// She chooses one from the row, then taps the picture where it goes; taps one already there to
// pick it up, and drags it or uses the four buttons; and takes it off. The same list is under the
// picture as buttons, so every step works from the keyboard and is said in words.
//
// The picture is an SVG whose images are placed by attributes, never styles, and every image is a
// file of the theme's own that the server checked. Rules are in places-rules.js.
import { h } from "./dom.js";
import { say } from "./words.js";
import { addPlace, formatPlaces, mostPlaces, movePlace, parsePlaces, placeLabel, putPlace, removePlace, spotAt, whereabouts } from "./places-rules.js";

const NS = "http://www.w3.org/2000/svg";
const SIZE = 10; // how wide one thing is drawn, on the picture's 100-wide grid
const svg = (name, attributes = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
};
let count = 0;

/** `{ element, value() }` for one `places` field spec; `onChange()` runs after every edit. */
export function createPlacesField(spec, start, onChange) {
  const id = `places-${++count}`;
  let list = parsePlaces(start ?? spec.default ?? "", spec);
  let chosen = -1; // which thing on the picture is picked up
  let armed = ""; // which kind the next tap adds
  let tall = 120; // the picture's height on the 100-wide grid, until it has loaded
  let dragging = false;

  // Each a literal id, so the words list can check them.
  const WHERE = {
    tl: () => say("places.where.tl"), t: () => say("places.where.t"), tr: () => say("places.where.tr"),
    l: () => say("places.where.l"), m: () => say("places.where.m"), r: () => say("places.where.r"),
    bl: () => say("places.where.bl"), b: () => say("places.where.b"), br: () => say("places.where.br"),
  };
  const where = (item) => WHERE[whereabouts(item.x, item.y)]();
  const named = (item) => placeLabel(spec, item.kind);
  const imageOf = (kind) => (spec.choices || []).find((choice) => choice.value === kind)?.image || "";

  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const picture = svg("svg", { class: "studio-places-picture", viewBox: `0 0 100 ${tall}`, role: "img", "aria-labelledby": `${id}-said` });
  const said = h("p", { id: `${id}-said`, class: "studio-visually-hidden" });
  const palette = h("div", { class: "studio-places-row", role: "group", "aria-label": say("places.paletteLabel") });
  const items = h("ol", { class: "studio-places-list", "aria-label": say("places.listLabel") });
  const tools = h("div", { class: "studio-places-row", role: "group", "aria-label": say("places.toolsLabel") });
  const tool = (label, run) => h("action-button", { variant: "secondary", size: "sm", onClick: run }, label);
  const steps = [
    tool(say("places.left"), () => step(-3, 0)),
    tool(say("places.right"), () => step(3, 0)),
    tool(say("places.up"), () => step(0, -3)),
    tool(say("places.down"), () => step(0, 3)),
    tool(say("places.remove"), () => takeOff()),
  ];
  tools.append(...steps);

  const element = h("fieldset", { class: "studio-field-group studio-places" },
    h("legend", { text: spec.label }),
    spec.hint ? h("p", { class: "studio-help", text: spec.hint }) : null,
    h("p", { class: "studio-help", text: say("places.how") }),
    palette, picture, said, status, tools, items);

  const sized = new Image();
  sized.addEventListener("load", () => {
    if (sized.naturalWidth > 0) tall = Math.round((sized.naturalHeight / sized.naturalWidth) * 1000) / 10;
    draw();
  });
  sized.src = spec.picture || "";

  function changed(words) {
    status.textContent = words || "";
    draw();
    onChange?.();
  }

  function drawPalette() {
    const full = list.length >= mostPlaces(spec);
    palette.replaceChildren(...(spec.choices || []).map((choice) => h("button", {
      type: "button", class: "studio-places-choice", "aria-pressed": armed === choice.value ? "true" : "false", disabled: full,
      onClick: () => arm(choice.value),
      onKeydown: (event) => { if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); add(choice.value); } },
    }, choice.image ? h("img", { src: choice.image, alt: "", width: 28, height: 28 }) : null, h("span", { text: choice.label }))));
  }

  function drawPicture() {
    picture.setAttribute("viewBox", `0 0 100 ${tall}`);
    const nodes = [svg("image", { href: spec.picture || "", x: 0, y: 0, width: 100, height: tall, preserveAspectRatio: "xMidYMid meet" })];
    list.forEach((item, index) => {
      const cx = item.x;
      const cy = (item.y / 100) * tall;
      if (index === chosen) nodes.push(svg("circle", { class: "studio-places-ring", cx, cy, r: SIZE * 0.75 }));
      const image = imageOf(item.kind);
      nodes.push(image
        ? svg("image", { href: image, x: cx - SIZE / 2, y: cy - SIZE / 2, width: SIZE, height: SIZE, "data-index": index, class: "studio-places-thing" })
        : svg("circle", { cx, cy, r: SIZE / 2.4, "data-index": index, class: "studio-places-thing studio-places-dot" }));
    });
    picture.replaceChildren(...nodes);
    said.textContent = list.length ? say("places.said", { n: list.length }) : say("places.none");
  }

  function drawList() {
    items.replaceChildren(...(list.length ? list.map((item, index) => h("li", {}, h("button", {
      type: "button", class: "studio-places-item", "aria-pressed": index === chosen ? "true" : "false", "data-index": index,
      onClick: () => pick(index === chosen ? -1 : index),
      onKeydown: (event) => onKey(event, index),
    }, say("places.item", { thing: named(item), where: where(item) })))) : [h("li", { class: "studio-help", text: say("places.none") })]));
    for (const button of steps) button.disabled = chosen < 0;
  }

  function draw() {
    drawPalette();
    drawPicture();
    drawList();
  }

  function arm(kind) {
    armed = armed === kind ? "" : kind;
    chosen = -1;
    status.textContent = armed ? say("places.armed", { thing: placeLabel(spec, armed) }) : "";
    draw();
    palette.querySelector('[aria-pressed="true"]')?.focus();
  }

  function add(kind, at) {
    const next = addPlace(list, kind, spec, at);
    if (!next) { status.textContent = say("places.full", { max: mostPlaces(spec) }); return; }
    list = next.list;
    chosen = next.index;
    changed(say("places.added", { thing: placeLabel(spec, kind), where: where(list[chosen]) }));
  }

  function pick(index) {
    chosen = index;
    armed = "";
    status.textContent = index >= 0 ? say("places.picked", { thing: named(list[index]) }) : "";
    draw();
    if (index >= 0) items.querySelector(`[data-index="${index}"]`)?.focus();
  }

  function step(dx, dy) {
    if (chosen < 0) return;
    list = movePlace(list, chosen, dx, dy);
    changed(say("places.moved", { thing: named(list[chosen]), where: where(list[chosen]) }));
    items.querySelector(`[data-index="${chosen}"]`)?.focus();
  }

  function takeOff() {
    if (chosen < 0) return;
    const gone = named(list[chosen]);
    list = removePlace(list, chosen);
    chosen = -1;
    changed(say("places.removed", { thing: gone }));
    (items.querySelector("button") || palette.querySelector("button"))?.focus();
  }

  function onKey(event, index) {
    const moves = { ArrowLeft: [-3, 0], ArrowRight: [3, 0], ArrowUp: [0, -3], ArrowDown: [0, 3] };
    if (moves[event.key]) {
      event.preventDefault();
      chosen = index;
      step(...moves[event.key]);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      chosen = index;
      takeOff();
    }
  }

  // The picture itself: tap to add what's chosen, tap a thing to pick it up, drag to move it.
  picture.addEventListener("pointerdown", (event) => {
    const spot = spotAt(event.clientX, event.clientY, picture.getBoundingClientRect());
    if (!spot) return;
    const hit = event.target instanceof Element ? event.target.getAttribute("data-index") : null;
    // One that's already there is always picked up, even with another chosen to add.
    if (hit !== null) {
      chosen = Number(hit);
      armed = "";
      dragging = true;
      picture.setPointerCapture?.(event.pointerId);
      status.textContent = say("places.picked", { thing: named(list[chosen]) });
      draw();
    } else if (armed) {
      add(armed, spot);
    } else if (chosen >= 0) {
      list = putPlace(list, chosen, spot.x, spot.y);
      changed(say("places.moved", { thing: named(list[chosen]), where: where(list[chosen]) }));
    } else {
      status.textContent = say("places.chooseFirst");
    }
  });
  picture.addEventListener("pointermove", (event) => {
    if (!dragging || chosen < 0) return;
    const spot = spotAt(event.clientX, event.clientY, picture.getBoundingClientRect());
    if (!spot) return;
    list = putPlace(list, chosen, spot.x, spot.y);
    drawPicture();
  });
  const drop = () => {
    if (!dragging) return;
    dragging = false;
    if (chosen >= 0) changed(say("places.moved", { thing: named(list[chosen]), where: where(list[chosen]) }));
  };
  picture.addEventListener("pointerup", drop);
  picture.addEventListener("pointercancel", drop);

  draw();
  return { element, value: () => formatPlaces(list) };
}
