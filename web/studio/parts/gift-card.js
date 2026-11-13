// A family member's card, drawn from its data: a design, a message, a sign-off and stickers, all
// from fixed lists (the gifts service and Admin's proxy both check them). Everything is built with
// createElementNS and textContent, so nothing anyone wrote can become markup. Studio slice 3b.

const NS = "http://www.w3.org/2000/svg";
const W = 600;
const H = 400;

// Each design: a background, a border colour, a text colour, and a few shapes of its own.
export const DESIGNS = {
  "snowy-night": { label: "Snowy night", bg: "#1f3a5f", ink: "#ffffff", edge: "#9cc3e6", shapes: [["circle", { cx: 80, cy: 70, r: 4, fill: "#fff" }], ["circle", { cx: 520, cy: 60, r: 3, fill: "#fff" }], ["circle", { cx: 460, cy: 340, r: 5, fill: "#fff" }], ["circle", { cx: 120, cy: 330, r: 3, fill: "#fff" }], ["path", { d: "M0 360 Q150 330 300 360 T600 350 V400 H0Z", fill: "#e8f1fa" }]] },
  "candy-stripe": { label: "Candy stripe", bg: "#fff6f2", ink: "#7a1020", edge: "#c8243c", shapes: [["path", { d: "M0 0H600V24H0ZM0 376H600V400H0Z", fill: "#c8243c" }], ["path", { d: "M0 24H600V32H0ZM0 368H600V376H0Z", fill: "#fff" }]] },
  holly: { label: "Holly", bg: "#f7f3e8", ink: "#1f4d2c", edge: "#2f6b3f", shapes: [["path", { d: "M30 40c20-10 40 0 50 20-20 0-40 10-50-20ZM80 30c10 20 0 40-20 50 0-20-10-40 20-50Z", fill: "#2f6b3f" }], ["circle", { cx: 70, cy: 60, r: 7, fill: "#c8243c" }], ["path", { d: "M570 360c-20 10-40 0-50-20 20 0 40-10 50 20ZM520 370c-10-20 0-40 20-50 0 20 10 40-20 50Z", fill: "#2f6b3f" }], ["circle", { cx: 530, cy: 340, r: 7, fill: "#c8243c" }]] },
  gingerbread: { label: "Gingerbread", bg: "#a4643a", ink: "#fff8ee", edge: "#fff8ee", shapes: [["path", { d: "M20 20H580V380H20Z", fill: "none", stroke: "#fff8ee", "stroke-width": 6, "stroke-dasharray": "2 14", "stroke-linecap": "round" }]] },
  starry: { label: "Starry", bg: "#2b2140", ink: "#ffe9a8", edge: "#f2c14e", shapes: [["path", { d: "M90 60l6 14 15 1-12 9 4 15-13-8-13 8 4-15-12-9 15-1Z", fill: "#f2c14e" }], ["path", { d: "M510 300l5 11 12 1-9 7 3 12-11-6-10 6 3-12-9-7 12-1Z", fill: "#f2c14e" }], ["circle", { cx: 480, cy: 70, r: 3, fill: "#ffe9a8" }], ["circle", { cx: 140, cy: 320, r: 3, fill: "#ffe9a8" }]] },
};

