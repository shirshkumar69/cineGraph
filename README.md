# CineGraph 2 — Movie Recommendation System

A working account-based movie recommender built with JavaScript, Vinext, Cloudflare Workers and D1 (SQLite). There are no pre-filled users, fake friends or invented ratings in the deployed app. A dated, real-movie reference catalogue is included so discovery works even during a provider outage.

## Use the app

1. Open the app and sign in.
2. Select **Taste & storefront**. Choose favourite genres, your display name and a movie storefront.
3. **Refresh chart** fetches the current Apple movie chart. Search filters the reference catalogue, loaded chart, your custom films, and saved/rated movies.
4. Use **Add a movie** for any title missing from the chart. Supply title, release year, runtime, genres and description. It immediately participates in recommendation scoring.
5. Open a film, give it 1–5 stars, or save it to your watchlist. Rated films are excluded from new recommendations. Removing a rating makes the film eligible again.
6. **My circle** shows your friend code. Request a connection with another person's code; the recipient must accept. Both accounts must opt into rating sharing before their ratings contribute.
7. **Algorithm lab** displays the real scoped friend graph, BFS traversal, genre matrix and score explanation.

The Site currently retains owner-private access. Friends must be granted Site access through the Site sharing controls before they can sign in. A friend code does not grant access or send an external message.

## What “live” means

- Account changes are written to a real server database, then the UI reloads the saved data and recomputes scores.
- Other open sessions poll every 15 seconds while visible, and on window focus. Polling pauses while a dialog or input is active to preserve in-progress edits. This is polling, not WebSockets.
- Movie metadata comes from the live Apple/iTunes movie chart for US, UK, India, Canada or Australia. This is **not a complete global movie-search API**. Storefront coverage varies; the feed may return fewer than 100 titles or no results.
- Charts are cached for 30 minutes. Manual refresh is allowed once per minute for a cached storefront. Upstream failures can return the previous chart with a warning and original timestamp. If no chart has ever been cached, the app uses the explicitly labelled saved US catalogue in `lib/reference-catalogue.json`. It is an actual fetched provider snapshot, not a claim of live or India-specific chart coverage.
- No movie API key is needed. Posters and metadata require an internet connection. Runtime is displayed as “not supplied” when the provider does not include it.
- You can still browse and rate reference films, receive suggestions, and add custom movies when the external chart is unavailable, as long as the CineGraph server is reachable.

Movie metadata and artwork provided courtesy of iTunes. Each provider movie links to its Apple TV page. This project recommends movies; it does not stream movies or claim streaming availability on other services.

## Run the source on your Windows laptop

Install **Node.js 24 LTS** (needed for the built-in SQLite test runner), then extract this ZIP and open its folder in VS Code. In PowerShell:

```powershell
npm install
npm run build
npm run db:migrate
npm run dev
```

Open the local URL printed in the terminal. `db:migrate` records applied migrations and is safe to run again. Keep the terminal open. Stop with Ctrl+C.

The starter supplies a **local development sign-in identity on loopback**; it is not a real production account session. Production uses a platform-provided identity. Never expose the local development server or trust arbitrary user-ID headers on another hosting platform.

Your local database lives in `.wrangler/state`; do not delete that folder if you want to preserve local development data. Local data is separate from the hosted app. Production D1 migrations are applied by Sites during deployment.

Run checks:

```powershell
npm test
npm run build
```

## Project structure

- `public/index.html`, `app.js`, `styles.css`: responsive interface and user inputs.
- `public/engine.js`: browser recommendation engine.
- `lib/engine.mjs`: same engine for server calculations and automated tests.
- `lib/api.mjs`: input validation, account storage, chart fetching, friend consent and API implementation.
- `app/api/[...path]/route.ts`: HTTP route and authenticated identity adapter.
- `app/chatgpt-auth.ts`: platform sign-in helpers.
- `db/schema.ts`, `drizzle/`: database schema and tracked migrations.
- `tests/api.test.mjs`: isolated SQLite integration tests. Test identities and provider fixtures are never served by the app.
- `scripts/migrate-local.mjs`: repeatable local database setup.
- `.openai/hosting.json`: hosted Site identity and D1 binding.

## Concepts used for your DSA presentation

| Concept | Implementation |
| --- | --- |
| Graph | Undirected accepted-friend connections, adjacency list, BFS queue with head index, visited set, depth 1 or 2 |
| Hash maps | Movie/profile ID lookup, rating dictionaries, de-duplication and movie merging |
| Arrays | Movie list, genre list, watchlist, queue and sorted recommendation list |
| Matrix operations | Movie × genre matrix; normalized row vectors; weighted preference vector and cosine dot products |

For a movie with k genres, each matching genre component is `1/sqrt(k)`. The taste vector starts with the selected genres and adds each rated movie vector multiplied by `(rating - 3)`. Normalize the taste vector and calculate its dot product with each candidate; clamp negative values to zero.

A consenting friend's 4-star rating contributes 0.5; 5 stars contributes 1. Divide by BFS distance and normalize by the sum of consenting reachable friends' distance weights. A second-degree friend contributes half the direct-friend weight. Private/custom movie ratings are not shared.

Hybrid ranking uses 65% genre and 35% friend signal when there is a nonzero taste vector and a consenting reachable friend. If only one signal exists, it receives 100%. Scores remain zero with neither signal. Sort scores descending and break ties by title. Match points express affinity, not the probability of enjoyment.

BFS: O(V+E). Ranking: O(MG + MF + M log M). Matrix storage: O(MG) if materialized; graph storage: O(V+E). G = genres, M = movies, F = reachable consenting friends.

## Data and privacy

All writes derive the owner from server-side authenticated identity. No profile switching or client-supplied owner ID is accepted. Friend requests require recipient acceptance. Sharing is off initially; shared external-film ratings are visible to opted-in friends and opted-in friends of friends. Watchlists and custom movies remain private. The export contains only the current account's data and friend code.

Writes validate inputs, reject foreign request origins and are rate limited. Account updates use optimistic revision checks to avoid lost concurrent edits. Limits: 150 custom movies per account, 180,000 characters of account JSON, 30 friend connections/requests, 100 writes per minute. The graph view is bounded to 100 peers and 300 second-hop edges. These are intentional small-project limits, not a claim of enterprise scale.

Existing version-1 local demo data is not silently imported into a real account, because it contains simulated identities and relationships. Version-2 exports are backups for inspection; automatic bulk import is not included.

## Verification and deployment notes

Automated tests cover authentication, validation, private custom movies, rating-driven ranking, watchlist persistence, cached/stale chart handling, mutual sharing, recipient-only friend acceptance, two-hop traversal, and concurrent updates. A live provider request was also checked. Browser checks covered sign-in, rendering and navigation with isolated visual-check data; a real authenticated multi-account browser session was not available in the build environment.

Deploying to another platform requires replacing the trusted authentication adapter and configuring a D1-compatible database; uploading only the HTML files does not run this backend.

## Empty-catalogue fix

Production chart requests returned HTTP 502, leaving first-time visitors without candidates. State loading now always includes a verified reference catalogue before external requests begin. Failed refreshes preserve usable recommendations and expose a dated fallback label. The Discover page offers genre choices immediately. A regression test covers first-visit upstream failure, saving and rating a reference film, and nonzero recommendation scores. Catalogue metadata is read-only and independent of account identity; all account endpoints still require authenticated identity.
