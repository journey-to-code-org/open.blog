# ONB1 decisions

Settled by `studio-stakeholder` with `studio-architect` and `studio-senior-ux`, 2026-11-16. Each
line says what was decided and why in one sentence.

1. **Extend Getting started, don't add a second onboarding.** About your blog is the opening of
   a Getting started run (`#/welcome` before `#/start`), shown while a login hasn't answered; R9b's
   switch, record, practice run, auto-open rule and stories stay as they are, because they already
   do the first-run path well.
2. **A new route, not the retired one.** R15 removed `GET|PUT preferences` with the old Admin and
   tests that it 404s; the per-login answers use `GET|PUT areas` over the same private file, so the
   retired route stays retired and the v1 files are read, never lost.
3. **Hiding is a list of hidden areas, not of shown ones.** An area added in a later release is
   shown until someone hides it, so a new screen never vanishes silently.
4. **Only an explicit answer hides; skipping hides nothing.** "Today's default" in Studio is
   everything it shows now, so a login that skips sees what it saw yesterday.
5. **A v1 file is answered, and hides almost nothing.** Studio never honoured the old Admin's
   presets; migrating `simple` to "essentials only" would suddenly hide screens owners use, so v1
   reads as `done` with `full` → Show everything and only `research`/`evidence` → research and
   `analytics` → readers carried over.
6. **One question per screen everywhere**, desktop included: the same path for both owners, and
   the address can carry where she is.
7. **Answers ride in the address until saved.** Reload and Back resume without phone storage
   (R9b keeps nothing in `localStorage`), and nothing reaches the server before Save.
8. **"Show me everything" is Show everything.** The sixth question maps to the Full preset; the
   answers are kept so turning it off later applies them.
9. **Stories are the story sets plus her own marks, kept in her preferences.** A rough draft is
   never edited (R9), so a "story" mark can't live on the piece; it lives in `storyMarks`.
10. **Start a post from a story makes a word-for-word polished copy first** when there is none,
    because R9's make-a-post works only from a polished copy and the rough story must stay as told.
11. **#677 is closed, not built:** the old Admin is retired (ADR 0415).
12. **#688 and #689 are satisfied by R9** (`#/voice/write`, `#/voice/guide`); ONB1 adds the kind's
    prompt sets and the offer, and keeps R9's name **Your voice guide** (a site may rename it).
13. **Two config changes, four screens.** Only changes that are one member and always safe are
    applied from a suggestion (`docs.enabled`, `recipes.listing`); anything needing her details
    (business, seasons, comments, sharing accounts) opens its own screen instead.
14. **init records the kind in `.openblog/onboarding.json`**, a private hint, not in
    `openblog.json`: answers are per login and never part of the site's settings.
15. **A practice run applies answers to the window only**, so Mikey sees the effect while
    rehearsing as her and nothing of hers is decided by him.

## Sign-off (`studio-stakeholder`)

Walked the brief's finish line against `qa.md`, `review-grammi.md` and `review-mikey.md`: items 1–9
are met by the tests and reviews named there. **Ship.** Follow-ups: a no-signal browser test for
saving answers; areas for audio episodes and a documentation editor when Studio has those screens;
marking a story from a piece's own page.
