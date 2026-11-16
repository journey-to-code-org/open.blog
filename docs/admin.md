# Studio: running your blog

`openblog serve --admin` adds a sign-in protected editor to the same server that serves your blog.
It is called **Studio**, at `/admin/studio/`; the address `/admin/` opens it too, so a bookmark, a
Home Screen icon or a link from before keeps working ([Old addresses](#old-addresses)). Studio reads
and writes the same Markdown and JSON files you would edit by hand, so your content stays plain files
you own. No database is required by default; ephemeral hosts can opt into [durable Supabase workspace
storage](deploy.md#durable-editorial-workspace-on-ephemeral-hosts).

```sh
openblog user add you              # create a sign-in (prompts for a password)
openblog serve --admin             # http://localhost:8080/admin/
```

Passwords need at least 12 characters. To avoid typing one where it is echoed, use
`echo "your passphrase" | openblog user add you --password-stdin` or set `OPENBLOG_PASSWORD`. Other
commands: `user passwd <name>`, `user remove <name>`, `user list`. Changing a password or removing a
user ends that person's open sessions immediately. `openblog user add <name> --co-writer` makes a
sign-in that reaches only [Writing together](#writing-together).

Studio is built for two people at once. Its first layer of every screen is for the owner who writes:
plain words, one job per screen, and nothing technical. Everything for the person who set the site up
sits one step deeper: a **Details** or **For …** panel on each screen, **More**, and **Find**
(`Ctrl+K`, or `Command+K` on a Mac), which reaches every screen and action by name. The words Studio
says can be changed per site or per host ([Studio's words](studio-words.md)).

Every screen keeps what you were doing: drafts save themselves, leaving with unsaved work asks first,
and anything you take out or delete can be undone. Studio works on a phone at 320 pixels wide, with the
keyboard alone, and with a screen reader; it opens with no signal once it has been opened once
([Notifications and the Home Screen](#notifications-and-the-home-screen)).

## Getting started

The first time an owner signs in to Studio on a site where it is switched on, **Getting started**
(`#/start`) opens instead of Home: at most three short steps, each of which can be skipped, with
**‹ Back**, **Finish later** and **More › Skip the rest** on every one (an installed app has no
Back button). The navigation and Find are hidden while it is open; her name's menu, with Sign out,
stays.

- **Turn on your writing helper** is shown only when the site has no usable key. She pastes the
  key once; it is kept on the server and never shown again. A key that doesn't look like one is
  questioned before it is sent, one the company refuses is removed at once, and over plain `http`
  the field isn't offered at all. **Skip** leaves it for whoever set the site up.
- **Tell a few short stories**: three prompts from the Getting started set, each told by typing
  (three minutes, as in Your writing voice) or, when something on the server can hear, **out
  loud**. Before the first recording a sheet says where it goes, by company, or that nothing leaves
  the site. A finished recording is kept on the phone until it has been turned into words, then
  removed; the words are shown read-only. Stories are private voice pieces: never published, never
  in a build. Each can be read back and thrown away. Three is the ask; one is enough.
- **Let your helper learn how you sound**: her own stories are ticked, the box says what goes to
  which company, and nothing is sent until she presses and nothing saved until **Save my voice
  guide**. Without a helper that is on, or without a story, this step is passed over and the last
  screen says why.
- **You're ready** lists what was done, each with a word and a mark. Reaching it is what finishes
  Getting started for that account.

Where she is lives on the server, so a reload, a closed app or another phone lands on the same
step. After **Finish later** Home shows **Finish getting started** and it doesn't open by itself
again for 20 hours. **Getting started** in her name's menu runs it at any time. If she left the
stories untold, Write shows one card on a new post ("Want your helper to sound like you?") at most
three times, a week apart, never once she has typed, with **Don't ask again**. Home's details list
every account's line and offer **Show it again at next sign-in**. In Your writing voice, a story
told out loud is marked **Told out loud**, and A piece gains **More › Throw this piece away…**.

The switch, its four values and a practice run are in
[Getting started for a new owner](deploy.md#getting-started-for-a-new-owner).

### Your first time: About your blog

A Getting started run opens with **About your blog** (`#/welcome`) while that sign-in hasn't
answered it: up to six questions, one per screen, each with **Skip this one**, and **More › Skip
the questions** ([ADR 0429](adr/0429-studio-shows-feature-areas-chosen-per-sign-in.md)).

1. What will you mostly write? (technical writing and code, recipes and family stories, a trade or
   local business, teaching, research with sources, a podcast, documentation for a project, a
   journal or something else). `openblog init --kind` (or its question in a terminal) chooses this
   in advance; each sign-in can change it.
2. Will anyone else write with you?
3. Should your blog dress up for holidays and seasons?
4. Do you want to share posts beyond your blog?
5. Do you want readers to comment or react?
6. How much would you like to see? (**Show me everything** turns hiding off.)

Answers ride in the address until **Save these**, so a reload or **Back** loses nothing and
nothing is sent before then. The summary lists what Studio will show and why ("Because you write
recipes and family stories.", "Already on your blog.") and what is tucked away, each with
**Change**. Only an answer hides something: a question skipped hides nothing, and anything the
site already uses always shows.

After saving, the answers may **suggest site changes**: a documentation section for a
documentation blog, a recipe list for a recipe blog, or a screen to open (business details,
decorations, comments, sharing accounts). A change is made only by its own **Do this**, and its
exact change to `openblog.json` is under **For …**; going on changes nothing
([ADR 0431](adr/0431-a-suggested-site-change-is-shown-exactly-and-applied-only-when-confirmed.md)).
Last comes the offer to learn how she writes: **Start** goes on to Getting started's stories, drawn
from the prompt sets that suit her blog and always with one true story; **Later** leaves a card on
Home; **No thanks** stops the invitation ([ADR 0432](adr/0432-the-blog-kind-chooses-the-voice-prompt-sets-and-stories-are-kept-as-her-own.md)).

### What Studio shows: feature areas

Every screen, Find item, Home line and Write choice belongs to an area. Essentials (Home, Posts,
Write, Pictures, Look, Front page, People, the writing helper, Your writing voice, My stories and
these settings) always show. The rest can be tucked away per sign-in: **Pages**, **Collections**,
**Recipes**, **Your business** (services, reviews, jobs, requests, reminders, business facts),
**Seasons and holidays** (decorations, cards, gifts), **Sharing**, **Readers**, **Research**,
**Teaching** (reading paths, questions for readers), **Code and diagrams** and **Writing
together**. Answers and hidden areas belong to one sign-in, so two people on the same site can see
different Studios; they are kept in `.openblog/private/admin-preferences/` and never built
([ADR 0430](adr/0430-first-run-answers-are-per-sign-in-preferences-not-site-settings.md)).

A tucked-away part is one step away: its address says "Seasons and holidays is turned off for you"
with **Turn it on**; Find offers **Turn on …** for each; and **What you use** (her name's menu and
Find) has a switch for each, **Show everything**, and **Ask me the questions again**. A part the
site uses (a recipe post, a page, comments on) is never hidden and says so. Write keeps the open
post's own kind whatever is tucked away; code and questions for readers already in a post show as
themselves.

### My stories

**My stories** (`#/stories`, from Your writing voice and Find) gathers the true stories she has
told: pieces from the Stories, People and Getting started sets, and any other piece she adds from
**Other things you've written**. Each shows its first words, **Read it** and **Start a post from
this**, which makes a word-for-word polished copy when there is none and then a draft post; the
story itself is never changed. In Write, **More › Stories you could tell** opens them beside the
post to draw on; nothing is put in the post. Stories are private and never published.

## Home

**Home** (`#/`) asks "What would you like to do?": one big way to start writing, the drafts you are in
the middle of, and what needs you, said in words. It says how the site is doing ("Everything you've
saved is on your site.", or how many changes are saved but not on the public site yet, with **Put them
on my site**), how many jobs are waiting on this phone, notes from readers waiting for a decision, and,
on a trade site, **Your site in ten minutes**: add a phone number or email, publish a service, publish a
job, save a review and share a job. Each step is worked out from your files every time by
`GET /admin/api/trade-checklist`, which only reads, so it ticks only when your site has it; each open
step opens the screen where it is done ([A site for a trade business](trades.md)). A recipe site gets
its recipe notes here too.

Home's details (**For** the person who set up the site) hold the release of Studio's files, the branch
and remote, **Rebuild the site now**, and **Words**: the site's own changes to Studio's words and any
that were dropped, each in words.

### When saved work can vanish

On a host that resets its files, such as Render with no durable workspace, what you save can vanish
when the server restarts. Studio says so on Home and after a save, until [the durable
workspace](deploy.md#keep-your-work-safe-on-render) is on; nothing shows on your own computer. If
sending the site out cannot reach its repository, Studio says what that means in plain words, with
git's own message in the details.

## Write

**Write** (`#/write`, or a post from **Posts**) is where a post is written: a title, the words, and the
photos. A new post can be a story or a recipe (`#/write/new/recipe` opens one laid out with Ingredients
and Steps); a trade site's job is written here too. A draft saves itself as you type; **Publish** puts
it on the site, **Schedule** picks a day ([Scheduling](#scheduling)), and a published post waits for
**Update**, with "Changed · not on your site yet" until then. **Delete** moves the file to
`.openblog/trash/`, with Undo; nothing is destroyed. Photos go in with **Put a photo in**, which asks
you to describe the photo first ([Photo uploads](#photo-uploads)).

### Your words, with cards in place

In Write, your words are plain boxes you type in. Anything in a post that isn't plain
words shows as a **card** in place: a photo (with the words under it), a tip or a note, a checklist,
a table, a video, before and after photos, questions and answers, a question for readers, a button,
links to other pages, a map, opening hours, how to reach you, code, a footnote. A card shows a short
sketch of what it holds and never its Markdown. Each card has **Change** (the form for that kind,
filled in) and **Move** (**Move up**, **Move down**, **Take it out**); Alt+↑ and Alt+↓ move a focused
card, and ↓ on a box's last line (↑ on its first) goes to the card next to it. Every add, change, move
and take-out says what happened under the box, with **Undo**, which reverses only that action: words
typed since stay. When what it changed was edited since (or the words around a taken-out card are
gone), Undo says "This changed since, so it can't be undone here." and changes nothing. Words, Your story, a recipe's notes and a job's four parts take cards; ingredient and
step rows never do.

Nothing about a card is rewritten unless you change it: a post opened and saved with no change keeps
every byte. **Done** with nothing changed writes nothing. A card the form couldn't write back exactly
(a hand-written piece with a field the form doesn't know, raw HTML, a lesson demo, a quote request
form, indented code) has no **Change**; it can still be moved and taken out, and its source is in its
details. A code fence that never ends leaves the rest of that box shown as written, so nothing in it
moves; the details say on which line it starts.

**Show the words as written** (in Add something's details, or in Find) turns every box into one plain
box with the Markdown exactly as it's saved, for this post and this visit.

Pasting from a web page, a document or an email keeps headings, bold, italic, links and lists and
leaves fonts and colours out, in every box; a photo in the paste with no description is left out and
said so. A pasted or dropped photo file opens **Put a photo in** at the describe step. Ctrl/⌘ B and I
make the selected words bold or slanted.

**Suggestions** under the words list gentle checks once you stop typing: a photo with no description,
a link with no words or that says "click here", an http:// address, a heading that skips a level, all
capitals, a very long paragraph. **Show me** goes to the place (or opens the card); **Fix it**, where it
is safe, changes only that place, with Undo. Suggestions never stop a save. An HTML tag is noted only in
the details for the person who set up the site.

### Add something

**Add something** sits beside every **Put a photo in**. It opens a sheet that first says where the thing
goes ("It goes in Your story, after “My mother made this every…”."), then lists what you can put in,
in two groups, with a search. Typing `/` alone on an empty line in any box opens it with the search
ready (a line like "1/2 cup" never does). It also opens from Write's **More** ("Add something…"), from
Find ("Add a table", "Add a video"...), and from an address ending `?add=1` (the list) or `?add=<kind>`
(that form, for example `?add=table`).

Each thing has a short form with a live **How it looks**, **See it in your post** (the preview with it
included; nothing is added yet) and **Add it** (Ctrl/⌘ Enter). A problem is said beside its field and
focus goes there. Tips, checklists, tables, headings, quotes, links, questions for readers and code are
written by Studio and work with no signal. Pieces (a video, a button, links to other pages, questions and
answers, a map, opening hours, how to reach you, a photo with words under it) and before and after photos
are checked and written by the server (`POST /admin/api/pieces`), so the file holds exactly what the build
reads (a refusal is a 422 whose `problems` are sentences and whose `issues` are the same problems coded as
`{field, item, code, message, max}`, which Studio uses to say each one beside its field); with no signal the form keeps what you filled in on this device and **Finish adding the video**
appears at the top of the sheet the next time. Closing a filled-in form asks once ("Add this table?").

With the caret in a link, a heading or a quote, Add something opens **Change this link** (heading, quote)
filled in; a link also offers **Take the link off**. On a research post, **Abstract** and **References**
add their headings (the Abstract at the start, References at the end) unless the post already has them.

The details ("For the person who set up your site") hold **Code** (language, title, highlighted lines,
line numbers), **A diagram** (a Mermaid diagram from one of five examples, with a title and a description
for people who can't see it; **Draw it** shows it as the build draws it, and it goes in as a card; see
[Diagrams](diagrams.md)), **Code readers can run** (an example or a challenge; generating one comes in R8), **A
CodePen**, **A footnote** (`[^n]` at the caret and the note at the end), opening hours and how to reach
you on a site that isn't a trade site, and **Show the words as written**. Each form's details show
**What it writes**. There is no option to write your own HTML. See
[Pieces](content.md#pieces-buttons-videos-maps-and-more) and [Before and after](content.md#before-and-after).

### A recording to listen to

**Put a recording with it** (Write's **More**, or Find) puts a recording with a post, for readers to
listen to: a file from this phone or computer, or a voice note already on the blog. It says that anyone
with its address can listen once it's on the blog, even before the post is published, and sends it only
when you press **Put it on your blog**. The length is read from the recording. A published recording
needs **the words said**: type or paste them, or **Turn it into words** where the blog can (it says what
goes to which company first), then **Put them in my post**, which adds them at the end under Transcript.
The parts of the recording (chapters) are in the details. Once a post has a recording, a line under About
this post shows its length with **Change**. **Take the recording off this post** removes it when the post
is saved; the file stays on the blog. It all saves with the post. See [Audio episodes](audio.md).

### About this post, and who wrote it

In Studio every setting of a post is in Write's **About this post** (the button at the end of
the side column, More, `?sheet=about`, or Find: "About this post", "Summary for search and
sharing", "Who wrote it", "More about this recipe", "Details for the person who set up your
site"). The old Settings pane (`#/edit/<post>?pane=settings`) opens it. It has no Save of its
own: a draft saves itself, and a published post keeps the changes on that device until
**Update**, with Write saying "Changed · not on your site yet".

- **What kind of post**: a story, a recipe, a job on a trade site, and the post's own kind
  (video, trip outdoors, research). Changing it keeps the words; a story turned recipe offers
  **Add the recipe parts**, and **Undo** sits under the choice until the sheet closes. A
  legacy `recipe: true` post shows as a recipe and writes `profile` only when changed.
- **This recipe / This video / This trip outdoors**: only the post's own kind's fields
  (`course`, `cuisine`, `yield`, `totalTime`, `calories`, `adaptedFrom`; the video and field
  journal fields). Serves and the two times stay under the title. A job's `job.*` stay in
  About this job, never in the sheet.
- **On the page**: the line under the title (`subtitle`; an old `subheading` or `dek` goes
  when it changes), the part in its collection (`seriesOrder`), and comments for this post.
- **In search and when shared**: the summary (`description`, or whichever of `summary`,
  `brief`, `excerpt` the post already uses), a rough card of how a shared link looks, and
  Pin words when the site sends Pins.
- **Who wrote it**: the names in order. **Change who wrote it** picks people from People,
  moves them, removes them, or **Just me** (no credit file). The list is sent only when it
  changed, always with its `creditEtag`; a save of the title never touches the credit file,
  and a credit file that can't be read never stops the rest of the post saving.
- **Details for the person who set up your site**: the address (`slug`), editable only while
  the post was never on the site (the server's `wasPublished`, from the file's history in
  Git; without history it counts as published), old addresses, first published elsewhere
  (`canonical`), the theme, a picture by web address, every kind, the technical video and
  research fields, each person's roles, "Name no one on this post", repairing a broken credit
  file, the keys Studio doesn't edit ("Also in this post", kept exactly as written), and the
  file's facts. There is no rename: a post's file never moves.

Every value is written under the name the post already uses, only when it changed, and a
summary-only change rewrites one line of the file.

**People** (`#/people`; the old `#/contributors` opens it) lists the blog's own name and
everyone who can be named on a post. Add someone with a name and a website; their id comes
from the name and never changes; other pages and an ORCID iD are under its details. A person
named on posts, in a shared reflection or in research notes can't be removed, and People says
which posts. A removal can be undone. **Add someone who isn't listed** on a post comes back to
it with the new person on its list. Saves use the `openblog.json` revision token and change
only `contributors`. ORCID iDs are checked for their check digit but not verified.

### Copy it for another blog

Write › More › **Copy it for another blog** shows the post as it will go to Medium, Ghost,
Hashnode, DEV, WordPress, a web page or plain words, made from what's on the screen (saved or
not), with **Copy** and **Download**. The differences there are listed in plain words with
**Go to it**; the engine's findings, the destination's policy, the tag plan and **Mark as
checked** (portability acknowledgements, per version) are under its details. Nothing there
saves the post.

### Before you publish

Write's **Before you publish** sheet answers "Is there anything I should look at before people
see this?" It opens by itself only on a post's **first** Publish or Schedule, and only when it has
something to show (a blocker, a suggestion, the exact route, a check that couldn't run, or a
research post, which always opens it); **Update** opens it only when something blocks. It opens
any time from the card under About this post (its line says "2 suggestions so far", "Nothing to
check" or "Changed since the last check"), More, Find, R6's Suggestions (**Check everything before
you publish**) and See how it looks (**Show them**). In order:

- **Needs fixing first**: what the build would refuse: a job's check problems (each with **Go to
  it**), research findings the build refuses, and a post the build can't make. Publish waits,
  `aria-disabled` and still focusable, and says why; **Save draft** always works.
- **When it's shared**: the real card from `POST preview` (`only: "checks"`), with notes for no
  summary, a summary over 160 letters, no picture, or a picture that can't be shown. About this
  post shows the same card a moment after the title, summary or cover changes, and R5's rough
  card when there is no signal.
- **Suggestions**: one list in post order: R6's checks (with their Fix it and Undo), the engine's
  accessibility findings, search hints (`title-long` over 65 letters, `no-tags`, `no-name`) and the
  recipe advice See how it looks used to show. None of them stop Publish.
- **Your video**, **Your trip** and **Research checks** on those posts; **Worth a look**; and the
  details, which keep the search hints (summary length, opening paragraph, sections, depth,
  outside source), build notes, recipe codes and every raw server sentence.

The checks run in parallel and wait at most 8 seconds. With no signal, Publish goes the usual
way and the sheet doesn't open; a check that didn't run says so with **Check again**. Ctrl/⌘ Enter
in the sheet publishes (or, when something blocks, goes to the first blocker).

**Words for YouTube** (video posts) shows the title, description, tags and chapters as
`openblog video` writes them (from `POST video/release`, or the page's own copy of the engine's
rules with no signal): the description ends with "Read the article: <address>", a video with no
chapters is fine, and anything YouTube won't take is listed above with **Show me**. Copy never
waits on a problem.

**Your route** (trip posts) reads a route file on the phone with no network and keeps its text
only in the page's memory. Every file starts as **Don't show it** (the numbers only; the climb
drawing is off until switched on); **The shape, without where it starts and ends** leaves off
500 m at each end by default (200 m, 1 km or 2 km, or any number in the details); **The whole
shape**; and **The exact route**, which asks once. The drawings show exactly the values that will
be written. An exact route file is cleaned on the phone (positions and heights only) and again on
the server, staged privately, and sent with the next save, draft or not: the server holds it in
`.openblog/pending-tracks/held/` until the post is live, so a post with the exact route can be
scheduled. **Use this route**, a change of choice and **Take the route off** each have Undo. See
[Field journals](field-journal.md#import-a-gpx-track).

### The writing helper

The **Writing helper** is two places:
a sheet in **Write** for help with the post in front of you, and the **Writing helper** screen
(`#/helper`, in the account menu and Find) where it is turned on and where it keeps what it knows
about you.

Three rules hold everywhere the helper is used:

- **It says what leaves, before it leaves.** Above every button that sends something to another
  company sits a box headed **What goes to** *the company*: one line per thing that goes, what never
  goes, and **Word for word**, the exact text. Nothing is sent before that button is pressed, and
  nothing is kept to send later when there is no signal.
- **It suggests; you decide.** Nothing the helper returns changes a post without a press, every
  press can be undone, and what it returns is shown as text: never a link, a picture or a button,
  and never an instruction the blog acts on.
- **Where you were stays private.** A route file's token, the route, its shape and the drawing of
  the climb are never part of any helper request.

**Read it over.** Open the **Writing helper** card under *Before you publish* (or **More → Writing
helper…**, or Find). Choose **What to read**: **The whole post**, **The words I selected** (what was
selected when the sheet opened, even though opening it moved the selection), or **The part I'm in**
(from the heading before the caret to the next; with no heading, the box you were in). A part or a
selection longer than 20,000 letters is refused before anything is sent. Choose **What to look
for**: *Spelling, grammar and clear sentences*, *How it flows from start to finish* (not for a
selection), *Whether it sounds like me* (with a voice guide) and, on a research post, *Facts that
need a source*. **Use what your helper knows about you** sends your notes; **Sound like me** sends
your voice guide. The box lists exactly those. **Read it over** then asks; after twenty seconds it
says it is still reading and offers **Stop waiting**. Closing the sheet does not stop it: the card
says when it has finished.

**What your helper found** lists each suggestion in post order: where it is, your words quoted, why,
and what to try. **Use this** swaps exactly the quoted words, and only when they are found once,
inside one box of your words and outside any card; anything else is advice with **Show me**, which
closes the sheet and selects the words. **Undo** is on the card and in the line under the box, and
puts back only that swap, so anything typed since stays. **Use all** applies every one that still
fits, with one Undo. **Not this one** sets a suggestion aside, with **Bring it back**. Suggestions
live in the page's memory for this visit only.

**Suggest the next words as I type** is a switch in the sheet, off by default and never
remembered: it is on for this post and this visit. While it is on, a line under your words says so,
with **Turn off**, because each pause in typing sends the post to the company. A suggestion shows
under the box as plain words; **Tab** or **Use it** puts it in at the caret (with Undo), **Escape**
or **No thanks** drops it, and typing, moving the caret or changing the title drops it silently.
It never asks from a title, a recipe row or a card, nor with fewer than twelve letters written.

**Tell your helper about this post** keeps two notes with a saved post, *Who it's for* and *What
you want it to do* (and, under the details, learning outcomes, sources and anything else it should
keep to). They save by themselves, privately, and saving a note sends nothing anywhere.

**Write questions for me** and **Draft it for me** are in the forms for *A question for readers*
and *Code readers can run* ([Add something](#add-something)). Each says what goes first: the words
you selected, else the part you are in, else all your words, and nothing else. What comes back
fills the form, not the post; **Put back what I had** restores the form; and the result goes through
the same checks as what you type when you press **Add it** (a written answer that carries a link is
refused). Nothing is run in the page.

**The Writing helper screen** says whether the helper is on and holds **About you** and **About
your blog**, two notes that save by themselves. New notes are private
(`.openblog/private/context/`); a note already kept with the project (`assistant/context/`) stays
there until it is moved. If private notes are not ignored by Git the screen says so. Under **For
the person who set up your site** are:

- **Connection**: the company, the model, an address for a custom https endpoint, and the key.
  **The key is write-only.** The page never receives it: it shows only whether one is set, whether
  the server's environment sets one (which wins), or whether the saved one is for another company.
  The key field is empty when the screen opens and after every answer, is emptied before the
  request is sent, and has no way to show what was typed. A key that does not look like that
  company's (a pasted password, say) is questioned before it is sent. **Remove the saved key** asks
  first. Replacing or removing a key cannot be undone, because the blog never shows the old one.
  **Check it** asks the company whether it accepts the key, with one small call that carries
  nothing of the site, at most once every ten seconds.
- **What it can look for**: every skill, built in or the site's own, with an editor for the site's
  own and Undo after a save.
- **Things it can read**: where the notes are kept (and **Move**), text you add, and a web page
  fetched once after a confirm, shown before it is kept, and never fetched again.

**A key is never sent or accepted over plain http.** On a page reached over `http://` from anywhere
but this computer, the key field is disabled and says why. The server refuses a key (`422`,
`insecure`) unless the request reached it:

- through a proxy listed in `admin.trustedProxies` that sends `X-Forwarded-Proto: https`; or
- from the same computer with nothing in between (a loopback address, no forwarded headers, a
  `localhost` `Host`), **and only while nothing says the server is deployed**.

The server takes itself to be deployed when any of these holds, and then a request from the same
computer is not private by itself: a local reverse proxy that is not listed, drops the forwarded
headers and rewrites `Host` looks exactly like a person at the keyboard.

| What the server knows | Where it comes from |
| --- | --- |
| A proxy is listed | `admin.trustedProxies` is not empty |
| The Admin is served over https | `admin.secureCookies` is `true` |
| It listens beyond this computer | `serve --host` is not `127.0.0.1`, `localhost` or `::1` (the container starts it with `0.0.0.0`) |
| A host runs it | `RENDER=true`, any of `RAILWAY_ENVIRONMENT`, `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE_ID`, `RAILWAY_STATIC_URL`, `RAILWAY_PUBLIC_DOMAIN`, or `FLY_APP_NAME`, `DYNO`, `K_SERVICE` |
| The host chose the port and the site is public | `PORT` is set and `url` in `openblog.json` is not a `localhost` address |

The site's `url` alone does not count: a site with a public address is also edited on its owner's
own computer. On a deployed server, list the proxy (or set the key in the server's environment,
which needs no page at all).

The same rule covers every route that accepts a secret: the helper's key
(`PUT assistant/settings`), the readers' service token (`PUT engagement/settings`) and a social
account's app password (`POST social/connections`, `POST social/accounts/<id>/reconnect`).
Signing in is the one exception: a password has to reach the server to start a session, so use
https (`admin.secureCookies`) wherever the Admin is reachable from another computer.
Every change to the key is logged
with who made it and for which company, never the key, its length or any part of it.

When a helper call fails, the page says what happened in one sentence and leaves the post as it
was. The server answers each failure with a code beside its sentence: `key-rejected`,
`provider-busy` (with `retryAfter` when the company gives one), `provider-down`, `timeout`,
`refused`, `cut-short`, `invalid-result`, `concurrency-limit` (two helper calls may run at once on
a server), and for a request it cannot take `too-long`, `no-text`, `too-many`, `over-budget`,
`skill-scope`, `context-unavailable`, `bad-language` and `bad-count`.

#### What the helper knows about open.blog

Every review, interaction-generation, and autocomplete request includes a versioned engine guide generated
from open.blog's deterministic core. It describes native quiz and Rust/web runnable fences, configured
runner allowlists, code options,
supported embeds, content-profile IDs, scheduling, source ownership, and the limits of evidence checks.
These are renderer facts, not instructions found in the draft. Draft and context text remain untrusted
data. The guide prevents an AI from treating supported engine syntax as an error, but it does not let
the provider save, publish, certify claims, perform external research, or add unsupported syntax.

## Pages, collections and reading paths

**Pages** (`#/pages`) are the site's own pages, like About or Contact: a title, a line under it,
whether it is in the menu, and its look. **Collections** (`#/collections`) group posts on one topic;
on disk they are series (`content/series/`), and a post joins one from About this post. Both are lists
with **Write a new one**, and each opens in its own editor (`#/page/<path>`, `#/collection/<path>`).

**Reading paths** (`#/paths`, in the navigation on a site that uses them) are your own ordered routes
through published posts and public atlas entries, saved as `content/paths/<name>.json`. The editor
lists the steps in order; **Move** (a menu, or Alt+Shift with the arrow keys, never drag only) changes
the order, a sheet changes or adds a step with its relationship (from a closed list) and your reason in
your own words, and **What readers will see** is the same projection a published path would have, with
why it would not be published as it stands. **Save draft**, **Publish** and **Update** are explicit;
a reason the server holds a path back is asked about once; deleting it and every change can be undone
through the server's kept copy. Draft posts and private atlas entries are never offered as steps.

## Change your home page and your look

Four screens change how the site looks without any code. None of them has a box that takes HTML or
CSS, and nothing changes on the public site until you save.

### Front page

**Front page** (`#/front-page`) arranges your home page as sections, top to bottom, each said in a
line: a welcome banner, text, latest posts, collections, a featured post, buttons, a picture, a video,
a map, opening hours, how to reach you, social links, questions and answers, a call-out, and your
theme's own components ([Components an owner can place](theme-components.md#components-an-owner-can-place)).
**Change** opens a section's fields in a side sheet, **Move** and **Hide** do what they say, and taking
one out can be undone. **Add a section** lists them in plain words; an empty page offers ready-made
layouts (Welcome, Small business, Portfolio, Newsletter, Recipes). The Recipes layout shows your newest
recipes once you publish the first one; any Latest posts section can show **Only my recipes**. **See
how it looks** shows the page as the build would make it from your unsaved sections, in a frame that
runs no scripts. **Save** writes `content/landing.json` ([Landing page sections](content.md#landing-page-sections));
if someone saved a newer page meanwhile you choose whose to keep. Earlier versions (your last twenty
saves, kept privately) can be brought back.

### Look

**Look** (`#/look`) chooses how every page looks all year: a ready-made look, the main colour, the
lettering, the size of the writing, corners, spacing, page width, headings, and whether readers can
switch to dark. Each choice can go back to your theme's own. A colour that would be hard to read is
adjusted on the server just enough, and the screen says so. Only the choices your theme honours are
shown ([Look controls](themes.md#look-controls)); they are saved under `appearance` in `openblog.json`.

### Describe a new look

**Describe a new look** (`#/look/design`, reached from **Look** while the writing helper is set up,
and from Find) takes the look you describe in your own words, or one of five
ideas. Your writing helper drafts a look, and the screen shows its name, a sentence on what it chose and its
six colours by name, for light and for dark. **See it on your front page** shows your own front page in it,
in light or dark. **Change it** asks for a change in words ("a little warmer"), with **Back to the one
before**; **Change** beside a colour lets you pick that one colour yourself. **Save this look** makes it a new
look with the name you give it, then offers **Put it up now**, **Add it to your calendar** and, for ten
minutes while it isn't in use, **Undo**.

- **Start from** chooses which of your looks the new one builds on. It keeps that look's layout and
  seasonal touches and changes the colours and the lettering.
- **What the helper can choose** is deliberately small: six colours for light and six for dark, a font for the
  writing and one for headings from a fixed list, a corner style and a text size. It is never CSS, a script, an
  image or a font file. The server checks every answer and refuses any other field.
- **Colours are made easy to read, whoever chose them.** The preview and the save both rebuild the look on
  the server from the draft: writing at 7:1 where it can be and never under 4.5:1 on the page and on boxes,
  quiet writing, links and the text on a button at 4.5:1. A colour that is moved, or that cannot get there
  and is replaced (writing by black or white, quiet writing and links by the writing colour, boxes by the
  page colour), is shown as it will be with a sentence saying what changed. The page may warn early; it
  never decides what is saved.
- **Look's own choices still apply on top.** A main colour, lettering or corners chosen on **Look** are worn
  over whatever look is up, a new one included; the preview applies them as a build does and the screen says
  which.
- **Nothing changes until you choose.** Drafting and previewing write nothing. Saving only creates
  `themes/<new name>/theme.json`; it never replaces a look, refuses a name you already have, and never puts
  the new one up.

It needs the writing helper set up (see [The writing helper](#the-writing-helper)). Your description is sent
to the company you configured, as data it is told never to follow as instructions, and nothing else from your
site is sent but its title and the name of the look you start from; the screen says so before you press
**Draft a look**. The routes are `GET theme-draft`, `POST theme-draft`, `POST theme-draft/preview` (which
answers the readable `colors`, the `changes` as data and `lookApplied`), `POST theme-draft/save` (which
answers an `undoToken`) and `DELETE theme-draft/<name>?undo=<token>`, behind the session and the CSRF check
([ADR 0410](adr/0410-an-owner-describes-a-theme-in-words-and-the-assistant-may-propose-only-colours-fonts-and-sizes-the-engine-makes-readable.md)).

### Decorations

**Decorations** (`#/decorations`) is when the site changes for the seasons, and to what. The top says
what visitors see today and when that changes. Turn on the calendar and add a season for each holiday:
what goes up, and the day it starts and ends (a season can run past New Year; the order decides which
wins where two overlap). **Put a look up now** wears one at once, early, until a day you choose. With
the calendar off, this is where you choose the look your site wears every day. It saves the `theme` and
`seasons` members of `openblog.json` through `GET`/`PUT /admin/api/seasons`, checked against the
revision you loaded ([Seasons](themes.md#seasons)).

## Business, services, reviews and jobs

These screens are in the navigation on a trade site (business facts naming a trade); Business facts
are on every site from the account menu and Find, so a trade site can be started
([A site for a trade business](trades.md)).

### Business

**Business** (`#/business`) states your name, trade, phone, email, opening hours, license, insurance,
accepted payments and the year you started, once; the footer of every page, the front page's Business
facts section and the `LocalBusiness` search data all read it ([configuration](configuration.md#business-facts)).
Type a phone number the way you say it; each day of the week has its own choice. A problem is said
beside its field and a save that finds one changes nothing. It reads and saves `GET`/`PUT
/admin/api/business`, checked against the revision of the block you loaded, and changes only the
`business` key of `openblog.json`, edited as text so every other key keeps its place
([ADR 0307](adr/0307-the-business-facts-screen-edits-one-member-of-openblog-json-as-text-checked-against-a-revision-of-that-member-and-problems-are-said-beside-the-field.md)).

### Services and reviews

**Services** (`#/services`) describes each thing you sell once: what it includes, a price band, a
typical timeline and the questions customers ask ([Services](services.md)). **Reviews** (`#/reviews`)
saves a customer's real review with its link ([Reviews](reviews.md)). Each is a list, and one opens in
its own editor (`#/service/<path>`, `#/review/<path>`, `#/service/new`); both use the same document
routes as posts, so revision checks and the trash apply.

### New job

**New job** (`#/new-job`, in the navigation, the account menu and the app icon's long-press on a trade
site) is for a phone on a roof: photos from the camera or the library, made smaller on the phone first,
a voice note and a few words. The job is kept on this phone until there is a signal, then goes to your
blog as a draft you finish in Write (**About this job**, its four parts, Before and After on each photo,
and **Write it up for me**). Studio sends waiting jobs from any screen when the signal comes back, and
Home says how many wait. Jobs are kept in the browser's `openblog-capture` store, the same one the old
Admin used, so jobs kept before the switch are sent too; the iPhone app and Safari keep separate lists
([Jobs](jobs.md#capturing-a-job-from-a-phone)).

### Quote requests and reminders

**Quote requests** (`#/quotes`) lists the requests visitors sent, newest first: mark them handled or
archived, copy a phone number or email, download a spreadsheet for chosen days, and clean up archived
requests (it always counts first, with a dry run, and asks once). It appears once
`OPENBLOG_QUOTE_ENDPOINT` and `OPENBLOG_QUOTE_ADMIN_KEY` are set where the server runs
([Quote requests](quote-requests.md)). **Reminders** (`#/reminders`) suggests what to write for your
trade at the right time of year: write it, wait, or skip it; **Change topics and dates** edits them. A
reminder only opens an unpublished draft; it never publishes anything ([Seasonal reminders](seasonal-reminders.md)).

## Sharing and your accounts

**Sharing** (`#/sharing`, when [social publishing](social-publishing.md) is set up) is where a post is
shared to your accounts, and what happened to each share. **Share a post** picks the post, the accounts
and a time, with how it looks on each; every row then has its own sheet: **Change** a waiting share's
words or time, **Check it** for a share with no clear answer, and its **History**. One banner says when
shares run late or wait on an account that needs reconnecting. For Bluesky, LinkedIn and Facebook accounts,
**The picture that goes with it** shows exactly what each would get (the post's cover, made smaller for
Bluesky) and its description; the picture goes only with **Send this picture** after she has seen it, and for
LinkedIn and Facebook she chooses what happens if it can't go (share the link without it, or don't share).
This needs the optional media tables ([Social publishing](social-publishing.md)); until they are there, it
says pictures can't go yet.

**Where each post went** (`#/sharing?view=posts`) is Sharing's second view: every post that went
anywhere, its status at each place, what that rests on, a link to it there, and visits from there in
the last 30 days, 90 days or a year ([Where your posts went](distribution-reporting.md)). **Share this
job** (`#/sharing/job/<path>`) posts a finished job to a connected Facebook Page once, or gives you the
words to copy for Google and Nextdoor and remembers **I posted it**, with Undo ([Job sharing](job-sharing.md)).
A job with an after photo goes to the Page with it once she describes the photo, presses **Show what goes**
and says yes with **Send this photo and description**; a changed photo or description stops it instead of
posting without it.

**Your accounts** (`#/sharing/accounts`) connects, reconnects and disconnects LinkedIn, Facebook,
Bluesky and Mastodon, one sheet per service. Signing in happens at the service, which sends you back to
Studio; a Bluesky app password is emptied before it is sent and never kept on the page.

### Announce a post on social media (optional)

An announcement is a share: a post, a caption and a time for one connected account. While it is
waiting, **Change** edits its words or time and **Cancel** asks first; once a sender has picked it up it
cannot be changed, and the row says why. A failed one says why in words with **Try again** (a fresh
allowance of tries). One where the service did not say whether it went out is **Needs checking**: it is
never sent again by itself; look at the account, then **Check it** and say whether it is there. Delivery
health is in Sharing's details. This only schedules; the delivery worker and the service adapters do
the posting ([social publishing](social-publishing.md#the-delivery-worker), [status and
history](social-publishing.md#status-and-history)).

## Cards and gifts

**Cards** (`#/cards`, when greeting cards are set up) are cards sent by email on the day: a contact, a
design, the words, a sign-off and the day; **Send a test** first ([Greeting cards](greeting-cards.md)).
**Gifts** are kept beside them ([Gifts](gifts.md)).

## Readers and visitors

**Readers** (`#/readers`) is one inbox for everything readers send: comments, notes on a passage,
author answers, third perspectives, suggestions and reports. Six views (Waiting, Asked, Shown, Not
shown, Taken down, Taken back) and a kind filter; each card offers only the decisions the server offers
for it, a no can be undone, several can be decided at once, and what is on the post can be fixed from
the card. A note readers can see is published on the post when you say so. Keys work while a card has
focus (`j`/`k` move, `s` shows, `n` says no, `u` undoes).

**Visitors** (`#/readers/visitors`) gives visits (not people) over 7, 30, 90 or 365 days: a chart, top
pages and where visitors came from ([features](features.md)). **How readers reach you**
(`#/readers/setup`) holds the comment switches, the captcha, how long notes are kept (with a dry run
before anything is cleared), and the hosted service's address and write-only key. The routes are
`engagement/*` and `analytics`; refusals carry a `code` ([webmention](webmention.md),
[comments and analytics](deploy.md)).

## People

**People** (`#/people`) lists who writes, cooks or takes photos for your blog: the blog's own name and
everyone you can name under **Who wrote it** on a post, with their roles and an ORCID where they have
one. A person still named on a post can't be removed; the screen says which posts. Owners also see the
sign-ins of people writing with them ([Writing together](#writing-together)).

## Research

On a site that uses research (a research store, a research post, `citations`, or a research publish
switch), **Research** (`#/research`) says how far your research has come and what's next
([Research posts](research-profile.md)):

- **Sources** (`#/research/sources`) keeps sources with their people and identifiers; imports CSL JSON
  from Zotero or any reference manager after a preview; exports CSL JSON or BibTeX; and says where each
  is cited and used before it is archived.
- **Notebook** (`#/research/notebook`) keeps passages (**Keep a passage**) and notes, searches them and
  copies a passage's exact words.
- **Atlas** (`#/research/atlas`) keeps the people, works, concepts, movements and events you study, the
  links someone asserted between them, and their datings, typed as plain years with BCE or CE and read
  back at their stated precision; **Chronology** lists every dating side by side, never merged.
- **Compare** (`#/research/compare`) reads aligned passages side by side, every word exactly as kept.
- **Readings side by side** (`#/research/readings`) sets several attributed readings of one subject side
  by side without ruling between them, with relations, explanations by audience, and approval of the
  exact words as saved; text an AI tool drafted stays a draft until approved
  ([Interpretation comparisons](interpretation-comparisons.md)).
- **What readers see** (`#/research/public`) shows, part by part, exactly what your published posts,
  atlas and comparisons give readers and why everything else stays private, with the whole site's
  research checks.

In Write, **Add something** gains **A citation** and **A quotation from your notebook**; citations show
under each part of your words, **Your research** sits beside your words on a computer (a sheet on a
phone), **Claims and evidence** makes a claim from selected words and links evidence, and **For
readers** chooses what a post offers readers beside it. Words whose rights aren't cleared ask once
before they go in; nothing is looked up online. Every change to research can be undone, and a form you
leave within research is kept until you come back.

## Writing together

**Writing together** (`#/together`) is where you write something
with other people, each in your own words, about something you all watched, read or heard, and put it
on your blog when you all agree. It is in the navigation once you take part in one; until then, start one
from Posts (**Write something with others**) or Find.

1. **Start writing together.** Say what started it (a video, an article, a podcast, a book or something
   else, up to 20, with a link if it has one), the question you each answer, a name for it, your name on
   it (from People; **Add my name** puts the blog's name there), and when you read each other's parts:
   **When everyone's ready** (the default) or **Each person, when they're ready**. Only you can see it
   until you invite someone.
2. **Invite someone.** On the reflection, **People and invitations** lists who is in it and what each
   does (**Writes a part**, **Writes a part and helps run it**, **Only reads**, **In charge**). Choose
   their name from People, say whether they're new (Studio makes them a sign-in, with a name you can
   change) or already sign in, and what they do. **Make the invitation link** shows the link once:
   **Copy the link** (or **Send it…** on a phone) and send it yourself. Nothing is emailed. It works once,
   for a week unless you choose otherwise under the details. **Withdraw** stops it; **Make a new link**
   replaces it.
3. **Join.** Someone new opens the link, chooses a password, and is in. Someone who already signs in
   signs in as the name the invitation names and presses **Say yes**. **No thanks** stops the link.
4. **Your part** saves itself on this computer as you type and is sent as a version when you press
   **Save** (Ctrl/⌘ S), leave, or let the others read it, so typing never spends the 200 versions a part
   can have. **Ideas to start from** put a question in your words. **Start a new part** splits your part
   for the layout (readers never see the break). If you saved somewhere else too, both are shown and
   nothing is lost until you choose **Keep mine**, **Use the other one** (with **Bring mine back**) or
   **Decide later**.
5. **Let the others read it** asks once. When everyone's ready you all read each other's parts.
   **Everyone's parts** shows them as plain text; **See it as readers will** shows the formatted version
   in a frame that can run nothing. **Agree to publish this** asks once and can be undone.
6. **Your name on it.** Before anyone reads the whole thing to agree, each person whose part is in it says
   how readers see their name: **My name as People has it** (with its link, as it is when chosen), **A name
   I write here**, or **Leave my name off**. It's in the reflection's **More** and in Find; changing it later
   asks once, because everyone then agrees again. Reflections started before this keep their names as they
   were until someone chooses.
7. **Publish** (or **Publish on a day**) is for an owner account in charge of it, once everyone needed has
   agreed. It asks once; the post is signed by everyone who wrote. **Put it away** (in **More**) takes an
   unpublished one off the list, and **Bring it back** returns it; nothing is ever thrown away.

**Shaping it** (in the reflection's **More**): **Layout** chooses how the parts sit on the page (one
after another, side by side, two sides, back and forth, or around a table) and arranges rounds of turns
(whose part, which part of theirs, an optional label), moved with buttons or Alt+↑/↓. **Rules** says
whose agreement counts (everyone writing, everyone who wrote, people or jobs you choose, everyone taking
part including people who only read, or everyone who wrote and at least a number you choose, which never
goes down when someone leaves) and what an agreement covers (their own part, or the whole thing; a
reflection started now is always agreed as a whole). A change is a suggestion: it takes effect once
everyone taking part presses **Agree to this rule**, and the reflection shows it to each of them until
they do. Several parts per writer and sharing one version with named people are in the API but not yet in
Studio ([#705](https://github.com/journey-to-code-org/open.blog/issues/705)). **Collection** puts it in a collection at a place
you choose, shows the reading order, and lets someone in charge make a new collection. **What we say
together** holds what you say after everyone's parts (an agreement, a difference, a question, something
to try, or what you're not sure about), each speaking for the people named on it and agreed by each of
them. **Moments** (from Your part) are places in what started it, with the words said there or what you
noticed, kept private or put with your part; words said there need their rights and where they came
from. Each of these is saved on its own, asks everyone to agree again where it changes what they agreed
to, and can be undone. **Fill in from the link**, on Start, asks the link's own site for a title and who
made it, and fills only empty boxes. Under People's details, an owner sees **Sign-ins for people writing
with you** and can remove one: the sign-in goes, and so does every reflection it was in; names stay on
what they wrote.

People you invite get a **co-writer** sign-in: it opens only Writing together, only the reflections
they're in, and the server refuses everything else. The design is recorded in
[ADR 0413](adr/0413-co-writer-accounts-reach-only-the-collaboration-routes.md) and
[ADR 0414](adr/0414-invite-a-new-person-by-link-and-they-choose-their-own-password.md); the private files
are under `.openblog/private/collaboration/` (back that folder up with your other private files), as in
[ADR 0007](adr/0007-private-shared-publication-records.md) and
[ADR 0013](adr/0013-publication-scoped-invitations.md). Removing your account with `openblog user remove`
removes you from every reflection, and so does adding a new account under a name used before.

### Putting a shared reflection in a series

Each shared reflection has a **Series** section. Everyone taking part sees which series it will
join, its position, and the reading order it would have among the parts already published.
Site owners and coordinators choose an existing series or type a new title, set a position (or
leave it empty to follow the numbered parts, by date), use **Preview order**, and **Save
placement**. Choose **Not in a series** and save to remove it. The series and position are shown in
the combined preview and are part of what every author approves, so saving a change means each
author approves again. If someone else changed the placement first, your choice stays in the form
next to the current one and you can save again. Site owners can also **Add a new series** with a
name and a one-line recurring premise; it is an ordinary series file, not shown to readers until a
part is published, and other details stay in the Series editor. Once the reflection is published,
its series is changed in the post like any other. The design is recorded in
[ADR 0039](adr/0039-arranging-a-shared-reflections-series-in-admin.md).

## Your writing voice

Studio's **Your writing voice** (`#/voice`) does the same job as `openblog voice`, with the same files and
the same rules (see [ADR 0271](adr/0271-admin-voice-routes-are-thin-calls-to-the-session-and-the-store-and-the-server-owns-the-deadline.md)
to [0277](adr/0277-the-voice-invitation-is-shown-once-on-the-admin-home-and-a-dismissal-is-an-admin-preference.md)).
On her screens a sample is **a piece**, kept as a **rough draft** and a **polished copy**; where the files
live is under **For the person who set up your site**. It is reached from the Writing helper screen, from
Home's one-time invitation and from Find, and it needs no writing helper: only the voice guide does.

The old voice addresses open these screens ([Old addresses](#old-addresses)).

- **The hub** lists her pieces by set, newest first (a prompt answered on several days has a row per
  answer), with Rough and Polished badges in a word and a shape, a line per set, what isn't written or
  polished yet, and her voice guide. No piece's text is loaded there.
- **Write a piece** (`#/voice/write`): choose one of three prompts (**Show me three others** draws again),
  then **Start writing**. Spell-check, autocorrect and writing suggestions are off in the box on purpose.
  The server owns the clock: the page shows it, a reload or a lost signal carries on with the original
  deadline, and text sent after the deadline is refused. The draft goes to the server a moment after typing
  stops and a bounded copy stays on the phone (a day at most). **I'm done** saves the rough draft at once;
  leaving while the clock runs asks first. Pieces are always private when written here; three minutes is the
  only length in Studio (`openblog voice --seconds` keeps the others, and a session started that way shows
  its own length).
- **A piece** (`#/voice/piece/<id>`): the rough draft, read only and exactly as written, and a copy to
  polish. **Start the copy over** and **Use the saved one** apply at once with **Undo**; a copy changed
  somewhere else asks which to keep; unsaved changes stay on the phone for up to 30 days and are offered
  back. **Turn it into a post** makes a draft post from the saved polished copy (with **Undo**); a new title
  gives the post a new name. Moving a piece between private and portable is in the details.
- **Your voice guide** (`#/voice/guide`): the pieces to learn from are ticked for her (rough drafts first,
  newest first, never more than 8 pieces or 120,000 letters), and the page says **what goes to which
  company**, with **Word for word**, before anything is sent. What comes back is shown line by line, each
  quoting her own words; for each change she chooses **Keep what you had** or **Use the new one**, and
  nothing is saved until **Save my voice guide** (which writes the guide where it already is, or private).
  A saved guide can be undone. The diff, the guide's text, **Save as private** / **Save as portable**
  and **Move** are in the details.
- **Home** names writing kept only on the phone, and signing out with such writing asks first.

### Where voice samples are kept

Voice samples are the author's own writing, captured so Assistant tools can learn how you sound
(see [ADR 0266](adr/0266-voice-samples-are-assistant-context-and-a-rough-draft-is-immutable.md)).
They are Assistant context, not posts: they are never published, built into the site, added to a
feed, or exported as content. You write them from the terminal
([`openblog voice`](#write-a-voice-sample-from-the-terminal)) or in Studio
([Your writing voice](#your-writing-voice)), and you can take them with you
([export and import](#move-your-voice-library-between-projects)).

| What | Portable | Private |
| --- | --- | --- |
| Rough and polished drafts | `assistant/context/voice/<YYYY-MM-DD>-<prompt-id>-<stage>.md` | `.openblog/private/context/voice/` (same names) |
| The open writing session | | `.openblog/private/voice/session.json` (always private) |
| Your own prompts and hidden packs | `assistant/voice/catalog.md` | |

- **Private is the default.** Everything under `.openblog/private/` is ignored by Git
  (`openblog init` adds `/.openblog/private/` to `.gitignore`) and excluded from publish staging.
  The Context view warns, and names the file, if a private voice sample is tracked by Git.
- **A rough draft never changes.** Once its session ends the store refuses any later write to it;
  to fix typos, make a polished draft, which is yours to edit. You can move a pair between
  portable and private, or erase it.
- **Add prompts or hide packs** with `assistant/voice/catalog.md`: `## pack-id: Title` and
  `### prompt-id: Title` sections (see the bundled catalog in the open.blog source), and
  `disabled: [pack-id]` in its front matter to hide a pack. A prompt id the bundled catalog
  already uses is rejected.
- A project that has never written a sample has none of these folders, and its builds are
  identical to before.

### Write a voice sample from the terminal

`openblog voice` is a three-minute writing session. It draws three prompts, you pick one, you write,
and the clock locks your **rough draft** exactly as typed (typos included). `openblog init` offers one
session when you run it at a terminal; answer anything but `y` to skip, or pass `--no-voice`. Scripts
and pipes are never asked.

```text
openblog voice                     # draw three prompts: pick 1-3, r to draw again, q to quit
openblog voice a-mistake-i-made    # skip the draw
openblog voice --list              # packs, how many you have answered, and each prompt's stage
openblog voice --resume            # carry on with an interrupted session (deadline unchanged)
openblog voice --scrap --yes       # give up the open session and save nothing
openblog voice erase [--yes]       # list, then erase ALL voice data (see below)
```

- **Where you write.** If `$VISUAL` or `$EDITOR` is set, your editor opens a file with the prompt and a
  marker line; only the text below the marker is saved. The editor command must wait until you close its
  window: use `code --wait` or `subl -w`, not plain `code` or `subl`. An editor that returns at once without a
  change locks and discards nothing; the session stays open for `--resume`. Otherwise (or with `--stdin`) you
  type in the terminal and finish with a line holding only `.`, or Ctrl-D. To pipe text in, name the prompt
  (`openblog voice <prompt-id> --stdin`); piped text without one starts nothing and exits with an error. The
  deadline time is shown first.
- **One window at a time.** A session is written in one terminal. `--resume` in a second window while the
  first is still writing is refused, and nothing is changed.
- **The clock.** The deadline is stored when the session starts. Text written after it is not saved, and
  if you come back after it the saved text is locked. An empty draft saves nothing.
- **Options.** `--portable` keeps the sample beside shared Assistant context (the default is private),
  and `--seconds <n>` sets the window (30 to 3600, default 180).
- **Refine a copy.** `openblog voice polish <sample>` opens a copy of the rough draft in your editor and
  saves it as the **polished draft** (`--title`, `--slug`, `--description` and `--tags a,b` set its
  details). Run it again to edit the polished draft. The rough file never changes; `openblog voice diff
  <sample>` shows what you changed.
- **Make a post.** `openblog voice promote <sample>` creates a post draft (`draft: true`) in
  `content/posts/` from the polished draft, refuses a slug a post already uses, and leaves your samples
  alone. `--dir posts/2026` picks a folder inside `posts`.

`<sample>` is a file name from `voice --list` or a prompt id. Output is plain text.

### Erase your voice data

Samples are private unless you choose portable (`--portable`, or "Portable" when you start a session in
Studio); "Make private" and "Make portable" on a sample move it, with its partner, and moving it back
restores the same bytes. The voice guide moves the same way. Use **Make private** or **Make portable** on its
card in the Assistant Context view, or run `openblog voice guide --move private` (it shows what would move;
add `--yes` to move it). The file is copied, checked and only then removed, so a failed move never loses the
guide. A guide that quotes private samples, or cannot be read, stays private
([ADR 0289](adr/0289-the-voice-guide-moves-between-portable-and-private-in-one-locked-copy-verify-remove-step.md)). Private samples are never published, built, fed or exported as content (a voice
export carries them only with `--include-private`; see below).

`openblog voice erase` lists everything the voice feature stored: samples in both folders, the session
record, the voice guide and leftover editor files. It stops there; add `--yes` to erase. In Studio, **Your
writing voice › More › Erase all your voice writing…** asks once, in a dialog that says what goes (the
files are listed in its details); nothing is typed. The erase is all or nothing (if one file cannot be
removed, everything is put back) and ends with a second look that says "nothing is left" or names what is.
Studio also clears the copies kept on that phone. Copies in Git history or backups are not touched, and
neither are voice export files you wrote yourself (for example `.openblog/private/voice-library.json`):
delete those by hand. Whether an account said **No thanks** to Home's invitation is kept (it isn't her
writing).

### Use voice samples and a voice guide with the Assistant

Your samples and a **voice guide** can be chosen as Assistant context, so reviews and suggestions
sound like you and not like a model (ADRs [0278](adr/0278-voice-samples-and-the-voice-guide-are-selected-as-assistant-context-by-id-and-reloaded-on-the-server.md)
to [0281](adr/0281-the-engine-guide-teaches-voice-samples-and-gaps-are-computed-by-the-core.md)).
Nothing is sent unless you select it and run a request, and nothing here changes a project that has no samples.

- **Choose samples.** In the Assistant's Context view a **Voice samples** section lists each sample with its
  stage, pack, prompt, visibility and size. Tick the ones to send. The disclosure lists them with a running
  total against the limit of 8 samples and 120,000 characters per request; a selection over it is refused
  before anything is sent. The server reads the chosen files again for every request, so the browser only ever
  names a sample. Sample text is sent as data to compare against, never as instructions.
- **Propose a guide.** In Studio this is **Your voice guide** (see [Your writing voice](#your-writing-voice)).
  The provider
  returns a guide in which every line quotes your own words word for word and names its sample (a result with
  a quote that is not in the sample is rejected, and nothing is shown). A line that rests on one sample is
  marked `(one sample)`, and the guide always ends with *What is not yet known*. The proposal is folded into
  your saved guide ([ADR 0288](adr/0288-a-proposed-voice-guide-is-folded-into-the-saved-guide-on-the-server-and-the-author-decides-each-change.md)).
  Traits it does not address are kept word for word and labelled **Kept from your current guide**. Your own
  text outside the traits, such as an introduction, notes or sections under your own headings, stays where it
  is. A trait the proposal changes is shown with both texts, and you choose **Keep current** or **Take proposed**
  for each one before you can save. A kept quote is checked again against its sample and flagged, not dropped,
  when that sample no longer exists or no longer contains it. You see the proposal as
  changes against your saved guide, can edit it, and it is written only when you choose **Save as portable**
  (`assistant/context/voice.md`) or **Save as private** (`.openblog/private/context/voice.md`, the default).
  **Discard** leaves your files as they were. A guide changed elsewhere since you opened it is a conflict, not
  an overwrite. A guide built from any private sample, from a saved guide that is private, or from a saved guide
  whose traits quote a sample that is private now, records that on a
  provenance line under its title (`<!-- openblog:voice-provenance sources=... -->`) and can only be saved as
  private: **Save as portable** is disabled with the reason. Keep that line if you edit the guide; the
  portable rule relies on it.
- **Use the guide.** Select the guide like any context. The `voice-review` skill compares your draft with it and
  with your samples, and names the sample or guide section behind each finding (a finding that names none is
  marked unverified advice). The `voice-match` skill works on a passage: select text or put the cursor in a
  section, choose **Selected text** or **Current section** in Review, and it suggests small replacements inside
  that passage only. A suggestion that cannot be found exactly in the passage is shown as advice and never
  applied, and any applied suggestion can be undone. With AI autocomplete on and the guide selected, suggestions lean toward your voice, and turning
  autocomplete on names the selected context first.
- **Never your rough text.** The Assistant never edits a rough draft and never applies a change to a polished
  draft: it proposes, you decide.
- **What is missing.** `openblog voice --list` also shows packs with no sample yet, prompts with a rough draft and
  no polished draft, and guide traits that still rest on one sample; the Sample library shows the same list under
  **What is missing**, and the guide request carries it.

### Move your voice library between projects

`openblog voice export` puts your voice samples and your voice guide in one JSON file; `openblog voice import`
reads such a file ([ADR 0284](adr/0284-the-voice-library-travels-as-one-previewed-all-or-nothing-export-that-keeps-each-items-folder.md)).
Neither needs a hosted service.

```text
openblog voice export                                  # print the portable samples and guide
openblog voice export --out voice-library.json --write # create the file (never replaces one)
openblog voice export --include-private --out .openblog/private/voice-library.json --write
openblog voice import voice-library.json               # preview: what would be created or replaced
openblog voice import voice-library.json --write       # apply, all or nothing
```

- **Private stays private.** An export holds only the portable folder unless you pass `--include-private`, and
  a file with private material is refused inside the project except under `.openblog/private/`.
- **Limits.** One guide travels: with both a portable and a private guide, the portable one is exported and
  the export warns that the private one was left out. One export holds at most 100 samples and 8 MiB; a larger
  library is refused whole, and nothing is written.
- **Previewed.** Import is a dry run unless `--write`. It lists `create`, `replace` or `unchanged` for each file
  and the folder it goes to, and it writes nothing at all if any item is invalid, too large, in a newer format
  or in conflict.
- **Folders are kept.** An item lands in the folder it came from; an import never moves private text to the
  portable folder, and `--as private` puts everything in the private folder. When files would go to the
  portable folder (which Git tracks) the preview says so.
- **Rough drafts are safe.** A rough draft that differs from the one already saved is a conflict, with or
  without `--overwrite`. A differing polished draft or guide is replaced only with `--overwrite`.
- **The guide follows its provenance.** A guide whose provenance line lists private samples is only accepted
  into the private folder, and is left out of a portable export.
- A valid file round-trips byte for byte. A library with no samples exports an empty file, and Studio has no
  import screen: the file moves between projects, and the command line is the place for it.

To remove the whole voice library from a project, see [Erase your voice data](#erase-your-voice-data):
`openblog voice erase [--yes]`, or **Erase all voice data…** in Studio with the typed confirmation. It is all or
nothing, checks again afterwards, and refuses a linked folder (see
[ADR 0282](adr/0282-voice-samples-are-private-until-the-author-chooses-portable-and-a-move-between-the-folders-is-reversible.md)
and [ADR 0283](adr/0283-erasing-voice-data-is-listed-confirmed-staged-in-a-trash-folder-and-checked-again.md)).

### Write your own prompt packs

Add prompts, or hide whole packs, with `assistant/voice/catalog.md`. It has the same shape as the bundled
catalog: optional front matter with `disabled: [pack-id]`, then `## pack-id: Title` sections (with an optional
one-line summary) holding `### prompt-id: Title` sections that begin with `words: low-high` and then the
invitation. Ids are lowercase kebab-case and are never renamed or reused, because a sample records its prompt
id; a prompt id the bundled catalog already uses is rejected. Write prompts the way you would ask a friend
("Tell me about a mistake you made and what it taught you"), keep each to a sentence or two, and give a pack
at least three so a draw has something to choose from. `openblog voice --list` shows your packs and a warning
for any section that could not be read.

## Notifications and the Home Screen

**Notifications** (`#/notifications`, from your name at the top) tells your phone when someone
comments, a reader sends a note or someone asks for a quote, once the hosted push function is set up
([Notifications](notifications.md)). It shows every state of the phone in your hand, with the steps to
allow notifications again where you said no, switches for what you hear about that save at once, **Send
a test**, and your other phones and computers. **Add to Home Screen** (or **Install as an app** on a
computer) gives Studio its own icon: the app is named after your site, starts at `/admin/studio/`, and
keeps one worker at `/admin/sw.js` (scope `/admin/`) for notifications and for opening with no signal.
The worker keeps only Studio's own files, network first, and never an `/admin/api/` reply. An app
installed before the switch still starts at `/admin/`; the server, or with no signal the worker, sends it
to Studio.

## Photo uploads

A photo can be uploaded at any size up to 40 MB. A photo that is wider or taller than 2000 pixels, is heavier
than 1 MB, or carries camera metadata is replaced as it arrives by a JPEG (a PNG, if it has transparent parts)
at most 2000 pixels on its longest side. The original is not kept. The copy is turned the right way up, keeps
the photo's colour profile, and drops the metadata, including the location a phone may have recorded.

Other pictures are published exactly as sent, up to `admin.maxUploadMb`: GIF and AVIF files, animations, light
pictures without metadata, and photos above about 64 megapixels, which are too large to decode safely on a
small host. Over that limit they are refused with a message saying so. Only one photo is reduced at a time, so
two large uploads together cannot run a 512 MB host out of memory.

iPhones take photos in HEIC, which web pages cannot show. An iPhone converts a photo to JPEG when it is chosen
in Studio. A HEIC file copied to a computer first is refused, with a message asking for a JPEG copy.

Files added some other way, such as a commit to `static/`, are not reduced.

## Scheduling

A post's status is one of:

- **Draft**: never public (`draft: true`).
- **Published**: the date is now or in the past.
- **Scheduled**: the date is in the future.

Pick a day under **When it appears** (and a time, in your own time zone; a future
day with no time gets 8:00 AM, shown in the time field) and press **Schedule**. The help says
when it really goes up: "by itself" only when the server keeps that promise (`meta.schedule`
is `self`: this server is the site, or it sends the built pages out after the scheduled
rebuild), otherwise "the next time your blog is sent out after that" (`next-send`, the live
site is built elsewhere). Scheduled posts are held back from the pages, feeds, sitemap, search
index, tags, series and the latest-posts JSON. The server checks every few seconds and
rebuilds when one comes due; with `publish.auto` it then sends the site out too
(`Publish scheduled post <title>`). **Make it a draft again** unschedules it, keeping the day.
Moving a published post to a later day asks first, because it comes off the site until then.

This works in plain files too: any post with a future `date:` stays hidden until a build
runs after that time. So a scheduled post also goes live on a static host if something runs
`openblog build` periodically: see [Scheduled builds](deploy.md#scheduled-builds).

```yaml
date: 2026-12-25T09:00:00Z      # offsets work too: 2026-12-25T09:00:00-05:00
```

`openblog build --drafts` and `serve --drafts` include drafts and scheduled posts, for
previewing.

## Running it for real

By default the server listens on `127.0.0.1` only. To use Studio from anywhere, run it on
a machine you control and put it behind HTTPS (a reverse proxy such as Caddy or nginx), then:

```jsonc
// openblog.json
"admin": {
  "secureCookies": true,      // mark the session cookie Secure (required over HTTPS)
  "sessionHours": 12,
  "maxUploadMb": 10,
  "usersFile": ".openblog/users.json",
  "trustedProxies": ["127.0.0.1"]   // the proxy's address, so login limits see real clients
}
```

Entries in `trustedProxies` are exact IP addresses, not ranges, or the single entry `"*"`
to trust every connection's `X-Forwarded-For` (only right when nothing can reach the
server except through the proxy, as in a container on a PaaS; the
`OPENBLOG_BEHIND_PROXY=1` environment variable sets this and `secureCookies` together). A connection from one of
them takes the client address from the last `X-Forwarded-For` entry, the one that proxy
appended; if the header is missing, the proxy's own address is used and every visitor
shares one login limit. Connections from a trusted proxy are also exempt from the
per-address connection cap, so the whole readership is not squeezed through one slot.

```sh
openblog serve --admin --port 8080
```

Keep the default `--host 127.0.0.1` when the proxy runs on the same machine, so only the
proxy can reach the plain-HTTP port; use `--host 0.0.0.0` only when the proxy is elsewhere,
and firewall the port. The proxy must pass the original `Host` header through and add
`X-Forwarded-For` (Caddy does both by default; nginx needs `proxy_set_header Host $host;`
and `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). Without the `Host`
header every login and save is refused as cross-origin; without `X-Forwarded-For` all
visitors share one login limit. [Deploying](deploy.md) has a complete nginx example.

Without HTTPS, passwords and sessions cross the network in clear text; the server prints a
warning if you expose it that way with `secureCookies` off. Keep `.openblog/` (users file and
trash) out of version control; `openblog init` adds it to `.gitignore`.

The public site and the admin share one process, so the blog is served by this server too.
If you would rather host the static output elsewhere, run the admin where the content lives
and publish `dist/` onward (for example with a git push or rsync after each build).

### Troubleshooting local styles and sessions

If the browser refuses `/assets/base.css` or `/themes/.../tokens.css` because the response
has the `text/html` MIME type, first restart `openblog serve --admin` after upgrading. Sites
whose configured URL includes a base path, such as `https://example.github.io/project/`,
still open Studio at `/admin/studio/`; in admin mode the server maps its root-relative
asset requests to the same built styles used by the public site. A stale pre-0.6.1 server
does not provide that mapping. If restarting does not help, run `openblog build` and confirm
the corresponding files exist under `dist/assets/` and `dist/themes/`.

An initial `GET /admin/api/session` response of `401 Unauthorized` is expected when no valid
admin cookie exists: it is how Studio decides to show the sign-in form. A `401` after
you have signed in means the session expired, the user was removed, or the password changed;
sign in again. It is unrelated to stylesheet MIME errors.

## Optional question generation

Knowledge checks work without an AI service. To add **Write questions for me**, **Read it over**
and the rest of [the writing helper](#the-writing-helper), set it up on the **Writing helper**
screen. The company, the address and the model are saved in
`openblog.json`; the key never is. It is kept in `.openblog/private/assistant/api-key` (mode 0600,
protected with DPAPI on Windows), is write-only from the page, and is refused over plain http
except from the same computer.

```jsonc
// openblog.json
"knowledgeChecks": {
  "provider": "anthropic",
  "generationEndpoint": "",
  "model": "claude-sonnet-5-5"
}
```

Choose a native provider to use its official API directly. open.blog fixes the destination for
native providers; only **Custom HTTPS** accepts an endpoint entered by the author.

| Provider | Suggested model | Environment credential |
|---|---|---|
| Anthropic Claude | `claude-sonnet-5-5` | `ANTHROPIC_API_KEY` |
| OpenAI | `gpt-6-luna` | `OPENAI_API_KEY` |
| Google Gemini | `gemini-3.8-flash` | `GEMINI_API_KEY` |
| xAI Grok | `grok-4.7` | `XAI_API_KEY` |
| DeepSeek | `deepseek-flash` | `DEEPSEEK_API_KEY` |
| Mistral AI | `mistral-small-latest` | `MISTRAL_API_KEY` |
| OpenRouter | enter a supported routed model ID | `OPENROUTER_API_KEY` |

The model field remains editable because provider model catalogs change. OpenRouter restricts
routing to upstream endpoints that accept the requested structured-output parameters, but the
upstream service still determines exact schema support.

### Transcribing a voice note

Studio's **New job** (with a signal) and a job's page in **Write** can turn a recorded voice note into words, only
when you ask and only after they say what is sent and where ([ADR 0302](adr/0302-transcription-is-a-separate-confirmed-call-through-the-provider-boundary-that-sends-only-the-recording-and-returns-untrusted-text.md)).
Only the recording is sent: no notes, photos, title or voice guide. Two providers take audio: OpenAI
(transcribed with `gpt-4o-mini-transcribe`) and Google Gemini (your configured model). Any other provider is
never sent audio, and **Turn it into words** isn't offered.

To keep audio on your own machine, set `OPENBLOG_TRANSCRIBE_COMMAND` in the server's environment to a JSON array:
the program and its fixed arguments. The server appends the voice note's file path and reads the transcript from the
program's output.

```sh
export OPENBLOG_TRANSCRIBE_COMMAND='["whisper-cli", "--model", "/models/base.bin", "--no-timestamps", "--file"]'
```

It runs without a shell, with a stripped environment (your API keys are not passed), no input, a time limit and a
bounded output. It is an environment setting, not part of `openblog.json`, so shared site files cannot name a
program to run. When it is set it is used instead of a provider. The transcript is kept privately beside the
note (`.openblog/captures/`) and is untrusted text: it goes under the words you typed (or under **Problem** in Write), made plain, for you to edit.

```sh
export ANTHROPIC_API_KEY="your Anthropic key"
openblog serve --admin
```

An OpenAI integration uses an OpenAI API key and API billing; a ChatGPT or Codex product
subscription is not itself an API credential. GitHub Copilot is not listed because its supported
programmatic integration is an authenticated agent/CLI SDK rather than this API-key provider
contract, and the separate GitHub Models inference API has been retired.

For an existing compatible service, choose **Custom HTTPS** instead:

```jsonc
"knowledgeChecks": {
  "provider": "custom-https",
  "generationEndpoint": "https://lessons.example.com/generate",
  "model": "your-model-name"
}
```

```sh
export OPENBLOG_LESSONS_API_KEY="your secret"
openblog serve --admin
```

The credential can instead be added, replaced, or cleared in the Assistant provider panel. It is
write-only and stored under `.openblog/private/assistant/`, never in `openblog.json`. An environment
credential takes precedence when present. Studio reports only whether a credential exists and where
it comes from; it never returns the saved value. Saved private credentials are bound to the provider
and destination active when they are entered. If you switch providers or change a Custom HTTPS
endpoint, enter the appropriate key for the new destination rather than reusing the hidden value.
Credentials saved by an older open.blog version have no destination binding and are not reused;
enter them once in the current panel to bind them safely.

Custom HTTPS endpoints receive JSON with `context`, `count`, `model`, task instructions, and the
expected response shape. They return one to three questions:

```json
{
  "questions": [{
    "prompt": "What stays in the reader's browser?",
    "choices": ["Quiz attempts", "Published posts"],
    "correctIndex": 0,
    "explanation": "Attempts are private local progress."
  }]
}
```

The key and endpoint are used only by the admin server. The browser calls the authenticated
same-origin admin API, public builds contain only the reviewed Markdown, and readers never
contact the generation service.

Open a post's **Assistant** view to confirm whether this provider is ready. If configuration
is incomplete, the status message identifies the server-side setting or environment variable
to add. It never displays the endpoint or credential value.

## Security design

- Passwords are hashed with Argon2id. Session and CSRF tokens are 256 random bits from the
  operating system.
- The session cookie is `HttpOnly` and `SameSite=Strict`, scoped to `/admin` (Studio lives under it,
  at `/admin/studio/`). Every API route
  except login checks it **before any request body is read**, so anonymous clients cannot make
  the server buffer uploads.
- Every state-changing request needs the CSRF token header and, when the browser sends one, a
  same-origin `Origin`. JSON endpoints require `Content-Type: application/json`.
- Failed logins are limited two ways. A client address is locked for five minutes after five
  failures (the attempt is counted before the password is checked, so parallel guesses do not
  slip past). A username is never locked, only slowed down with a growing delay, so someone who
  knows your username cannot shut you out. Unknown usernames take as long as wrong passwords.
- File paths from the browser are matched against a strict allow-list (`posts/`, `series/`,
  `pages/`, `.md` only) and resolved inside the content directory, including through symlinks.
- Uploads are accepted by their bytes, not their names: PNG, JPEG, GIF, WebP, and AVIF only.
  SVG is refused because it can carry scripts.
- Studio is served with a strict Content-Security-Policy: `script-src 'self'`,
  `style-src 'self'`, `frame-src 'self'`, with no inline scripts, no WebAssembly and no other
  site framed. Runnable code and embeds are shown only inside a preview, which carries its own
  policy.
- The writing helper's key is write-only: no response, log line or error carries it, it is
  refused over plain http except from the same computer, and each change is logged with who made
  it and never the key. Text a helper returns is treated as untrusted text and is never executed.
  Full-page
  previews are kept in a small in-memory cache behind an authenticated random URL and rendered in
  an opaque-origin sandbox. Built-in components and the selected theme's local or configured-CDN
  assets can run, while owner-supplied analytics, comments, and other raw HTML snippets are removed
  from unpublished previews. The preview cannot submit forms or access the admin document.
- Front matter values are always quoted so a value containing a newline cannot add fields.
- Limits: 64 concurrent connections (16 per address, not applied to trusted proxies),
  header and body size caps, deadlines for slow senders and slow readers, and no chunked
  bodies.

- Studio's files are embedded in the server and cannot be replaced by a site: files under
  `<paths.web>/admin/` are not read (except `admin/icons/`, the app's icons) and never published.
  `/admin/` and every other old Admin address answer `302` to `/admin/studio/`, with `no-store`, so the
  redirect is never cached.
- A co-writer sign-in (`--co-writer`) reaches only Writing together: every other API route answers
  `403` before any body is read.

What it does not do: multi-factor sign-in, or roles beyond owner and co-writer.

## Old addresses

The old Admin was retired in Studio R15 ([ADR 0415](adr/0415-the-old-admin-is-retired-and-admin-redirects-to-studio.md)).
Its addresses keep working, forever: bookmarks, notifications queued on other phones and old
invitation links still carry them. The server answers `/admin` and `/admin/` (and any other old page)
with a `302` to `/admin/studio/`, dropping the query; the browser keeps the `#…`, and Studio maps it to
its own screen and puts its own address in the bar. This is the only place in these docs where the old
addresses are written out.

| Arrives as | Opens |
| --- | --- |
| `/admin`, `/admin/`, `/admin/?anything` | Home |
| `/admin/#/overview` | Home |
| `/admin/#/posts`, `#/pages`, `#/series` (with `?status=`) | Posts, Pages, Collections |
| `/admin/#/new/posts`, `#/new/recipe`, `#/new/pages`, `#/new/series` | Write, a new recipe, a new page, a new collection |
| `/admin/#/edit/<path>` | Write, a page, a collection, a service or a review, by folder |
| `/admin/#/edit/<path>?pane=settings` | About this post |
| `/admin/#/edit/<path>?pane=social`, `optimize`, `accessibility` | Before you publish |
| `/admin/#/edit/<path>?pane=release`, `field`, `assistant`, `evidence` | Words for YouTube, Your route, the Writing helper, Claims and evidence |
| `/admin/#/analytics[/<days>]` | Readers › Visitors |
| `/admin/#/moderation[/<state>][?kind=]`, `#/feedback…` | Readers, in that view and kind |
| `/admin/#/contributors` | People |
| `/admin/#/voice`, `#/voice/library[/<id>]`, `#/voice?pack=<id>` | Your writing voice, a piece, Write a piece |
| `/admin/#/social`, `#/announcements`, `#/distribution`, `#/share/<path>` | Your accounts, Sharing, Where each post went, Share this job |
| `/admin/#/quotes`, `#/greetings`, `#/reminders`, `#/business` | Quote requests, Cards, Reminders, Business |
| `/admin/#/notifications[?sheet=home-screen]`, `#/capture…` | Notifications (and the Home Screen sheet), New job |
| `/admin/#/landing`, `#/look`, `#/appearance`, `#/seasons`, `#/design` | Front page, Look, Look, Decorations, Describe a new look |
| `/admin/#/services[/new\|/edit/<path>]`, `#/reviews[…]` | Services or Reviews, or the editor for one |
| `/admin/#/paths[/new\|/edit/<name>]`, `#/comparisons[…]` | Reading paths, Readings side by side |
| `/admin/#/research…`, `#/sources…`, `#/atlas…`, `#/compare…` | Research and its parts |
| `/admin/#/shared`, `#/shared/new`, `#/shared/accept/<token>` | Writing together, Start, Join (the token never stays in the address) |
| `/admin/#/tools`, `#/not-yet/<name>` | Home, or the screen that replaced that part |
| An unknown address | Home |

A tab of the old Admin left open across the update keeps saving through the same API; its next
screen fails to load and a reload opens Studio. Unsaved Front page and Look changes the old Admin kept
in the browser are offered back once, the next time you open Front page or Look. What the old Admin
kept elsewhere in the browser (its colour scheme, editor mode, preview width) is left alone and no
longer read. The tests keep every old address landing where this table says
(`tests/web/studio-legacy-routes.test.mjs`).
