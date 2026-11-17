// V5 : validation des demandes de réservation par le conducteur

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { createServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';

const hours = (n) => new Date(Date.now() + n * 3_600_000).toISOString();

async function start() {
  const { server, db } = createServer(loadConfig({ dbPath: ':memory:', jwtSecret: 'test-secret', loginMaxAttempts: 100000 }));
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://localhost:${server.address().port}`;
  const call = async (method, path, { body, token } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  };
  let n = 0;
  const user = async (role = 'both') => {
    n += 1;
    return (await call('POST', '/api/auth/register', { body: { email: `v${n}@valid.test`, password: 'motdepasse123', name: `Valid ${n}`, role } })).data;
  };
  const trip = async (driver, seats = 3) =>
    (await call('POST', '/api/trips', {
      token: driver.token,
      body: { origin: 'Gare', destination: 'Campus', departure_at: hours(24), seats_total: seats, price: 2 },
    })).data.trip;
  const request = async (passenger, tripId, seats = 1) =>
    (await call('POST', `/api/trips/${tripId}/bookings`, { token: passenger.token, body: { seats } })).data.booking;
  const seatsLeft = async (tripId) => (await call('GET', `/api/trips/${tripId}`)).data.trip.seats_left;
  const close = () => new Promise((resolve) => server.close(resolve));
  return { db, call, user, trip, request, seatsLeft, close };
}

describe('validation par le conducteur', () => {
  test('une réservation est créée « en attente » et ne retire aucune place', async () => {
    const { call, user, trip, seatsLeft, close } = await start();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const t = await trip(driver, 2);
    const res = await call('POST', `/api/trips/${t.id}/bookings`, { token: passenger.token, body: { seats: 2 } });
    assert.equal(res.status, 201);
    assert.equal(res.data.booking.status, 'pending');
    assert.equal(res.data.seats_left, 2);
    assert.equal(await seatsLeft(t.id), 2);
    // Le trajet reste visible dans la recherche avec toutes ses places
    assert.equal((await call('GET', '/api/trips?seats=2')).data.trips.length, 1);
    await close();
  });

  test('accepter : le conducteur attribue les places, le passager voit « confirmed »', async () => {
    const { call, user, trip, request, seatsLeft, close } = await start();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const t = await trip(driver, 3);
    const b = await request(passenger, t.id, 2);
    const res = await call('PATCH', `/api/bookings/${b.id}/accept`, { token: driver.token });
    assert.equal(res.status, 200);
    assert.equal(res.data.booking.status, 'confirmed');
    assert.equal(res.data.seats_left, 1);
    assert.equal(await seatsLeft(t.id), 1);
    assert.equal((await call('GET', '/api/me/bookings', { token: passenger.token })).data.bookings[0].status, 'confirmed');
    const mine = (await call('GET', '/api/me/trips', { token: driver.token })).data.trips[0];
    assert.equal(mine.bookings[0].status, 'confirmed');
    await close();
  });

  test('refuser : aucune place consommée, la demande ne peut plus être annulée ni traitée', async () => {
    const { call, user, trip, request, seatsLeft, close } = await start();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const t = await trip(driver, 2);
    const b = await request(passenger, t.id);
    const res = await call('PATCH', `/api/bookings/${b.id}/refuse`, { token: driver.token });
    assert.equal(res.status, 200);
    assert.equal(res.data.booking.status, 'refused');
    assert.equal(await seatsLeft(t.id), 2);
    assert.equal((await call('DELETE', `/api/bookings/${b.id}`, { token: passenger.token })).status, 409);
    assert.equal((await call('PATCH', `/api/bookings/${b.id}/accept`, { token: driver.token })).status, 409);
    // Après un refus, le passager peut refaire une demande
    assert.equal((await call('POST', `/api/trips/${t.id}/bookings`, { token: passenger.token })).status, 201);
    await close();
  });

  test('machine d\'états : on ne répond qu\'une fois à une demande', async () => {
    const { call, user, trip, request, close } = await start();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const t = await trip(driver, 3);

    const accepted = await request(passenger, t.id);
    assert.equal((await call('PATCH', `/api/bookings/${accepted.id}/accept`, { token: driver.token })).status, 200);
    assert.equal((await call('PATCH', `/api/bookings/${accepted.id}/accept`, { token: driver.token })).status, 409);
    assert.equal((await call('PATCH', `/api/bookings/${accepted.id}/refuse`, { token: driver.token })).status, 409);

    // Une demande annulée par le passager ne peut plus être acceptée
    const other = await user('passenger');
    const cancelled = await request(other, t.id);
    assert.equal((await call('DELETE', `/api/bookings/${cancelled.id}`, { token: other.token })).status, 200);
    assert.equal((await call('PATCH', `/api/bookings/${cancelled.id}/accept`, { token: driver.token })).status, 409);
    await close();
  });

  test('droits : seul le conducteur du trajet répond, identifiants invalides gérés', async () => {
    const { call, user, trip, request, close } = await start();
    const driver = await user('driver');
    const otherDriver = await user('driver');
    const passenger = await user('passenger');
    const t = await trip(driver);
    const b = await request(passenger, t.id);

    for (const action of ['accept', 'refuse']) {
      assert.equal((await call('PATCH', `/api/bookings/${b.id}/${action}`)).status, 401);
      assert.equal((await call('PATCH', `/api/bookings/${b.id}/${action}`, { token: passenger.token })).status, 403);
      assert.equal((await call('PATCH', `/api/bookings/${b.id}/${action}`, { token: otherDriver.token })).status, 403);
      assert.equal((await call('PATCH', `/api/bookings/999999/${action}`, { token: driver.token })).status, 404);
      assert.equal((await call('PATCH', `/api/bookings/abc/${action}`, { token: driver.token })).status, 400);
    }
    // Rien n'a bougé malgré toutes ces tentatives
    assert.equal((await call('GET', '/api/me/bookings', { token: passenger.token })).data.bookings[0].status, 'pending');
    await close();
  });

  test('accepter revérifie la capacité : on ne peut pas dépasser les places', async () => {
    const { call, user, trip, request, seatsLeft, close } = await start();
    const driver = await user('driver');
    const [a, b] = [await user('passenger'), await user('passenger')];
    const t = await trip(driver, 3);
    const first = await request(a, t.id, 2);
    const second = await request(b, t.id, 2); // 2 <= 3 libres : la demande est enregistrée
    assert.equal((await call('PATCH', `/api/bookings/${first.id}/accept`, { token: driver.token })).status, 200);
    const res = await call('PATCH', `/api/bookings/${second.id}/accept`, { token: driver.token });
    assert.equal(res.status, 409);
    assert.match(res.data.error, /Il ne reste que 1 place/);
    assert.equal(await seatsLeft(t.id), 1);
    // Le conducteur peut en revanche refuser la seconde
    assert.equal((await call('PATCH', `/api/bookings/${second.id}/refuse`, { token: driver.token })).status, 200);
    await close();
  });

  test('un passager ne peut avoir qu\'une demande active, qu\'elle soit en attente ou acceptée', async () => {
    const { call, user, trip, request, close } = await start();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const t = await trip(driver);
    const b = await request(passenger, t.id);
    assert.equal((await call('POST', `/api/trips/${t.id}/bookings`, { token: passenger.token })).status, 409);
    await call('PATCH', `/api/bookings/${b.id}/accept`, { token: driver.token });
    assert.equal((await call('POST', `/api/trips/${t.id}/bookings`, { token: passenger.token })).status, 409);
    await close();
  });

  test('annuler une demande en attente fonctionne ; annuler une réservation acceptée libère les places', async () => {
    const { call, user, trip, request, seatsLeft, close } = await start();
    const driver = await user('driver');
    const [a, b] = [await user('passenger'), await user('passenger')];
    const t = await trip(driver, 2);
    const pending = await request(a, t.id);
    assert.equal((await call('DELETE', `/api/bookings/${pending.id}`, { token: a.token })).data.booking.status, 'cancelled');
    const accepted = await request(b, t.id, 2);
    await call('PATCH', `/api/bookings/${accepted.id}/accept`, { token: driver.token });
    assert.equal(await seatsLeft(t.id), 0);
    await call('DELETE', `/api/bookings/${accepted.id}`, { token: b.token });
    assert.equal(await seatsLeft(t.id), 2);
    await close();
  });

  test('on ne répond pas à une demande d\'un trajet annulé ou déjà parti', async () => {
    const { db, call, user, trip, request, close } = await start();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const t1 = await trip(driver);
    const b1 = await request(passenger, t1.id);
    await call('DELETE', `/api/trips/${t1.id}`, { token: driver.token });
    // L'annulation du trajet annule aussi la demande en attente
    assert.equal((await call('GET', '/api/me/bookings', { token: passenger.token })).data.bookings[0].status, 'cancelled');
    assert.equal((await call('PATCH', `/api/bookings/${b1.id}/accept`, { token: driver.token })).status, 409);

    const other = await user('passenger');
    const t2 = await trip(driver);
    const b2 = await request(other, t2.id);
    db.prepare('UPDATE trips SET departure_at = ? WHERE id = ?').run('2020-01-01T08:00:00.000Z', t2.id);
    const res = await call('PATCH', `/api/bookings/${b2.id}/accept`, { token: driver.token });
    assert.equal(res.status, 409);
    assert.match(res.data.error, /déjà parti/);
    await close();
  });

  test('une demande en attente ne donne pas le droit de laisser un avis', async () => {
    const { db, call, user, trip, request, close } = await start();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const t = await trip(driver);
    await request(passenger, t.id);
    db.prepare('UPDATE trips SET departure_at = ? WHERE id = ?').run('2020-01-01T08:00:00.000Z', t.id);
    const res = await call('POST', `/api/trips/${t.id}/reviews`, { token: passenger.token, body: { target_id: driver.user.id, rating: 5 } });
    assert.equal(res.status, 403);
    await close();
  });
});

describe('migration d\'une base V4', () => {
  test('les réservations existantes sont conservées et le nouveau statut devient utilisable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'campusride-'));
    const path = join(dir, 'v4.db');
    try {
      // On fabrique une base V4 : schéma actuel, puis table bookings remplacée par l'ancienne définition
      let db = openDb(path);
      db.exec('DROP INDEX idx_bookings_active; DROP TABLE bookings;');
      db.exec(`
        CREATE TABLE bookings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trip_id INTEGER NOT NULL REFERENCES trips(id),
          passenger_id INTEGER NOT NULL REFERENCES users(id),
          seats INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 4),
          status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE UNIQUE INDEX idx_bookings_active ON bookings(trip_id, passenger_id) WHERE status = 'confirmed';
        INSERT INTO users (id, email, password_hash, name) VALUES (1, 'd@x.test', 'h', 'D'), (2, 'p@x.test', 'h', 'P');
        INSERT INTO trips (id, driver_id, origin, destination, departure_at, seats_total, price) VALUES (1, 1, 'A', 'B', '2099-01-01T08:00:00.000Z', 3, 1);
        INSERT INTO bookings (trip_id, passenger_id, seats, status) VALUES (1, 2, 2, 'confirmed');
      `);
      db.close();

      db = openDb(path); // migration
      const rows = db.prepare('SELECT id, seats, status FROM bookings').all();
      assert.deepEqual(rows.map((r) => ({ ...r })), [{ id: 1, seats: 2, status: 'confirmed' }]);
      db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = 1").run();
      db.prepare('INSERT INTO bookings (trip_id, passenger_id, seats) VALUES (1, 2, 1)').run();
      assert.equal(db.prepare('SELECT status FROM bookings WHERE id = 2').get().status, 'pending');
      db.close();

      db = openDb(path); // deuxième ouverture : rien ne doit changer ni échouer
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 2);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
