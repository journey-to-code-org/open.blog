# ONB1: QA sign-off

By `studio-qa`, 2026-11-16, against the `studio-ux` checklist and `ux.md`. Played by the agent that
built the slice, following `.claude/agents/studio-qa.md`; every check below was run, and anything not
run says so.

## Test runs

| Run | Result |
| --- | --- |
| `cargo test --workspace` | all pass (openblog-cli: 1,418), including `admin::tests::areas_routes` (10), `admin_preferences::tests` (6), `areas::tests` (2), `scaffold::tests` for `--kind` (3) |
| `cargo clippy --workspace --all-targets -D warnings`, `cargo fmt` | clean |
| `node --test tests/web/*.test.mjs` | 2,195 pass; 1 fail: "container Git recovery", environment-only (passes on CI) |
| New node tests: `studio-area-rules`, `studio-welcome-rules`, `studio-story-list-rules` | 19 pass |
| `tests/browser/studio-onboarding.spec.mjs` | 5 pass, twice in a row |
| `tests/browser/studio-start.spec.mjs` (R9b, updated to answer first) | 17 pass |
| Every other `tests/browser/studio-*.spec.mjs` (441 tests) | 439 pass; `studio-look` "choose a look…" and `studio-readers-notes` "a shown question…" failed once in the 40-minute run and pass alone on this branch (timing in a long run; neither touches areas) |
| `node scripts/check-doc-links.mjs`, words and file lists (`--check`) | clean |

## The checklist, screen by screen

| Check | About your blog (questions, summary, suggestions, offer) | What you use | Turned off | My stories / Stories you could tell |
| --- | --- | --- | --- | --- |
| Job and one primary action at 400 px | yes: Next / Save these / Next / Start, sticky above the keyboard | switches save by themselves; no Save needed | Turn it on | Write another story |
| Keyboard only | Mikey's journey: Space chooses, Ctrl+Enter is Next, Alt+← is Back; focus on each h2 | Space toggles; status said | Tab then Enter | buttons named "Read it: <title>" |
| axe (WCAG 2.1 AA) at 320 px, nothing sideways | question 1, summary, suggestions, offer; question 1 in dark mode | light and dark | yes | My stories |
| Reduced motion | Mikey's journey runs with `reducedMotion: reduce`; no motion is added | | | |
| Errors in words | save: no signal, changed elsewhere, not saved; suggestions: stale, failed, didn't load | a failing save puts the switch back and says "That wasn't saved. Try again." (tested) | turn on failed / no signal | didn't load + Try again; post couldn't be made |
| Nothing lost | answers ride in the address (reload resumes: tested); nothing saved before Save these (tested) | turning off deletes nothing | | stories are never edited; a post is made from a copy |
| Her layer has no system words | banned-word test passes for every new id | | | |
| Mikey one step away | For … shows the saved body; suggestion's exact lines | For … lists ids and state | Find: Turn on … | Find: My stories, Stories you could tell |

## Edges tried

- Reload mid-questions; Back after answering; skip a question; skip all (More).
- A technical answer on a site that has a recipe post: Recipes stays, "Already on your blog".
- A save refused by the server (switch goes back); a change in another window (adopted when the
  window is shown again); suggestions declined (file byte for byte), a stale file (refused, Rust),
  applied twice (refused "already", Rust).
- A co-writer: the four new routes refuse a co-writer sign-in (route-table test).

## Not run

- A real iPhone or iPad (Playwright's Chromium at 400 px and 320 px only).
- A screen reader by ear; names and live regions were checked through the accessibility tree.
- No signal while saving answers (the words exist and follow R9b's; not exercised in a browser).

## Findings

None left open. Fixed during QA: the summary's **Change** links were the browser's blue and far
apart (now the blog's colour, at the end of each line, 44 px tall); the journeys waited on screens
that hadn't arrived yet; a story typed from a non-story prompt isn't in My stories, which is as
specified (only story sets and her own marks count), so the test now picks the story prompt.

**Sign-off:** ship.
