# ONB1: Mikey walks it (technical, desktop, keyboard only)

By `user-mikey`, 2026-11-16. Walked against `ux.md` before building and then on the running Studio
at 1280 px with the keyboard alone and reduced motion (the browser journey "Mikey by keyboard" in
`tests/browser/studio-onboarding.spec.mjs`, plus the documentation-blog suggestion test). The
persona was played by the agent that built the slice, following `.claude/agents/user-mikey.md`.

## Tasks

1. Answer as a technical blog with no seasons, by keyboard.
2. Check that nothing seasonal, recipe-shaped or of a business shows in the navigation, Find, Home
   or Write.
3. Turn a tucked-away part back on from its address, from Find, and from What you use.
4. Check the exact change behind a suggested site change.

## Slow

- Six questions is six screens. **Ctrl+Enter** is Next on every one, **Alt+←** is Back, and **More
  › Skip the questions** ends it, so it's a few seconds. Fine.
- *Asked for:* a way to answer again without clicking through the menu. Find has **Ask me the
  questions again** and **What you use**. Done.

## Hidden

- Nothing I needed was missing. Every tucked-away part is in Find as **Turn on …**; its address
  says it's turned off and offers **Turn it on**, and lands on the screen I asked for.
- *Asked for:* see what was saved for this login. **What you use › For the person who set up your
  site** lists the hidden ids, Show everything, the state and the kind; the summary's details show
  the exact body that is saved.

## Trust

- The suggestion card shows the exact `openblog.json` lines one layer deeper, and the file didn't
  change until I pressed **Do this**; what changed was exactly what was shown (route and browser
  tests compare them).
- A suggestion is refused if the file changed since it was shown, and says so.
- *Raised:* a notification for a quote request landing on "Your business is turned off for you"
  would be confusing. *Folded back:* a site with the quote form set up now counts as using its
  business area, so it can't be tucked away (as comments already do for Readers).
- *Raised:* would hiding Readers hide comments waiting for moderation? No: a site with comments on
  uses Readers, so it always shows.

## Grammi-safe

- Turning things off deletes nothing, and the page says so.
- **Do this** is the only thing that changes the site, and it only turns one setting on.
- Her answers are hers: mine on the same site don't change what she sees. A rehearsal as her
  applies answers to that window only.

No blocker left.
