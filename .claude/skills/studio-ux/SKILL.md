---
name: studio-ux
description: open.blog Studio's UI/UX standard (the new Admin built on Zubra UI). Use when designing, building, writing copy for, or reviewing any Studio screen.
---

# Studio UX standard

Studio is where an owner runs an open.blog site. It serves two people at once, and every screen is judged by both:

- **Grammi** (the owner who writes): not technical, writes recipes and family stories, wants to put words up and get back to the kitchen. She must never meet a file path, a setting name, JSON, Git, a status code or a word like "deploy", "push", "subscription", "PWA", "service worker", "permission", "endpoint", "device" or "browser" (except to name the app she is in: "Safari", "Chrome"). She says "phone", "iPad" or "computer".
- **Mikey** (the owner who builds): a developer who set the site up. Wants speed, the keyboard, everything reachable, and the truth about what the system did.

The answer is _layers_: the first layer of every screen is Grammi's; Mikey's power sits one deliberate step deeper (a **More** menu, a details panel, the command palette), never in her way and never missing.

## Principles

1. **One job per screen.** Each screen answers one question ("What do I want to write?", "When does the house change?"). Its title says the job in her words. Anything that serves a different job moves to its own screen.
2. **The next step is obvious.** One primary action per screen, visible without scrolling at 400 px. Secondary actions are quieter buttons; rare or risky ones live in **More**.
3. **Her words, not the system's.** Name things by what she does: _Write_, _Publish_, _Recipes_, _Decorations_, _Cards_. Same action, same word, in the button, the toast and the help: a button that says **Publish** produces "Published". In her own words the product is _your blog_: "Studio" and "Admin" never appear in her sentences ("Your blog can post for you", not "Studio can post for you"); they may appear in details for Mikey.
4. **Nothing is lost.** Every edit autosaves as a draft; leaving with unsaved work asks first; every destructive action can be undone, or shows exactly what goes and asks once in plain words.
5. **Say what happened.** After every action, a short status in words ("Saved. Your readers will see it in about a minute."). Errors say what went wrong and how to fix it, never apologise and never show a code. Empty screens invite the first action.
6. **Calm, warm, large.** Base text 18 px, controls at least 44 px tall, generous spacing, one accent colour. Motion only to show what changed, and none under reduced motion.
7. **Works on her phone.** One column at 400 px with nothing scrolling sideways; the same screen widens into columns on a desktop. Every screen works in the installed app, which has no Back button or address bar: every screen has its own way home.

## Accessibility (the floor, not a goal)

- WCAG 2.2 AA: text contrast 4.5:1 (7:1 for body text is the target), focus always visible, every control named, targets 44 px.
- Keyboard only: every action reachable, logical order, no traps; Escape closes what opened.
- Status messages in a live region; errors linked to their field and focus moves to the first one.
- Works at 400% zoom (320 CSS px) and with reduced motion.

## Zubra UI

Studio is built from Zubra UI components, themed through Studio's tokens. Reach for the component before writing markup:

| Need | Component |
| --- | --- |
| Page frame, navigation | `sidebar-layout` (desktop), `nav-bar`, `breadcrumb-trail` |
| Buttons | `action-button` |
| Text, numbers, dates | `text-field`, `money-input`, `date-field`, `date-range` |
| On/off, one of a few, one of many | `toggle-switch`, `segmented-control` / `choice-cards` / `radio-group`, `select-field` / `combo-box` |
| Tags | `tag-input` |
| Confirm, edit in place | `modal-dialog`, `side-sheet` |
| Status | `toast-region`, `alert-banner`, `status-badge` |
| Lists of things | `data-table`, `content-card`, `empty-state` |
| Uploads | `file-drop` |
| Find anything | `command-palette` |
| Progress | `step-indicator`, `progress-bar`, `loading-spinner`, `skeleton-block` |

When a component falls short, fix or extend it in zubra-ui and re-vendor it (see `studio-architecture`); a Studio-only fork is the last resort and is written down in the screen's notes.

## Words

- Sentence case everywhere. Buttons are verbs ("Publish", "Add a recipe"). Labels are nouns.
- One short sentence of help under a field, only when the label can't carry it.
- Dates and times as people say them: "Friday, November 27 at 8 AM".
- Numbers she cares about, never internals: "3 recipes waiting", not "3 drafts (status=draft)".

## Review checklist

A screen passes when every line holds:

- [ ] Its job and its one primary action are clear at 400 px without scrolling.
- [ ] Grammi can finish its main task without reading help; nothing on the first layer is technical.
- [ ] Mikey can reach every advanced option in one step (More, details or the command palette).
- [ ] Every action ends in a status in words; every error names its field and the fix.
- [ ] Unsaved work is never lost; destructive actions undo or ask once.
- [ ] Keyboard only, screen reader names, 320 px reflow, reduced motion, contrast: all pass.
- [ ] Built from Zubra UI components themed by Studio tokens, with no one-off styles.
- [ ] Her layer says "your blog", never "Studio" or "Admin"; platform steps show only the ones for the device in her hand.
