// V5 : notifications internes (cloche)

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
    return (await call('POST', '/api/auth/register', { body: { email: `n${n}@notif.test`, password: 'motdepasse123', name: `Notif ${n}`, role } })).data;
  };
  const admin = async () => {
    const created = await user('both');
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(created.user.id);
    return (await call('POST', '/api/auth/login', { body: { email: `n${n}@notif.test`, password: 'motdepasse123' } })).data;
  };
  const trip = async (driver, seats = 3) =>
    (await call('POST', '/api/trips', {
      token: driver.token,
      body: { origin: 'Gare', destination: 'Campus', departure_at: hours(24), seats_total: seats, price: 2 },
    })).data.trip;
  const request = async (passenger, tripId, seats = 1) =>
    (await call('POST', `/api/trips/${tripId}/bookings`, { token: passenger.token, body: { seats } })).data.booking;
  const inbox = async (u) => (await call('GET', '/api/notifications', { token: u.token })).data;
  const types = async (u) => (await inbox(u)).notifications.map((x) => x.type); // plus récentes d'abord
  const close = () => new Promise((resolve) => server.close(resolve));
  return { db, call, user, admin, trip, request, inbox, types, close };
}

describe('notifications : événements', () => {
  test('une nouvelle demande notifie le conducteur, et lui seul', async () => {
    const { call, user, trip, inbox, types, close } = await start();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const bystander = await user('both');
    const t = await trip(driver);
    const res = await call('POST', `/api/trips/${t.id}/bookings`, { token: passenger.token, body: { seats: 2 } });
    assert.equal(res.status, 201);

    const mine = await inbox(driver);
    assert.equal(mine.unread_count, 1);
    const [notification] = mine.notifications;
    assert.equal(notification.type, 'booking_request');
    assert.equal(notification.trip_id, t.id);
    assert.equal(notification.booking_id, res.data.booking.id);
    assert.equal(notification.read_at, null);
    assert.ok(notification.message.includes(passenger.user.name));
    assert.ok(notification.message.includes('Gare'));
    assert.equal((await call('GET', '/api/notifications/unread-count', { token: driver.token })).data.unread_count, 1);

    assert.deepEqual(await types(passenger), []);
    assert.deepEqual(await types(bystander), []);
    await close();
  });

  test('accepter ou refuser notifie le passager concerné', async () => {
    const { call, user, trip, request, types, close } = await start();
    const driver = await user('driver');
    const [a, b] = [await user('passenger'), await user('passenger')];
    const t = await trip(driver, 4);
    const ra = await request(a, t.id);
    const rb = await request(b, t.id);
    await call('PATCH', `/api/bookings/${ra.id}/accept`, { token: driver.token });
    await call('PATCH', `/api/bookings/${rb.id}/refuse`, { token: driver.token });

    assert.deepEqual(await types(a), ['booking_accepted']);
    assert.deepEqual(await types(b), ['booking_refused']);
    assert.deepEqual(await types(driver), ['booking_request', 'booking_request']);
    await close();
  });

  test('le passager qui annule prévient le conducteur ; une annulation refusée ne prévient personne', async () => {
    const { call, user, trip, request, inbox, types, close } = await start();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const t = await trip(driver);
    const b = await request(passenger, t.id);
    assert.equal((await call('DELETE', `/api/bookings/${b.id}`, { token: passenger.token })).status, 200);
    const mine = await inbox(driver);
    assert.equal(mine.notifications[0].type, 'booking_cancelled');
    assert.ok(mine.notifications[0].message.includes(passenger.user.name));

    const before = (await types(driver)).length;
    assert.equal((await call('DELETE', `/api/bookings/${b.id}`, { token: passenger.token })).status, 409);
    assert.equal((await types(driver)).length, before);
    await close();
  });

  test('le conducteur annule son trajet : seuls les passagers avec une demande active sont prévenus', async () => {
    const { call, user, trip, request, types, close } = await start();
    const driver = await user('driver');
    const [pending, confirmed, refused, withdrawn, outsider] = [
      await user('passenger'),
      await user('passenger'),
      await user('passenger'),
      await user('passenger'),
      await user('passenger'),
    ];
    const t = await trip(driver, 5);
    await request(pending, t.id);
    const bc = await request(confirmed, t.id);
    const br = await request(refused, t.id);
    const bw = await request(withdrawn, t.id);
    await call('PATCH', `/api/bookings/${bc.id}/accept`, { token: driver.token });
    await call('PATCH', `/api/bookings/${br.id}/refuse`, { token: driver.token });
    await call('DELETE', `/api/bookings/${bw.id}`, { token: withdrawn.token });

    assert.equal((await call('DELETE', `/api/trips/${t.id}`, { token: driver.token })).status, 200);

    assert.deepEqual(await types(pending), ['trip_cancelled']);
    assert.deepEqual(await types(confirmed), ['trip_cancelled', 'booking_accepted']);
    assert.deepEqual(await types(refused), ['booking_refused']);
    assert.deepEqual(await types(withdrawn), []);
    assert.deepEqual(await types(outsider), []);
    await close();
  });

  test('retrait par l\'admin : conducteur et passagers sont prévenus, pas l\'admin', async () => {
    const { call, user, admin, trip, request, inbox, types, close } = await start();
    const root = await admin();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const t = await trip(driver);
    await request(passenger, t.id);

    assert.equal((await call('DELETE', `/api/admin/trips/${t.id}`, { token: root.token })).status, 200);
    assert.equal((await types(driver))[0], 'trip_removed');
    const mine = await inbox(passenger);
    assert.equal(mine.notifications[0].type, 'trip_cancelled');
    assert.ok(mine.notifications[0].message.includes('administrateur'));
    assert.deepEqual(await types(root), []);
    await close();
  });

  test('suspension d\'un conducteur : ses passagers sont prévenus de l\'annulation', async () => {
    const { call, user, admin, trip, request, types, close } = await start();
    const root = await admin();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const t = await trip(driver);
    await request(passenger, t.id);
    const res = await call('POST', `/api/admin/users/${driver.user.id}/suspend`, { token: root.token, body: { reason: 'test' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await types(passenger), ['trip_cancelled']);
    await close();
  });

  test('une action refusée ne produit aucune notification', async () => {
    const { call, user, trip, request, types, close } = await start();
    const driver = await user('driver');
    const [a, b] = [await user('passenger'), await user('passenger')];
    const t = await trip(driver, 3);
    const ra = await request(a, t.id, 2);
    const rb = await request(b, t.id, 2);
    assert.equal((await call('PATCH', `/api/bookings/${ra.id}/accept`, { token: driver.token })).status, 200);
    assert.equal((await call('PATCH', `/api/bookings/${ra.id}/accept`, { token: driver.token })).status, 409); // déjà traitée
    assert.equal((await call('PATCH', `/api/bookings/${rb.id}/accept`, { token: driver.token })).status, 409); // plus de place
    assert.deepEqual(await types(a), ['booking_accepted']);
    assert.deepEqual(await types(b), []);
    await close();
  });
});

describe('notifications : lecture et droits', () => {
  test('accès protégé, et personne ne touche aux notifications des autres', async () => {
    const { call, user, trip, request, inbox, close } = await start();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const other = await user('both');
    const t = await trip(driver);
    await request(passenger, t.id);
    const id = (await inbox(driver)).notifications[0].id;

    for (const [method, path] of [
      ['GET', '/api/notifications'],
      ['GET', '/api/notifications/unread-count'],
      ['POST', '/api/notifications/read-all'],
      ['POST', `/api/notifications/${id}/read`],
    ]) {
      assert.equal((await call(method, path)).status, 401, `${method} ${path}`);
    }

    assert.equal((await call('POST', `/api/notifications/${id}/read`, { token: other.token })).status, 404);
    assert.deepEqual((await inbox(other)).notifications, []);
    assert.equal((await call('POST', '/api/notifications/read-all', { token: other.token })).data.marked, 0);
    assert.equal((await inbox(driver)).unread_count, 1); // rien n'a bougé pour le conducteur

    assert.equal((await call('POST', '/api/notifications/abc/read', { token: driver.token })).status, 400);
    assert.equal((await call('POST', '/api/notifications/999999/read', { token: driver.token })).status, 404);
    await close();
  });

  test('marquer comme lue est idempotent et met le compteur à jour', async () => {
    const { call, user, trip, request, inbox, close } = await start();
    const driver = await user('driver');
    const passenger = await user('passenger');
    const t = await trip(driver);
    await request(passenger, t.id);
    const id = (await inbox(driver)).notifications[0].id;

    const first = await call('POST', `/api/notifications/${id}/read`, { token: driver.token });
    assert.equal(first.status, 200);
    assert.notEqual(first.data.notification.read_at, null);
    assert.equal(first.data.unread_count, 0);
    const second = await call('POST', `/api/notifications/${id}/read`, { token: driver.token });
    assert.equal(second.status, 200);
    assert.equal(second.data.notification.read_at, first.data.notification.read_at);
    await close();
  });

  test('tout marquer comme lu garde l\'historique ; une nouvelle demande relance le compteur', async () => {
    const { call, user, trip, request, inbox, close } = await start();
    const driver = await user('driver');
    const t = await trip(driver, 4);
    for (let i = 0; i < 3; i += 1) await request(await user('passenger'), t.id);
    assert.equal((await inbox(driver)).unread_count, 3);

    const res = await call('POST', '/api/notifications/read-all', { token: driver.token });
    assert.equal(res.data.marked, 3);
    const after = await inbox(driver);
    assert.equal(after.unread_count, 0);
    assert.equal(after.notifications.length, 3);

    await request(await user('passenger'), t.id);
    assert.equal((await inbox(driver)).unread_count, 1);
    await close();
  });

  test('la liste est limitée à 30, les plus récentes d\'abord, et le compteur reste exact', async () => {
    const { db, user, inbox, close } = await start();
    const driver = await user('driver');
    const insert = db.prepare("INSERT INTO notifications (user_id, type, message) VALUES (?, 'booking_request', ?)");
    for (let i = 0; i < 35; i += 1) insert.run(driver.user.id, `n${i}`);
    const mine = await inbox(driver);
    assert.equal(mine.notifications.length, 30);
    assert.equal(mine.notifications[0].message, 'n34');
    assert.equal(mine.unread_count, 35);
    await close();
  });
});

describe('migration d\'une base sans notifications', () => {
  test('la table est créée sans toucher aux données existantes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'campusride-'));
    const path = join(dir, 'before-notifications.db');
    try {
      let db = openDb(path);
      db.exec('DROP TABLE notifications;');
      db.exec("INSERT INTO users (id, email, password_hash, name) VALUES (1, 'a@x.test', 'h', 'A')");
      db.close();

      db = openDb(path); // migration
      assert.equal(db.prepare('SELECT name FROM users WHERE id = 1').get().name, 'A');
      db.prepare("INSERT INTO notifications (user_id, type, message) VALUES (1, 'booking_request', 'x')").run();
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 1);
      db.close();

      db = openDb(path); // deuxième ouverture : rien ne doit changer ni échouer
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});