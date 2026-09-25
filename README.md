# Oslo Airport Arrivals

Shows arrivals at Oslo Airport Gardermoen (OSL) from now through the next 24 hours: one HTML page and one small script, with no dependencies and no build step.

**Live:** https://andersbjorkh.github.io/flights-avinor/

## What it shows

- Arrivals sorted by scheduled time and grouped by **Today** and **Tomorrow**.
- Status for each flight: *Landed 16:01*, *Delayed 17:20*, *Expected 16:05* or *Cancelled*.
- Flight number, airline, origin (with any stops), and baggage belt.
- A Schengen or International tag for flights that aren't domestic.
- Flights that landed in the last 30 minutes, shown dimmed.
- A search box that filters by flight number, airline or city.

All times are Oslo local time. The page reloads the data every 3 minutes, and the header shows when the data was fetched. If the data is more than 30 minutes old, the page warns about it.

## How the data gets here

Avinor's feed doesn't accept requests from browsers, and Avinor asks users to cache the data rather than send every visitor to its servers. So a GitHub Actions workflow (`.github/workflows/deploy.yml`) does the fetching:

1. Every 5 minutes, `scripts/fetch.mjs` downloads OSL arrivals from an hour ago to 24 hours ahead, plus Avinor's airport, airline and status names.
2. It converts them to `arrivals.json`, with names already resolved.
3. It deploys that file with the page to GitHub Pages. The browser only ever reads `arrivals.json`.

If a fetch fails or returns no flights, the workflow stops, and the last good version stays online.

Two caveats:
- GitHub starts scheduled workflows on a best-effort basis. Runs usually happen every 5 to 15 minutes but can be later at busy times.
- GitHub disables scheduled workflows in repositories that have had no activity for 60 days. Re-enable the workflow from the **Actions** tab.

## Data source

[Flight data from Avinor](https://www.avinor.no), used under Avinor's [terms for flight data](https://partner.avinor.no/en/services/flight-data/): cache the data, poll no more than every 3 minutes, and credit Avinor with a link next to the data.

## Run locally

```sh
node scripts/fetch.mjs                  # writes _site/
python3 -m http.server 8080 -d _site    # then visit http://localhost:8080
```

## Files

- `avinor.js`: feed URLs, XML parsing, and display helpers. Used by both the fetch script and the page.
- `scripts/fetch.mjs`: fetches the feeds and builds `_site/`.
- `index.html`: the UI.
- `avinor.test.mjs`: tests for `avinor.js`. Run them with `node --test`.
