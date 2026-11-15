# Studio UX, retirement slice R14: Writing together

By `studio-ux`, 2026-11-14. One spec for the slice, split in two (**R14a**, **R14b**; §Split). Sources: `studio-ux`, `studio-architecture`, `words/spec.md` (ids, `say()`, `{helper}` `{product}` `{owner}`, persona rule, `HER_BANNED`), `docs/studio-words.md`, `retirement-plan.md` (§1 G "Collaboration", §1 H, §2 invitation links `admin.rs:13009`, §4 R14, Decided 2 and 4), `r5/ux.md` (People, Who wrote it, `shared-order`/`shared-rebind`, `in-shared-reflection`, "shared-reflection keys" read-only), `r6/ux.md` (word box, cards in place), `r7/ux.md` (preview sandbox), `r10/ux.md` ("Answer as {author}", coordinator role words), `r11/ux.md` (shape, gate, private-stays-private); old Admin `web/admin/admin.js`: helpers l.7101–7980 (`SHARED_SOURCE_KINDS`, `validateSharedReflectionDraft`, `INVITATION_ROLES`, `invitationPayload`, `invitationTokenFromHash`, `removalImpact`, `roleChangeImpact`, `invitationStatusText`, `REFLECTION_PROMPTS`, `draftStateText`, `draftFailure`, `SYNTHESIS_KINDS`, `MOMENT_LOCATOR_KINDS`, `QUOTATION_RIGHTS`, `momentPayload`, series helpers, `REVEAL_POLICIES`, `revealSlotText`, `previewSectionText`, `APPROVAL_REQUIREMENTS`, `approvalPolicyPayload`, `PART_MARKER_LINE`, `ARRANGEMENT_LAYOUTS`, `arrangementPayload`, `validateArrangement`, `lookupSourceDetails`), views l.18314–20516 (`showSharedReflections`, `showSharedReflectionForm`, `invitationPanel`, `seriesPanel`, `draftPanel`, `synthesisPanel`, `momentsPanel`, `showInvitationAccept`); Admin API `crates/openblog-cli/src/admin.rs` route table l.1132–1167, `collaboration_identities` 12954, `shared_publication_summary` 12943, `invitation_link` 13291, `draft_not_found` 13596, publish gate 13808–14370, `read_combined_preview` 15410, `set_reveal_ready` 16106; `shared_publications.rs`; `auth.rs` (`UserRecord { name, hash }`: **no account kinds**); core `collaboration.rs` (role matrix l.560–620), `draft.rs` (`RevealPolicy` default `Independent`, `MAX_REVISIONS_PER_DRAFT = 200`), `preview.rs` (`seen`), `assembly.rs`; ADRs 0005–0007, 0013–0015, 0018, 0020–0026, 0029–0031, 0038–0039, 0052, 0062–0065, 0103, 0133; `docs/admin.md` l.892–975; `CONTEXT.md` §Shared publication collaboration; tests `tests/web/admin-shared-{reflection,invitations,members,drafts,series}.test.mjs`, browser `shared-{drafts,moments,series}.spec.mjs`; Studio `router.js` (`NOT_YET` has `shared`), `screens/not-yet.js` ("Writing together"), `studio.js`, `screens/signin.js`, `parts/kept.js`.

**Studio is a product.** The owner is any subscriber; personas judge screens and no shipped default names a person, family, food or site. Every string below is a word id read with `say(id, vars)`; wireframe names ("Ruth", "Sam", "What we noticed") are data, never defaults.

## Who this is for

- **The owner** (an owner account: the recipe writer, the roofer, the historian). Starts a reflection from something people watched, read or heard, invites people, writes her part, reads theirs, agrees, publishes it on her blog. Her layer is the first layer of every screen here.
- **People she invites** (a **co-writer** sign-in, G110). A sister, a friend, a colleague. They see **only** Writing together and only the reflections they were invited to: never posts, settings, accounts, keys, People, readers, or the blog's other screens. They write their part, read the others', agree. Their layer is the same her-layer words; they never see "your blog's" settings words because they never reach them.
- **The developer** ("Mikey"). Everything technical one step deeper under **For {helper}** (`common.forHelper`): ids, sign-in names, roles as stored, revisions, sharing and approval rules as stored, raw Markdown of her part, file paths under `.openblog/private/collaboration/`, codes.

**The jobs.** R14a: "Write something with other people, each in our own words, and put it on my blog when we all agree." R14b: "Shape it: how the parts are laid out, whose agreement counts, which collection it's in, what we say together afterwards, and the moments we point to." After R14b, nothing about writing together opens the old Admin.

**Findings that drive this spec.**
1. **Every old-Admin account is a full Admin.** `users.json` has `{name, hash}` only; roles exist per reflection. Inviting someone in the old Admin meant giving them the whole Admin (settings, social accounts, provider keys, every post). Studio does not repeat that (⚑ 2, G110).
2. **The old Admin could not approve, schedule or publish a reflection.** The four routes exist and are tested (ADR 0022) but had no caller, and Decided 2 deletes them. Without them nothing written together can ever reach the blog (⚑ 1).
3. **Default sharing is "never".** `RevealPolicy::Independent`: nobody reads anyone's part, so the combined preview is never complete and no one can agree. Every old reflection needed an organizer to find and change a rule first (⚑ 5).
4. **Saving cuts a revision; 200 per person, kept forever.** Autosave every few seconds would exhaust it in minutes (⚑ 6, G114).
5. **Inviting needed an existing sign-in name**, made by the developer on the command line (⚑ 3, G112).

**Decisions the owner should check** (⚑ where they appear):
1. ⚑ **Keep `collaboration/approve`, `approve/withdraw`, `schedule`, `publish`** (reverse Decided 2 for these four only; the other five deletions stand). Recommended: yes. If no, R14 ships writing and reading together with no way to publish, and the release note must say so.
2. ⚑ **Invited people get a co-writer sign-in that reaches only Writing together**, enforced by the server (G110), not by hiding buttons. R14a does not ship invitations without G110. Existing accounts keep full access (no `kind` = owner).
3. ⚑ **Invite someone new by their name**; they choose their own password on the join page (G112). Nothing is emailed: she copies the link and sends it herself, as today.
4. ⚑ **Only an owner account publishes or schedules** onto the blog, even if a co-writer "helps run" the reflection. Co-writers can invite (other co-writers only), arrange and set rules.
5. ⚑ **New reflections start "When everyone's ready"** (`allReady`, G113). "Each when ready" (`voluntary`) is on her layer for organizers; "Never" (`independent`) is in details only.
6. ⚑ **Your part saves itself** to a private working copy (G114) and becomes a fixed version only when you let the others read it. Until G114: kept on this device as you type, sent as a version on **Save**, on leaving, and when sharing.
7. ⚑ **Writing together shows only where it's used**: in navigation once you take part in one; otherwise from Posts › More › **Write something with others** and Find.
8. ⚑ **Other people's parts are shown as plain text** in Studio; the formatted, combined view is only the sandboxed preview.
9. ⚑ **"Editor" is not offered** on her layer: no route lets an editor change someone else's part, so the role only means "writes a part that needs no agreement". Kept as stored; shown and grantable in details.
10. ⚑ **Put away, never delete** (G116): a reflection she no longer wants leaves the list with Undo; private parts are never thrown away from Studio.
11. ⚑ **Split into R14a and R14b** (§Split).

## Her words

**Her layer:** write together, reflection, "what started it" (a video, article, podcast, book or something else), "the question you each answer", your part, their part, everyone's parts, invite, invitation, link, "say yes", join, "writes a part", "helps run it", "in charge", "only reads", "let the others read it", ready, "read everyone's parts", "as readers will see it", agree, agreed, publish, "publish on a day", put away, "kept private", R14b: layout, "one after another", "side by side", "back and forth", round, turn, label, "whose agreement counts", collection (R5's word for series), "what we say together" (agreement, difference, question, "something to try", "not sure"), moment, quotation, "who said it", "rights", "where the words came from".

**Never on her layer:** `HER_BANNED` (incl. contributor, profile, metadata, sync, upload, piece, block, markdown, syntax), plus: participant, publication, revision, reveal, offer, binding, token, policy, coordinator, site owner, editor, reader (as role names), synthesis, assembly, approval rule, scope, structure, arrangement (her word is "layout"), stamp, `publicationId`, sign-in name as "adminUser", "Studio", "Admin". Those live under **For {helper}**.

