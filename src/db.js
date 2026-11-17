import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'both' CHECK (role IN ('driver', 'passenger', 'both')),
  photo_url     TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Le rôle administrateur est séparé de role : il ne s'obtient jamais par l'inscription ni par le profil
  is_admin      INTEGER NOT NULL DEFAULT 0,
  -- Date de suspension du compte (NULL = compte actif)
  suspended_at  TEXT
);

CREATE TABLE IF NOT EXISTS trips (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id    INTEGER NOT NULL REFERENCES users(id),
  origin       TEXT NOT NULL,
  destination  TEXT NOT NULL,
  departure_at TEXT NOT NULL,
  seats_total  INTEGER NOT NULL CHECK (seats_total BETWEEN 1 AND 8),
  price        INTEGER NOT NULL CHECK (price >= 0),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_trips_departure ON trips(departure_at);

CREATE TABLE IF NOT EXISTS bookings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id      INTEGER NOT NULL REFERENCES trips(id),
  passenger_id INTEGER NOT NULL REFERENCES users(id),
  seats        INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 4),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'refused', 'cancelled')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Un passager ne peut avoir qu'une demande active (en attente ou acceptée) par trajet
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active
  ON bookings(trip_id, passenger_id) WHERE status IN ('pending', 'confirmed');

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id    INTEGER NOT NULL REFERENCES trips(id),
  author_id  INTEGER NOT NULL REFERENCES users(id),
  target_id  INTEGER NOT NULL REFERENCES users(id),
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (trip_id, author_id, target_id)
);

-- Signalements faits par les utilisateurs, traités par les administrateurs
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('user', 'trip', 'review')),
  target_id   INTEGER NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('inappropriate', 'spam', 'dangerous', 'fraud', 'other')),
  details     TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id)
);
-- Un utilisateur ne peut pas signaler dix fois la même cible tant que le premier signalement est ouvert
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_open ON reports(reporter_id, target_type, target_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);

-- Journal des actions de modération : qui a fait quoi, quand
CREATE TABLE IF NOT EXISTS admin_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   INTEGER NOT NULL,
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

/**
 * Bases créées avant la V5 : le statut « pending » / « refused » n'existe pas dans leur contrainte CHECK.
 * SQLite ne sait pas modifier une contrainte : on reconstruit la table en conservant toutes les lignes
 * (« confirmed » et « cancelled » gardent leur sens).
 */
function migrateBookings(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bookings'").get();
  if (!row || row.sql.includes("'pending'")) return;

  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.exec('BEGIN');
    db.exec('DROP INDEX IF EXISTS idx_bookings_active');
    db.exec('ALTER TABLE bookings RENAME TO bookings_old');
    db.exec(SCHEMA); // recrée bookings (et son index) ; les autres tables existent déjà
    db.exec(
      'INSERT INTO bookings (id, trip_id, passenger_id, seats, status, created_at) ' +
        'SELECT id, trip_id, passenger_id, seats, status, created_at FROM bookings_old',
    );
    db.exec('DROP TABLE bookings_old');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

/** Bases créées avant la V5 : ajoute les colonnes d'administration à `users` (les anciennes lignes restent intactes). */
function migrateUsers(db) {
  const columns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  if (!columns.includes('is_admin')) db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  if (!columns.includes('suspended_at')) db.exec('ALTER TABLE users ADD COLUMN suspended_at TEXT');
}

const NOTIFICATIONS_SCHEMA = `
-- Notifications internes (la cloche). trip_id et booking_id sont informatifs, sans clé étrangère
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  trip_id    INTEGER,
  booking_id INTEGER,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, id);
`;

/** Ouvre (et crée si besoin) la base SQLite, puis applique le schéma. */
export function openDb(path) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  migrateBookings(db);
  db.exec(SCHEMA);
  migrateUsers(db);
  db.exec(NOTIFICATIONS_SCHEMA);
  return db;
}

/** Exécute `fn` dans une transaction : tout est validé ou tout est annulé. */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
