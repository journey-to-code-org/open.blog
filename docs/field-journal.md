# Field journals and private-by-default tracks

Use the Field journal profile for hikes, paddles, field surveys, restoration days, and
other place-based notes. The post remains ordinary Markdown; the profile adds a compact
field summary, optional route and elevation drawings, and explicit location privacy.

For a complete working example, see
[`content/posts/2026-10-23-a-wet-morning-on-the-ridge.md`](../content/posts/2026-10-23-a-wet-morning-on-the-ridge.md).
It includes a cover image, narrative trail log, field observations, access and stewardship
notes, and privacy-safe route and elevation drawings.

## Start a field note

Select **Field journal** under **Settings → Content profile**, or author the fields directly:

```yaml
profile: field-journal
activity: Hike
location: Northern ridge
locationPrivacy: trimmed
distanceKm: 8.4
elevationGainM: 420
duration: 2 hr 15 min
conditions: Cool, windy, and muddy above the tree line
```

Use the Markdown body for observations, photos, accessibility notes, stewardship work, and
the story of the outing. Conditions are observations written by the author; OpenBlog does
not fetch or imply historical weather data.

## Import a GPX track

In Studio, open **Your route** from a trip post (Write's More, Find, About this post › This trip
outdoors, or Before you publish › Your trip) and choose the route file your hiking app or watch
exported (in AllTrails, Strava or Gaia GPS, use Export or Share and choose GPX). The file is read on
the phone or computer, with regular expressions and no document parsing, and never leaves it
unless you choose the exact route. Studio calculates distance, positive elevation gain (only when
the file has heights), elapsed time (only when it has times), a normalized route outline, and an
elevation profile. No map, weather, or tracking service is contacted. Every new file starts as
**Don't show it**; the drawings under **What readers see** are made from exactly the values that
will be written.

| Studio's choice | Mode | Published route data |
| --- | --- | --- |
| **Don't show it** (default) | `hidden` | The numbers only. The climb drawing is left out unless **Show a drawing of the climb** is switched on. |
| **The shape, without where it starts and ends** | `trimmed` | A drawing with the first and last part left off: 500 m at each end by default (200 m, 1 km or 2 km; any number of metres in the details). A route shorter than both ends together is refused. |
| **The whole shape** | `approximate` | A drawing of the whole route, ends included (it was "Just the area" in R5; someone who knows the area may recognise where it starts). |
| **The exact route** | `exact` | Asks once, then the downloadable file: cleaned on the phone to track points with position and height (times, waypoints, names and the app's details removed), cleaned again by the server, and sent with the next save, draft or not. It becomes public only when the post is live (below), so a post with the exact route can be scheduled. |

In the old Admin, open **Field Review** (`Alt+5`), choose the privacy mode, and select a GPX
file; its modes are these:

| Mode | Published route data |
| --- | --- |
| **Hidden** | Statistics and elevation profile only; no route outline or source GPX. This is the default. |
| **Trimmed** | Removes the chosen distance from both endpoints, then saves only normalized drawing points. |
| **Approximate** | Saves normalized drawing points but no geographic coordinates or source GPX. |
| **Exact** | Privately stages a cleaned copy of the GPX, then publishes it as a downloadable static asset once the post is live. |

Normalized points describe a shape in an SVG view box, not latitude and longitude. Hidden,
trimmed, and approximate imports never upload the source file, and a Hidden journal keeps no
`routeShape` in its file: the server drops it on save, so a public repository never holds the
shape of a route its post hides. Exact mode requires a human
review because it can reveal a home, campsite, sensitive species, or fragile habitat.

### When an exact route file becomes public

The server keeps only what the published file needs: each track point's latitude, longitude
and height. Times, waypoints, routes, names, descriptions, links, the recording app's details
and extensions are removed before the staged copy is stored.

An exact route file is public only while its post is:

- Saving a **draft** or a post **scheduled for a later day** keeps the file private, in
  `.openblog/pending-tracks/held/<year>/<name>.gpx` (inside the ignored `.openblog` folder, never
  pruned while it waits). The post's `route` already names its future address,
  `/tracks/uploads/<year>/<name>.gpx`.
- When the post goes live (published now, or its scheduled day comes), the server moves the file
  into `static/tracks/uploads/` before it builds, so the site's files and a repository built
  from them hold it from that day.
- Every build copies files under `static/tracks/uploads/` only when a live post with
  `locationPrivacy: exact` names them, even a build that shows drafts. A file a draft names
  (including one an older release put in `static`), a stray file, or a file named by a post that
  isn't exact never reaches the built site.

Changing a saved Exact journal to another privacy mode removes its OpenBlog-managed
track, public or held, and moves it to `.openblog/trash/tracks/` for recovery. Deleting the
journal does the same. Abandoned private staging files can be discarded from the editor
and are pruned after 24 hours when another GPX is staged.

GPX calculations are deterministic summaries, not navigation or safety guidance. Check
measurements against the recording device when accuracy matters, and do not rely on the
published route for emergency or backcountry navigation.