## Navigation, routes and what each person sees

| Job | Lands in | Route | Slice | Replaces |
| --- | --- | --- | --- | --- |
| What am I writing with others, what's next | **Writing together** | `#/together` | R14a | `#/shared` |
| Start one | **Start writing together** | `#/together/new` | R14a | `#/shared/new` |
| Where this one stands, my next step | **The reflection** | `#/together/<id>` | R14a | the card + its panels |
| Write my part | **Your part** | `#/together/<id>/write` | R14a | Your draft panel |
| Read everyone's parts; see it as readers will; agree | **Everyone's parts** | `#/together/<id>/read` | R14a | Sharing slots + Combined preview |
| Who's in it; invite; change or end access | **People** sheet | `#/together/<id>?sheet=people` | R14a | Members and invitations |
| Say yes to an invitation | **Join** | `#/together/join` (token never kept in the address) | R14a | `#/shared/accept/<token>` |
| Layout, rounds, turns | **Layout** sheet | `?sheet=layout` | R14b | Layout and arrangement |
| Whose agreement counts; when parts are shared | **Rules** sheet | `?sheet=rules` | R14b (sharing choice on her layer in R14a) | Sharing rule, Approval rule |
| Which collection, which part | **Collection** sheet | `?sheet=collection` | R14b | Series panel |
| What we say together | **What we say together** | `#/together/<id>/together` | R14b | Continuing conversation |
| Moments in what started it | **Moments** sheet from Your part | `#/together/<id>/write?sheet=moments` | R14b | Moments panel |

- **Nav** ⚑ 7: "Writing together" (`together.nav`) after Posts, when `meta.together.takingPart > 0` (G111) or for a co-writer (their only item, and their Home). Badge `together.waitingBadge` "{n} waiting on you" from `meta.together.waitingOnYou`. Owners who take part in none: Posts › More › **Write something with others** (`together.startFromPosts`) and Find.
- **Find:** "Writing together", "Start writing together", per reflection "Your part: {title}", "Everyone's parts: {title}", "People in {title}", "Invite someone to {title}"; R14b "Layout", "Rules", "Collection", "What we say together", "Moments". Co-writers' Find lists only these.
- **`legacyRoute`:** drop `shared` from `NOT_YET` and `not-yet.js` `NAMES`. `#/shared` → `#/together`; `#/shared/new` → `#/together/new`; `#/shared/accept/<token>` → `#/together/join` (the token is taken out before routing, §Join); any other `#/shared/<x>` → `#/together`. Query strings kept.
- **Breadcrumbs:** `Home › Writing together › {title} › Your part`. Co-writers: `Writing together › {title} › Your part`. Every screen has **‹ {title}** or **‹ Writing together**; nothing depends on browser Back.

| | Owner (owner account) | Co-writer (invited) | Developer |
| --- | --- | --- | --- |
| Navigation | Writing together among the rest | Writing together only; it is Home | + Find › details |
| Start one | yes | no (G110) | |
| Write, share, read, agree | per role in that reflection | per role in that reflection | |
| Invite | anyone, new or with a sign-in (in charge / helps run) | other co-writers with a sign-in, only when helping run it | + roles as stored, expiry days, sign-in names |
| Publish / publish on a day | yes, with "in charge" or "helps run" | never (⚑ 4) | |
| Settings, posts, People, readers, accounts, keys | as today | **none: 404 from the server** | |
| Details | — | — | ids, revisions, rules as stored, raw part, files, codes |

## Flows

```
R14a
Writing together ──[Start writing together]──> what started it · the question · your name on it
      │                                          ──[Start]──> The reflection: "Invite someone to write with you"
      └── a reflection ──> The reflection (status + one next step)
             ├─[Invite someone]──> People sheet ── their name ── new or has a sign-in ── what they do
             │        ──[Make the invitation link]──> link shown once ──[Copy the link]── she sends it herself
             ├─[Write your part]──> Your part (saves itself) ──[Let the others read it]──(asks once)
             │        "Ready. You'll all read each other's parts when everyone's ready."
             ├─[Read everyone's parts]──> Everyone's parts ──[See it as readers will]──> preview
             │        ──[Agree to publish this]──(asks once)──> "Agreed." Undo
             └─(all agreed, owner)──[Publish]  or  [Publish on a day]──(asks once)──> "It's on your blog."
Invited person: link ──> Join ── (new: choose a password | signed in: Say yes) ──> The reflection
R14b: The reflection › More: Layout · Rules · Collection · What we say together;  Your part › Moments
```

## Inventory: every collaboration feature the old Admin had

| Old Admin | Does | API | Decision | Layer | Slice |
| --- | --- | --- | --- | --- | --- |
| Shared reflections list (cards: "Private draft", title/question, sources) | | `GET collaboration/publications` | **Writing together** list with state and next step (G115) | her | a |
| Intro sentences ("kept in private server files") | | | one lede in her words; files in details | her / Mikey | a |
| Start form: up to 20 sources (kind, title, link, made by, publisher, published, ISBN), title or question, "You will appear as" | `validateSharedReflectionDraft` | `POST publications` | **Start writing together**; one source open, **Add another** (≤ 20); "Your name on it" from People | her | a |
| Source kind examples ("e.g. Middlemarch") | `SHARED_SOURCE_KINDS` | | placeholder ids (`together.kindExample*`), generic | her | a |
| "Add yourself as a contributor first" | | `contributors` | inline **Add my name** (R5 People route) | her | a |
| Suggest details from link (YouTube, CodePen) | `lookupSourceDetails` | `publications/source-metadata` | **Fill in from the link**, says who is asked first; fills empty boxes only | her | b |
| Members list (sign-in, credited as, roles, warnings) | | `GET members` | People sheet: name + what they do; sign-in and key in details | her / Mikey | a |
| Change roles (checkboxes, review, confirm) | `roleChangeImpact` | `POST members/roles` | "What they do" choice; asks once only when it takes something away; Undo | her | a |
| Remove access (inline confirm, impact) | `removalImpact` | `POST members/remove` | **Stop their access…** asks once (impact words kept) | her | a |
| Invite: sign-in name, profile, roles, days 1–30 | `validateInvitationDraft` | `POST invitations` | **Invite someone**: their name (People), new or has a sign-in (G112), what they do; days in details (default 7) | her / Mikey | a |
| Link shown once, Copy link, "nothing is emailed" | `invitationShareLink` | | same, Studio address (G119), **Copy the link** + share sheet on phones (`navigator.share`) | her | a |
| Invitation list, states, Revoke, Issue a new link | `invitationStatusText` | `GET invitations`, `revoke`, `reissue` | rows "Waiting for Sam to say yes · until Friday"; **Withdraw**, **Make a new link** | her | a |
| Accept page (profile select, Accept and join / Decline) | `showInvitationAccept` | `invitations/accept`, `decline` | **Join** page; name fixed by the invitation (G112 `GET join`); **Say yes** / **No thanks** | her | a |
| Your draft (Markdown textarea, Save draft, revision state) | `draftStateText` | `GET/PUT draft` | **Your part** word box, saves itself (G114); versions in details | her | a |
| Prompts (4, add at caret, hide/show) | `REFLECTION_PROMPTS` | | **Ideas to start from** (ids), hide remembered per person | her | a |
| Start a new part (`<!-- openblog:part -->`) | `partBreakInsertion` | | card in place **New part here** (R6 card kind `part-break`); raw marker in details | her | a |
| Conflict: keep mine / use newer / decide later, restore | | 409 | same three, her words; mine always kept (§Conflicts) | her | a |
| Sharing rule (3 policies, confirm) | `REVEAL_POLICIES` | `PUT reveal/policy` | on the reflection page for whoever runs it: **When everyone's ready** / **Each when ready**; "Never" in details | her / Mikey | a |
| Offer / take back offer (confirm, revision named) | | `PUT reveal/ready` | **Let the others read it** (asks once) / **Not yet after all** | her | a |
| Slots: others' text as revealed | `revealSlotText` | `GET reveal` | **Everyone's parts**, plain text | her | a |
| Combined preview (sandboxed frame, section lines) | `previewSectionText`, `previewStateText` | `GET preview` | **See it as readers will** (R7 sandbox), one line per person | her | a |
| Approve / withdraw approval | — (no caller) | `approve`, `approve/withdraw` | **Agree to publish this** / Undo ⚑ 1 | her | a |
| Schedule / publish | — (no caller) | `schedule`, `publish` | **Publish** / **Publish on a day** (R5 time rules) ⚑ 1, 4 | her | a |
| Approval rule (4 kinds, named people, roles, scope, confirm) | `approvalPolicy*` | `GET/PUT approval-policy` | **Rules** sheet: "Whose agreement counts" | her | b |
| Unmet rule warnings | `approvalRuleText` | | status on the reflection page (R14a reads it) | her | a |
| Layout and arrangement (5 layouts, rounds, turns, labels) | `ARRANGEMENT_LAYOUTS`, `arrangement*` | `GET/PUT reflection` | **Layout** sheet | her | b |
| Series placement, preview order, create series | series helpers | `GET/PUT series`, `series/create` | **Collection** sheet (R5 word); create = owner only | her | b |
| Continuing conversation (5 kinds, prompts, speaks for, approve, edit, withdraw, reorder) | `SYNTHESIS_KINDS` | `GET/POST synthesis` | **What we say together** | her | b |
| Media moments (where, quotation, speaker, rights, provenance, observation, propose) | `moment*`, `QUOTATION_*` | `GET/POST moments` | **Moments** sheet from Your part | her | b |
| `ob-admin-synthesis-prompts-dismissed` | | localStorage | read once into `studio:together:<user>:promptsHidden` | — | b |
| Answer a reader as the author of a section | | `engagement/*` (ADR 0128) | **R10** "Answer as {author}", already specified; G110 allowlist keeps it for co-writers | her | — |
| Delete a reflection | none | none | **Put away** / **Bring back** (G116) ⚑ 10 | her | a |
| Edit another's part (Editor role) | none | none | **drop**: no route; role kept in details ⚑ 9 | Mikey | — |
| `layout` v1 field | reserved, unread (ADR 0005) | | drop: not shown | — | — |
| Export grant | no route | | drop: nothing to show | — | — |

