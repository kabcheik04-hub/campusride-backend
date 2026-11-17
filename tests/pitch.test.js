import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';

function start(overrides = {}) {
  const { server, db } = createServer(loadConfig({ dbPath: ':memory:', jwtSecret: 'test-secret', ...overrides }));
  return new Promise((resolve) => {
    server.listen(0, () => {
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
      resolve({ server, db, call });
    });
  });
}

const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

describe('e-mail de l\'établissement', () => {
  let ctx;
  before(async () => {
    ctx = await start({ allowedEmailDomains: ['univ.test'] });
  });
  after(() => new Promise((resolve) => ctx.server.close(resolve)));

  test('seuls les domaines autorisés (et leurs sous-domaines) peuvent s\'inscrire', async () => {
    const register = (email) =>
      ctx.call('POST', '/api/auth/register', { body: { email, password: 'motdepasse123', name: 'Test Domaine' } });

    assert.equal((await register('ok@univ.test')).status, 201);
    assert.equal((await register('ok2@etu.univ.test')).status, 201);
    for (const bad of ['pirate@gmail.com', 'x@evil-univ.test', 'x@univ.test.evil.com', 'x@xuniv.test']) {
      const r = await register(bad);
      assert.equal(r.status, 400, bad);
      assert.match(r.data.error, /établissement/);
    }
  });
});

describe('données utiles à l\'interface', () => {
  let ctx;
  before(async () => {
    ctx = await start();
  });
  after(() => new Promise((resolve) => ctx.server.close(resolve)));

  test('photo à l\'inscription, nombre d\'avis, état du trajet (open, done, cancelled)', async () => {
    const { call, db } = ctx;
    const reg = async (email, name, role, extra = {}) =>
      (await call('POST', '/api/auth/register', { body: { email, password: 'motdepasse123', name, role, ...extra } })).data;

    const driver = await reg('d@pitch.test', 'Awa Koné', 'driver', { photo_url: 'https://exemple.fr/awa.png' });
    const passenger = await reg('p@pitch.test', 'Léa Martin', 'passenger');
    assert.equal(driver.user.photo_url, 'https://exemple.fr/awa.png');

    const bad = await call('POST', '/api/auth/register', {
      body: { email: 'x@pitch.test', password: 'motdepasse123', name: 'Mauvaise Photo', photo_url: 'javascript:alert(1)' },
    });
    assert.equal(bad.status, 400);

    const { data } = await call('POST', '/api/trips', {
      token: driver.token,
      body: { origin: 'Résidence Les Lilas', destination: 'Campus Sciences', departure_at: tomorrow(), seats_total: 2, price: 3 },
    });
    const tripId = data.trip.id;
    assert.equal(data.trip.state, 'open');
    assert.equal(data.trip.driver_photo_url, 'https://exemple.fr/awa.png');
    assert.equal(data.trip.driver_reviews_count, 0);
    assert.equal(data.trip.driver_rating, null);

    const booking = (await call('POST', `/api/trips/${tripId}/bookings`, { token: passenger.token })).data.booking;
    await call('PATCH', `/api/bookings/${booking.id}/accept`, { token: driver.token });
    assert.equal((await call('GET', '/api/me/bookings', { token: passenger.token })).data.bookings[0].trip_state, 'open');

    // Le départ passe : le trajet devient « terminé » et un avis devient possible
    db.prepare('UPDATE trips SET departure_at = ? WHERE id = ?').run('2020-01-01T08:00:00.000Z', tripId);
    assert.equal((await call('GET', `/api/trips/${tripId}`)).data.trip.state, 'done');
    assert.equal((await call('GET', '/api/me/bookings', { token: passenger.token })).data.bookings[0].trip_state, 'done');

    const review = await call('POST', `/api/trips/${tripId}/reviews`, {
      token: passenger.token,
      body: { target_id: driver.user.id, rating: 5, comment: 'Ponctuel' },
    });
    assert.equal(review.status, 201);
    const after = (await call('GET', `/api/trips/${tripId}`)).data.trip;
    assert.equal(after.driver_reviews_count, 1);
    assert.equal(after.driver_rating, 5);

    // Trajet annulé
    const second = (
      await call('POST', '/api/trips', {
        token: driver.token,
        body: { origin: 'Gare', destination: 'Campus Sciences', departure_at: tomorrow(), seats_total: 2, price: 2 },
      })
    ).data.trip;
    await call('DELETE', `/api/trips/${second.id}`, { token: driver.token });
    assert.equal((await call('GET', `/api/trips/${second.id}`)).data.trip.state, 'cancelled');
  });
});
