// open.blog front-end entry. Everything here is progressive enhancement: the
// pages are complete HTML without it. Each component is an autonomous custom
// element in its own file, so a theme or fork can drop any of them.
// Themes add their own components through "scripts" in theme.json
// (see docs/theme-components.md and themes/demo/).
//
// A component is fetched only when its element is on the page, so a post with
// no lab never downloads one. Each file is named after the element it defines.
// Elements a script adds later (a theme may build an <ob-search> in a dialog)
// load their component the moment they are inserted.
const components = [
  "ob-theme-toggle",
  "ob-code",
  "ob-rust-playground",
  "ob-code-runner",
  "ob-web-sandbox",
  "ob-git-sandbox",
  "ob-practice-lab",
  "ob-fetch-lab",
  "ob-component-lab",
  "ob-evolution-lab",
  "ob-audio-lab",
  "ob-native-lab",
  "ob-recipe",
  "ob-quiz",
  "ob-reading-modes",
  "ob-back-to-top",
  "ob-search",
  "ob-share",
  "ob-views",
  "ob-comments",
  "ob-abuse-report",
  "ob-conversation",
];

const pending = new Set(components);

function load(root) {
  for (const name of pending) {
    if (root.matches?.(name) || root.querySelector?.(name)) {
      pending.delete(name);
      import(`./components/${name}.js`);
    }
  }
}

load(document);

if (pending.size) {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) load(node);
      }
    }
    if (!pending.size) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
