import { HttpError } from '../http.js';
import { transaction } from '../db.js';
import { requireTrip } from '../queries.js';
import { parseId, requireInt } from '../validation.js';

export const bookingRoutes = [
  {
    // F4 : réserver une ou plusieurs places
    method: 'POST',
    path: '/api/trips/:id/bookings',
    auth: true,
    handler({ db, user, params, body }) {
      const tripId = parseId(params.id);
      const seats = requireInt(body.seats ?? 1, 'seats', { min: 1, max: 4 });

      // La transaction empêche deux réservations simultanées de dépasser le nombre de places
      return transaction(db, () => {
        const trip = requireTrip(db, tripId);
        if (trip.status !== 'open') throw new HttpError(409, 'Ce trajet est annulé');
        if (trip.departure_at <= new Date().toISOString()) throw new HttpError(409, 'Ce trajet est déjà parti');
        if (trip.driver_id === user.id) throw new HttpError(403, 'Vous ne pouvez pas réserver votre propre trajet');
        if (
          db
            .prepare("SELECT 1 FROM bookings WHERE trip_id = ? AND passenger_id = ? AND status = 'confirmed'")
            .get(tripId, user.id)
        ) {
          throw new HttpError(409, 'Vous avez déjà réservé ce trajet');
        }
        if (seats > trip.seats_left) {
          throw new HttpError(409, `Il ne reste que ${trip.seats_left} place(s) sur ce trajet`);
        }

        const { lastInsertRowid } = db
          .prepare('INSERT INTO bookings (trip_id, passenger_id, seats) VALUES (?, ?, ?)')
          .run(tripId, user.id, seats);
        const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(lastInsertRowid);
        return { status: 201, body: { booking, seats_left: trip.seats_left - seats } };
      });
    },
  },
  {
    // F4 : annuler sa réservation (libère les places)
    method: 'DELETE',
    path: '/api/bookings/:id',
    auth: true,
    handler({ db, user, params }) {
      const id = parseId(params.id);
      const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
      if (!booking) throw new HttpError(404, 'Réservation introuvable');
      if (booking.passenger_id !== user.id) throw new HttpError(403, 'Cette réservation ne vous appartient pas');
      if (booking.status === 'cancelled') throw new HttpError(409, 'Cette réservation est déjà annulée');

      const trip = requireTrip(db, booking.trip_id);
      if (trip.departure_at <= new Date().toISOString()) {
        throw new HttpError(409, 'Impossible d\'annuler : le trajet est déjà parti');
      }
      db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id);
      return { body: { booking: db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) } };
    },
  },
  {
    // F5 : mes réservations
    method: 'GET',
    path: '/api/me/bookings',
    auth: true,
    handler({ db, user }) {
      const bookings = db
        .prepare(
          `SELECT b.id, b.seats, b.status, b.created_at,
                  t.id AS trip_id, t.origin, t.destination, t.departure_at, t.price, t.status AS trip_status,
                  d.id AS driver_id, d.name AS driver_name
           FROM bookings b
           JOIN trips t ON t.id = b.trip_id
           JOIN users d ON d.id = t.driver_id
           WHERE b.passenger_id = ?
           ORDER BY t.departure_at DESC`,
        )
        .all(user.id);
      return { body: { bookings } };
    },
  },
];
