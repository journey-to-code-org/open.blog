# Seasonal reminders

A quiet month does not have to mean a quiet site. When you turn on seasonal reminders, Admin tells you, at the
right time of year, what is worth writing about for your trade: "get the furnace checked before the cold",
"keep pipes from freezing", "after a storm". A reminder only starts a **draft** for you to write. It never
publishes anything, never posts to a social account and sends nothing anywhere. A site that does not turn them
on builds and behaves exactly as it did before ([ADR 0354](adr/0354-seasonal-topics-are-bundled-per-trade-the-site-stores-only-its-changes-and-absent-means-off.md)).

## Turning them on

Open **Reminders** in Admin (`#/reminders`) and tap **Turn on seasonal reminders**. The topics come from your
trade in [Business facts](configuration.md#business-facts); with no trade set you get four general ones
(spring, summer, fall, winter). On the screen you can:

- **Start a draft.** Makes one unpublished draft, titled with the topic and opening with the prompt, and links
  you to the editor. Tapping again finds the same draft instead of making another.
- **Snooze a week.** Hides the reminder until that day; it comes back if its window is still open.
- **Turn this topic off**, or **move its dates**, for any topic in the list.

If you have a voice guide or voice samples ([Voice samples](specs/voice-samples.md)), the screen reminds you that
the Assistant can use them from the editor to write a first draft in your own voice. That is the editor's usual
explicit step: you choose what the Assistant sees, and nothing is sent until you ask
([ADR 0356](adr/0356-the-reminders-screen-lists-what-to-write-now-moves-or-turns-off-a-bundled-topic-and-only-links-to-the-voice-flow.md)).

A reminder is **due** while its window is open and **upcoming** for the 30 days before it opens. The list is
worked out from today's date each time you open the screen: nothing runs in the background, and nothing can fire
while you are not looking ([ADR 0355](adr/0355-a-reminder-is-derived-from-the-date-and-a-private-record-and-opening-it-writes-one-unpublished-draft-that-nothing-can-publish.md)).
What you snoozed or started is remembered in `.openblog/private/seasonal.json`, which holds no prose and is
never built, exported or committed by `openblog init`'s ignore rules.

## The format

Your changes are stored in `openblog.json` under `seasonalPrompts`. You can edit the file instead of the screen.

```json
{
  "seasonalPrompts": {
    "version": 1,
    "enabled": true,
    "topics": [
      { "id": "furnace-tuneup", "start": "08-15", "end": "09-30" },
      { "id": "ac-tuneup", "disabled": true },
      {
        "id": "gutter-day",
        "start": "10-01",
        "end": "10-31",
        "topic": "Clean your gutters",
        "prompt": "Why does a clogged gutter cost more than cleaning it, and what do you see on the job?"
      }
    ]
  }
}
```

- **`enabled`** turns the whole thing on. Missing or `false` means off, and the member is not written back.
- **An entry with the id of a bundled topic** changes only what it states: `disabled: true` turns it off,
  `start` and `end` move it, `topic` and `prompt` reword it. Everything else stays as bundled, so improved
  bundled wording reaches you unless you reworded it yourself.
- **An entry with any other id** is your own topic and needs all of `start`, `end`, `topic` and `prompt`.
- **Dates** are `MM-DD`. A window can cross the new year (`"start": "11-01", "end": "02-28"`). `02-29` is
  February 28 in a year without one.
- **Limits:** the topic is at most 80 characters, the prompt at most 600, ids are lowercase letters, digits and
  hyphens (at most 40), and there are at most 60 entries. Every mistake is shown in `openblog check` and
  `openblog build` as a sentence naming the entry and the field. A newer `version` is refused and never
  rewritten.

## Bundled topics

| Trade | Topic ids |
| --- | --- |
| `hvac` | `furnace-tuneup`, `ac-tuneup`, `filter-change` |
| `plumbing` | `freeze-protection`, `water-heater`, `spring-leaks` |
| `electrical` | `holiday-lights`, `storm-prep`, `panel-check` |
| `roofing` | `spring-roof-check`, `pre-winter-roof`, `storm-damage` |
| `landscaping` | `spring-cleanup`, `fall-cleanup`, `irrigation` |
| `painting` | `exterior-season`, `interior-winter` |
| `flooring` | `humidity`, `refinish` |
| `excavation` | `drainage`, `pre-freeze-dig` |
| `mobile-mechanic` | `winter-car`, `road-trip` |
| `auto-body-paint` | `hail-season`, `winter-salt` |
| any other trade | `spring-prep`, `summer-heat`, `fall-ready`, `winter-slow` |

## What it does not do

- It does not publish, schedule or announce anything. Publishing is the editor's, as for any draft.
- It does not email or push a notification; you see reminders when you open Admin. A nudge from the social
  worker is a possible later addition and would need its own consent.
- It stores nothing about your customers.
