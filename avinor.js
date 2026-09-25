// Parsing and display helpers for Avinor's flight data feed.
// Used by scripts/fetch.mjs (Node) and index.html (browser); no dependencies.

export const AIRPORT = 'OSL';
const FEED = 'https://asrv.avinor.no';

// Paths and parameters are case-sensitive.
export const URLS = {
  arrivals: `${FEED}/XmlFeed/v1.0?airport=${AIRPORT}&direction=A&TimeFrom=1&TimeTo=24`,
  airports: `${FEED}/airportNames/v1.0`,
  airlines: `${FEED}/airlineNames/v1.0`,
  statuses: `${FEED}/flightStatuses/v1.0`,
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) =>
  e[0] === '#'
    ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    : ENTITIES[e.toLowerCase()]);

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? unescape(m[1]) : null;
};
const text = (body, name) => {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(body);
  return m ? unescape(m[1]).trim() : null;
};

// The feed is flat: <flight uniqueID="…"><airline>…</airline>…<status code="E" time="…"/></flight>
export function parseFlights(xml) {
  if (!/<airport\b[^>]*>/.test(xml) || !/<flights\b/.test(xml)) throw new Error('Not an Avinor flight feed');
  const lastUpdate = attr(/<flights\b[^>]*>/.exec(xml)[0], 'lastUpdate');
  const flights = [];
  for (const [, open, body] of xml.matchAll(/(<flight\b[^>]*>)([\s\S]*?)<\/flight>/g)) {
    const statusTag = /<status\b[^>]*\/?>/.exec(body)?.[0];
    const via = text(body, 'via_airport');
    flights.push({
      id: attr(open, 'uniqueID'),
      airline: text(body, 'airline'),
      flight: text(body, 'flight_id'),
      domInt: text(body, 'dom_int'),
      scheduled: text(body, 'schedule_time'),
      direction: text(body, 'arr_dep'),
      from: text(body, 'airport'),
      via: via ? via.split(',').map((s) => s.trim()).filter(Boolean) : [],
      status: statusTag ? { code: attr(statusTag, 'code'), time: attr(statusTag, 'time') } : null,
      belt: text(body, 'belt'),
      delayed: text(body, 'delayed') === 'Y',
    });
  }
  return { lastUpdate, flights };
}

// <airportName code="OSL" name="Oslo"/> → { OSL: 'Oslo' }; same shape for airlines and statuses.
export function parseNames(xml, tag, nameAttr = 'name') {
  const names = {};
  for (const [el] of xml.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))) {
    const code = attr(el, 'code');
    const name = attr(el, nameAttr);
    if (code && name) names[code] = name;
  }
  return names;
}

// Resolve codes to names and keep only what the page needs.
export function toArrivals({ lastUpdate, flights }, { airports = {}, airlines = {}, statuses = {} } = {}, fetchedAt = new Date().toISOString()) {
  return {
    airport: AIRPORT,
    fetchedAt,
    lastUpdate,
    flights: flights
      .filter((f) => f.direction === 'A' && f.scheduled)
      .map((f) => ({
        id: f.id,
        flight: f.flight,
        airline: airlines[f.airline] ?? f.airline,
        from: airports[f.from] ?? f.from,
        via: f.via.map((c) => airports[c] ?? c),
        domInt: f.domInt,
        scheduled: f.scheduled,
        status: f.status && { ...f.status, text: statuses[f.status.code] ?? f.status.code },
        belt: f.belt,
        delayed: f.delayed,
      }))
      .sort((a, b) => a.scheduled.localeCompare(b.scheduled) || a.flight.localeCompare(b.flight)),
  };
}

const HOUR = 3600e3;
export const RECENT_LANDED_MS = 30 * 60e3;

// Best current estimate of when the flight gets (or got) in.
export const expectedTime = (f) => f.status?.time ?? f.scheduled;

// Flights from now to now + 24 h, plus ones that landed in the last 30 minutes.
export function upcoming(flights, now = Date.now()) {
  const end = now + 24 * HOUR;
  return flights.filter((f) => {
    const sched = Date.parse(f.scheduled);
    const expected = Date.parse(expectedTime(f));
    if (f.status?.code === 'A') return expected >= now - RECENT_LANDED_MS && sched <= end;
    if (f.status?.code === 'C') return sched >= now - RECENT_LANDED_MS && sched <= end;
    return expected >= now && sched <= end;
  });
}

export function matches(f, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [f.flight, f.airline, f.from, ...f.via].some((s) => s?.toLowerCase().includes(q));
}

const TZ = 'Europe/Oslo';

export function osloTime(iso) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

const osloDate = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(t));

export function dayLabel(iso, now = Date.now()) {
  const d = osloDate(iso);
  if (d === osloDate(now)) return 'Today';
  if (d === osloDate(now + 24 * HOUR)) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short' })
    .format(new Date(iso));
}

// What the status column says, e.g. "Landed 16:01", "New time 16:20", "Cancelled".
export function statusLabel(f) {
  const s = f.status;
  if (!s) return { text: '', kind: '' };
  switch (s.code) {
    case 'A': return { text: `Landed ${osloTime(s.time)}`, kind: 'landed' };
    case 'C': return { text: 'Cancelled', kind: 'cancelled' };
    case 'E': {
      if (!s.time) return { text: s.text, kind: '' };
      const late = Date.parse(s.time) - Date.parse(f.scheduled) >= 5 * 60e3;
      return { text: `${late ? 'Delayed' : 'Expected'} ${osloTime(s.time)}`, kind: late ? 'delayed' : 'expected' };
    }
    default: return { text: s.text ?? '', kind: '' };
  }
}

export const REGION = { D: 'Domestic', S: 'Schengen', I: 'International' };
