---
title: A tour of the lesson demos
subtitle: Networking, web components, modern JavaScript, Web Audio and new browser features, each one hands-on.
date: 2026-05-25
series: teaching-with-code
seriesOrder: 5
tags:
  - tutorial
  - web
  - javascript
  - teaching
description: Every built-in lesson demo in one place, from a simulated network inspector to a Web Audio synth, with the one-line fence that embeds each in your own posts.
---

Beyond Git, open.blog has five more lesson demos for teaching the web platform. Each runs
entirely in the reader's browser against pretend data. Nothing is sent or stored. Each is one
`demo` fence, and the text inside is what readers see where the demo cannot run.

## Networking: `fetch-lab`

A simulated network inspector and storage panel. Edit a request, watch what `fetch()` and
`response.json()` do with it, and fill up `localStorage` until it hits its quota.

```demo fetch-lab title="What fetch() really does"
`fetch()` resolves as soon as the response **headers** arrive, even for a 404 or a 500, so
always check `response.ok`. Reading the body with `response.json()` is a second, separate wait.
```

The same lab has three more scenarios. Pick one with `lesson="…"`:

```demo fetch-lab lesson="caching" title="Caching with a pretend clock"
A response with `Cache-Control: max-age=60` is reused without asking the server for a minute.
After that, the browser sends the `ETag` back in `If-None-Match`, and the server answers
**304 Not Modified** with an empty body if nothing changed.
```

- `lesson="login"`: cookies, `credentials: "include"` and CORS.
- `lesson="caching"`: `Cache-Control`, `ETag` and 304 responses, with a clock you control.
- `lesson="testing"`: replacing `fetch` with a stub so tests do not need a server.

## Web components: `component-lab`

A live custom element with a shadow root. Change its attributes, its slotted content and the
CSS custom properties that reach inside it, and see which styles get through.

```demo component-lab title="Inside a custom element"
A custom element keeps its own markup and styles in a **shadow root**. Page styles cannot reach
inside, except through CSS custom properties such as `--accent`, which the component chooses to
read. Content you put between its tags is shown through a `<slot>`.
```

## Modern JavaScript: `js-evolution`

The same task written in 2015, 2017 and 2020 JavaScript, side by side, run on the same data.

```demo js-evolution title="Ten years of JavaScript"
Callbacks became promises (2015), promises became `async`/`await` (2017), and defensive checks
like `user && user.address && user.address.city` became `user?.address?.city` (2020). Each
version gives the same answer, and each newer one has less to read.
```

## Sound: `audio-lab`

A real, quiet synthesiser built from the Web Audio API: an oscillator, a low-pass filter and a
live trace of the signal. Sound plays only after the reader presses **Start**.

```demo audio-lab title="A synth in your browser"
An **oscillator** makes a tone at a frequency (440 Hz is the A above middle C), and its wave
shape (sine, square, sawtooth, triangle) changes its character. A **low-pass filter** removes
frequencies above its cutoff, making the sound darker.
```

## New browser features: `native-lab`

View Transitions, the Web Animations API, the `popover` attribute, and the Intersection and
Resize observers. Each reports whether the reader's browser supports it.

```demo native-lab title="What browsers can do now"
Many effects that once needed a library are now built into browsers: animated page changes
(**View Transitions**), tooltips and menus that need no JavaScript (the **popover** attribute),
and knowing when an element scrolls into view (**IntersectionObserver**).
```

## Embedding one in your own post

````markdown
```demo fetch-lab lesson="caching" title="Caching with a pretend clock"
What the reader sees if the demo cannot run: a short worked example works best.
```
````

| Kind | Teaches |
| --- | --- |
| `git-sandbox` | Commits, branches, merges and conflicts |
| `git-practice` | Git commands, one checked goal at a time |
| `fetch-lab` | `fetch`, JSON, storage, cookies and CORS, caching, testing |
| `component-lab` | Custom elements, shadow DOM, slots, CSS custom properties |
| `js-evolution` | How JavaScript changed from 2015 to 2020 |
| `audio-lab` | Oscillators, filters and the Web Audio graph |
| `native-lab` | View Transitions, Web Animations, popover, observers |

Leave the body empty to use the demo's own one-paragraph description, but text written for your
lesson is a better fallback.

That is the end of this series. To show off finished work instead of code, see
[For trades and local businesses](/series/for-trades-and-local-business/).