// Each sticker: shapes drawn around 0,0 at about 24 units across.
export const STICKERS = {
  star: [["path", { d: "M0-12 3.5-4 12-3.5 5.5 2 7.5 11 0 6.5-7.5 11-5.5 2-12-3.5-3.5-4Z", fill: "#f2c14e" }]],
  heart: [["path", { d: "M0 10C-11 3-12-4-8-8-4-11 0-7 0-5 0-7 4-11 8-8 12-4 11 3 0 10Z", fill: "#d6455a" }]],
  snowflake: [["path", { d: "M0-11V11M-9.5-5.5 9.5 5.5M-9.5 5.5 9.5-5.5", stroke: "#7fb3e0", "stroke-width": 2.4, "stroke-linecap": "round" }]],
  "candy-cane": [["path", { d: "M3 12V-4a6 6 0 0 0-12 0", stroke: "#fff", "stroke-width": 5, fill: "none", "stroke-linecap": "round" }], ["path", { d: "M3 12V-4a6 6 0 0 0-12 0", stroke: "#c8243c", "stroke-width": 5, fill: "none", "stroke-dasharray": "3 3", "stroke-linecap": "round" }]],
  bell: [["path", { d: "M0-10C-7-10-7-2-7 2L-9 7H9L7 2C7-2 7-10 0-10Z", fill: "#e0a12e" }], ["circle", { cy: 9, r: 2.4, fill: "#b8862a" }]],
  mitten: [["path", { d: "M-6 8V-4C-6-10 6-10 6-4V2L9-1C11-3 13-1 11 1L6 8Z", fill: "#c8364a" }], ["rect", { x: -7, y: 7, width: 14, height: 5, rx: 1.5, fill: "#fff" }]],
  cookie: [["circle", { r: 10, fill: "#c98a4b" }], ["circle", { cx: -3, cy: -3, r: 1.6, fill: "#5a3518" }], ["circle", { cx: 4, cy: 2, r: 1.6, fill: "#5a3518" }]],
  ornament: [["rect", { x: -3, y: -13, width: 6, height: 4, rx: 1, fill: "#c9a24a" }], ["circle", { r: 10, fill: "#2f6fd0" }], ["circle", { cx: -4, cy: -4, r: 3, fill: "#fff", opacity: 0.5 }]],
  holly: [["path", { d: "M-12-2c6-6 12-4 12 2-6 2-10 2-12-2ZM12-2c-6-6-12-4-12 2 6 2 10 2 12-2Z", fill: "#2f6b3f" }], ["circle", { cy: 3, r: 3.5, fill: "#c8243c" }]],
  gift: [["rect", { x: -9, y: -4, width: 18, height: 13, fill: "#2f6b3f" }], ["rect", { x: -10, y: -8, width: 20, height: 5, fill: "#3f8a52" }], ["rect", { x: -1.5, y: -8, width: 3, height: 17, fill: "#f2c14e" }]],
};

function el(name, attributes = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

/** Lines of at most `width` characters, breaking at spaces; paragraphs kept. Exported for tests. */
export function wrapLines(words, width = 38, max = 9) {
  const lines = [];
  for (const paragraph of String(words || "").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > width && line) { lines.push(line); line = word.slice(0, width); } else line = next.slice(0, width + 10);
    }
    lines.push(line);
  }
  return lines.length > max ? [...lines.slice(0, max - 1), `${lines[max - 1]}…`] : lines;
}

/** The card as an SVG element, described for screen readers by `label`. */
export function drawCard(card, { label = "A card" } = {}) {
  const design = DESIGNS[card?.design] || DESIGNS.holly;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", class: "studio-gift-card" });
  const title = el("title");
  title.textContent = label;
  svg.append(title, el("rect", { width: W, height: H, rx: 18, fill: design.bg, stroke: design.edge, "stroke-width": 6 }));
  for (const [name, attributes] of design.shapes) svg.append(el(name, attributes));
  // A long message gets smaller writing rather than being cut short.
  let lines = wrapLines(card?.message);
  const small = lines.length > 6 || lines.some((line) => line.endsWith("…"));
  if (small) lines = wrapLines(card?.message, 50, 12);
  const size = small ? 19 : 26;
  const step = small ? 23 : 32;
  const top = H / 2 - ((lines.length - 1) * step) / 2;
  const text = el("text", { x: W / 2, y: top, "text-anchor": "middle", "dominant-baseline": "middle", fill: design.ink, "font-size": size, "font-family": "Georgia, serif" });
  lines.forEach((line, index) => {
    const span = el("tspan", { x: W / 2, dy: index === 0 ? 0 : step });
    span.textContent = line;
    text.append(span);
  });
  svg.append(text);
  if (card?.signOff) {
    const sign = el("text", { x: W - 60, y: H - 50, "text-anchor": "end", fill: design.ink, "font-size": 24, "font-style": "italic", "font-family": "Georgia, serif" });
    sign.textContent = `— ${card.signOff}`;
    svg.append(sign);
  }
  for (const sticker of card?.stickers || []) {
    const shapes = STICKERS[sticker.kind];
    if (!shapes) continue;
    const group = el("g", { transform: `translate(${30 + (sticker.x / 100) * (W - 60)} ${30 + (sticker.y / 100) * (H - 60)}) scale(1.8)` });
    for (const [name, attributes] of shapes) group.append(el(name, attributes));
    svg.append(group);
  }
  return svg;
}
