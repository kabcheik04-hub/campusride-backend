import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { signToken } from '../src/auth.js';
import { createServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createRateLimiter } from '../src/rateLimit.js';

const SECRET = 'test-secret';
const hours = (n) => new Date(Date.now() + n * 3_600_000).toISOString();

async function start(overrides = {}) {
  const { server, db } = createServer(loadConfig({ dbPath: ':memory:', jwtSecret: SECRET, loginMaxAttempts: 100000, ...overrides }));
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://localhost:${server.address().port}`;
  const call = async (method, path, { body, token } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null, headers: response.headers };
  };
  let n = 0;
  const user = async (role = 'both') => {
    n += 1;
    const { data } = await call('POST', '/api/auth/register', {
      body: { email: `h${n}@hard.test`, password: 'motdepasse123', name: `Hard ${n}`, role },
    });
    return data;
  };
  const close = () => new Promise((resolve) => server.close(resolve));
  return { db, call, user, close };
}

describe('Durcissement', () => {
  test('recherche : le filtre de places est appliqué avant la limite de 200 trajets', async () => {
    const { db, call, user, close } = await start();
    const driver = await user('driver');
    const insert = db.prepare('INSERT INTO trips (driver_id, origin, destination, departure_at, seats_total, price) VALUES (?, ?, ?, ?, ?, ?)');
    const book = db.prepare("INSERT INTO bookings (trip_id, passenger_id, seats, status) VALUES (?, ?, ?, 'confirmed')");
    const passenger = await user('passenger');
    // 250 trajets complets (1 place, réservée), plus tôt dans le temps que le trajet réservable
    for (let i = 0; i < 250; i += 1) {
      const { lastInsertRowid } = insert.run(driver.user.id, 'Gare', 'Campus', hours(1 + i / 1000), 1, 2);
      book.run(lastInsertRowid, passenger.user.id, 1);
    }
    insert.run(driver.user.id, 'Gare', 'Campus', hours(48), 3, 2);
    const { status, data } = await call('GET', '/api/trips?seats=1');
    assert.equal(status, 200);
    assert.equal(data.trips.length, 1, 'le trajet réservable doit apparaître malgré 250 trajets complets avant lui');
    assert.equal(data.trips[0].seats_left, 3);
    await close();
  });

  test('annuler un trajet déjà parti : 409', async () => {
    const { db, call, user, close } = await start();
    const driver = await user('driver');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO trips (driver_id, origin, destination, departure_at, seats_total, price) VALUES (?, ?, ?, ?, ?, ?)')
      .run(driver.user.id, 'Gare', 'Campus', hours(-2), 3, 2);
    const res = await call('DELETE', `/api/trips/${lastInsertRowid}`, { token: driver.token });
    assert.equal(res.status, 409);
    assert.match(res.data.error, /déjà parti/);
    await close();
  });

  test('annuler une réservation : deux annulations simultanées, une seule réussit', async () => {
    const { call, user, close } = await start();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const trip = (await call('POST', '/api/trips', {
      token: driver.token,
      body: { origin: 'Gare', destination: 'Campus', departure_at: hours(24), seats_total: 3, price: 2 },
    })).data.trip;
    const booking = (await call('POST', `/api/trips/${trip.id}/bookings`, { token: passenger.token, body: { seats: 2 } })).data.booking;
    const results = await Promise.all([1, 2, 3].map(() => call('DELETE', `/api/bookings/${booking.id}`, { token: passenger.token })));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
    assert.equal((await call('GET', `/api/trips/${trip.id}`)).data.trip.seats_left, 3);
    await close();
  });

  test('mise à jour du profil', async () => {
    const { call, user, close } = await start();
    const me = await user('passenger');
    const res = await call('PATCH', '/api/me', { token: me.token, body: { name: 'Nouveau Nom', role: 'both', photo_url: 'https://exemple.fr/a.jpg' } });
    assert.equal(res.status, 200);
    assert.equal(res.data.user.name, 'Nouveau Nom');
    assert.equal(res.data.user.role, 'both');
    assert.equal((await call('PATCH', '/api/me', { token: me.token, body: { role: 'admin' } })).status, 400);
    assert.equal((await call('PATCH', '/api/me', { token: me.token, body: { photo_url: 'javascript:alert(1)' } })).status, 400);
    assert.equal((await call('PATCH', '/api/me', { body: { name: 'Xx' } })).status, 401);
    await close();
  });

  test('jeton expiré : 401', async () => {
    const { call, user, close } = await start();
    const me = await user();
    const expired = signToken({ sub: me.user.id }, SECRET, -10);
    assert.equal((await call('GET', '/api/me', { token: expired })).status, 401);
    assert.equal((await call('GET', '/api/me', { token: me.token })).status, 200);
    await close();
  });

  test('e-mail inconnu et mauvais mot de passe : même réponse', async () => {
    const { call, user, close } = await start();
    const me = await user();
    const unknown = await call('POST', '/api/auth/login', { body: { email: 'personne@hard.test', password: 'motdepasse123' } });
    const wrong = await call('POST', '/api/auth/login', { body: { email: me.user.email, password: 'mauvaismdp123' } });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.deepEqual(unknown.data, wrong.data);
    await close();
  });

  test('connexion : 429 avec Retry-After après trop d\'échecs, les succès ne comptent pas', async () => {
    const { call, user, close } = await start({ loginMaxAttempts: 10, loginWindowSeconds: 900 });
    const me = await user();
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await call('POST', '/api/auth/login', { body: { email: me.user.email, password: 'motdepasse123' } })).status, 200);
    }
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await call('POST', '/api/auth/login', { body: { email: me.user.email, password: 'faux-mot-de-passe' } })).status, 401);
    }
    const blocked = await call('POST', '/api/auth/login', { body: { email: me.user.email, password: 'motdepasse123' } });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.match(blocked.data.error, /Réessayez dans \d+ minute/);
    await close();
  });

  test('limiteur : la fenêtre expire', () => {
    const limiter = createRateLimiter({ max: 2, windowSeconds: 60 });
    limiter.fail('ip', 0);
    limiter.fail('ip', 1000);
    assert.equal(limiter.retryAfter('ip', 2000), 58);
    assert.equal(limiter.retryAfter('ip', 61_000), 0);
  });

  test('sans JWT_SECRET : secret aléatoire en développement, obligatoire en production', () => {
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    const warn = console.warn;
    console.warn = () => {};
    try {
      const a = loadConfig({ nodeEnv: 'development', jwtSecret: undefined }).jwtSecret;
      const b = loadConfig({ nodeEnv: 'development', jwtSecret: undefined }).jwtSecret;
      assert.ok(a.length >= 32);
      assert.notEqual(a, b);
      assert.notEqual(a, 'secret-de-developpement-a-changer');
      assert.throws(() => loadConfig({ nodeEnv: 'production', jwtSecret: undefined }), /JWT_SECRET/);
    } finally {
      console.warn = warn;
      if (saved !== undefined) process.env.JWT_SECRET = saved;
    }
  });
});
