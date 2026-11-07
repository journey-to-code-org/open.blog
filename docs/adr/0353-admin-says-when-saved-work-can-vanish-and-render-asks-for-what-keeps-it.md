# ADR 0353: Admin says when saved work can vanish, and Render asks for what keeps it

- Status: Accepted
- Date: 2026-11-07

## Context

`render.yaml` as written runs the free plan with no disk, no Git credential and no durable workspace.
This path was confirmed by reading the code; none of it was run on Render.

- Admin saves to the container's files. `Workspace::restore_from_env` returns nothing with no settings,
  so a restart or a deploy starts again from the image. Saved posts, drafts, photos, Look and Landing
  saves go. An idle wake is expected to do the same, because the plan has no disk.
- Publish makes a local commit and then fails to push, with `git push failed: ...` shown to the owner.
- Save rebuilds the served site, so the work looks kept until the container resets.
- Admin said "Save keeps your changes" and "2 drafts kept local".

The real fix, the Supabase workspace and a credential, needs accounts only a person can create. The
owner still deserves the truth until then.

Three claims in the file and the docs were also wrong:

- The commented disk mounts `/blog/.openblog`, which holds no post, draft or photo.
- View counts do not survive through the analytics branch. A fresh container has no copy of the branch
  (`container-git.sh` fetches only the shipped commit), only a build reads that branch, and only for
  baked numbers. `Store::load` starts the live store empty. `commit_file_to_branch` then starts a new
  orphan branch, whose push is not a fast-forward once the remote branch exists.
- An empty `OPENBLOG_WORKSPACE_*` value counted as configured: `configured()` asked only whether the
  variable existed. `Backend::from_env` then refused to start the server. So prompting with `sync: false`
  was unsafe if a host passes an unfilled prompt as an empty value, which we could not check.

## Decision

- **The server decides, as one field.** `filesMayVanish` is true when the host resets its files and no
  durable workspace is on. `GET status` and `GET publish` both carry it, because Overview asks the first
  and the header, Landing page and Customize look ask the second. It describes the setup: it
  says nothing about what is at risk right now.
- **A host resets its files if `OPENBLOG_FILES_RESET` says so, or else if `RENDER=true`.** The setting
  can also say `0`, for a Render service whose whole project is on a disk. A Docker container on someone's
  own machine shows nothing unless told, because we cannot know where its files live.
- **A workspace that is on counts as durable, even before anyone has run its live check.** Admin cannot
  know whether that check was done, and the workspace stops saves outright when its storage fails.
- **Say it fully once, then briefly.** Overview has the whole notice. Every other page has one short line
  linking to it, and a save in the editor, the Landing page or Customize look adds one sentence. There is
  no dialog and no dismissal: it stays true until the setup changes, and hiding it would hide a risk of
  loss. The Help list and tour on the Landing page change their words on this setup.
- **"Kept local" becomes "not published" everywhere.** It was jargon on every setup and false with a
  workspace.
- **A failed push is translated in Admin, and only there.** `publish()` keeps git's text for the command
  line and the logs. `failure_for_owner` reads that text for the signs of a missing or refused credential
  and writes what happened, what to do, and what it means for her work, which depends on `filesMayVanish`.
  Any other push failure gets its own plain words. Neither says her changes were not published or are
  not live: where the files do not last, the server that refused to push is the one visitors see, and a
  save has already rebuilt it, so what she saved is out there and only keeping it failed. On that setup
  she is told it already shows but is not kept. Elsewhere the words say only that it could not be sent. Reading git's messages is brittle, but a message it
  does not recognise only gets the general wording, which is still true. Other refusals keep their words.
- **What she has to read goes where she is looking.** Publish on the Landing page and Customize look sits in
  the bar at the bottom of a phone screen, and the status box does not, so a refused Publish scrolls that box
  to the top. A save does not scroll, since she may be midway through editing: the line in the bar under Save
  says it can vanish, from her first save on that visit until she publishes.
- **The notice names no host.** It can show on any host through `OPENBLOG_FILES_RESET`. It asks whoever set
  up the site to look up "Keep your work safe", which the guide's heading answers to, and that section says
  what to do elsewhere.
- **The technical text stays one tap away.** The answer has `detail`, folded under "Details for whoever
  helps you". On the Landing page and Customize look the fold sits under the status box, not in the bar: a
  long refusal would make the bar too tall to float, and it would drop far down the page. A password written into a remote address is taken out, since this text is meant to be passed on.
- **Where the files do not last, Publish with no remote is refused.** It would otherwise report success for
  a commit that dies with the server, the same reason the workspace refuses it.
- **Blank counts as not set.** Partly filled workspace settings still stop startup with their reason.
  `render.yaml` therefore prompts for the token and the three workspace settings.

## Consequences

- An owner on this setup is told the truth before she loses anything. Nothing gets more durable: only
  a person creating the accounts in "Keep your work safe on Render" does that, and that setup has not been
  run live from this repository.
- `publish.auto` failures still only reach the server log. This decision does not change that.
- The analytics branch still cannot carry counts across a Render restart. The docs now say so; fixing it
  would need the container to fetch the branch and the store to read it, which is a separate decision.
- A push that is rejected after a local commit still leaves that commit, and the header says some changes are
  not sent yet, or not kept yet where the files do not last. Publish again retries it. With no remote-tracking ref, as on an empty remote or when the
  remote cannot be read, git cannot say how far ahead the site is, and every commit of a shipped checkout
  looks unsent. So `publish` marks its first commit that has not gone out with `refs/openblog/first-unsent`,
  which is not pushed, and clears it after a push. The header counts from that mark only when there is no
  tracking ref. A commit made outside `publish` with no tracking ref still reads as published, because
  the server does not ask the network each time the header loads.
- Sentences that promise a saved page or photo is kept were reworded where they could be true on every host.
  Others, such as the voice note and shared reflections saying they are kept on the server, were not changed;
  the notice covers them.
