// Enhances an episode's native player; the audio controls work without JavaScript.
const BaseElement = globalThis.HTMLElement ?? class {};

export function timeParameter(search) {
  const values = new URLSearchParams(search).getAll("t");
  if (values.length !== 1 || !/^\d+(?:\.\d+)?$/.test(values[0])) return null;
  const time = Number(values[0]);
  return Number.isFinite(time) ? time : null;
}

export class ObEpisode extends BaseElement {
  #controller = null;
  #buttons = [];

  connectedCallback() {
    if (this.#controller) return;
    const audio = this.querySelector("audio");
    if (!audio) return;
    const controller = new AbortController();
    this.#controller = controller;
    const { signal } = controller;
    let chapterChosen = false;
    this.#buttons = [...this.querySelectorAll("button[data-audio-time]")];
    for (const button of this.#buttons) {
      const time = timeParameter(`t=${encodeURIComponent(button.dataset.audioTime ?? "")}`);
      if (time === null) continue;
      button.disabled = false;
      button.addEventListener("click", () => {
        if (Number.isFinite(audio.duration) && time >= audio.duration) return;
        chapterChosen = true;
        audio.currentTime = time;
      }, { signal });
    }

    const initialTime = timeParameter(globalThis.location?.search ?? "");
    if (initialTime !== null) {
      audio.addEventListener("play", () => {
        const seek = () => {
          if (chapterChosen || !Number.isFinite(audio.duration) || initialTime >= audio.duration) return;
          audio.currentTime = initialTime;
        };
        if (audio.readyState >= 1) seek();
        else audio.addEventListener("loadedmetadata", seek, { signal, once: true });
      }, { signal, once: true });
    }
  }

  disconnectedCallback() {
    this.#controller?.abort();
    this.#controller = null;
    for (const button of this.#buttons) button.disabled = true;
    this.#buttons = [];
  }
}

if (globalThis.customElements && !customElements.get("ob-episode")) {
  customElements.define("ob-episode", ObEpisode);
}
