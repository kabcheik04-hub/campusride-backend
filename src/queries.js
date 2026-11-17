import { HttpError } from './http.js';

/**
 * Requête de base pour lire un trajet : ajoute le nom et la note moyenne du conducteur
 * et calcule le nombre de places encore libres (places totales - réservations acceptées ; les demandes en attente ne bloquent aucune place).
 */
export const TRIP_SELECT = `
  SELECT t.id, t.driver_id, u.name AS driver_name, u.photo_url AS driver_photo_url,
         (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.target_id = t.driver_id) AS driver_rating,
         (SELECT COUNT(*) FROM reviews r WHERE r.target_id = t.driver_id) AS driver_reviews_count,
         t.origin, t.destination, t.departure_at, t.seats_total, t.price, t.status, t.created_at,
         CASE WHEN t.status = 'cancelled' THEN 'cancelled'
              WHEN t.departure_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 'done'
              ELSE 'open' END AS state,
         t.seats_total - COALESCE(
           (SELECT SUM(b.seats) FROM bookings b WHERE b.trip_id = t.id AND b.status = 'confirmed'), 0
         ) AS seats_left
  FROM trips t
  JOIN users u ON u.id = t.driver_id`;

export function getTrip(db, id) {
  return db.prepare(`${TRIP_SELECT} WHERE t.id = ?`).get(id);
}

export function requireTrip(db, id) {
  const trip = getTrip(db, id);
  if (!trip) throw new HttpError(404, 'Trajet introuvable');
  return trip;
}

/** Vrai si l'utilisateur est le conducteur du trajet ou un passager avec une réservation confirmée. */
export function isParticipant(db, trip, userId) {
  if (trip.driver_id === userId) return true;
  return Boolean(
    db
      .prepare("SELECT 1 FROM bookings WHERE trip_id = ? AND passenger_id = ? AND status = 'confirmed'")
      .get(trip.id, userId),
  );
}
