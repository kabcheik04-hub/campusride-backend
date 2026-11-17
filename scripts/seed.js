// Remplit la base avec des données de démonstration (mot de passe de tous les comptes : password123)
import { hashPassword } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';

const config = loadConfig();
const db = openDb(config.dbPath);

const insertUser = db.prepare('INSERT OR IGNORE INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)');
const passwordHash = hashPassword('password123');
const users = [
  ['awa@campus.test', 'Awa Koné', 'driver'],
  ['yann@campus.test', 'Yann Diallo', 'both'],
  ['lea@campus.test', 'Léa Martin', 'passenger'],
];
for (const [email, name, role] of users) insertUser.run(email, passwordHash, name, role);

const idOf = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
const inDays = (days, hour) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

const insertTrip = db.prepare(
  'INSERT INTO trips (driver_id, origin, destination, departure_at, seats_total, price) VALUES (?, ?, ?, ?, ?, ?)',
);
const trips = [
  // Prix en euros entiers
  ['awa@campus.test', 'Résidence Les Lilas', 'Campus Sciences', inDays(1, 7), 3, 3],
  ['awa@campus.test', 'Campus Sciences', 'Résidence Les Lilas', inDays(1, 17), 3, 3],
  ['yann@campus.test', 'Gare', 'Campus Sciences', inDays(2, 8), 2, 2],
  ['yann@campus.test', 'Quartier Nord', 'Campus Sciences', inDays(3, 7), 4, 4],
];
if (db.prepare('SELECT COUNT(*) AS n FROM trips').get().n === 0) {
  for (const [email, origin, destination, departureAt, seats, price] of trips) {
    insertTrip.run(idOf(email), origin, destination, departureAt, seats, price);
  }
}

console.log('Données de démonstration ajoutées. Connexion : awa@campus.test / password123');
db.close();
