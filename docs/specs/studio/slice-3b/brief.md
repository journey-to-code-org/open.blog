# Studio, slice 3b: Christmas decorations, the tree and gifts

Brief by `studio-stakeholder`, 2026-11-13. Builds on slice 3 (`../slice-3/brief.md`, `decisions.md`, `design.md`). The old Admin at `/admin` keeps running untouched. Mikey confirmed the scope on 2026-11-13; the Rudolph and Misfit Toys look became an original look of her own (see item 1). Auto-publish comes later.

## Outcome

Grammi opens **Decorations** and puts up only what she wants: the garland, the wreath, the village on the mantel, the snow. Each one can be turned on or off on its own, and she can pick which garland or wreath goes up, including a new look of her own. She opens **Your tree** and hangs ornaments from a box, one branch at a time, on her phone. The family visits the site and leaves her a gift under the tree. A gift is a short note, or a card they make in a tiny card maker. Everyone sees the presents pile up, wrapped. Nobody can read one, Grammi included, until Christmas morning, when she opens them one by one in Studio. Strangers can't leave gifts and can't read them. Mikey can see where everything is stored and whether the service is working, and he can clear out spam without opening a present. He never has a theme file rewritten.

## For

**Grammi first.** She judges every first-layer word on Decorations, Your tree and Gifts.

**Family guests second.** They are on a phone, have never seen Studio, and leave a gift in under two minutes with no account to make.

**Mikey must not lose:**
- his theme files, which are never edited by Studio;
- `openblog.json` as written, with only changed values differing (slice 3, A3);
- the truth about where gifts live and what the service did;
- slice 3 as shipped.

## What it takes (in this order)

0. **The family service is switched on.** Right now `engagement.enabled` is `false` and its endpoint is empty, so this is a prerequisite and not optional. Mikey runs `scripts/setup-family-service.sh` this week. Gifts can't be tested without it.
1. **A new Christmas look of Grammi's own** (theme work in `grammis-house`). It is original artwork, not Rudolph or the Island of Misfit Toys: those are someone else's characters and aren't drawn here. It extends `christmas-toyshelf` and supplies the ornament box for the tree. Studio offers it like any other look. *(Mikey picks the idea.)*
2. **Decorations as pieces.** Under the season's look, Decorations lists its pieces (garland, banner, wreath, mantel, pattern, falling snow), each with a switch and **See how it looks**. **Choose another** takes the same piece from any other Christmas look ("Garland: from Grammi's toy shelf"). Pieces she switched off stay off next year. Saving publishes as in slice 3.
3. **Your tree.** A tree on the home page and a box of ornaments. She hangs them by tapping a spot ("Branch 3, left") and then an ornament. There is no dragging. She can move or take down any ornament, and **See how it looks** shows the tree. Readers see the tree all through the Christmas season.
4. **Gifts under the tree.** A family guest taps **Leave a gift for Grammi** under the tree and chooses one of two things:
   - **A note**: up to 1,000 characters, plus "From".
   - **A card**: pick a Christmas design from the greeting-card designs already in the site, write a message and a sign-off, then **See your card** and **Put it under the tree**.

   The guest's status says "Wrapped and under the tree. Grammi opens it on Christmas morning." Gifts can be left from the day Christmas goes up until December 25. Gifts left on Christmas Day can be opened right away.
5. **Wrapped until Christmas, for real.** The service won't hand any gift's contents to anyone before December 25, 12:00 AM Eastern. That includes Studio, Grammi and Mikey's browser. Hiding them in the interface isn't enough.
6. **Christmas morning.** Studio's **Gifts** screen.
   - **Before Christmas**: "6 gifts are waiting under your tree. You can open them on Friday, December 25."
   - **On Christmas morning**: **Open the next gift**, one at a time, with "From …", the note or the card, and **Keep it**.
   - Opened gifts stay in her Gifts screen after Christmas.
7. **Privacy and spam.**
   - Only family can leave a gift.
   - Readers see wrapped boxes and a count. They never see words or names.
   - There are rate limits, and the honeypot follows the comment service's pattern.
   - Mikey can **Take this gift away** without opening it. He sees who it's from and when it arrived.
8. **Mikey's layer.** Details shows:
   - where pieces, the tree and gifts are stored;
   - the service endpoint and its last check;
   - the gift count and when the gifts unlock (UTC and Eastern).

   The palette gets Decorations pieces, Your tree, Gifts, and "Turn off …" for each piece.

## Out of scope

- Opened gifts going on the Family Wall automatically. That is a follow-up.
- Photos or uploads in gifts, and voice messages.
- Guests editing or withdrawing a gift after leaving it (reader receipts exist in `protection.sql`, but they come later).
- Ornaments Grammi draws herself, or a free-form ornament designer.
- Pieces for seasons other than Christmas. The same mechanism should work for them, but they are not tested or promised.
- Gifts for anyone but Grammi, and gifts in other seasons.
- Auto-publish, and a site time zone for builds (slice 3, A4).