## Writing together (`#/together`)

- **Job:** "What am I writing with others, and what's waiting on me?" **Title:** "Writing together" (`together.title`). **Lede:** `together.lede` "Write with other people, each in your own words, about something you all watched, read or heard. Nothing goes on {product} until everyone agrees." **Primary:** **Start writing together** (owners only). **Loads:** `GET collaboration/publications`.
- **Views** (`segmented-control`): **Now** (default) · **On {product}** (published) · **Put away** (G116). Co-writers have no Put away.
- **Each card** (`content-card`, heading = title or question): what started it ("A video: How to Listen"), people ("You, Ruth and Sam"), state badge + next step sentence (`togetherStep`, §States), one button for that step.

```
400 px                                      Desktop (>= 48rem): cards in a 2-column grid,
+------------------------------------------+ lede beside the primary
| Home > Writing together                  |
| Writing together                         |  h1
| Write with other people, each in your    |
| own words... Nothing goes on your blog   |
| until everyone agrees.                   |
| [ Start writing together ]               |  primary (owners)
| ( Now | On your blog | Put away )        |  segmented-control
| +--------------------------------------+ |
| | What we noticed about attention      | |  content-card, h2
| | A talk: How to Listen                | |
| | You, Ruth and Sam                    | |
| | [Waiting on you]                     | |  status-badge
| | Ruth and Sam are ready. Let them     | |
| | read yours when you are.             | |
| | [ Write your part ]                  | |  the next step
| +--------------------------------------+ |
| | Letters home                         | |
| | [Agreed by everyone]                 | |
| | [ Publish ]           (owner only)   | |
| +--------------------------------------+ |
| > For the person who set up your site    |
+------------------------------------------+
```

- **Empty:** `empty-state` `together.emptyTitle` "Nothing written together yet" / `together.empty` "Start from something you watched, read or heard, and invite people to answer the same question." **Start writing together**. Co-writer empty: `together.emptyGuest` "You're not writing anything with others right now. If someone sends you a link, open it to join."
- **Details:** per reflection id, file, your roles as stored, sharing and agreement rules as stored, invitation count.

## Start writing together (`#/together/new`)

- **Job:** "Start something to write with others." **Primary:** **Start** (`together.start`). Owners only (G110 refuses co-writers; the route shows the Writing together list for them).

```
400 px                                      Desktop: one 40rem column
+------------------------------------------+
| Home > Writing together > Start          |
| Start writing together                   |  h1
| What started it                          |  h2
| What kind  (o) A video ( ) An article    |  radio-group, choice-cards look:
|            ( ) A podcast ( ) A book      |  video, article, podcast, book, something else
|            ( ) Something else            |
| What it's called [How to Listen       ]  |  required
| Link, if it has one [https://...      ]  |
| > More about it                          |  details: Made by, Published by, When, ISBN (books)
|   [Fill in from the link]   (R14b)       |
| [ Add another ]  (up to 20)              |
| The question you each answer             |  h2
| [What changed how you see your work?  ]  |
| A name for it (optional)                 |
| [What we noticed about attention      ]  |
| Your name on it  [ Ruth Nichols     v ]  |  select over People; default the person
|                                          |  matching the blog's name
| When you read each other's parts         |  R14a ⚑ 5
| (o) When everyone's ready                |
| ( ) Each person, when they're ready      |
|==========================================|
| Nothing goes on your blog until everyone |  sticky footer status
| agrees.           [Cancel]   [ Start ]   |
+------------------------------------------+
```

