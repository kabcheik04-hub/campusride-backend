import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { signToken } from '../src/auth.js';
import { createServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const SECRET = 'test-secret';
let server;
let db;
let baseUrl;
let counter = 0;

const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

async function call(method, path, { body, token, raw, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function newUser(role = 'both') {
  counter += 1;
  const { status, data } = await call('POST', '/api/auth/register', {
    body: { email: `user${counter}@robust.test`, password: 'motdepasse123', name: `Utilisateur ${counter}`, role },
  });
  assert.equal(status, 201);
  return data;
}

async function newTrip(driver, seats = 3) {
  const { status, data } = await call('POST', '/api/trips', {
    token: driver.token,
    body: { origin: 'Départ test', destination: 'Arrivée test', departure_at: tomorrow(), seats_total: seats, price: 100 },
  });
  assert.equal(status, 201);
  return data.trip;
}

before(async () => {
  ({ server, db } = createServer(loadConfig({ dbPath: ':memory:', jwtSecret: SECRET })));
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

describe('concurrence', () => {
  test('30 réservations simultanées sur 3 places : exactement 3 réussissent', async () => {
    const driver = await newUser('driver');
    const trip = await newTrip(driver, 3);
    const passengers = await Promise.all(Array.from({ length: 30 }, () => newUser('passenger')));

    const results = await Promise.all(
      passengers.map((p) => call('POST', `/api/trips/${trip.id}/bookings`, { token: p.token, body: { seats: 1 } })),
    );
    const ok = results.filter((r) => r.status === 201).length;
    const refused = results.filter((r) => r.status === 409).length;
    assert.equal(ok, 3);
    assert.equal(refused, 27);

    const total = db
      .prepare("SELECT SUM(seats) AS n FROM bookings WHERE trip_id = ? AND status = 'confirmed'")
      .get(trip.id).n;
    assert.equal(total, 3);
    assert.equal((await call('GET', `/api/trips/${trip.id}`)).data.trip.seats_left, 0);
  });

  test("le même passager qui clique 10 fois ne réserve qu'une fois", async () => {
    const driver = await newUser('driver');
    const trip = await newTrip(driver, 5);
    const passenger = await newUser('passenger');
    const results = await Promise.all(
      Array.from({ length: 10 }, () => call('POST', `/api/trips/${trip.id}/bookings`, { token: passenger.token })),
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.ok(results.every((r) => r.status === 201 || r.status === 409));
  });

  test('inscriptions simultanées avec le même email : un seul compte, aucune erreur 500', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        call('POST', '/api/auth/register', {
          body: { email: 'doublon@robust.test', password: 'motdepasse123', name: 'Doublon' },
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.ok(results.every((r) => r.status === 201 || r.status === 409));
  });

  test('annulation et réservation en même temps ne cassent pas le décompte des places', async () => {
    const driver = await newUser('driver');
    const trip = await newTrip(driver, 2);
    const people = await Promise.all(Array.from({ length: 6 }, () => newUser('passenger')));
    await Promise.all(people.map((p) => call('POST', `/api/trips/${trip.id}/bookings`, { token: p.token })));
    const left = (await call('GET', `/api/trips/${trip.id}`)).data.trip.seats_left;
    assert.ok(left >= 0 && left <= 2);
  });
});

describe('jetons falsifiés', () => {
  test('jeton modifié, expiré, signé avec un autre secret, algorithme none, utilisateur inexistant', async () => {
    const victim = await newUser();
    const attacker = await newUser();

    const [header, , signature] = attacker.token.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ sub: victim.user.id, exp: 9999999999 })).toString('base64url');
    assert.equal((await call('GET', '/api/me', { token: `${header}.${forgedBody}.${signature}` })).status, 401);

    const expired = signToken({ sub: victim.user.id }, SECRET, -10);
    assert.equal((await call('GET', '/api/me', { token: expired })).status, 401);

    const wrongSecret = signToken({ sub: victim.user.id }, 'autre-secret', 3600);
    assert.equal((await call('GET', '/api/me', { token: wrongSecret })).status, 401);

    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${forgedBody}.`;
    assert.equal((await call('GET', '/api/me', { token: none })).status, 401);

    const ghost = signToken({ sub: 999999 }, SECRET, 3600);
    assert.equal((await call('GET', '/api/me', { token: ghost })).status, 401);

    for (const token of ['', 'a', 'a.b', 'a.b.c', '....', 'Bearer', '%00']) {
      const r = await call('GET', '/api/me', { token });
      assert.equal(r.status, 401, `jeton "${token}"`);
    }
    assert.equal((await call('GET', '/api/me', { headers: { Authorization: 'Basic abc' } })).status, 401);
  });
});

describe("droits d'accès", () => {
  test('on ne touche pas aux trajets et réservations des autres', async () => {
    const owner = await newUser('driver');
    const intruder = await newUser('both');
    const passenger = await newUser('passenger');
    const trip = await newTrip(owner, 3);
    const booking = (await call('POST', `/api/trips/${trip.id}/bookings`, { token: passenger.token })).data.booking;

    assert.equal((await call('DELETE', `/api/trips/${trip.id}`, { token: intruder.token })).status, 403);
    assert.equal((await call('DELETE', `/api/bookings/${booking.id}`, { token: intruder.token })).status, 403);
    assert.equal((await call('DELETE', `/api/bookings/${booking.id}`)).status, 401);

    const patch = await call('PATCH', '/api/me', { token: intruder.token, body: { role: 'admin' } });
    assert.equal(patch.status, 400);
    const sneaky = await call('PATCH', '/api/me', {
      token: intruder.token,
      body: { id: 1, email: 'pirate@robust.test', password_hash: 'x', name: 'Nouveau Nom' },
    });
    assert.equal(sneaky.status, 200);
    assert.equal(sneaky.data.user.id, intruder.user.id);
    assert.equal(sneaky.data.user.email, intruder.user.email);
  });

  test('la réponse ne contient jamais de mot de passe', async () => {
    const user = await newUser();
    const texts = [
      JSON.stringify(user),
      JSON.stringify((await call('GET', '/api/me', { token: user.token })).data),
      JSON.stringify((await call('GET', `/api/users/${user.user.id}/reviews`)).data),
    ];
    for (const text of texts) {
      assert.ok(!text.includes('password'), 'fuite possible de mot de passe');
      assert.ok(!text.includes('scrypt'));
    }
  });
});

describe('données invalides et malveillantes', () => {
  test('JSON cassé, corps non objet, corps trop gros', async () => {
    assert.equal((await call('POST', '/api/auth/login', { raw: '{"email": ' })).status, 400);
    assert.equal((await call('POST', '/api/auth/login', { raw: '[1,2,3]' })).status, 400);
    assert.equal((await call('POST', '/api/auth/login', { raw: 'null' })).status, 400);
    assert.equal((await call('POST', '/api/auth/login', { raw: '"texte"' })).status, 400);
    assert.equal((await call('POST', '/api/auth/login', { raw: '' })).status, 401);

    const huge = JSON.stringify({ email: 'a@b.fr', password: 'x'.repeat(300_000) });
    assert.equal((await call('POST', '/api/auth/login', { raw: huge })).status, 413);
    assert.equal((await call('GET', '/api/health')).status, 200);
    assert.equal((await call('GET', '/api/health')).status, 200);
  });

  test('types incorrects et valeurs hors limites à la publication', async () => {
    const driver = await newUser('driver');
    const base = { origin: 'Gare', destination: 'Campus', departure_at: tomorrow(), seats_total: 3, price: 100 };
    const bad = [
      { seats_total: '3' }, { seats_total: 0 }, { seats_total: 9 }, { seats_total: 2.5 }, { seats_total: null },
      { seats_total: Number.MAX_SAFE_INTEGER }, { price: -1 }, { price: 1.5 }, { price: '100' }, { price: 10_000_000 },
      { origin: '' }, { origin: 'a' }, { origin: 'x'.repeat(500) }, { origin: 123 }, { origin: { $ne: 1 } },
      { destination: 'gare' }, { destination: null },
      { departure_at: 'demain' }, { departure_at: 12345 }, { departure_at: '2020-01-01T00:00:00Z' }, { departure_at: null },
    ];
    for (const patch of bad) {
      const r = await call('POST', '/api/trips', { token: driver.token, body: { ...base, ...patch } });
      assert.equal(r.status, 400, `devrait refuser ${JSON.stringify(patch).slice(0, 60)}`);
    }
    const missing = await call('POST', '/api/trips', { token: driver.token, body: {} });
    assert.equal(missing.status, 400);
  });

  test('inscription : emails, mots de passe, noms et rôles invalides', async () => {
    const bad = [
      { email: 'sans-arobase' }, { email: 'a@b' }, { email: '' }, { email: null }, { email: 42 },
      { email: `${'a'.repeat(300)}@b.fr` }, { password: 'court' }, { password: 12345678 }, { password: 'x'.repeat(201) },
      { name: 'A' }, { name: '' }, { name: 'x'.repeat(100) }, { role: 'admin' }, { role: 5 },
    ];
    for (const patch of bad) {
      const r = await call('POST', '/api/auth/register', {
        body: { email: 'valide@robust.test', password: 'motdepasse123', name: 'Nom Valide', ...patch },
      });
      assert.equal(r.status, 400, `devrait refuser ${JSON.stringify(patch).slice(0, 60)}`);
    }
  });

  test('le même email en majuscules est reconnu comme un doublon', async () => {
    const first = await call('POST', '/api/auth/register', {
      body: { email: 'Casse@Robust.test', password: 'motdepasse123', name: 'Casse Test' },
    });
    assert.equal(first.status, 201);
    const second = await call('POST', '/api/auth/register', {
      body: { email: 'casse@robust.TEST', password: 'motdepasse123', name: 'Casse Test' },
    });
    assert.equal(second.status, 409);
    const login = await call('POST', '/api/auth/login', { body: { email: 'CASSE@robust.test', password: 'motdepasse123' } });
    assert.equal(login.status, 200);
  });

  test('injections SQL et caractères spéciaux sans effet', async () => {
    const payloads = ["' OR '1'='1", "'; DROP TABLE users; --", '" OR ""="', '%', '_', '\\', "Robert'); DROP TABLE trips;--"];
    for (const payload of payloads) {
      const login = await call('POST', '/api/auth/login', { body: { email: payload, password: payload } });
      assert.equal(login.status, 401);
      const search = await call('GET', `/api/trips?origin=${encodeURIComponent(payload)}&destination=${encodeURIComponent(payload)}`);
      assert.equal(search.status, 200);
      assert.equal(search.data.trips.length, 0, `la recherche "${payload}" ne doit rien renvoyer`);
    }
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0);
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'trips'").get().n === 1);
  });

  test('le caractère joker % ne renvoie pas tous les trajets', async () => {
    const driver = await newUser('driver');
    await newTrip(driver, 2);
    const all = (await call('GET', '/api/trips')).data.trips.length;
    assert.ok(all > 0);
    assert.equal((await call('GET', '/api/trips?origin=%25')).data.trips.length, 0);
  });

  test('accents, emojis et texte long acceptés sans erreur', async () => {
    const driver = await newUser('driver');
    const r = await call('POST', '/api/trips', {
      token: driver.token,
      body: { origin: 'Cité Universitaire é à ç 🚗', destination: 'Campus Éphémère', departure_at: tomorrow(), seats_total: 2, price: 0 },
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.trip.origin, 'Cité Universitaire é à ç 🚗');
    assert.equal((await call('GET', `/api/trips?origin=${encodeURIComponent('Cité')}`)).data.trips.length > 0, true);
  });

  test("identifiants et paramètres d'URL absurdes", async () => {
    for (const id of ['abc', '-1', '0', '1.5', '99999999999999999999', '%20', 'null']) {
      const r = await call('GET', `/api/trips/${id}`);
      assert.equal(r.status, 400, `/api/trips/${id}`);
    }
    assert.equal((await call('GET', '/api/trips/999999')).status, 404);
    assert.equal((await call('GET', '/api/users/999999/reviews')).status, 404);
    for (const q of ['date=2026-13-45x', 'date=demain', 'seats=abc', 'seats=0', 'seats=-2', 'seats=1.5']) {
      assert.equal((await call('GET', `/api/trips?${q}`)).status, 400, q);
    }
    assert.equal((await call('GET', '/api/trips?seats=9999')).status, 200);
  });

  test('routes et méthodes inconnues', async () => {
    assert.equal((await call('GET', '/')).status, 404);
    assert.equal((await call('GET', '/api/trips/1/inconnu')).status, 404);
    assert.equal((await call('GET', '/api/../etc/passwd')).status, 404);
    assert.equal((await call('PUT', '/api/trips')).status, 405);
    assert.equal((await call('DELETE', '/api/health')).status, 405);
  });

  test('avis : notes et cibles invalides', async () => {
    const driver = await newUser('driver');
    const passenger = await newUser('passenger');
    const trip = await newTrip(driver, 2);
    await call('POST', `/api/trips/${trip.id}/bookings`, { token: passenger.token });
    db.prepare('UPDATE trips SET departure_at = ? WHERE id = ?').run('2020-01-01T08:00:00.000Z', trip.id);

    const target = driver.user.id;
    for (const rating of [0, 6, 4.5, '5', null, -1]) {
      const r = await call('POST', `/api/trips/${trip.id}/reviews`, { token: passenger.token, body: { target_id: target, rating } });
      assert.equal(r.status, 400, `note ${rating}`);
    }
    const self = await call('POST', `/api/trips/${trip.id}/reviews`, { token: passenger.token, body: { target_id: passenger.user.id, rating: 5 } });
    assert.equal(self.status, 400);
    const unknown = await call('POST', `/api/trips/${trip.id}/reviews`, { token: passenger.token, body: { target_id: 999999, rating: 5 } });
    assert.equal(unknown.status, 403);
    const long = await call('POST', `/api/trips/${trip.id}/reviews`, { token: passenger.token, body: { target_id: target, rating: 5, comment: 'x'.repeat(600) } });
    assert.equal(long.status, 400);
  });

  test('URL de photo dangereuse refusée', async () => {
    const user = await newUser();
    for (const photo_url of ['javascript:alert(1)', 'data:text/html;base64,AAAA', 'ftp://x.fr/a.png', 'x'.repeat(600)]) {
      const r = await call('PATCH', '/api/me', { token: user.token, body: { photo_url } });
      assert.equal(r.status, 400, photo_url.slice(0, 30));
    }
    const ok = await call('PATCH', '/api/me', { token: user.token, body: { photo_url: 'https://exemple.fr/photo.png' } });
    assert.equal(ok.status, 200);
  });
});

describe('charge et stabilité', () => {
  test('300 requêtes simultanées de recherche répondent toutes correctement et vite', async () => {
    const driver = await newUser('driver');
    await newTrip(driver, 2);
    const start = Date.now();
    const results = []; for (let wave = 0; wave < 6; wave += 1) results.push(...(await Promise.all(Array.from({ length: 50 }, () => call('GET', '/api/trips')))));
    const duration = Date.now() - start;
    assert.ok(results.every((r) => r.status === 200));
    assert.ok(duration < 10_000, `trop lent : ${duration} ms`);
    console.log(`  → 300 recherches simultanées en ${duration} ms`);
  });

  test('50 connexions simultanées (hachage coûteux) fonctionnent', async () => {
    const user = await newUser();
    const start = Date.now();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => call('POST', '/api/auth/login', { body: { email: user.user.email, password: 'motdepasse123' } })),
    );
    assert.ok(results.every((r) => r.status === 200));
    console.log(`  → 50 connexions simultanées en ${Date.now() - start} ms`);
  });

  test('le serveur répond toujours après tous ces abus', async () => {
    const r = await call('GET', '/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { status: 'ok' });
  });
});