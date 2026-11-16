# ONB1 brief: first-run questions that shape Studio to the blog

By `studio-stakeholder`, 2026-11-16. Epic #666 (stories #667, #670, #674, #678, #680, #683, #686).
Read with `architecture.md` (shape), `ux.md` (every screen, state and word), `decisions.md`.

## Outcome

A person opening their blog's Studio for the first time answers up to six plain questions
("What will you mostly write?", "Will anyone else write with you?", ...) and from then on sees
the tools that blog needs: a family cook never meets cross-posting, research or code; a technical
writer never meets decorations, greeting cards, recipe boxes or business screens. Nothing is
taken away for good: anything the site already uses always shows, a hidden part is one press away
(its own address, Find, and **What you use**), the answers can be changed or asked again, and
**Show everything** turns hiding off. The questions can also suggest site changes (a
documentation section, a recipe list), each shown with the exact change and applied only on a
press. `openblog init` asks the first question too, so Studio starts from the same answer. At the
end, the existing Getting started (R9b) offers the writing exercise with prompts that suit the
blog, always including a true story, and the stories told are gathered in **My stories** and
beside Write.

## For

- **Grammi first** (recipes, phone, 400 px): six taps or fewer, every one skippable, and a
  summary that says in her words what she'll see and why.
- **Mikey must not lose** anything: every hidden part is reachable from Find in one step ("Turn
  on Research"), the exact `openblog.json` change sits one layer deeper on each suggestion, and
  his own login can show everything while hers stays simple (answers are per login).

## Out of scope

- The old Admin following the areas (#677): the old Admin was retired in R15 (ADR 0415). Closed
  with a note.
- Areas for parts Studio doesn't have yet (audio episodes, a documentation editor): they join the
  catalog with their screens, as the ADR says.
- Marking any piece of writing as a story from its own page (only the story sets and **Keep with
  my stories** in My stories count in this slice; see `decisions.md` 9).
- Renaming R9's **Your voice guide** to "How you write": R9 already proposes the guide habit by
  habit with quotes and saves only what she keeps (#689 is satisfied there; a site can rename it
  with `studio.words`).

## Finish line

1. On a new site with Getting started on, the first sign-in opens **About your blog**; finishing
   or skipping lands in Getting started's stories (or Home), and is remembered for that login
   (`studio-onboarding.spec.mjs`, "Grammi on a phone").
2. A login that answered "Technical writing" with seasons No sees no Decorations, Cards, Gifts,
   recipe choice, business screens or Reminders in the navigation, Home, Find or Write; a
   "Recipes" login sees no Sharing, Research, or code items (`studio-onboarding.spec.mjs`, both
   journeys; `studio-area-rules.test.mjs`).
3. A site that has recipes, answered as technical, still shows recipes, with the reason "Already on
   your blog" (browser test and table test).
4. A hidden part's address shows "<Area> is turned off for you" with **Turn it on**; Find offers
   "Turn on <Area>"; What you use has a switch; all three work (browser test, Mikey turns on Code
   and diagrams from What you use and Research from Find).
5. Declining every suggestion leaves `openblog.json` byte for byte; an applied one produces exactly
   the change shown (Rust route tests).
6. `openblog init --kind technical` writes the plain starter and the hint; `--kind trade` equals
   `--starter trade`; no prompt without a terminal (scaffold tests).
7. The voice offer draws prompts from the kind's sets plus one story; My stories lists a story
   told in Getting started; Write's **Stories you could tell** shows it; starting a post from it
   leaves the story unchanged (browser test).
8. axe clean, keyboard-only, 320 px and reduced motion on About your blog, the summary, the
   suggestions, the voice offer, What you use, the turned-off page and My stories; `studio-qa`
   signs the checklist (`qa.md`).
9. Spec, ADRs 0416–0419, the guide (`docs/admin.md`), CHANGELOG, generated words and CLI
   reference are complete; doc-link and coverage tests pass.
