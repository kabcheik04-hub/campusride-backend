// V5 : administration et modération (signalements, suspension, retrait de trajet, suppression d'avis)

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { hashPassword } from '../src/auth.js';
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
    return (await call('POST', '/api/auth/register', { body: { email: `a${n}@admin.test`, password: 'motdepasse123', name: `Admin Test ${n}`, role } })).data;
  };
  // Un administrateur ne se crée jamais par l'API : on passe par la base, comme le fait le script make-admin
  const admin = async () => {
    const u = await user();
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(u.user.id);
    return u;
  };
  const trip = async (driver, seats = 3) =>
    (await call('POST', '/api/trips', {
      token: driver.token,
      body: { origin: 'Gare', destination: 'Campus', departure_at: hours(24), seats_total: seats, price: 2 },
    })).data.trip;
  const report = (who, target_type, target_id, reason = 'spam', extra = {}) =>
    call('POST', '/api/reports', { token: who.token, body: { target_type, target_id, reason, ...extra } });
  const close = () => new Promise((resolve) => server.close(resolve));
  return { db, call, user, admin, trip, report, close };
}

describe('rôle administrateur', () => {
  test('on ne devient jamais admin par l\'inscription ni par le profil', async () => {
    const { call, user, close } = await start();
    const sneaky = await call('POST', '/api/auth/register', {
      body: { email: 'pirate@admin.test', password: 'motdepasse123', name: 'Pirate', role: 'admin', is_admin: true },
    });
    assert.equal(sneaky.status, 400); // role « admin » refusé

    const me = await user();
    assert.equal(me.user.is_admin, false);
    const patch = await call('PATCH', '/api/me', { token: me.token, body: { is_admin: true, name: 'Encore Pirate' } });
    assert.equal(patch.status, 200);
    assert.equal(patch.data.user.is_admin, false);
    assert.equal((await call('GET', '/api/admin/users', { token: me.token })).status, 403);
    await close();
  });

  test('toutes les routes d\'administration refusent les non-admins et les visiteurs', async () => {
    const { call, user, close } = await start();
    const regular = await user();
    const routes = [
      ['GET', '/api/admin/reports'],
      ['PATCH', '/api/admin/reports/1/resolve'],
      ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users/1/suspend'],
      ['POST', '/api/admin/users/1/unsuspend'],
      ['GET', '/api/admin/reviews'],
      ['DELETE', '/api/admin/reviews/1'],
      ['DELETE', '/api/admin/trips/1'],
      ['GET', '/api/admin/actions'],
    ];
    for (const [method, path] of routes) {
      assert.equal((await call(method, path)).status, 401, `${method} ${path} visiteur`);
      assert.equal((await call(method, path, { token: regular.token })).status, 403, `${method} ${path} utilisateur`);
    }
    await close();
  });
});