## If time runs short

The target dates are:
- decorations and tree live by **December 1** (when Christmas goes up);
- gifts open to family by **December 5**;
- opening rehearsed on a copy by **December 18**;
- frozen on **December 20**.

Cut in this order:
1. The card maker (notes only).
2. **Choose another** for pieces (switches only).
3. The tree on fixed spots, with a pre-hung set she can switch off.

Never cut the following: wrapped-until-Christmas enforced by the server, family-only gifts, privacy, accessibility, the keep-as-written config.

## Finish line

All checks run on a copy of Grammi's House with a test family service. The clock is set to December 2 unless stated.

1. **Grammi** (`user-grammi`, 400 px, a screenshot per step):
   - Turn the wreath off.
   - Swap the garland for the toy-shelf one.
   - Use See how it looks, then save.
   - Hang 5 ornaments, then move one and take one down.
   - Read the Gifts screen's waiting sentence aloud correctly.

   Passes with no help read and no blocker reported.
2. **Family guest** (a `user-grammi`-style stand-in on a phone, 400 px):
   - Leave a note, and separately make and leave a card, each in under two minutes.
   - The tree then shows two more wrapped boxes.
3. **Mikey** (`user-mikey`, keyboard only):
   - Ctrl/Cmd+K "Turn off garland", then save.
   - Hang an ornament without a mouse.
   - Take a spam gift away without seeing its contents.
   - Details shows storage, endpoint and unlock times.
4. **Christmas morning:**
   - At Dec 24 11:59 PM Eastern, every route refuses gift contents. A route test checks the service as well as the UI.
   - At Dec 25 12:00 AM Eastern, Grammi opens all gifts in order.
   - A gift left on Dec 25 opens right away.
   - A gift left on Dec 26 is refused in plain words.
5. **Privacy and spam:**
   - A non-family visitor can't leave a gift.
   - The public page and the network responses contain no gift text or names.
   - The 21st gift from one source within an hour is refused politely.
   - The honeypot catches a scripted post.
6. **Config:**
   - Turning a piece off and on, then saving, gives a byte-identical `openblog.json`.
   - No file under `themes/` changes.
   - The site with every piece on looks identical to slice 3, checked by a screenshot diff.
7. **Accessibility:**
   - axe-core reports no violations on Decorations, Your tree, Gifts, and the guest's gift and card flow.
   - Every spot and ornament is named, and moves are announced.
   - Wrapped boxes have a text alternative ("6 gifts for Grammi, wrapped until Christmas").
   - 320 px, reduced motion (no falling snow, no shaking presents) and contrast all pass.
8. **Housekeeping:**
   - Studio's `node --test`, browser specs and `cargo test -p openblog-cli` pass, with new route tests for pieces, tree and the gift unlock.
   - The service tests pass.
   - `scripts/studio-files.mjs` is clean, and no module is over about 400 lines.
9. **No regressions:** slice 3 checks 1–10 and slice 2 checks 1–9 still pass.
10. **UX checklist:** every new or changed screen passes `studio-ux`, signed by `studio-qa`.

## Open questions

**Architect**
- **A1. Where gifts live.** Should they reuse the comment and notes tables (a moderation inbox already exists), or get a new private table modelled on `greetings.sql` (RLS on, no policies, service role only, an `opens_on` date checked in the function)? *Lean: the new table.* The comment path is built to publish, and one wrong Approve would leak a present.
- **A2. How a guest proves they're family.** One option is per-person invite links sent from her greeting-card address book through Brevo. The other is a family word Grammi sets. *Lean: invite links, with the family word as a fallback for anyone not in the book.* What does each need from the service, and how is a link revoked?
- **A3. Piece switches without breaking themes.** One option is a config member, such as `seasons.decor: { "<theme>": { "corner": false, "garland": "christmas-toyshelf" } }`, applied as token overrides at build. The other is generated child themes. It must keep `openblog.json` as written and leave `themes/` alone. Is the six-piece vocabulary core, or declared by the theme?
- **A4. The tree.** Should it be a Zubra component in `grammis-house` with its arrangement in config, or a landing-section prop? Where is the ornament box declared (`theme.json`)?
- **A5. Unlock time.** The service already knows `America/New_York` (from greetings), and builds run on UTC. Confirm that unlock uses her time zone and that the public "wrapped" view never depends on a rebuild.

**Designers**
- **U1.** Pieces, the tree and gifts: one screen or three? What is the single primary action at 400 px on each?
- **U2.** Hanging an ornament on a phone without dragging: spot first or ornament first?
- **U3.** The card maker's whole flow at 400 px in three steps or fewer. What does a guest see if their invite link has expired?
- **U4.** Christmas morning should feel like a moment, not a list, and still be calm under reduced motion. What does "Open the next gift" look like?
- **U5.** What do readers who aren't family see under the tree?
