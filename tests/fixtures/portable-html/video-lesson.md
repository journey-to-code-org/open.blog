---
title: Gate of Embers — a lesson
date: 2026-10-24
profile: video
videoUrl: https://youtu.be/dQw4w9WgXcQ
comments: open
---
A lesson about the café gate, with a [relative link](../reference/) and a [section link](#chapters).

## Chapters

00:00 The gate opens
00:14 A warning & a `<script>` in the *dark*
1:02:03 Into the ruin — Ünter

> [!NOTE]
> Nested inside a callout:
>
> ```rust runnable title="src/<main> &amp; 'lib'.rs"
> fn main() { println!("</code></pre><script>alert(1)</script>"); }
> ```

```quiz
Which tag opens a **disclosure** without `<script>`?
- [ ] `<dialog onclick="alert(1)">`
- [x] `<details>`
- [ ] `<ob-quiz>`
> Native disclosure works without JavaScript — even in Zürich.
```

```quiz
Is the answer shown before the reader asks?
- [x] No
- [ ] Yes
```

```web runnable title="Try it"
---html
<button onclick="alert(1)">Hi</button>
---css
button { color: red; }
---js
document.body.append('</script><img src=x onerror=alert(1)>');
```

```python runnable
print("runs on the canonical page")
```

- [A pen about gates <3](https://codepen.io/u/pen/abc)

  A loose list item keeps its embed link.

%[https://codepen.io/team/acme/pen/xyz]

![The café gate](/images/café-gate.png)