describe('signalements', () => {
  test('signaler un utilisateur, un trajet ou un avis', async () => {
    const { db, call, user, trip, report, close } = await start();
    const driver = await user('driver');
    const reporter = await user();
    const t = await trip(driver);
    assert.equal((await report(reporter, 'user', driver.user.id, 'dangerous', { details: 'Conduite risquée' })).status, 201);
    assert.equal((await report(reporter, 'trip', t.id, 'fraud')).status, 201);

    db.prepare('INSERT INTO reviews (trip_id, author_id, target_id, rating, comment) VALUES (?, ?, ?, 1, ?)').run(t.id, driver.user.id, reporter.user.id, 'Insulte');
    const review = db.prepare('SELECT id FROM reviews').get();
    assert.equal((await report(reporter, 'review', review.id, 'inappropriate')).status, 201);
    assert.equal((await call('POST', '/api/reports', { body: { target_type: 'user', target_id: 1, reason: 'spam' } })).status, 401);
    await close();
  });

  test('doublons, auto-signalement, cibles et motifs invalides', async () => {
    const { call, user, trip, report, close } = await start();
    const driver = await user('driver');
    const other = await user();
    const t = await trip(driver);

    assert.equal((await report(other, 'trip', t.id)).status, 201);
    assert.equal((await report(other, 'trip', t.id)).status, 409);

    assert.equal((await report(driver, 'user', driver.user.id)).status, 400);
    assert.equal((await report(driver, 'trip', t.id)).status, 400);

    assert.equal((await report(other, 'user', 999999)).status, 404);
    assert.equal((await report(other, 'planete', 1)).status, 400);
    assert.equal((await report(other, 'user', driver.user.id, 'nimporte')).status, 400);
    assert.equal((await report(other, 'user', 'abc')).status, 400);
    assert.equal((await report(other, 'user', driver.user.id, 'spam', { details: 'x'.repeat(501) })).status, 400);
    assert.equal((await call('POST', '/api/reports', { token: other.token, body: {} })).status, 400);
    await close();
  });

  test('la file de signalements montre la cible et se classe', async () => {
    const { call, user, admin, trip, report, close } = await start();
    const boss = await admin();
    const driver = await user('driver');
    const reporter = await user();
    const t = await trip(driver);
    await report(reporter, 'trip', t.id, 'fraud', { details: 'Prix annoncé faux' });

    const list = await call('GET', '/api/admin/reports', { token: boss.token });
    assert.equal(list.status, 200);
    assert.equal(list.data.reports.length, 1);
    const r = list.data.reports[0];
    assert.equal(r.reason, 'fraud');
    assert.equal(r.reporter_id, reporter.user.id);
    assert.equal(r.target.origin, 'Gare');
    assert.equal(r.target.driver_id, driver.user.id);

    assert.equal((await call('GET', '/api/admin/reports?status=nimporte', { token: boss.token })).status, 400);
    assert.equal((await call('PATCH', `/api/admin/reports/${r.id}/resolve`, { token: boss.token })).status, 200);
    assert.equal((await call('PATCH', `/api/admin/reports/${r.id}/resolve`, { token: boss.token })).status, 409);
    assert.equal((await call('PATCH', '/api/admin/reports/999999/resolve', { token: boss.token })).status, 404);
    assert.equal((await call('GET', '/api/admin/reports', { token: boss.token })).data.reports.length, 0);
    assert.equal((await call('GET', '/api/admin/reports?status=resolved', { token: boss.token })).data.reports.length, 1);

    // Une fois classé, le même utilisateur peut signaler à nouveau si le problème revient
    assert.equal((await report(reporter, 'trip', t.id)).status, 201);
    await close();
  });
});

