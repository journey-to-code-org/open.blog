---
title: Counting terns at the river mouth
subtitle: A survey morning where the location stays hidden, by design.
date: 2026-11-02
series: field-notes
seriesOrder: 2
tags:
  - field-notes
  - birds
  - stewardship
description: A volunteer nesting survey written up with the field-journal profile, showing why hidden location mode is the right choice when publishing a route could harm wildlife.
profile: field-journal
activity: Shorebird survey
location: A river mouth on the coast (withheld)
locationPrivacy: hidden
distanceKm: 3.1
elevationGainM: 12
duration: 3 hr 40 min
conditions: Light onshore breeze, high tide at 07:50, clear after early fog; sand firm below the wrack line
---

> [!NOTE]
> A fictional but realistic example. The numbers are illustrative, and the place is deliberately
> unnamed.

The fog lifted at about seven, just as the tide came up. We walked the outer edge of the roped
area in a slow line, counting from outside the fence with binoculars and never stepping in.

## Why this post has no route

The ridge hike in the [previous part](/posts/a-wet-morning-on-the-ridge/) shows an approximate
route outline. This one shows none, because it uses `locationPrivacy: hidden`, the default for
every field journal. Readers see the distance, time and conditions, but no route shape and no
GPX file.

Hidden is the right choice whenever a route could lead someone somewhere they should not be.
Ground-nesting birds abandon nests when people walk too close, and a published track to a colony
does exactly that, even when everyone means well. Other good reasons include a home, a
campsite, a rare plant or a private landowner's trail.

| Mode | What readers get |
| --- | --- |
| `hidden` | Statistics only: no route outline, no file. **The default.** |
| `trimmed` | A route outline with the start and end cut off, so it does not lead to a door |
| `approximate` | A route outline drawn as a shape, with no coordinates |
| `exact` | The original GPX as a download, after you have reviewed it |

## Counts

| Species | Adults | Active nests | Chicks seen |
| --- | ---: | ---: | ---: |
| Least tern | 46 | 19 | 7 |
| Piping plover | 4 | 2 | 0 |
| Killdeer | 2 | 1 | 4 |

The plover nests are both still on eggs. Two tern scrapes from last week's count were empty and
washed over by the spring tide.

## Disturbance log

- 07:20: an off-leash dog at the south fence. The owner leashed it when asked.
- 08:05: a drone over the colony for about two minutes. The terns lifted and mobbed it, then
  settled once it left. Reported to the refuge office.
- 09:30: two people walked the high-tide line inside the symbolic fence. A volunteer explained
  the closure, and they went round.

## Stewardship

We re-tied three fence posts that the tide had loosened and replaced one faded sign. The colony
coordinator now has the drone report, with the time and direction it flew in from.

> [!IMPORTANT]
> Before you publish any field note, ask: could someone use this to find something that should
> not be found? If the answer is maybe, leave `locationPrivacy` on `hidden`.
