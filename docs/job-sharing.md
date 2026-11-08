# Sharing a job

A finished [job](jobs.md) can go where people look for tradespeople: your Google Business Profile, your Facebook
Page and Nextdoor. open.blog prepares the same job for each of them: one line about the work, the service and town,
the job's first after photo and a link to the job's page. You see exactly what would go before anything does.

In Admin, open a published job in Write and choose **Share this job** (under the Job form in the document's
settings). The same is a command on your computer: `openblog job-share`.

## In Admin

**Share this job** shows, for each place, the words, the link, the photo, anything to fix and where it stands: not
shared yet, posted, posted by hand, or, for a Facebook Page, the state of its announcement (Scheduled, Published,
Failed and so on, as on the Announcements screen).

- **Copy the words**, **Save the photo** and **Open Nextdoor** (or Facebook, or your Business Profile) let you post
  it yourself. Then press **I posted it** so the screen remembers. If the job changes afterwards, the screen says so.
- **Post to** your Page appears for Facebook when social publishing is set up, your Facebook Page is connected under
  Connected accounts, and the job has no after photo. It schedules the job's words and link on your Page five
  minutes ahead, through the same queue as your other announcements. open.blog posts to a Page without a photo, so
  a job with an after photo goes to Facebook by hand. Once the job is scheduled or posted there, the button is not
  offered again; it comes back only if that announcement failed or was canceled.
- Google is not sent from Admin. Until Google approves open.blog for your profile, post it by hand from here.

The record of what happened is `.openblog/job-shares.json`, which is never published. On Render with the workspace
on, it is kept with your posts.

## See what each place would get

```
openblog job-share new-oak-floor
```

This prints, for each place, the words, the link, the photo and anything to fix. Nothing is sent. Add
`--to google-business-profile,facebook,nextdoor` to pick places, or `--json` for the same as JSON.

The words are the first line of the job's `description` (or its title), then a line such as
"Hardwood install in Maple Falls, WA." Facebook and Nextdoor get the link at the end; Google gets it as a
**Learn more** button. When the words are too long for a place, the first line is shortened at a word and you are
told. The job must be published and the site's address set, so the link works.

Before anything goes, open.blog checks the first after photo:

- It must be in the site's files and be a photo it can read.
- It must not hold where it was taken. A phone photo often does, and on a job that can be your customer's home.
  Save a copy without the location and use that. Until then the photo is left out everywhere, the kit included.
- For Google it must be a JPEG or PNG of 10 KB to 5 MB, at least 250 by 250 pixels, uploaded to this site.

A job with no after photo goes without one.

## Post it by hand (works today, no account needed)

```
openblog job-share new-oak-floor --kit share-floor
```

This makes a new folder, `share-floor`, with `index.html`, `kit.json` and the photo. Open `index.html`. For each
place it shows three steps: copy the words, save the photo, then open the place and post it yourself. The
**Open Nextdoor** link opens Nextdoor's post box with the words already in it; add the photo there. Nothing is
posted for you.

## Send to Google Business Profile (needs Google's approval)

Google lets an app post to a Business Profile only after it approves the app's Google Cloud project. To ask, your
profile must have been verified and active for at least 60 days; then fill in Google's
[API access form](https://developers.google.com/my-business/content/prereqs) from an owner or manager address and
wait for Google's answer. Until Google says yes, use the kit.

Once approved:

1. In `openblog.json`, add:

   ```json
   "syndication": {
     "googleBusinessProfile": { "enabled": true, "account": "123", "location": "456" }
   }
   ```

   The two numbers come from your profile's `accounts/123/locations/456` name.
2. Put an access token with the `https://www.googleapis.com/auth/business.manage` scope in
   `GOOGLE_BUSINESS_ACCESS_TOKEN`. open.blog never prints or saves it.
3. Run `openblog job-share new-oak-floor` and check the Google part. It ends with a digest.
4. Run `openblog job-share new-oak-floor --send google-business-profile --confirm <digest>`.

If the job changed after you looked, the digest no longer matches and nothing is sent. If Google did not answer,
open.blog does not send it again until you have looked on your profile and run the same command with
`--forget-attempt`.

A job already on your profile, whether open.blog posted it or you pressed **I posted it** in Admin, is never sent
there again, and a new kit does not undo **I posted it**
([ADR 0397](adr/0397-a-job-already-at-a-place-is-never-sent-there-again-by-a-send-a-kit-or-a-reopened-screen.md)).

No live post to Google has been made by open.blog's own tests: they use scripted replies, because nobody working
on it has Google's approval yet ([ADR 0393](adr/0393-a-job-reaches-google-business-profile-from-the-cli-only-when-the-owner-turned-it-on-and-confirmed-its-digest.md)).

## Facebook and Nextdoor

Nextdoor is always posted by hand: it lets only approved partners post through its API
([ADR 0394](adr/0394-nextdoor-is-a-by-hand-kit-because-its-publish-api-is-for-approved-partners.md)). A job with no
after photo can go to your Facebook Page from Admin's **Share this job**, through your connected Page; a job with a
photo, or a site without social publishing, posts to Facebook by hand. The command does not post to Facebook
([ADR 0396](adr/0396-a-job-is-shared-from-admin-reaches-a-facebook-page-through-the-announcements-and-never-carries-a-located-photo.md)).

## What happened where

```
openblog job-share new-oak-floor --status
```

shows, for each place, whether the job was posted, may have been posted, was posted by hand, or had a kit made, and
when. The record is `.openblog/job-shares.json`, which is never published.
