---
title: HTML, CSS and JavaScript sandboxes
subtitle: Three editable tabs, a live preview and a console, running safely in the reader's browser.
date: 2026-05-11
series: teaching-with-code
seriesOrder: 3
tags:
  - tutorial
  - web
  - javascript
  - teaching
description: Teach front-end code with web runnable blocks, which have HTML, CSS and JS tabs, a live preview, a console panel, working forms and storage, and opt-in modules and network access.
---

Web lessons are best when the reader can change a colour and see it change. A `web runnable`
block gives them three editable tabs (HTML, CSS and JavaScript), **Run preview** and **Reset** buttons,
and a live preview. Nothing is uploaded. The preview runs in a locked-down frame in the reader's
own browser.

## A first sandbox

Change the colour in the CSS tab, or the message in the JS tab, and press **Run preview**.

```web runnable title="A button that counts"
---html
<button id="count">Clicked 0 times</button>
---css
button {
  font: inherit;
  padding: 0.75rem 1.25rem;
  border: 0;
  border-radius: 999px;
  background: rebeccapurple;
  color: white;
}
---js
let clicks = 0;
document.querySelector("#count").addEventListener("click", (event) => {
  clicks += 1;
  event.currentTarget.textContent = `Clicked ${clicks} time${clicks === 1 ? "" : "s"}`;
  console.log("click number", clicks);
});
```

````markdown
```web runnable title="A button that counts"
---html
<button id="count">Clicked 0 times</button>
---css
button { background: rebeccapurple; color: white; }
---js
document.querySelector("#count").addEventListener("click", ...);
```
````

The `---html`, `---css` and `---js` lines split the block into tabs. Each section is optional.

## The console, forms and storage

Click the button above and look under the preview. `console.log`, warnings, errors and uncaught
exceptions appear in a **Console** panel, so lessons can teach debugging too. Forms fire their
`submit` event, and `localStorage` works for the life of the preview:

```web runnable title="A to-do list that remembers"
---html
<form id="add">
  <input name="task" placeholder="Something to do" required>
  <button>Add</button>
</form>
<ul id="list"></ul>
---css
body { font-family: system-ui, sans-serif; }
li { padding: 0.25rem 0; }
---js
const list = document.querySelector("#list");
const saved = JSON.parse(localStorage.getItem("tasks") ?? "[]");
const render = () => {
  list.replaceChildren(...saved.map((task) => {
    const item = document.createElement("li");
    item.textContent = task;
    return item;
  }));
};
document.querySelector("#add").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = event.currentTarget.task;
  saved.push(input.value);
  localStorage.setItem("tasks", JSON.stringify(saved));
  console.log(`Saved ${saved.length} task(s)`);
  input.value = "";
  render();
});
render();
```

`alert`, `confirm` and `prompt` work too. Real form submission and page navigation stay blocked.

## Modules and top-level `await`

Add `module` after `web runnable` to run the JavaScript as an ES module. It allows `import` and
`export` syntax, and `await` outside a function:

```web runnable module title="Waiting with top-level await"
---html
<p id="status">Starting…</p>
---js
const status = document.querySelector("#status");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (const step of ["Mixing", "Rising", "Baking", "Done!"]) {
  status.textContent = step;
  console.log(step);
  await wait(700);
}
```

There is nothing to import from, so keep a module lesson in one file.

## Opting in to the network and images

By default a lesson cannot reach the internet. That is the safe choice for a page anyone can
edit. When a lesson is *about* fetching data, add `network` (HTTPS `fetch`) or `images`
(HTTPS images). Readers then see a note that the preview may contact other sites:

````markdown
```web runnable network module title="Load a user"
---js
const user = await (await fetch("https://jsonplaceholder.typicode.com/users/1")).json();
```
````

Site-hosted libraries such as React can be loaded with `libs=react` once they are listed under
`webSandbox.libraries` in `openblog.json`. `openblog check` reports a `libs=` name that is not
configured.

## How safe is it?

The preview runs in an iframe with an opaque origin and a strict content security policy. It
cannot read the blog's page, cookies or storage. It cannot load outside resources unless the
author opted in, and it cannot submit forms or open frames. Code can still navigate its own
preview, so the editor reminds readers never to type secrets into it.

Readers without JavaScript, and copies in feeds or on other sites, see the HTML, CSS and
JavaScript as ordinary code blocks.

Next: [Git without fear](/posts/git-without-fear/).
