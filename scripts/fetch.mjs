// Fetches OSL arrivals from Avinor and builds the static site in _site/.
// Run by the deploy workflow; exits non-zero on bad data so a failed fetch never gets deployed.
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { URLS, parseFlights, parseNames, toArrivals } from '../avinor.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');
const STATIC = ['index.html', 'avinor.js'];

async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'flights-avinor (+https://github.com/andersbjorkh/flights-avinor)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  // The feed is ISO-8859-1.
  return new TextDecoder('latin1').decode(await res.arrayBuffer());
}

const [arrivalsXml, airportsXml, airlinesXml, statusesXml] = await Promise.all(
  [URLS.arrivals, URLS.airports, URLS.airlines, URLS.statuses].map(get),
);

const feed = parseFlights(arrivalsXml);
if (feed.flights.length === 0) throw new Error('Feed has no flights');

const data = toArrivals(feed, {
  airports: parseNames(airportsXml, 'airportName'),
  airlines: parseNames(airlinesXml, 'airlineName'),
  statuses: parseNames(statusesXml, 'flightStatus', 'statusTextEn'),
});

await mkdir(out, { recursive: true });
await writeFile(join(out, 'arrivals.json'), JSON.stringify(data));
await writeFile(join(out, '.nojekyll'), '');
for (const f of STATIC) await copyFile(join(root, f), join(out, f));

console.log(`Wrote ${data.flights.length} arrivals (feed updated ${data.lastUpdate}) to _site/`);
