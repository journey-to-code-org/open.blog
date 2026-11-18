# ADR 0432: The blog kind chooses the voice prompt sets, and stories are kept as her own

- Status: Accepted
- Date: 2026-11-16
- Builds on: [ADR 0429](0429-studio-shows-feature-areas-chosen-per-sign-in.md), [ADR 0277](0277-the-voice-invitation-is-shown-once-on-the-admin-home-and-a-dismissal-is-an-admin-preference.md)
- Spec: [Studio ONB1](../specs/studio/onb1/ux.md)

## Context

Getting started's stories drew from one generic set. Once Studio knows what a blog is about, the
writing exercise can ask what suits it, and the true stories it gathers are worth finding again
when a post needs one. A rough draft is never edited (R9), so nothing about a story can be written
on the piece itself.

## Decision

- **Kind → sets** live in the area catalog (`KINDS[kind].packs`) and are table-tested: technical →
  teaching, expertise, opinions, craft; recipes → stories, people, reviews; trade → expertise,
  stories, people, trades; teaching → teaching, stories, craft; research → expertise, opinions,
  stories; podcast → stories, opinions, humor; docs → teaching, expertise, craft; personal →
  stories, people, humor. **Stories always comes too.**
- `POST voice/draw` takes `packs` (several sets; unknown ones dropped, none left is 404
  `pack-gone`) and `story: true` (one of the three from Stories). Getting started's stories use them
  when the sign-in has a kind, and the Getting started set otherwise.
- **A story** is a rough piece from the Stories, People or Getting started sets, or one she added:
  its id in her `storyMarks` (per-sign-in preferences, ADR 0430), never a tag on the piece.
- **Start a post from this** makes a word-for-word polished copy when there is none, then R9's
  make-a-post; the rough story stays as told.

## Consequences

- My stories and Write's Stories you could tell need no new storage beyond the marks.
- A site's own prompt catalog can drop a set; drawing then falls back as R9 does.
