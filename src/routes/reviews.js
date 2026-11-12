import { HttpError } from '../http.js';
import { isParticipant, requireTrip } from '../queries.js';
import { parseId, requireInt, requireString } from '../validation.js';

export const reviewRoutes = [
  {
    // F6 : donner un avis après un trajet (conducteur et passagers s'évaluent entre eux)
    method: 'POST',
    path: '/api/trips/:id/reviews',
    auth: true,
    handler({ db, user, params, body }) {
      const trip = requireTrip(db, parseId(params.id));
      const targetId = parseId(body.target_id);
      const rating = requireInt(body.rating, 'rating', { min: 1, max: 5 });
      const comment = body.comment ? requireString(body.comment, 'comment', { max: 500 }) : null;

      if (trip.status !== 'open') throw new HttpError(409, 'Ce trajet a été annulé');
      if (trip.departure_at > new Date().toISOString()) {
        throw new HttpError(403, "Vous pourrez donner votre avis une fois le trajet effectué");
      }
      if (targetId === user.id) throw new HttpError(400, 'Vous ne pouvez pas vous noter vous-même');
      if (!isParticipant(db, trip, user.id) || !isParticipant(db, trip, targetId)) {
        throw new HttpError(403, "Seules les personnes ayant participé au trajet peuvent s'évaluer");
      }
      if (
        db
          .prepare('SELECT 1 FROM reviews WHERE trip_id = ? AND author_id = ? AND target_id = ?')
          .get(trip.id, user.id, targetId)
      ) {
        throw new HttpError(409, 'Vous avez déjà donné votre avis sur cette personne pour ce trajet');
      }

      const { lastInsertRowid } = db
        .prepare('INSERT INTO reviews (trip_id, author_id, target_id, rating, comment) VALUES (?, ?, ?, ?, ?)')
        .run(trip.id, user.id, targetId, rating, comment);
      const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(lastInsertRowid);
      return { status: 201, body: { review } };
    },
  },
  {
    // Avis reçus par un utilisateur, avec la note moyenne
    method: 'GET',
    path: '/api/users/:id/reviews',
    handler({ db, params }) {
      const id = parseId(params.id);
      const user = db.prepare('SELECT id, name, photo_url FROM users WHERE id = ?').get(id);
      if (!user) throw new HttpError(404, 'Utilisateur introuvable');

      const reviews = db
        .prepare(
          `SELECT r.id, r.trip_id, r.rating, r.comment, r.created_at, a.id AS author_id, a.name AS author_name
           FROM reviews r JOIN users a ON a.id = r.author_id
           WHERE r.target_id = ? ORDER BY r.created_at DESC`,
        )
        .all(id);
      const average = reviews.length
        ? Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 10) / 10
        : null;
      return { body: { user, average, count: reviews.length, reviews } };
    },
  },
];
