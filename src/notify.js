// Notifications internes. Ces fonctions s'exécutent dans la transaction de l'action qui les déclenche :
// pas de notification sans action, ni d'action sans notification.

export const tripLabel = (trip) => `${trip.origin} → ${trip.destination}`;

export function userName(db, id) {
  return db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name ?? 'Un utilisateur';
}

export function notify(db, userId, type, message, { tripId = null, bookingId = null } = {}) {
  db.prepare('INSERT INTO notifications (user_id, type, message, trip_id, booking_id) VALUES (?, ?, ?, ?, ?)').run(
    userId,
    type,
    message,
    tripId,
    bookingId,
  );
}

const CANCEL_MESSAGES = {
  driver: (label) => `Le trajet ${label} a été annulé par le conducteur.`,
  admin: (label) => `Le trajet ${label} a été retiré par un administrateur.`,
  suspension: (label) => `Le trajet ${label} a été annulé.`,
};

/**
 * Prévient les passagers ayant une demande active (en attente ou acceptée) sur ce trajet.
 * À appeler AVANT de passer leurs réservations à « cancelled », sinon on ne sait plus qui prévenir.
 * cause : 'driver' | 'admin' | 'suspension'. Si l'admin retire le trajet, le conducteur est prévenu aussi.
 */
export function notifyTripCancelled(db, trip, cause) {
  const label = tripLabel(trip);
  const passengers = db
    .prepare("SELECT DISTINCT passenger_id FROM bookings WHERE trip_id = ? AND status IN ('pending', 'confirmed')")
    .all(trip.id);
  for (const { passenger_id: passengerId } of passengers) {
    notify(db, passengerId, 'trip_cancelled', CANCEL_MESSAGES[cause](label), { tripId: trip.id });
  }
  if (cause === 'admin') {
    notify(db, trip.driver_id, 'trip_removed', `Votre trajet ${label} a été retiré par un administrateur.`, { tripId: trip.id });
  }
}