describe('suspension de compte', () => {
  test('effet immédiat : le jeton existant ne fonctionne plus, la connexion est refusée', async () => {
    const { call, user, admin, close } = await start();
    const boss = await admin();
    const victim = await user();
    assert.equal((await call('GET', '/api/me', { token: victim.token })).status, 200);

    const res = await call('POST', `/api/admin/users/${victim.user.id}/suspend`, { token: boss.token, body: { reason: 'Propos injurieux' } });
    assert.equal(res.status, 200);
    assert.ok(res.data.user.suspended_at);

    const me = await call('GET', '/api/me', { token: victim.token });
    assert.equal(me.status, 403);
    assert.equal(me.data.code, 'account_suspended');

    const good = await call('POST', '/api/auth/login', { body: { email: victim.user.email, password: 'motdepasse123' } });
    assert.equal(good.status, 403);
    assert.equal(good.data.code, 'account_suspended');
    // Un mauvais mot de passe ne révèle rien sur l'état du compte
    const bad = await call('POST', '/api/auth/login', { body: { email: victim.user.email, password: 'faux-faux-faux' } });
    assert.equal(bad.status, 401);

    // Réactivation : tout refonctionne avec l'ancien jeton
    assert.equal((await call('POST', `/api/admin/users/${victim.user.id}/unsuspend`, { token: boss.token })).status, 200);
    assert.equal((await call('GET', '/api/me', { token: victim.token })).status, 200);
    assert.equal((await call('POST', `/api/admin/users/${victim.user.id}/unsuspend`, { token: boss.token })).status, 409);
    await close();
  });

  test('les trajets et réservations à venir du compte suspendu sont annulés, ses signalements classés', async () => {
    const { call, user, admin, trip, report, close } = await start();
    const boss = await admin();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const innocentDriver = await user('driver');
    const reporter = await user();

    const t = await trip(driver, 3);
    const b = (await call('POST', `/api/trips/${t.id}/bookings`, { token: passenger.token })).data.booking;
    await call('PATCH', `/api/bookings/${b.id}/accept`, { token: driver.token });
    const innocentTrip = await trip(innocentDriver, 3);
    const mine = (await call('POST', `/api/trips/${innocentTrip.id}/bookings`, { token: driver.token })).data.booking; // le conducteur est passager ailleurs
    await report(reporter, 'user', driver.user.id, 'dangerous');

    const res = await call('POST', `/api/admin/users/${driver.user.id}/suspend`, { token: boss.token });
    assert.equal(res.status, 200);
    assert.equal(res.data.cancelled_trips, 1);

    assert.equal((await call('GET', `/api/trips/${t.id}`)).data.trip.status, 'cancelled');
    assert.equal((await call('GET', '/api/me/bookings', { token: passenger.token })).data.bookings[0].status, 'cancelled');
    // Sa demande de passager sur le trajet d'un autre est annulée aussi ; l'autre trajet reste ouvert
    const theirs = (await call('GET', '/api/me/trips', { token: innocentDriver.token })).data.trips[0];
    assert.equal(theirs.bookings.find((x) => x.id === mine.id).status, 'cancelled');
    assert.equal(theirs.status, 'open');
    assert.equal((await call('GET', '/api/admin/reports', { token: boss.token })).data.reports.length, 0);
    await close();
  });

  test('garde-fous : pas d\'auto-suspension, pas de suspension d\'admin, cibles invalides', async () => {
    const { call, admin, close } = await start();
    const boss = await admin();
    const second = await admin();
    assert.equal((await call('POST', `/api/admin/users/${boss.user.id}/suspend`, { token: boss.token })).status, 409);
    assert.equal((await call('POST', `/api/admin/users/${second.user.id}/suspend`, { token: boss.token })).status, 409);
    assert.equal((await call('POST', '/api/admin/users/999999/suspend', { token: boss.token })).status, 404);
    assert.equal((await call('POST', '/api/admin/users/abc/suspend', { token: boss.token })).status, 400);
    assert.equal((await call('GET', '/api/me', { token: boss.token })).status, 200);
    await close();
  });

  test('recherche d\'utilisateurs : nom, e-mail, joker % sans effet, mot de passe jamais exposé', async () => {
    const { call, user, admin, close } = await start();
    const boss = await admin();
    await user();
    const res = await call('GET', '/api/admin/users?q=admin.test', { token: boss.token });
    assert.equal(res.data.users.length, 2);
    assert.ok(res.data.users.every((u) => u.password_hash === undefined));
    assert.equal((await call('GET', '/api/admin/users?q=%25', { token: boss.token })).data.users.length, 0);
    assert.equal((await call('GET', '/api/admin/users?q=introuvable', { token: boss.token })).data.users.length, 0);
    await close();
  });
});

