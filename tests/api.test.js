import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let server;
let db;
let baseUrl;

const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

async function api(method, path, { body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

async function register(email, name, role = 'both') {
  const { status, data } = await api('POST', '/api/auth/register', {
    body: { email, password: 'motdepasse123', name, role },
  });
  assert.equal(status, 201);
  return data;
}

before(async () => {
  ({ server, db } = createServer(loadConfig({ dbPath: ':memory:', jwtSecret: 'test-secret' })));
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

describe('authentification (F1)', () => {
  test('inscription, doublon, connexion et profil', async () => {
    const { token, user } = await register('Awa@Campus.test', 'Awa Koné');
    assert.equal(user.email, 'awa@campus.test');
    assert.equal(user.password_hash, undefined);

    const duplicate = await api('POST', '/api/auth/register', {
      body: { email: 'awa@campus.test', password: 'motdepasse123', name: 'Autre' },
    });
    assert.equal(duplicate.status, 409);

    const login = await api('POST', '/api/auth/login', { body: { email: 'awa@campus.test', password: 'motdepasse123' } });
    assert.equal(login.status, 200);

    const wrong = await api('POST', '/api/auth/login', { body: { email: 'awa@campus.test', password: 'faux' } });
    assert.equal(wrong.status, 401);

    const me = await api('GET', '/api/me', { token });
    assert.equal(me.data.user.name, 'Awa Koné');
  });

  test('validation et accès protégé', async () => {
    const invalid = await api('POST', '/api/auth/register', { body: { email: 'pas-un-email', password: 'court', name: 'A' } });
    assert.equal(invalid.status, 400);

    assert.equal((await api('GET', '/api/me')).status, 401);
    assert.equal((await api('GET', '/api/me', { token: 'jeton.invalide.ici' })).status, 401);
    assert.equal((await api('GET', '/api/inconnue')).status, 404);
  });
});

describe('parcours complet : publier, chercher, réserver, noter', () => {
  test('du trajet publié à l\'avis laissé', async () => {
    const driver = await register('conducteur@campus.test', 'Conducteur Test', 'driver');
    const passenger = await register('passager@campus.test', 'Passager Test', 'passenger');
    const other = await register('autre@campus.test', 'Autre Passager', 'passenger');

    // F2 : publication (un passager ne peut pas publier, les données sont validées)
    const forbidden = await api('POST', '/api/trips', {
      token: passenger.token,
      body: { origin: 'Gare', destination: 'Campus', departure_at: tomorrow(), seats_total: 2, price: 300 },
    });
    assert.equal(forbidden.status, 403);

    const past = await api('POST', '/api/trips', {
      token: driver.token,
      body: { origin: 'Gare', destination: 'Campus', departure_at: '2020-01-01T08:00:00Z', seats_total: 2, price: 300 },
    });
    assert.equal(past.status, 400);

    const created = await api('POST', '/api/trips', {
      token: driver.token,
      body: { origin: 'Gare centrale', destination: 'Campus nord', departure_at: tomorrow(), seats_total: 2, price: 300 },
    });
    assert.equal(created.status, 201);
    const trip = created.data.trip;
    assert.equal(trip.seats_left, 2);

    // F3 : recherche
    const found = await api('GET', '/api/trips?origin=gare&destination=NORD');
    assert.ok(found.data.trips.some((t) => t.id === trip.id));
    const none = await api('GET', '/api/trips?origin=introuvable');
    assert.equal(none.data.trips.length, 0);
    assert.equal((await api('GET', '/api/trips?date=demain')).status, 400);

    // F4 : réservation, doublon, surréservation, annulation
    const booked = await api('POST', `/api/trips/${trip.id}/bookings`, { token: passenger.token, body: { seats: 1 } });
    assert.equal(booked.status, 201);
    assert.equal(booked.data.seats_left, 1);

    const again = await api('POST', `/api/trips/${trip.id}/bookings`, { token: passenger.token, body: { seats: 1 } });
    assert.equal(again.status, 409);

    const tooMany = await api('POST', `/api/trips/${trip.id}/bookings`, { token: other.token, body: { seats: 2 } });
    assert.equal(tooMany.status, 409);

    const own = await api('POST', `/api/trips/${trip.id}/bookings`, { token: driver.token, body: { seats: 1 } });
    assert.equal(own.status, 403);

    // F5 : tableaux de bord
    const mine = await api('GET', '/api/me/bookings', { token: passenger.token });
    assert.equal(mine.data.bookings.length, 1);
    const published = await api('GET', '/api/me/trips', { token: driver.token });
    assert.equal(published.data.trips[0].bookings.length, 1);

    // Annulation : la place est rendue
    const cancelled = await api('DELETE', `/api/bookings/${booked.data.booking.id}`, { token: passenger.token });
    assert.equal(cancelled.data.booking.status, 'cancelled');
    assert.equal((await api('GET', `/api/trips/${trip.id}`)).data.trip.seats_left, 2);

    const notOwner = await api('DELETE', `/api/bookings/${booked.data.booking.id}`, { token: other.token });
    assert.equal(notOwner.status, 403);

    // F6 : avis impossible avant le départ
    await api('POST', `/api/trips/${trip.id}/bookings`, { token: passenger.token, body: { seats: 1 } });
    const early = await api('POST', `/api/trips/${trip.id}/reviews`, {
      token: passenger.token,
      body: { target_id: driver.user.id, rating: 5 },
    });
    assert.equal(early.status, 403);

    // On fait passer le départ dans le passé pour simuler un trajet effectué
    db.prepare('UPDATE trips SET departure_at = ? WHERE id = ?').run('2020-01-01T08:00:00.000Z', trip.id);

    const stranger = await api('POST', `/api/trips/${trip.id}/reviews`, {
      token: other.token,
      body: { target_id: driver.user.id, rating: 1 },
    });
    assert.equal(stranger.status, 403);

    const badRating = await api('POST', `/api/trips/${trip.id}/reviews`, {
      token: passenger.token,
      body: { target_id: driver.user.id, rating: 9 },
    });
    assert.equal(badRating.status, 400);

    const review = await api('POST', `/api/trips/${trip.id}/reviews`, {
      token: passenger.token,
      body: { target_id: driver.user.id, rating: 4, comment: 'Ponctuel et sympa' },
    });
    assert.equal(review.status, 201);

    const duplicate = await api('POST', `/api/trips/${trip.id}/reviews`, {
      token: passenger.token,
      body: { target_id: driver.user.id, rating: 5 },
    });
    assert.equal(duplicate.status, 409);

    const reviews = await api('GET', `/api/users/${driver.user.id}/reviews`);
    assert.equal(reviews.data.count, 1);
    assert.equal(reviews.data.average, 4);
  });

  test('le conducteur annule son trajet et les réservations suivent', async () => {
    const driver = await register('conducteur2@campus.test', 'Conducteur Deux', 'driver');
    const passenger = await register('passager2@campus.test', 'Passager Deux');
    const { data } = await api('POST', '/api/trips', {
      token: driver.token,
      body: { origin: 'Quartier sud', destination: 'Campus', departure_at: tomorrow(), seats_total: 3, price: 0 },
    });
    const tripId = data.trip.id;
    await api('POST', `/api/trips/${tripId}/bookings`, { token: passenger.token });

    assert.equal((await api('DELETE', `/api/trips/${tripId}`, { token: passenger.token })).status, 403);
    assert.equal((await api('DELETE', `/api/trips/${tripId}`, { token: driver.token })).status, 200);

    const mine = await api('GET', '/api/me/bookings', { token: passenger.token });
    assert.equal(mine.data.bookings[0].status, 'cancelled');
    const retry = await api('POST', `/api/trips/${tripId}/bookings`, { token: passenger.token });
    assert.equal(retry.status, 409);
  });
});
