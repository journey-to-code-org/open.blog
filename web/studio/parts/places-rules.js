// Things set down on a picture: a `places` setting of a theme component (ADR 0434). The value is
// `kind@x,y;kind@x,y`, each kind one of the setting's choices and each spot on a 0 to 100 grid.
// Pure: no DOM. The server checks every value again; these rules keep the editor from ever
// writing one it would refuse.

const onGrid = (n) => Math.min(100, Math.max(0, Math.round(Number(n) || 0)));

/** The most a setting holds: what it says, else 24. */
export const mostPlaces = (spec) => (Number.isInteger(spec?.max) && spec.max > 0 ? spec.max : 24);

/** A stored value as `[{ kind, x, y }]`: only whole things the setting offers, at most what it holds. */
export function parsePlaces(text, spec) {
  const kinds = new Set((spec?.choices || []).map((choice) => choice.value));
  const out = [];
  for (const item of String(text ?? "").split(";")) {
    const found = /^([a-z0-9-]{1,40})@(\d{1,3}),(\d{1,3})$/.exec(item);
    if (!found || !kinds.has(found[1])) continue;
    const x = Number(found[2]);
    const y = Number(found[3]);
    if (x > 100 || y > 100) continue;
    out.push({ kind: found[1], x, y });
    if (out.length >= mostPlaces(spec)) break;
  }
  return out;
}

/** The list as the one string it is stored as. */
export const formatPlaces = (list) => (Array.isArray(list) ? list : []).map((item) => `${item.kind}@${onGrid(item.x)},${onGrid(item.y)}`).join(";");

/**
 * A free spot for something added without pointing: the middle, else the nearest place on a ring
 * around it that nothing sits within 8 of, else the middle again.
 */
export function freeSpot(list) {
  const taken = (x, y) => list.some((item) => Math.hypot(item.x - x, item.y - y) < 8);
  if (!taken(50, 50)) return { x: 50, y: 50 };
  for (let ring = 1; ring <= 5; ring += 1) {
    for (let step = 0; step < 8 * ring; step += 1) {
      const turn = (step / (8 * ring)) * Math.PI * 2;
      const x = onGrid(50 + Math.cos(turn) * ring * 9);
      const y = onGrid(50 + Math.sin(turn) * ring * 9);
      if (!taken(x, y)) return { x, y };
    }
  }
  return { x: 50, y: 50 };
}

/** Add one. `{ list, index }` with the new thing last, or `null` when it holds no more or isn't offered. */
export function addPlace(list, kind, spec, at) {
  if (list.length >= mostPlaces(spec) || !(spec?.choices || []).some((choice) => choice.value === kind)) return null;
  const spot = at ? { x: onGrid(at.x), y: onGrid(at.y) } : freeSpot(list);
  return { list: [...list, { kind, ...spot }], index: list.length };
}

/** The list with one thing put at a spot, kept on the grid. */
export const putPlace = (list, index, x, y) => list.map((item, at) => (at === index ? { ...item, x: onGrid(x), y: onGrid(y) } : item));

/** The list with one thing moved by a step. */
export const movePlace = (list, index, dx, dy) => (list[index] ? putPlace(list, index, list[index].x + dx, list[index].y + dy) : list);

/** The list without one thing. */
export const removePlace = (list, index) => list.filter((_, at) => at !== index);

/** Which ninth of the picture a spot is in: "tl", "t", "tr", "l", "m", "r", "bl", "b" or "br". */
export function whereabouts(x, y) {
  const row = y < 34 ? "t" : y < 67 ? "" : "b";
  const column = x < 34 ? "l" : x < 67 ? "" : "r";
  return row + column || "m";
}

/** A point on the drawn picture (its box on screen) as a spot on the grid. */
export function spotAt(clientX, clientY, box) {
  if (!box || !(box.width > 0) || !(box.height > 0)) return null;
  return { x: onGrid(((clientX - box.left) / box.width) * 100), y: onGrid(((clientY - box.top) / box.height) * 100) };
}

/** The label a choice goes by, else its value. */
export const placeLabel = (spec, kind) => (spec?.choices || []).find((choice) => choice.value === kind)?.label || kind;