describe('modération des contenus', () => {
  test('retirer un trajet : annulé, réservations annulées, signalements classés', async () => {
    const { call, user, admin, trip, report, close } = await start();
    const boss = await admin();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const t = await trip(driver);
    await call('POST', `/api/trips/${t.id}/bookings`, { token: passenger.token });
    await report(passenger, 'trip', t.id, 'fraud');

    const res = await call('DELETE', `/api/admin/trips/${t.id}`, { token: boss.token });
    assert.equal(res.status, 200);
    assert.equal(res.data.trip.status, 'cancelled');
    assert.equal((await call('GET', '/api/me/bookings', { token: passenger.token })).data.bookings[0].status, 'cancelled');
    assert.equal((await call('GET', '/api/admin/reports', { token: boss.token })).data.reports.length, 0);
    assert.equal((await call('DELETE', `/api/admin/trips/${t.id}`, { token: boss.token })).status, 409);
    assert.equal((await call('DELETE', '/api/admin/trips/999999', { token: boss.token })).status, 404);
    await close();
  });

  test('on ne retire pas un trajet déjà parti', async () => {
    const { db, call, user, admin, trip, close } = await start();
    const boss = await admin();
    const driver = await user('driver');
    const t = await trip(driver);
    db.prepare('UPDATE trips SET departure_at = ? WHERE id = ?').run('2020-01-01T08:00:00.000Z', t.id);
    const res = await call('DELETE', `/api/admin/trips/${t.id}`, { token: boss.token });
    assert.equal(res.status, 409);
    assert.match(res.data.error, /déjà parti/);
    await close();
  });

  test('supprimer un avis : la note du conducteur est recalculée et les signalements classés', async () => {
    const { db, call, user, admin, trip, report, close } = await start();
    const boss = await admin();
    const driver = await user('driver');
    const author = await user();
    const t = await trip(driver);
    db.prepare('INSERT INTO reviews (trip_id, author_id, target_id, rating, comment) VALUES (?, ?, ?, 1, ?)').run(t.id, author.user.id, driver.user.id, 'Avis abusif');
    const review = db.prepare('SELECT id FROM reviews').get();
    await report(driver, 'review', review.id, 'inappropriate');
    assert.equal((await call('GET', `/api/trips/${t.id}`)).data.trip.driver_reviews_count, 1);

    const list = await call('GET', '/api/admin/reviews', { token: boss.token });
    assert.equal(list.data.reviews[0].comment, 'Avis abusif');

    assert.equal((await call('DELETE', `/api/admin/reviews/${review.id}`, { token: boss.token })).status, 200);
    assert.equal((await call('GET', `/api/trips/${t.id}`)).data.trip.driver_reviews_count, 0);
    assert.equal((await call('GET', '/api/admin/reports', { token: boss.token })).data.reports.length, 0);
    assert.equal((await call('DELETE', `/api/admin/reviews/${review.id}`, { token: boss.token })).status, 404);
    await close();
  });

  test('chaque action est écrite dans le journal', async () => {
    const { db, call, user, admin, trip, close } = await start();
    const boss = await admin();
    const driver = await user('driver');
    const t = await trip(driver);
    await call('DELETE', `/api/admin/trips/${t.id}`, { token: boss.token });
    await call('POST', `/api/admin/users/${driver.user.id}/suspend`, { token: boss.token, body: { reason: 'Fraude répétée' } });
    await call('POST', `/api/admin/users/${driver.user.id}/unsuspend`, { token: boss.token });
    // Les refus (409, 404) ne laissent aucune trace
    await call('POST', `/api/admin/users/${boss.user.id}/suspend`, { token: boss.token });

    const log = (await call('GET', '/api/admin/actions', { token: boss.token })).data.actions;
    assert.deepEqual(log.map((a) => a.action), ['unsuspend_user', 'suspend_user', 'remove_trip']);
    assert.equal(log[1].details, 'Fraude répétée');
    assert.equal(log[0].admin_name, boss.user.name);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admin_actions').get().n, 3);
    await close();
  });
});

describe('migration d\'une base antérieure', () => {
  test('les colonnes d\'administration sont ajoutées sans toucher aux comptes existants', () => {
    const dir = mkdtempSync(join(tmpdir(), 'campusride-'));
    const path = join(dir, 'old.db');
    try {
      let db = openDb(path);
      db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run('vieux@x.test', hashPassword('motdepasse123'), 'Vieux Compte');
      db.exec('ALTER TABLE users DROP COLUMN is_admin; ALTER TABLE users DROP COLUMN suspended_at; DROP TABLE reports; DROP TABLE admin_actions;');
      db.close();

      db = openDb(path);
      const columns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
      assert.ok(columns.includes('is_admin') && columns.includes('suspended_at'));
      const row = db.prepare('SELECT name, is_admin, suspended_at FROM users').get();
      assert.equal(row.name, 'Vieux Compte');
      assert.equal(row.is_admin, 0);
      assert.equal(row.suspended_at, null);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reports').get().n, 0);
      db.close();
      db = openDb(path); // deuxième ouverture sans erreur
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
