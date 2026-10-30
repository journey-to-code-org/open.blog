# ADR 0901: The quote form is one plain accessible form, in a fence and a landing section, that renders nothing until quote requests are on

- Status: Accepted
- Date: 2026-10-29
- Parent story: [#485](https://github.com/journey-to-code-org/open.blog/issues/485)
- Task: [#515](https://github.com/journey-to-code-org/open.blog/issues/515)
- Parent epic: [#474](https://github.com/journey-to-code-org/open.blog/issues/474)
- Builds on: [ADR 0900](0900-quote-requests-are-stored-server-side-only-through-a-fenced-visitor-endpoint-that-is-off-by-default.md), [ADR 0306](0306-business-facts-render-as-one-engine-block-in-the-footer-and-a-landing-section-with-localbusiness-data-on-the-home-page.md), [ADR 0291](0291-a-before-and-after-pair-is-a-compare-fence-the-engine-validates-with-two-figures-as-its-portable-form.md), [ADR 0314](0314-service-areas-are-a-versioned-list-of-towns-in-openblog-json-checked-for-duplicates-with-regions-formatted-from-a-bundled-list-and-absent-means-nothing-changes.md)

## Context

The form must be placeable on any page, work without JavaScript, and change nothing for a site that never
turns it on.

## Decision

- **One form, written once in core** (`openblog_core::quote::form_html`), used by both placements: a `quote`
  fence in a post, and a `quote-form` landing section (landing version 2, like business facts, ADR 0306).
  The Landing builder lists it as "Quote request form".
- **Settings.** A versioned-free `quote` member of `openblog.json`: `enabled` (default false), `endpoint` (a
  path such as `/api/quote`, the default, or an `https://` address; no queries, spaces or markup), and one
  line of `notice`. Absent or default is omitted from the written file.
- **Off renders nothing.** With `enabled` false the fence and the section produce no markup, no capability
  and no script; the output is byte for byte what it was. A portable copy (feeds, export, syndication) never
  carries the form, and a `quote` fence is not a semantic fact the copy must keep.
- **Choices from the site.** Towns come from `serviceAreas` (ADR 0314) in the order stated; services come from
  the services collection in the landing section, and from `service:` lines in the fence (the fence is
  rendered before the collection is known). With no list a field is a text box. Everything is escaped.
- **Plain HTML first.** A `<form method="post" enctype="multipart/form-data">` to `<endpoint>/submit`; every
  field has a visible `<label>`, hint and error element tied by `aria-describedby`; phone, email, name and
  town carry `autocomplete`; the honeypot is a labelled field moved off screen and hidden from assistive
  technology; the status line is `role="status"`. The markup holds no request value, so no personal field
  can reach static output.
- **Enhancement.** `<ob-quote>` (`web/components/ob-quote.js` and the pure `ob-quote-model.js`) fetches the
  form token, checks fields with the same rules as the server, says each problem beside its field and
  moves focus to the first, shrinks photos with a canvas to the server's 900 KB bound, shows upload
  progress, and replaces the form with a confirmation. It sends only to its own `endpoint`, stores nothing in
  the browser, and steps aside (the browser posts the form) when no token can be fetched.
- **Ids stay unique** with a per-placement prefix, so a page may hold several forms.

## Consequences

The landing builder adds a section type (`SECTION_TYPES` is 16). Admin cannot yet show whether the hosted
function is reachable; the setup guide says how to check. Axe is not a dependency of this repository, so the
accessibility contract is tested as markup (labels, descriptions, live region) and in a real browser at 400 px.
