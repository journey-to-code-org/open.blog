import assert from "node:assert/strict";
import test from "node:test";

globalThis.HTMLElement = class extends EventTarget {};
globalThis.customElements = { get: () => undefined, define() {} };
const { ObEpisode, timeParameter } = await import("../../web/components/ob-episode.js");

class Button extends EventTarget {
  constructor(time) {
    super();
    this.dataset = { audioTime: time };
    this.disabled = true;
  }
}

class Audio extends EventTarget {
  duration = 100;
  currentTime = 0;
  readyState = 1;
}

function fixture(search = "") {
  globalThis.location = { search };
  const audio = new Audio();
  const buttons = [new Button("12"), new Button("99"), new Button("-1")];
  const component = new ObEpisode();
  component.querySelector = () => audio;
  component.querySelectorAll = () => buttons;
  component.connectedCallback();
  return { audio, buttons, component };
}

test("time parameters reject ambiguous and invalid values", () => {
  for (const search of ["", "?t=", "?t=-1", "?t=Infinity", "?t=1e2", "?t=1&t=2", "?t=1x"]) {
    assert.equal(timeParameter(search), null, search);
  }
  assert.equal(timeParameter("?t=12.5"), 12.5);
  assert.equal(timeParameter("?t=0"), 0);
});

test("chapter buttons seek without starting playback and disable on removal", () => {
  const { audio, buttons, component } = fixture();
  assert.deepEqual(buttons.map((button) => button.disabled), [false, false, true]);
  buttons[0].dispatchEvent(new Event("click"));
  assert.equal(audio.currentTime, 12);
  audio.duration = 20;
  buttons[1].dispatchEvent(new Event("click"));
  assert.equal(audio.currentTime, 12);
  component.disconnectedCallback();
  assert.ok(buttons.every((button) => button.disabled));
  buttons[0].dispatchEvent(new Event("click"));
  assert.equal(audio.currentTime, 12);
});

test("a time link seeks only after play, waits for metadata and applies once", () => {
  const { audio } = fixture("?t=42");
  audio.readyState = 0;
  assert.equal(audio.currentTime, 0);
  audio.dispatchEvent(new Event("play"));
  assert.equal(audio.currentTime, 0);
  audio.readyState = 1;
  audio.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(audio.currentTime, 42);
  audio.currentTime = 5;
  audio.dispatchEvent(new Event("play"));
  assert.equal(audio.currentTime, 5);
});

test("out of range time links do not seek", () => {
  const { audio } = fixture("?t=100");
  audio.dispatchEvent(new Event("play"));
  assert.equal(audio.currentTime, 0);
});

test("choosing a chapter wins over a time link awaiting metadata", () => {
  const { audio, buttons } = fixture("?t=42");
  audio.readyState = 0;
  audio.dispatchEvent(new Event("play"));
  buttons[0].dispatchEvent(new Event("click"));
  audio.readyState = 1;
  audio.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(audio.currentTime, 12);
});
