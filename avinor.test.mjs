import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  URLS, dayLabel, matches, parseFlights, parseNames, statusLabel, toArrivals, upcoming,
} from './avinor.js';

// Trimmed from a real XmlFeed response.
const FEED = '<?xml version="1.0" encoding="ISO-8859-1" standalone="yes"?><airport name="OSL" xsi:noNamespaceSchemaLocation="/XmlFeed.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><flights lastUpdate="2026-09-25T14:22:33.830916Z">'
  + '<flight uniqueID="1616374025"><airline>DY</airline><flight_id>DY1791</flight_id><dom_int>S</dom_int><schedule_time>2026-09-25T12:55:00Z</schedule_time><arr_dep>A</arr_dep><airport>ALC</airport><status code="A" time="2026-09-25T14:01:00Z"/><belt>2</belt><delayed>Y</delayed></flight>'
  + '<flight uniqueID="186536712"><airline>WF</airline><flight_id>WF170</flight_id><dom_int>D</dom_int><schedule_time>2026-09-25T14:10:00Z</schedule_time><arr_dep>A</arr_dep><airport>BGO</airport><via_airport>SOG,HOV</via_airport><status code="E" time="2026-09-25T14:40:00Z"/></flight>'
  + '<flight uniqueID="919251241"><airline>SK</airline><flight_id>SK1472</flight_id><dom_int>S</dom_int><schedule_time>2026-09-25T20:35:00Z</schedule_time><arr_dep>A</arr_dep><airport>AAR</airport></flight>'
  + '<flight uniqueID="5"><airline>ZZ</airline><flight_id>ZZ9</flight_id><dom_int>I</dom_int><schedule_time>2026-09-25T15:00:00Z</schedule_time><arr_dep>A</arr_dep><airport>JFK</airport><status code="C"/></flight>'
  + '</flights></airport>';

const AIRPORTS = '<airportNames><airportName code="ALC" name="Alicante"/><airportName code="BGO" name="Bergen"/><airportName code="AAR" name="Århus"/><airportName code="SOG" name="Sogndal"/><airportName code="HOV" name="Ørsta-Volda"/></airportNames>';
const AIRLINES = '<airlineNames><airlineName code="DY" name="Norwegian"/><airlineName code="WF" name="Widerøe"/><airlineName code="SK" name="SAS"/><airlineName code="XX" name="A &amp; B Air"/></airlineNames>';
const STATUSES = '<flightStatuses><flightStatus code="A" statusTextEn="Arrived" statusTextNo="Landet"/><flightStatus code="C" statusTextEn="Cancelled" statusTextNo="Innstilt"/><flightStatus code="E" statusTextEn="New time" statusTextNo="Ny tid"/></flightStatuses>';

const arrivals = () => toArrivals(parseFlights(FEED), {
  airports: parseNames(AIRPORTS, 'airportName'),
  airlines: parseNames(AIRLINES, 'airlineName'),
  statuses: parseNames(STATUSES, 'flightStatus', 'statusTextEn'),
}, '2026-09-25T14:25:00Z');

test('URLs use the case-sensitive feed paths', () => {
  assert.equal(URLS.arrivals, 'https://asrv.avinor.no/XmlFeed/v1.0?airport=OSL&direction=A&TimeFrom=1&TimeTo=24');
});

test('parseFlights reads every field, including via, missing status and cancelled', () => {
  const { lastUpdate, flights } = parseFlights(FEED);
  assert.equal(lastUpdate, '2026-09-25T14:22:33.830916Z');
  assert.equal(flights.length, 4);
  assert.deepEqual(flights[0], {
    id: '1616374025', airline: 'DY', flight: 'DY1791', domInt: 'S', scheduled: '2026-09-25T12:55:00Z',
    direction: 'A', from: 'ALC', via: [], status: { code: 'A', time: '2026-09-25T14:01:00Z' }, belt: '2', delayed: true,
  });
  assert.deepEqual(flights[1].via, ['SOG', 'HOV']);
  assert.equal(flights[2].status, null);
  assert.deepEqual(flights[3].status, { code: 'C', time: null });
});

