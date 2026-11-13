// Load Zubra UI elements on demand: a screen awaits `use(...)` for what it needs before it builds,
// so each element is defined (and its props are real setters) before Studio creates one.
const loaded = new Map();

export function use(...names) {
  return Promise.all(names.map((name) => {
    if (!loaded.has(name)) loaded.set(name, import(`./zubra/cdn/${name}.js`).then(() => customElements.whenDefined(name)));
    return loaded.get(name);
  }));
}
