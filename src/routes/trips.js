import { HttpError } from '../http.js';
import { transaction } from '../db.js';
import { TRIP_SELECT, getTrip, requireTrip } from '../queries.js';
import { escapeLike, parseId, requireDate, requireInt, requireString } from '../validation.js';

export const tripRoutes = [
  {
    // F3 : rechercher un trajet (filtres : origin, destination, date=AAAA-MM-JJ, seats)
    method: 'GET',
    path: '/api/trips',
    handler({ db, query }) {
      const where = ["t.status = 'open'", 't.departure_at > ?'];
      const params = [new Date().toISOString()];

      if (query.origin) {
        where.push("t.origin LIKE ? ESCAPE '\\'");
        params.push(`%${escapeLike(query.origin.trim())}%`);
      }
      if (query.destination) {
        where.push("t.destination LIKE ? ESCAPE '\\'");
        params.push(`%${escapeLike(query.destination.trim())}%`);
      }
      if (query.date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) throw new HttpError(400, 'date doit être au format AAAA-MM-JJ');
        where.push('substr(t.departure_at, 1, 10) = ?');
        params.push(query.date);
      }
      const minSeats = query.seats ? Number(query.seats) : 1;
      if (!Number.isInteger(minSeats) || minSeats < 1) throw new HttpError(400, 'seats doit être un entier positif');

      const rows = db
        .prepare(`${TRIP_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.departure_at ASC LIMIT 200`)
        .all(...params);
      return { body: { trips: rows.filter((trip) => trip.seats_left >= minSeats) } };
    },
  },
  {
    // F5 : mes trajets publiés, avec leurs réservations
    method: 'GET',
    path: '/api/me/trips',
    auth: true,
    handler({ db, user }) {
      const trips = db.prepare(`${TRIP_SELECT} WHERE t.driver_id = ? ORDER BY t.departure_at DESC`).all(user.id);
      const bookingsOf = db.prepare(
        `SELECT b.id, b.passenger_id, p.name AS passenger_name, b.seats, b.status, b.created_at
         FROM bookings b JOIN users p ON p.id = b.passenger_id
         WHERE b.trip_id = ? ORDER BY b.created_at`,
      );
      return { body: { trips: trips.map((trip) => ({ ...trip, bookings: bookingsOf.all(trip.id) })) } };
    },
  },
  {
    method: 'GET',
    path: '/api/trips/:id',
    handler: ({ db, params }) => ({ body: { trip: requireTrip(db, parseId(params.id)) } }),
  },
  {
    // F2 : publier un trajet
    method: 'POST',
    path: '/api/trips',
    auth: true,
    handler({ db, user, body }) {
      if (user.role === 'passenger') {
        throw new HttpError(403, 'Passez votre profil en conducteur pour publier un trajet');
      }
      const origin = requireString(body.origin, 'origin', { min: 2, max: 120 });
      const destination = requireString(body.destination, 'destination', { min: 2, max: 120 });
      if (origin.toLowerCase() === destination.toLowerCase()) {
        throw new HttpError(400, 'Le départ et l\'arrivée doivent être différents');
      }
      const departureAt = requireDate(body.departure_at, 'departure_at');
      if (departureAt <= new Date().toISOString()) throw new HttpError(400, 'departure_at doit être dans le futur');
      const seatsTotal = requireInt(body.seats_total, 'seats_total', { min: 1, max: 8 });
      const price = requireInt(body.price, 'price', { min: 0, max: 1_000_000 });

      const { lastInsertRowid } = db
        .prepare(
          'INSERT INTO trips (driver_id, origin, destination, departure_at, seats_total, price) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(user.id, origin, destination, departureAt, seatsTotal, price);
      return { status: 201, body: { trip: getTrip(db, lastInsertRowid) } };
    },
  },
  {
    // Annuler un trajet : réservé au conducteur, annule aussi les réservations
    method: 'DELETE',
    path: '/api/trips/:id',
    auth: true,
    handler({ db, user, params }) {
      const id = parseId(params.id);
      return transaction(db, () => {
        const trip = requireTrip(db, id);
        if (trip.driver_id !== user.id) throw new HttpError(403, 'Seul le conducteur peut annuler ce trajet');
        if (trip.status === 'cancelled') throw new HttpError(409, 'Ce trajet est déjà annulé');
        db.prepare("UPDATE trips SET status = 'cancelled' WHERE id = ?").run(id);
        db.prepare("UPDATE bookings SET status = 'cancelled' WHERE trip_id = ? AND status = 'confirmed'").run(id);
        return { body: { trip: getTrip(db, id) } };
      });
    },
  },
];
