// Things set down on a picture (ADR 0434): the editor's rules. The server checks every value
// again (crates/openblog-core/src/components.rs); these keep the editor from writing one it refuses.
import test from "node:test";
import assert from "node:assert/strict";
import { addPlace, formatPlaces, freeSpot, mostPlaces, movePlace, parsePlaces, placeLabel, putPlace, removePlace, spotAt, whereabouts } from "../../web/studio/parts/places-rules.js";

const spec = { max: 3, choices: [{ value: "star", label: "Star" }, { value: "red-ball", label: "Red ball" }] };

test("a stored value is read as whole things the setting offers, and written back one way", () => {
  assert.deepEqual(parsePlaces("star@0,100;red-ball@7,42", spec), [{ kind: "star", x: 0, y: 100 }, { kind: "red-ball", x: 7, y: 42 }]);
  assert.deepEqual(parsePlaces("bow@1,1;star@101,1;star@1;star@1,1,1;star@-1,1;star@1.5,2;;star@5,6", spec), [{ kind: "star", x: 5, y: 6 }]);
  assert.deepEqual(parsePlaces("star@1,1;star@2,2;star@3,3;star@4,4", spec).length, 3, "no more than it holds");
  assert.deepEqual(parsePlaces(null, spec), []);
  assert.deepEqual(parsePlaces("star@1,1", null), []);
  assert.equal(formatPlaces([{ kind: "star", x: 0.4, y: 100.6 }, { kind: "red-ball", x: -3, y: 42 }]), "star@0,100;red-ball@0,42");
  assert.equal(formatPlaces(null), "");
  assert.equal(formatPlaces(parsePlaces("star@0,100;red-ball@7,42", spec)), "star@0,100;red-ball@7,42");
  assert.equal(mostPlaces({}), 24);
  assert.equal(mostPlaces({ max: 2.5 }), 24);
});

test("adding, moving and taking off keep the list whole and on the grid", () => {
  const one = addPlace([], "star", spec);
  assert.deepEqual(one, { list: [{ kind: "star", x: 50, y: 50 }], index: 0 });
  const two = addPlace(one.list, "red-ball", spec);
  assert.equal(two.index, 1);
  assert.ok(Math.hypot(two.list[1].x - 50, two.list[1].y - 50) >= 8, "the second doesn't land on the first");
  const three = addPlace(two.list, "star", spec, { x: 140, y: -9 });
  assert.deepEqual(three.list[2], { kind: "star", x: 100, y: 0 });
  assert.equal(addPlace(three.list, "star", spec), null, "it holds no more");
  assert.equal(addPlace([], "bow", spec), null, "only what it offers");
  assert.deepEqual(movePlace(three.list, 2, 5, -5)[2], { kind: "star", x: 100, y: 0 });
  assert.deepEqual(movePlace(three.list, 0, -3, 4)[0], { kind: "star", x: 47, y: 54 });
  assert.equal(movePlace(three.list, 9, 1, 1), three.list);
  assert.deepEqual(putPlace(three.list, 1, 12.6, 200)[1], { kind: "red-ball", x: 13, y: 100 });
  assert.deepEqual(removePlace(three.list, 0).map((item) => item.kind), ["red-ball", "star"]);
  const crowded = Array.from({ length: 400 }, (_, i) => ({ kind: "star", x: (i % 20) * 5, y: Math.floor(i / 20) * 5 }));
  assert.deepEqual(freeSpot(crowded), { x: 50, y: 50 }, "a full picture still answers");
});

test("a spot is said in plain words, and a point on the picture becomes a spot", () => {
  assert.deepEqual([[5, 5], [50, 5], [95, 5], [5, 50], [50, 50], [95, 50], [5, 95], [50, 95], [95, 95]].map(([x, y]) => whereabouts(x, y)), ["tl", "t", "tr", "l", "m", "r", "bl", "b", "br"]);
  const box = { left: 100, top: 200, width: 300, height: 400 };
  assert.deepEqual(spotAt(250, 400, box), { x: 50, y: 50 });
  assert.deepEqual(spotAt(0, 9999, box), { x: 0, y: 100 });
  assert.equal(spotAt(1, 1, { left: 0, top: 0, width: 0, height: 0 }), null);
  assert.equal(placeLabel(spec, "red-ball"), "Red ball");
  assert.equal(placeLabel(spec, "gone"), "gone");
});
