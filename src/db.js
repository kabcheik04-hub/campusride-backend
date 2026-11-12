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
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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
  status       TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Un passager ne peut avoir qu'une réservation active par trajet
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active
  ON bookings(trip_id, passenger_id) WHERE status = 'confirmed';

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
  db.exec(SCHEMA);
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
