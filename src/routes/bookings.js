import { HttpError } from '../http.js';
import { notify, tripLabel, userName } from '../notify.js';
import { transaction } from '../db.js';
import { requireTrip } from '../queries.js';
import { parseId, requireInt } from '../validation.js';

const STATUS_LABELS = { pending: 'en attente', confirmed: 'acceptée', refused: 'refusée', cancelled: 'annulée' };

/**
 * Charge une demande pour que son conducteur y réponde. À appeler dans une transaction.
 * Ordre des contrôles : existence (404), droits (403), puis état (409).
 */
function loadPendingRequest(db, user, params) {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(parseId(params.id));
  if (!booking) throw new HttpError(404, 'Réservation introuvable');
  const trip = requireTrip(db, booking.trip_id);
  if (trip.driver_id !== user.id) throw new HttpError(403, 'Seul le conducteur de ce trajet peut répondre à cette demande');
  if (booking.status !== 'pending') {
    throw new HttpError(409, `Cette demande a déjà été traitée (statut : ${STATUS_LABELS[booking.status]})`);
  }
  if (trip.status !== 'open') throw new HttpError(409, 'Ce trajet est annulé');
  if (trip.departure_at <= new Date().toISOString()) throw new HttpError(409, 'Ce trajet est déjà parti');
  return { booking, trip };
}

export const bookingRoutes = [
  {
    // F4 : demander une ou plusieurs places (la demande reste « en attente » jusqu'à la réponse du conducteur)
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
            .prepare("SELECT 1 FROM bookings WHERE trip_id = ? AND passenger_id = ? AND status IN ('pending', 'confirmed')")
            .get(tripId, user.id)
        ) {
          throw new HttpError(409, 'Vous avez déjà une demande en cours ou une réservation sur ce trajet');
        }
        if (seats > trip.seats_left) {
          throw new HttpError(409, `Il ne reste que ${trip.seats_left} place(s) sur ce trajet`);
        }

        const { lastInsertRowid } = db
          .prepare('INSERT INTO bookings (trip_id, passenger_id, seats) VALUES (?, ?, ?)')
          .run(tripId, user.id, seats);
        const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(lastInsertRowid);
        notify(
          db,
          trip.driver_id,
          'booking_request',
          `${userName(db, user.id)} demande ${seats} place${seats > 1 ? 's' : ''} sur ${tripLabel(trip)}.`,
          { tripId, bookingId: booking.id },
        );
        // Une demande en attente ne retire aucune place : seul le conducteur, en acceptant, les attribue
        return { status: 201, body: { booking, seats_left: trip.seats_left } };
      });
    },
  },
  {
    // F4 : annuler sa demande ou sa réservation (libère les places si elle était acceptée)
    method: 'DELETE',
    path: '/api/bookings/:id',
    auth: true,
    handler({ db, user, params }) {
      const id = parseId(params.id);
      // Lecture, contrôles et mise à jour dans une même transaction : pas de course avec une autre annulation
      return transaction(db, () => {
        const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
        if (!booking) throw new HttpError(404, 'Réservation introuvable');
        if (booking.passenger_id !== user.id) throw new HttpError(403, 'Cette réservation ne vous appartient pas');
        if (booking.status === 'cancelled') throw new HttpError(409, 'Cette réservation est déjà annulée');
        if (booking.status === 'refused') throw new HttpError(409, 'Cette demande a été refusée par le conducteur');

        const trip = requireTrip(db, booking.trip_id);
        if (trip.departure_at <= new Date().toISOString()) {
          throw new HttpError(409, 'Impossible d\'annuler : le trajet est déjà parti');
        }
        db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id);
        notify(
          db,
          trip.driver_id,
          'booking_cancelled',
          `${userName(db, user.id)} a annulé ${booking.status === 'pending' ? 'sa demande' : 'sa réservation'} pour ${tripLabel(trip)}.`,
          { tripId: trip.id, bookingId: id },
        );
        return { body: { booking: db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) } };
      });
    },
  },
  {
    // Le conducteur accepte une demande : la capacité est revérifiée dans la transaction
    method: 'PATCH',
    path: '/api/bookings/:id/accept',
    auth: true,
    handler({ db, user, params }) {
      return transaction(db, () => {
        const { booking, trip } = loadPendingRequest(db, user, params);
        if (booking.seats > trip.seats_left) {
          throw new HttpError(409, `Il ne reste que ${trip.seats_left} place(s) : impossible d'accepter cette demande`);
        }
        db.prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ?").run(booking.id);
        notify(db, booking.passenger_id, 'booking_accepted', `Votre demande pour ${tripLabel(trip)} a été acceptée.`, {
          tripId: trip.id,
          bookingId: booking.id,
        });
        return {
          body: {
            booking: db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id),
            seats_left: trip.seats_left - booking.seats,
          },
        };
      });
    },
  },
  {
    // Le conducteur refuse une demande
    method: 'PATCH',
    path: '/api/bookings/:id/refuse',
    auth: true,
    handler({ db, user, params }) {
      return transaction(db, () => {
        const { booking, trip } = loadPendingRequest(db, user, params);
        db.prepare("UPDATE bookings SET status = 'refused' WHERE id = ?").run(booking.id);
        notify(db, booking.passenger_id, 'booking_refused', `Votre demande pour ${tripLabel(trip)} a été refusée.`, {
          tripId: trip.id,
          bookingId: booking.id,
        });
        return {
          body: { booking: db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id), seats_left: trip.seats_left },
        };
      });
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
                  CASE WHEN t.status = 'cancelled' THEN 'cancelled'
                       WHEN t.departure_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 'done'
                       ELSE 'open' END AS trip_state,
                  d.id AS driver_id, d.name AS driver_name, d.photo_url AS driver_photo_url
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
