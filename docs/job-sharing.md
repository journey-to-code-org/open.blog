# Sharing a job

A finished [job](jobs.md) can go where people look for tradespeople: your Google Business Profile, your Facebook
Page and Nextdoor. open.blog prepares the same job for each of them: one line about the work, the service and town,
the job's first after photo and a link to the job's page. You see exactly what would go before anything does.

Today this is a command on your computer. Admin does not have it yet.

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
  Save a copy without the location and use that.
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

No live post to Google has been made by open.blog's own tests: they use scripted replies, because nobody working
on it has Google's approval yet ([ADR 0393](adr/0393-a-job-reaches-google-business-profile-from-the-cli-only-when-the-owner-turned-it-on-and-confirmed-its-digest.md)).

## Facebook and Nextdoor

Both are posted by hand from the kit. Nextdoor lets only approved partners post through its API
([ADR 0394](adr/0394-nextdoor-is-a-by-hand-kit-because-its-publish-api-is-for-approved-partners.md)). Facebook Page
announcements from Admin are separate and do not use a job's photo
([ADR 0395](adr/0395-a-job-projection-is-its-summary-service-town-link-and-first-after-photo-fitted-to-each-destination.md)).

## What happened where

```
openblog job-share new-oak-floor --status
```

shows, for each place, whether the job was posted, may have been posted, or had a kit made, and when. The record is
`.openblog/job-shares.json`, which is never published.