- Labels/help (ids `together.kind*`, `together.sourceTitle` "What it's called", `together.sourceLink` "Link, if it has one" + help "Leave it empty for a book or a conversation.", `together.madeBy` "Made by", `together.publisher` "Published by", `together.when` "When it came out", `together.isbn` "ISBN" + "10 or 13 digits; dashes are fine.", `together.question` "The question you each answer" + "One question everyone answers in their own words.", `together.name` "A name for it" + "You need a question, a name, or both.", `together.yourName` "Your name on it" + "How your part is signed when it's published.").
- **Your name on it**, empty People or none matches: `together.addMyName` "Your name isn't in People yet." **Add my name** (writes `contributors` via R5's route with `author.name`; owners only).
- Client checks (lifted `validateSharedReflectionDraft`, words as ids): `together.needSource` "Say what started it.", `together.needSourceTitle` "Give it a name, like the title of the video.", `together.badLink` "A full web address, starting with https://.", `together.badIsbn` "An ISBN has 10 or 13 digits.", `together.needQuestion` "Write the question you each answer, or a name for it.", `together.needYourName` "Choose your name."
- **Start** → `POST publications` with `revealPolicy` (G113) → route `#/together/<id>`, toast `together.started` "Started. Only you can see it until you invite someone."
- Leave-guard asks when anything is typed. No signal: form kept in memory; **Start** waits (`common.noSignal`); nothing is created twice (one request in flight).

## The reflection (`#/together/<id>`)

- **Job:** "Where does this stand, and what do I do next?" **Title:** its name or question. **Primary:** the one next step from `togetherStep` (§States). **Loads:** `GET publications` (summary, G115), `GET reveal`; with the Invite grant `GET members`, `GET invitations` on opening People.

```
400 px                                      Desktop (>= 60rem): main 1fr | 22rem side
+------------------------------------------+ (side: People list + Invite; More)
| Writing together > What we noticed  [More v]
| What we noticed about attention          |  h1
| What changed how you see your own work?  |  the question
| A talk: How to Listen  [Open it]         |  link: only http(s), new tab
| [Waiting on you]                         |  status-badge
| Ruth and Sam are ready. Let them read    |  togetherStep sentence (live)
| yours when you are.                      |
| [ Write your part ]                      |  primary (the step)
| Everyone                                 |  h2
| You    · writing                         |  one row per person: name · where they are
| Ruth   · ready                           |
| Sam    · ready                           |
| Waiting for Lee to say yes (until Fri)   |
| [ People and invitations ]               |  opens People sheet
| When you read each other's parts         |  only for whoever runs it
| When everyone's ready   [Change]         |
| > For the person who set up your site    |
+------------------------------------------+
More: Read everyone's parts · See it as readers will · People · (R14b: Layout · Rules ·
Collection · What we say together) · Put it away (in charge, unpublished)
```

- **Person rows** (`togetherPeopleRows`): "writing", "hasn't started", "ready", "can read everyone's", "agreed", "agreed to an earlier version", "isn't in it any more" (left with credit kept). No colour-only state; each row is text.
- **Sharing choice** (whoever runs it; `segmented-control`): **When everyone's ready** / **Each when ready**. Changing asks once (`together.ruleChangeAsk` "Change when you read each other's parts? Anyone who said they're ready will need to say so again. Nothing is shared by the change." **Change it** / **Keep it**). "Never" shows as `together.ruleNever` "Each part stays private" with **Change** only; set in details.

## Your part (`#/together/<id>/write`)

- **Job:** "Write my part." **Title:** "Your part" + the question under it. **Primary:** **Let the others read it** (when the policy allows and there are words), else none (it saves itself). Contributor or editor role only; others get `together.cantWrite` "You read this one; you don't write a part. {helper} or whoever runs it can change that."

```
400 px                                      Desktop: words 1fr | 18rem side (ideas, moments)
+------------------------------------------+
| What we noticed > Your part              |
| Your part                                |  h1
| What changed how you see your own work?  |  the question, quiet
| Saved · only you can read it             |  status (live)
| > Ideas to start from                    |  details, open until she hides them
|   What stood out to you, and why? [Add]  |
|   ...                     [Hide ideas]   |
| +--------------------------------------+ |
| | Words                                | |  R6 word box (cards in place)
| | I kept thinking about the pause...   | |
| | +----------------------------------+ | |
| | | New part here    [Move] [Take out]| | |  part-break card
| | +----------------------------------+ | |
| | And the second thing...              | |
| +--------------------------------------+ |
| [Start a new part]   (R14b: [Moments])   |
|==========================================|
| [ Let the others read it ]               |  sticky bar
+------------------------------------------+
```

- **Saving** ⚑ 6: with G114, 3 s after a change `PUT draft {working: true, etag}`; status `part.saved` "Saved · only you can read it." Before G114: kept on this device on every change (`kept.js`, key `studio:kept:<user>:together/<id>`), status `part.keptHere` "Kept on this computer. Press Save to keep it on {product}." with a **Save** button (sends a version), plus a version on leaving the screen and before sharing. At 190 versions (details shows the count) her layer says `part.nearlyFull` "You can save this part 10 more times. Let the others read it, or tell {helper}."
- **Ideas to start from** (`part.idea1`–`part.idea4`, lifted prompts): **Add** puts the line in as a quotation at the caret (R6 insertion rules, Undo). **Hide ideas** remembered per person (`studio:together:<user>:promptsHidden`).
- **Start a new part** inserts the `part-break` card at the caret; help `part.newPartHelp` "Splits your words so whoever runs it can place each part in the layout. Readers never see the break." Raw marker in **Show the words as written** (Mikey).
- **Let the others read it** asks once (`modal-dialog`): `part.shareAsk` "Let the others read your part as it is now?" / `part.shareAskBody` "When everyone's ready, you'll all read each other's parts. Once someone has read it, it can't be taken back. Changes you make after this stay private until you share again." **Let them read it** / **Not yet**. Sends the version on screen (G114: cuts it from the working copy). Toast: `part.sharedWaiting` "Ready. You'll all read each other's parts when everyone's ready." or `part.sharedNow` "Shared. You can read everyone's parts now." **Read them**.
- **After sharing:** bar shows `part.notYet` **Not yet after all** (takes back the offer, only before anyone read it). Edits after sharing: status `part.changedSince` "Changed since you shared it · only you can read the changes" and the primary becomes **Let them read your changes** (asks once; if anyone agreed: `part.reagreeWarn` "Ruth and Sam agreed to your earlier words. They'll need to read and agree again.").
- **Owners' Write is untouched**: a part is not a post and never appears in Posts.

## Everyone's parts (`#/together/<id>/read`)

- **Job:** "Read what everyone wrote, and say if I agree to publish it." **Primary:** **Agree to publish this** (contributors, when the preview is complete and you haven't agreed). **Loads:** `GET reveal`, then `GET preview` on **See it as readers will**.

```
400 px                                      Desktop (>= 70rem): parts side by side in
+------------------------------------------+ columns, same DOM order; preview below
| What we noticed > Everyone's parts       |
| Everyone's parts                         |  h1
| Ruth                                     |  h2 per person (bdi)
| I hadn't noticed how much I interrupt... |  plain text paragraphs, dir=auto
| Sam                                      |
| Kept private until Sam is ready.         |  slot not shared
| You                                      |
| I kept thinking about the pause...       |
| [ See it as readers will ]               |  secondary
| +--------------------------------------+ |  sandboxed iframe (R7), "As readers will
| |  (rendered combined reflection)      | |  see it, not published"
| +--------------------------------------+ |
| Ruth agreed · Sam hasn't yet · You       |  previewSectionText lines
|==========================================|
| [ Agree to publish this ]                |  sticky bar
+------------------------------------------+
```

- **Parts are text** ⚑ 8: `textContent`, split on blank lines into `p`, `dir="auto"`, `.studio-stranger` isolation (R10); the part-break marker shows as a thin rule with `part.breakLabel` "Part 2". Never parsed as markup in Studio.
- **See it as readers will:** `GET preview` → `iframe sandbox=""` (no allowances) at `previewUrl`, title `read.previewTitle` "{title}, as readers will see it. Not published." Lines under it from `previewSectionText`/`previewItemText` in ids. State line `previewStateText` → `read.allAgreed` "Everyone has agreed to exactly this." / `read.missing` "Not ready: {names} still need to agree." / `read.incomplete` "Not everyone's part can be read yet."
- **Agree to publish this** (needs `preview.seen`; disabled with reason until read): asks once `read.agreeAsk` "Agree to publish exactly what you just read?" / `read.agreeAskBody` "If anyone changes their words, you'll be asked again." **Agree** / **Not yet** → `POST approve {seen, affirmed: true}` → toast `read.agreed` "Agreed." **Undo** (withdraw). After a change elsewhere: `read.agreeStale` "Ruth changed her part since you agreed. Read it again, then agree."

## Publishing (on the reflection page)

When `preview.ready` and the session is an owner account with "in charge" or "helps run":

- **Primary:** **Publish** (`together.publish`); secondary **Publish on a day** opens R5's date/time fields (8 AM default, R5 help words via `whenHelp`).
- **Publish** asks once: `together.publishAsk` "Put "{title}" on {product} now?" / `together.publishAskBody` "Everyone agreed to exactly this. It will be signed by {names}." **Publish** / **Not yet**. Success (`{state, path}` G118): status and toast `together.published` "It's on {product}." **Open it** (owners: `#/write/<path>`; R5 locks who wrote each part via `shared-order`/`shared-rebind`). No Undo: help `together.takeOffHelp` "To take it off, open it and choose Take it off my site."
- **Scheduled:** badge "Goes up Friday, November 27 at 8 AM"; **Don't publish it then** → `schedule {publishAt: null}` → `together.unscheduled` "It won't go up on Friday." **Undo** (reschedule same time).
- Co-writers and owners without the grant see `together.waitingPublish` "Everyone agreed. Waiting for {name} to publish it." (`{name}` = the first owner account in charge, from G115.)
- **Put it away** (More; in charge, unpublished, G116): toast `together.putAway` "Put away. Nothing was thrown away." **Undo**. In the Put away view: **Bring it back**.

## People sheet (`?sheet=people`)

- `side-sheet` "People in {title}" (full screen under 30rem). For whoever has the Invite grant; others see the read-only "Everyone" list on the page.

```
400 px (full screen)
+------------------------------------------+
| People in What we noticed            [x] |
| You       In charge                      |
| Ruth      Writes a part     [Change v]   |  dropdown: what they do · Stop their access…
| Sam       Writes a part     [Change v]   |
| Invitations                              |  h3
| Lee · Writes a part                      |
| Waiting for Lee to say yes, until        |
| Friday, November 21.                     |
| [Withdraw]  [Make a new link]            |
| Invite someone                           |  h3
| Their name  [ Lee Park          v ]      |  combo-box over People; "Someone new…" adds
| ( ) They already sign in to your blog    |  radio: new (default) / has a sign-in
| (o) They're new: make them a sign-in     |
|     Sign-in name [leepark         ]      |  suggested from the name, editable
| What they do                             |
| (o) Writes a part                        |
| ( ) Writes a part and helps run it       |
| ( ) Only reads                           |
| ( ) In charge   (owners only)            |
| [ Make the invitation link ]             |
| > For the person who set up your site    |  days valid (1–30), roles as stored
+------------------------------------------+
```

- **What they do** (ids `people.role*`): "Writes a part" (`contributor`), "Writes a part and helps run it" (`contributor`+`coordinator`), "Only reads" (`reader`), "In charge" (`siteOwner`, offered only to sessions that hold it). Help `people.roleHelp` "Helping run it means inviting people and choosing the layout. Only someone with a sign-in to everything on {product} can publish it." Other stored combinations show as their words joined ("Helps run it, only reads") and are kept unless changed (lifted rule).
- **Their name** lists People (R5). **Someone new…** opens R5's Add someone inline (owners only; co-writers can invite only people already in People with a co-writer sign-in).
- **New sign-in** (G112, owners only): sign-in name suggested (`a-z0-9._-`, ≤ 32, unused); check `people.nameTaken` "Someone already signs in with that name. Add a letter or number."
- **Make the invitation link** → result card: `people.linkMade` "Send this link to Lee yourself. It works once, until Friday, November 21. Your blog doesn't email it." read-only `text-field` with the link, **Copy the link** (`people.copied` "Copied."; refused: selects it, `people.copyYourself` "Select the link and copy it."), on phones **Send it…** (`navigator.share` with the link only). The link is shown only now: `people.onlyNow` "You won't see this link again. If it's lost, make a new one." Toast `people.invited` "Invitation made." **Undo** (withdraw).
- **Withdraw** asks once: "Withdraw Lee's invitation? The link stops working." **Withdraw** / **Keep it**. **Make a new link**: old link stops (`people.newLink` "New link made. The old one doesn't work any more."), result card as above.
- **Change** what they do: applied at once with Undo; when it takes something away, asks once with `roleChangeImpact` words as ids ("Ruth won't be able to invite people or choose the layout. What she wrote stays hers.").
- **Stop their access…** asks once (`removalImpact` as ids): "Stop Ruth's access to What we noticed?" / "She won't be able to open it, and any link she has stops working. Her name stays on what she wrote. You can invite her again." **Stop her access** / **Keep her**. No Undo (ADR 0015): toast `people.stopped` "Ruth can't open it any more. Invite her again to bring her back."
- Warnings (`memberWarnings`): `people.signInGone` "Ruth's sign-in or name on {product} was removed, so she can't open this. Invite her again." Details: sign-in names, keys, participant ids, `bindingCurrent`, invitation ids.

## Join (`#/together/join`)

**The token** ⚑: `studio.js`, before any request and before sign-in, calls `joinToken(location.hash)` (pure): for `#/shared/accept/<t>` or `#/together/join/<t>` with a token matching `^[a-z0-9-]{1,128}\.[0-9a-f]{64}$` it returns `{token, hash: "#/together/join"}`; `history.replaceState` drops the token from the address and history at once. The token lives only in memory (a module variable); never in storage, a log, a toast or details. A reload loses it: `join.reopen` "Open the link you were sent again."

**Loads:** `GET collaboration/invitations/join` with the token in a header `X-Openblog-Invitation` (G112; never in a query) → `{title, question, invitedBy, forName, newAccount, signInName, expiresAt}`; refused tokens all answer the same 404.

```
400 px, new person (not signed in)          400 px, has a sign-in, signed in
+------------------------------------------+ +------------------------------------------+
| Ruth's blog                              | | Writing together > Join                  |
| Write together                           | | Write together                           |
| Ruth invited you to write about:         | | Ruth invited you to write about:         |
| What we noticed about attention          | | What we noticed about attention          |
| "What changed how you see your work?"    | | You'll write a part, signed Lee Park.    |
| You'll write a part, signed Lee Park.    | | [No thanks]          [ Say yes ]         |
| Your sign-in name: leepark               | +------------------------------------------+
| Choose a password [            ]         |
| At least 12 letters, numbers or symbols. |
| Type it again     [            ]         |
| [No thanks]          [ Say yes ]         |
+------------------------------------------+
```

- **New person** (G112 `newAccount`): password fields (`join.password`, `join.passwordAgain`, `autocomplete="new-password"`), checks `join.passwordShort` "At least 12 characters.", `join.passwordsDiffer` "The two passwords don't match." **Say yes** → `POST invitations/join {token, password}` → signed in as a co-writer → `#/together/<id>`, toast `join.joined` "You're in. Write your part when you're ready."
- **Has a sign-in, signed out:** Studio's sign-in form with intro `join.signInFirst` "Sign in as leepark to say yes." (the token stays in memory across the in-page sign-in). Signed in as someone else: `join.wrongPerson` "This invitation is for leepark. Sign out, then open the link again." **Sign out**.
- **Say yes** (has a sign-in) → `POST invitations/accept {token, contributorId}` with the key from `GET join`. **No thanks** asks once → `decline` → `join.declined` "You said no thanks. Ruth can invite you again."
- Refused (spent, expired, withdrawn, wrong): one sentence `join.notWorking` "This link doesn't work any more. Ask the person who sent it for a new one."

## States (`togetherStep(summary, reveal, preview, session)`, pure)

| State | Badge (`together.state*`) | Next step sentence | Primary |
| --- | --- | --- | --- |
| Only you, no invitations | Just started | "Invite someone to write with you." | Invite someone |
| Invitations waiting, nobody joined | Waiting to hear back | "Waiting for Lee to say yes. Start your part meanwhile." | Write your part |
| You haven't written | Waiting on you | "Write your part." | Write your part |
| You wrote, not shared | Waiting on you | "Let the others read it when you're ready." | Let the others read it |
| You shared, others not ready | Waiting on others | "Waiting for Sam and Lee to be ready." | Read everyone's parts (what's readable) |
| Everyone's readable, you haven't agreed | Waiting on you | "Read everyone's parts and say if you agree." | Read everyone's parts |
| You agreed, others haven't | Waiting on others | "Waiting for Ruth to agree." | — |
| Your agreement is out of date | Waiting on you | "Ruth changed her part. Read it again." | Read everyone's parts |
| Everyone agreed, you can publish | Ready to publish | "Everyone agreed." | Publish |
| Everyone agreed, you can't publish | Ready to publish | "Waiting for {name} to publish it." | — |
| Scheduled | Goes up {when} | "It goes up on {when}." | Don't publish it then (secondary) |
| Published | On {product} | "It's on {product}." | Open it |
| Rule can't be met (R14a reads, R14b fixes) | Stuck | "It can't be published as it stands: Sam can't agree any more." + `common.tell` or **Rules** (R14b) | — |
| Sharing set to "never" | Each part private | "Each part stays private, so it can't be published together. Whoever runs it can change that." | Change (if runs it) |
| Put away | Put away | — | Bring it back |
| You lost access | (not listed) | direct address: `together.gone` "You're not part of this any more." | Writing together |

Readers-only people get the same table without writing or agreeing rows.

## Conflicts and concurrent editing (never lose anyone's words)

- **No two people edit the same words.** Each person writes only their own part; shared things (layout, rules, collection, what we say together) are separate records with revisions. Studio says so in the lede of Your part's details, not as a warning.
- **Your part in two tabs or devices:** `PUT draft` carries the working etag (G114) or `expectedRevision`. 409 → `conflict` block (`parts/conflict.js`): `part.conflict` "You changed your part somewhere else too." Both shown read-only, labelled "On {product} now" / "On this screen"; **Keep mine** (saves on top), **Use the other one** (mine kept: **Bring mine back** until leaving), **Decide later** (nothing saved; leave-guard still asks). The words on screen are never replaced without her press.
- **Kept copies:** every keystroke is in the kept copy until the server confirms (G114 or a version); a kept copy newer than the server's opens with `part.keptNewer` "Your part has changes kept on this computer from {when}." **Use them** / **Use what's saved**.
- **Shared records** (layout, rules, collection, sharing choice, what we say together, moments): 409 reloads the current record **around** what she typed or chose (lifted behaviour: `load(false)`), with `together.changedElsewhere` "{what} was changed by someone else. Here it is now with your changes still in the boxes; save again." Typed text in conversation items and moments survives.
- **Membership/role changes while open:** 404 on any call → `together.accessChanged` "Your access to this changed." Typed words stay on screen with **Copy my words** (copies the box) before **Back to Writing together**.
- **Agreement and change:** any change to a part, the layout, the rule, the collection, an item or a proposed moment clears the agreements it touches (server); every such action says so in its status before or as it happens (ids `*.clearsAgreement`).

## Permissions and safety

- **Server-enforced** (G110): a co-writer session may call only `session`, `logout`, `meta` (reduced), `collaboration/*` except `publications` POST, `publish`, `schedule`, `series/create`, `publications/archive`, and new-account invitations; `preview/<token>` for its own combined preview; the R10 author-response routes that already authorize by the shared record (ADR 0128, 0133). Everything else answers 404 exactly like an unrouted path. A route-table test lists every route with its account kinds, so a new route is owner-only until classified.
- **Studio** also hides everything else for co-writers (nav, Find, Home), but the safety is the server's.
- **Invitations:** owners invite anyone; co-writers who help run it invite only existing co-writer sign-ins (never owner accounts, never new ones). "In charge" is granted only by someone in charge (lifted rule). The link is shown once.
- **Tokens:** out of the address before any request (§Join), sent only in the request body or the `X-Openblog-Invitation` header, never stored or logged; Admin's `Referrer-Policy: same-origin` already keeps it from other sites; the join screen has no outbound links. Five tries per account or address per window (ADR 0013), refunded on success.
- **Untrusted words:** everyone's parts, names, titles, questions, source titles, labels, quotations, items: `textContent`, `bdi`/`dir="auto"`, `.studio-stranger`. Source links are links only when `http(s)`, `target=_blank rel="noopener noreferrer nofollow" referrerpolicy="no-referrer"`. The combined preview is the server's document in `sandbox=""`.
- **Private stays private:** parts travel only in request bodies; addresses carry ids only; a kept copy of her part is on her own device under her sign-in name, removed once saved; signing out with an unsaved kept part asks (`part.signOutAsk` "Your part has changes that aren't saved yet. Save them first?" **Save and sign out** / **Sign out anyway, keep them here**).
- **Publishing** checks exact agreement on the server (ADR 0022) and refuses unsafe markup there; Studio never assembles anything.
- **Writing helper (R8):** nothing written together is ever sent to a provider; R14 adds no helper feature.

## Errors by code

`togetherProblem(error, place)` in `parts/together-rules.js` maps every answer to `{field, id, vars}`; the server's sentence and code go in details. Until G117 it reads today's shapes (status + `field`).

| Answer | Where | Her words (id) |
| --- | --- | --- |
| 401 | shell | "Sign in again"; typed words stay |
| 0 | status | `common.noSignal` + `part.keptHere` on Your part |
| 404 `not-found` (any collaboration call) | screen | `together.accessChanged` (§Conflicts) |
| 409 `changed` | that record | `part.conflict` / `together.changedElsewhere` |
| 409 `published` | page | `together.alreadyPublished` "It's already on {product}. Nothing changed." |
| 409 `unapproved` (+ `missing`) | Publish | `together.notAgreed` "{names} still need to agree." |
| 409 `rule-unmet` (+ `unmetNamed`, `unmetRoles`) | page | `together.stuck` (§States) |
| 409 `occupied` | Publish | `together.placeTaken` "Something else is already where this would go on {product}. Nothing changed. " + `common.tell` |
| 413 / 422 `too-large` | Your part | `part.tooLong` "Your part is too long to save in one go (64,000 letters). Make it shorter or split it into two reflections." |
| 422 `revision-limit` | Your part | `part.full` "This part can't be saved any more times. Let the others read it, or " + `common.tell` |
| 422 `unsafe-markup` | Publish / that person's row | `together.unsafeWords` "{name}'s part has something {product} can't publish safely. Ask them to look at it and agree again." |
| 422 `reserved-heading` | same | `together.reservedHeading` "{name} used a heading {product} keeps for itself. Ask them to change it." |
| 422 `layout-mismatch` | page | `together.layoutOld` "The layout names a part someone took out. Whoever runs it needs to fix the layout." |
| 422 `moment-*` (`unresolved`, `unsafe`) | that moment | `moments.cantUse` "This moment no longer fits what started it. Change it or keep it private." |
| 422 `invalid` + `field` (start form) | mapped field (`sharedReflectionFieldId` → Studio field) | the client check's id |
| 422 `affirmed` | Agree | `read.readFirst` "Open See it as readers will first, then agree." |
| invitation 422 `account-taken` / `name-taken` / `already-invited` | Invite | `people.alreadyIn` "Lee is already in this, or already invited." / `people.nameTaken` |
| invitation 403 `owner-only` | Invite / role | `people.ownerOnly` "Only someone in charge can do that." |
| join 404 `invalid-invitation` | Join | `join.notWorking` |
| join 422 `password` | password | `join.passwordShort` |
| 429 `too-many-tries` | Join / Invite | `join.tooMany` "Too many tries. Wait a few minutes, then open the link again." |
| 500 `storage`, `build` | status | `together.serverDown` "{product} didn't do that, so nothing changed. Your words are still here." **Try again** |
| any unknown code | mapped field, else banner | `together.failed` "That didn't work, and nothing changed. " + `common.tell` |

## Undo

| Action | Undo |
| --- | --- |
| Words in your part, an idea added, a new part break | box Undo (R6), toast **Undo** for insertions |
| Let the others read it | **Not yet after all** until anyone has read it; after that, none (asked once) |
| Agree | toast **Undo** → `approve/withdraw` |
| Publish | none (asked once); take it off from Write (owners) |
| Publish on a day | toast **Undo** → unschedule; **Don't publish it then** → **Undo** reschedules the same time |
| Invite | toast **Undo** → withdraw |
| Withdraw an invitation / make a new link | none (asked once / says the old link stopped) |
| Change what someone does | toast **Undo** → the previous roles |
| Stop someone's access | none (asked once): invite again |
| Put away / bring back | toast **Undo** → the opposite |
| Sharing choice, whose agreement counts, layout, collection (R14b) | toast **Undo** → the previous value; status says offers/agreements cleared by the change don't come back |
| What we say together: add / edit / take my name off / move (R14b) | **Undo** → remove the new item / previous text / add my name back / move back |
| Moment added / changed / removed (R14b) | **Undo** → remove / previous / add back (a proposed moment's agreements don't come back; said) |

## No signal

- Lists and pages open from nothing kept (private words are never cached by the worker); with no signal: `together.noSignalList` "Writing together needs a signal. Your part is kept on this computer if you were writing it."
- **Your part** opens from its kept copy with no signal and keeps every keystroke; status `part.waitingSignal` "Waiting for a signal · kept on this computer." It saves on its own when the signal returns (G114 working copy, or a version before G114). **Let the others read it**, **Agree**, **Publish**, invitations and joins need a signal and say so; nothing is queued that would share, agree or publish later without her watching.

## Keyboard, names, 320 px

- **Order:** Writing together: title, lede, primary, views, cards (heading, facts, badge, step button). Reflection: title, question, source, badge, step, primary, Everyone, People button, sharing choice, details. Your part: title, status, ideas, words, Start a new part, bar.
- **Keys:** Ctrl/⌘ S saves your part now; Ctrl/⌘ Enter = the screen's primary (asks as the button does); Escape closes sheets and dialogs (asking if typed). Alt+↑/↓ moves a part-break card (R6). Lists: ↑/↓ between cards (roving tabindex), Enter opens. No one-letter shortcuts.
- **Names:** cards "{title}: {badge}. {step}"; person rows "Ruth: ready"; buttons carry their target ("Change what Ruth does", "Withdraw Lee's invitation", "Make a new link for Lee", "Agree to publish {title}"); preview frame titled; parts are `section` with `aria-labelledby` the person's heading.
- **Live regions:** one polite region per screen (saves, steps, copies); `role="alert"` for conflicts and access changes only. Focus: after an action, the status; after a dialog, the control that opened it (or its replacement); errors focus their field with `aria-describedby`.
- **320 px:** one column; sheets full screen with sticky footers; parts follow one another (side by side only ≥ 70rem, same DOM order); the link field wraps (`overflow-wrap:anywhere`) with Copy under it; choice cards stack; no sideways scroll; controls ≥ 44 px. Reduced motion: no slide, no highlight fade.
- **Zubra:** `sidebar-layout`, `breadcrumb-trail`, `content-card`, `status-badge`, `segmented-control`, `choice-cards`, `radio-group`, `text-field`, `select-field`, `combo-box`, `date-field`, `side-sheet`, `modal-dialog`, `action-button`, `dropdown-menu`, `alert-banner`, `toast-region`, `empty-state`, `skeleton-block`, `loading-spinner`, `command-palette`. Checkboxes (R14b named approvers) use the native fallback (R5–R11).

## Rules each part uses (static imports, DOM-free, tested)

| Part | File | Functions (lifted unless marked new) | Slice |
| --- | --- | --- | --- |
| Start, people, states, errors | `parts/together-rules.js` | `SHARED_SOURCE_KINDS` (→ ids), `MAX_SHARED_SOURCES`, `emptySharedSource`, `validateSharedReflectionDraft` (→ ids), `sharedReflectionPayload` (+ `revealPolicy`), `sharedReflectionFieldId` (→ Studio field names), `INVITATION_ROLES` (→ `ROLE_CHOICES` new grouping), `invitationPayload` (+ `newAccount`), `validateInvitationDraft` (→ ids), `invitationShareLink` (Studio path), `memberRolesLabel` (→ `roleWords`), `memberWarnings`, `removalImpact`, `roleChangeImpact`, `invitationStatusText` (→ ids, R5 date words), `REVEAL_POLICIES`, `revealSlotText`, `previewSectionText`, `previewItemText`, `previewStateText`; new: `togetherStep`, `togetherPeopleRows`, `togetherProblem`, `suggestSignInName(name, taken)`, `canInvite(kind, roles, target)` | a |
| Join | `parts/join-rules.js` | `invitationTokenFromHash` → new `joinToken(hash)` `{token, hash}`, `joinProblem` | a |
| Your part | `parts/part-rules.js` | `REFLECTION_PROMPTS` (→ ids), `promptInsertion`, `insertAtSelection`, `PART_MARKER_LINE`, `partBreakInsertion`, `draftStateText` (→ ids, no version numbers), `draftFailure` (→ `togetherProblem`); new: `partBlocks(text)` (part-break card kind for `word-blocks.js`), `partSaveMode(meta)` (working vs version) | a |
| Layout, rules, collection | `parts/arrange-rules.js` | `ARRANGEMENT_LAYOUTS`, `TURN_LABEL_MAX_BYTES`, `arrangementDraft`, `moveItem`, `nextRoundId`, `arrangementPayload`, `validateArrangement` (→ ids), `arrangementFailure`; `APPROVAL_REQUIREMENTS`, `APPROVAL_ROLE_CHOICES`, `approvalPolicyChoice`, `approvalPeopleRows`, `approvalPolicyPayload`, `approvalRuleText` (→ ids), `approvalRuleFailure`; `NEW_SERIES`, `NO_SERIES`, `seriesPlacementText`, `seriesPartText`, `seriesPlacementRequest`, `keepStoredSeries`, `seriesFailure` | b |
| What we say together | `parts/conversation-rules.js` | `SYNTHESIS_KINDS`, `synthesisKindLabel`, `synthesisItemText`, `moveSynthesisItem`, `synthesisFailure` (all → ids) | b |
| Moments | `parts/moment-rules.js` | `MOMENT_LOCATOR_KINDS`, `QUOTATION_RIGHTS`, `QUOTATION_PROVENANCE`, `parseMomentTimestamp`, `momentLocationError`, `momentPayload`, `quotationNotices`, `rightsGuidanceText`, `sortMoments`, `momentText`, `momentLinkText`, `offeredMomentsText`, `momentsFailure` (→ ids); `applySourceSuggestion`, `lookupSourceDetails`, `sharedSourceHref` | b |
| Words | `parts/together-words.js` (`together.*`, `people.*`, `join.*`), `parts/part-words.js` (`part.*`, `read.*`); R14b `parts/arrange-words.js` (`layout.*`, `rules.*`, `collection.*`), `parts/conversation-words.js` (`talk.*`), `parts/moment-words.js` (`moments.*`) | all `layer: "her"` except `*.details*` and `together.findDetails`; every default passes `HER_BANNED` and the persona test; none uses `{owner}` (people are named from data) | a/b |
| Screens | `screens/together.js` (list), `screens/together-new.js`, `screens/together-one.js` + `parts/together-people.js`, `parts/together-publish.js`; `screens/together-part.js`; `screens/together-read.js`; `screens/together-join.js`; R14b `parts/together-layout.js`, `parts/together-rules-sheet.js`, `parts/together-collection.js`, `screens/together-talk.js`, `parts/together-moments.js` (each < 400 lines) | | |

**Port (R14a):** `admin-shared-reflection` (21) → `studio-together-rules`; `admin-shared-invitations` (4) + `admin-shared-members` (15) → `studio-together-rules` (people); `admin-shared-drafts` (83): prompts, save state, failures, conflict, part break, reveal slots, offer, preview cases → `studio-part-rules` / `studio-together-rules`. Browser `shared-drafts.spec` → `studio-together.spec.mjs`.
**Port (R14b):** `admin-shared-drafts` arrangement and approval-rule cases → `studio-arrange-rules`; synthesis cases → `studio-conversation-rules`; moment cases → `studio-moment-rules`; `admin-shared-series` (13) → `studio-arrange-rules`. Browser `shared-moments.spec`, `shared-series.spec` → `studio-together-shape.spec.mjs`. Cases about old panel chrome ("wired into the shared reflections view", "loads only when opened", focus inside `<details>` panels, "uses the ob-admin key") are rewritten against Studio screens or deleted in R15. `reflection-history.spec`, `reflection-layouts.spec`, `reader-reflections.test` test the public site: untouched.

**New tests:** `joinToken` strips every accepted form and rejects malformed tokens; the token never reaches `localStorage`, `sessionStorage` or a request URL (request log check); `togetherStep` gives one primary per state in §States; `canInvite` (co-writer cannot invite new people, owner accounts, or grant "in charge"); `roleWords` round-trips every stored role set and keeps unknown roles; `partBlocks` round-trips every fixture draft byte-for-byte with part breaks; `togetherProblem` covers every G117 code (a fixture per code from the Rust enum, so a new code fails); no her-layer default contains a banned word, "Studio", "Admin", "contributor", "revision", "reveal" or a persona name.
**New browser:** `studio-together.spec.mjs`: owner starts one (sharing default "When everyone's ready" sent), invites a new person → copies link; second context opens the link → address has no token before the first request → chooses password → lands on the reflection; co-writer sees only Writing together, and `GET /admin/api/meta`'s settings, `document`, `contributors` PUT, `social/status`, `assistant/settings` all answer 404 for them; both write (two tabs conflict keeps both), share, read as text, preview in a sandbox, agree → Undo → agree; owner publishes → post exists, signed in order; co-writer has no Publish; put away → Undo; 320 px, keyboard only, axe clean.

## Server gaps

- **G110. Co-writer sign-ins.** `UserRecord` gains optional `kind: "co-writer"` (absent = owner; existing accounts unchanged). Sessions carry the kind. One allowlist (§Permissions) checked in the dispatcher before any handler; everything else 404. `openblog user add --co-writer <name>` for the developer; `openblog user list` shows kinds. Publishing, scheduling, `series/create`, `publications` POST and new-account invitations also require an owner account. A route-table test classifies every route.
- **G111. `meta` by account.** `meta.account: "owner"|"co-writer"`; for a co-writer `meta` holds only `account`, `siteName`, `studioWords`, `now`, `release`, `together`. For everyone `meta.together: { takingPart, waitingOnYou, canStart }`.
- **G112. Invite someone new; join by link.** `POST invitations` accepts `newAccount: { signInName }` (owner only): reserves a co-writer account with no password that cannot sign in, released when the invitation is withdrawn, expires or is declined. `GET collaboration/invitations/join` (token in `X-Openblog-Invitation`; no session needed) answers `{title, question, invitedBy, forName, contributorId, newAccount, signInName, expiresAt}` or one 404. `POST collaboration/invitations/join {token, password}` (no session; password policy; ADR 0013 throttle per address and per publication) sets the password, accepts, and starts a session in one write. Signed-in `accept` unchanged.
- **G113. Start with a sharing choice.** `POST publications` accepts `revealPolicy` (`allReady` | `voluntary` | `independent`); absent stays `independent` for other callers.
- **G114. A working copy that isn't a version.** `PUT draft {working: true, etag}` overwrites one private working copy per person (no revision, no limit hit); `GET draft` returns `working {markdown, etag, savedAt}` and the latest revision; `PUT reveal/ready {fromWorking: true}` cuts a revision from the working copy and offers it in one write. `draft` 422 adds `revision-limit`.
- **G115. List with state.** Each `publications` summary adds `state` (`started|writing|sharing|agreeing|ready|scheduled|published|stuck|privateParts`), `people: [{displayName, where, you}]`, `invitationsWaiting`, `you: {wrote, shared, agreed, agreedStale, canPublish}`, `publishAt`, `path`, `archived`, `publisherName`. No prose, no revision numbers.
- **G116. Put away.** `POST collaboration/publications/archive {publicationId, archived}` (in charge, unpublished); archived records list only with `?archived=1`; nothing is deleted.
- **G117. Codes on every collaboration answer:** top-level `code` (`not-found`, `changed`, `published`, `unapproved`, `rule-unmet`, `occupied`, `too-large`, `revision-limit`, `unsafe-markup`, `reserved-heading`, `layout-mismatch`, `moment-unresolved`, `moment-unsafe`, `invalid` + `field`, `affirmed`, `account-taken`, `name-taken`, `already-invited`, `owner-only`, `invalid-invitation`, `password`, `too-many-tries`, `storage`, `build`), `name` (display name, never prose) where a person is the cause. Sentences stay one release.
- **G118. The four gate routes stay** (⚑ 1): `approve`, `approve/withdraw`, `schedule`, `publish` are kept and routed; `publish` answers `{state, path, url}`.
- **G119. Invitation links open Studio:** `invitation_link` → `/admin/studio/#/together/join/<token>` (the old form still works through `joinToken`); test `admin.rs:37522` changes with it.
- **G120 (R14b). Co-writer sign-ins list:** `GET co-writers` / `POST co-writers/remove` (owner only): name, reflections they're in, last sign-in; removing ends every binding (ADR 0006 obligation) and the account. Shown in People › details › **Sign-ins for people writing with you**.
- **Not gaps:** `publications` GET/POST, `publications/source-metadata`, `invitations` (+ `revoke`, `reissue`, `accept`, `decline`), `members` (+ `roles`, `remove`), `draft`, `reveal` (+ `policy`, `ready`), `approval-policy`, `reflection`, `preview`, `series` (+ `create`), `synthesis`, `moments`; `contributors` (R5); `preview/<token>`.

## Split

**R14 is split.** Each half ships alone and passes `studio-ux`.

| | **R14a — Write together** (XL) | **R14b — Shape it** (L) |
| --- | --- | --- |
| The job | invite, write, read, agree, publish | layout, whose agreement counts, collection, what we say together, moments, fill in from a link, co-writer sign-ins list |
| Screens | Writing together, Start, the reflection, Your part, Everyone's parts, People sheet, Join | Layout, Rules, Collection sheets; What we say together; Moments sheet |
| Gaps | G110–G119 (G110, G112, G118 are blockers) | G120 |
| Until it ships | — | More shows the R14b items only as Find entries opening `#/not-yet/together-shape` (never a blank screen); existing layouts, rules, collections, items and moments are kept untouched and still publish |
| `NOT_YET` | `shared` removed; `TOGETHER_NOT_YET = layout, rules, collection, talk, moments` | emptied |

Why this cut: R14a is the whole loop a first-time owner needs, and it carries all the security work (accounts, tokens, allowlist) that must be reviewed together. Everything in R14b changes what an agreed reflection looks like, never who can reach it, and has sensible server defaults (one after another, everyone agrees to their own part, no collection, no items, no moments).

## Risks to test before release

- A co-writer sign-in on a real server: every route outside the allowlist answers 404 (generated from the route table, not a hand list); `meta` shows no settings; Studio's kept `meta` in `localStorage` holds only the reduced copy.
- An old reflection with `independent` sharing and no layout: opens, says "Each part stays private", the organizer changes it, everyone shares, agrees, publishes; the post matches the old gate's output byte-for-byte (`shared_publication_output.rs` fixture).
- Accounts made in the old Admin era (all owners) bound as participants keep working; nothing becomes a co-writer by itself.
- An invitation link from before G119 (`/admin/#/shared/accept/<t>`) opens Join with the token gone from the address and history before the first request; after R15's redirect too.
- Two tabs on Your part, one offline: no words lost; the conflict shows both; before G114, 200 versions are never reached by autosave.
- A hostile part (`<script>`, `[x](javascript:…)`, a 100-person roundtable, right-to-left names): text in Studio, refused at publish with the person named, preview sandboxed.
- Agreement drift: Ruth edits and re-shares after Sam agreed → Sam's state says read again; Publish refuses with `unapproved` naming Sam.
- iPhone at 320 px: Join with password managers (`new-password`), Copy/Send the link, Your part with the keyboard over the sticky bar.

## Docs and release note

- `docs/admin.md` (Studio manual, R15 rewrite): **Writing together** chapter: start, invite (new person / has a sign-in), what people can do, the join link, your part, sharing, reading, agreeing, publishing; R14b: layout, rules, collection, what we say together, moments. Rewrite l.892–975 (old "Start a shared reflection", "Putting a shared reflection in a series"). `docs/cli-reference.md`: `openblog user add --co-writer`. `docs/deploy.md`: co-writer sign-ins reach only Writing together. `CONTEXT.md`: add **Co-writer account** beside Admin user; "Shared reflection" stays the domain term, "Writing together" is Studio's. ADR: "Co-writer accounts reach only collaboration routes" (G110) and "Invite a new person by link" (G112), superseding ADR 0007's "any signed-in Admin user may pick any key" for co-writers. `retirement-plan.md` Decided 2 amended per ⚑ 1. `docs/studio-words.md` regenerated. `CHANGELOG.md`.
- **Release note (R14a):** Write with other people in **Writing together**: start from something you all watched, read or heard; invite people by name and send them the link yourself; each writes their own part, which saves itself and stays private until they let the others read it; read everyone's parts, see it as readers will, agree, and publish it on your blog or on a day you choose. People you invite get a sign-in that opens only what they were invited to. New reflections share parts when everyone's ready. Old invitation links still work.
- **Release note (R14b):** Choose how the parts are laid out, whose agreement counts, which collection it joins, add what you say together, and pin moments in what started it, all in Studio. Remove sign-ins for people you no longer write with.

## Changes to `studio-ux` (proposed)

- **Guests see only what they were invited to.** Someone who isn't the blog's owner gets a sign-in that the server limits to their invitation; their Studio has that one area, their Home is it, and nothing else is hidden-but-reachable.
- **Other people's words are text until everyone agrees.** Studio never renders another person's words as markup; the formatted view is the server's sandboxed preview.
- **Agreement is to exact words.** Anything that changes what someone agreed to says so before or as it happens, and the agreement is asked for again; nothing is published on an agreement to different words.
- **A secret in an address is read once and removed** before any request, and lives only in memory.
- **Shared things never overwrite.** When two people change a shared record, the newer copy is shown around what she typed; her words are never replaced without her press.
- Review checklist: "A guest account can reach nothing outside its invitation (server test)." and "Every action that clears someone's agreement says so."