test('parseFlights rejects anything that is not a flight feed', () => {
  assert.throws(() => parseFlights('<html>Unauthorized</html>'), /Not an Avinor flight feed/);
});

test('parseNames reads codes, non-ASCII names and XML entities', () => {
  const airlines = parseNames(AIRLINES, 'airlineName');
  assert.equal(airlines.WF, 'Widerøe');
  assert.equal(airlines.XX, 'A & B Air');
  assert.equal(parseNames(STATUSES, 'flightStatus', 'statusTextEn').E, 'New time');
});

test('toArrivals resolves names and sorts by scheduled time', () => {
  const d = arrivals();
  assert.equal(d.fetchedAt, '2026-09-25T14:25:00Z');
  assert.deepEqual(d.flights.map((f) => f.flight), ['DY1791', 'WF170', 'ZZ9', 'SK1472']);
  const wf = d.flights[1];
  assert.equal(wf.airline, 'Widerøe');
  assert.equal(wf.from, 'Bergen');
  assert.deepEqual(wf.via, ['Sogndal', 'Ørsta-Volda']);
  assert.equal(wf.status.text, 'New time');
  assert.equal(d.flights[3].from, 'Århus');
  // Unknown codes fall back to the code itself.
  assert.equal(d.flights[2].airline, 'ZZ');
  assert.equal(d.flights[2].from, 'JFK');
});

test('upcoming keeps now → +24 h and flights that landed in the last 30 minutes', () => {
  const { flights } = arrivals();
  const at = (iso) => upcoming(flights, Date.parse(iso)).map((f) => f.flight);
  // 14:20: DY1791 landed 14:01 (19 min ago), WF170 expected 14:40, ZZ9 cancelled 15:00, SK1472 20:35.
  assert.deepEqual(at('2026-09-25T14:20:00Z'), ['DY1791', 'WF170', 'ZZ9', 'SK1472']);
  // 14:45: DY1791 landed 44 min ago; WF170's new time has passed without a landing.
  assert.deepEqual(at('2026-09-25T14:45:00Z'), ['ZZ9', 'SK1472']);
  // Anything scheduled more than 24 h out (SK1472 at 20:35) is dropped.
  assert.deepEqual(at('2026-09-24T20:00:00Z'), ['DY1791', 'WF170', 'ZZ9']);
});

test('statusLabel describes landed, delayed, on-time and cancelled flights', () => {
  const f = (status, scheduled = '2026-09-25T14:10:00Z') => ({ scheduled, status });
  assert.deepEqual(statusLabel(f({ code: 'A', time: '2026-09-25T14:01:00Z' })), { text: 'Landed 16:01', kind: 'landed' });
  assert.deepEqual(statusLabel(f({ code: 'E', time: '2026-09-25T14:40:00Z' })), { text: 'Delayed 16:40', kind: 'delayed' });
  assert.deepEqual(statusLabel(f({ code: 'E', time: '2026-09-25T14:05:00Z' })), { text: 'Expected 16:05', kind: 'expected' });
  assert.deepEqual(statusLabel(f({ code: 'C', time: null })), { text: 'Cancelled', kind: 'cancelled' });
  assert.deepEqual(statusLabel(f(null)), { text: '', kind: '' });
});

test('dayLabel uses Oslo dates', () => {
  const now = Date.parse('2026-09-25T20:00:00Z'); // 22:00 in Oslo
  assert.equal(dayLabel('2026-09-25T21:30:00Z', now), 'Today');
  assert.equal(dayLabel('2026-09-25T22:30:00Z', now), 'Tomorrow'); // 00:30 on the 26th in Oslo
});

test('matches searches flight, airline, origin and via', () => {
  const wf = arrivals().flights[1];
  for (const q of ['wf170', 'widerøe', 'berg', 'ørsta', '']) assert.ok(matches(wf, q), q);
  assert.ok(!matches(wf, 'alicante'));
});
