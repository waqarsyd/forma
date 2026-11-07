# Changelog

Forma's release notes are on its site: **<https://openforma.web.app/changelog>**,
newest first, filterable by kind and area, with an Atom feed at
<https://openforma.web.app/changelog.xml>.

Every deploy is a numbered release, tagged `v<version>` with its notes on
[GitHub Releases](https://github.com/waqarsyd/forma/releases), so
"Watch → Custom → Releases" on the repository emails you each one.

The notes are written once, in [`src/lib/releases.ts`](src/lib/releases.ts),
and the page, the feed, the in-app *What's new* and each GitHub release are
all drawn from it. This file points there rather than keeping another copy,
because a copy is the one that goes stale.
