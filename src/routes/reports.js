import { HttpError } from '../http.js';
import { transaction } from '../db.js';
import { parseId, requireString } from '../validation.js';

const TARGET_TYPES = ['user', 'trip', 'review'];
const REASONS = ['inappropriate', 'spam', 'dangerous', 'fraud', 'other'];

// Pour chaque type de cible : comment la retrouver et qui en est l'auteur (on ne se signale pas soi-même)
const OWNER_QUERIES = {
  user: 'SELECT id AS owner_id FROM users WHERE id = ?',
  trip: 'SELECT driver_id AS owner_id FROM trips WHERE id = ?',
  review: 'SELECT author_id AS owner_id FROM reviews WHERE id = ?',
};

export const reportRoutes = [
  {
    // Signaler un utilisateur, un trajet ou un avis
    method: 'POST',
    path: '/api/reports',
    auth: true,
    handler({ db, user, body }) {
      if (!TARGET_TYPES.includes(body.target_type)) {
        throw new HttpError(400, `target_type doit valoir ${TARGET_TYPES.join(', ')}`);
      }
      if (!REASONS.includes(body.reason)) throw new HttpError(400, `reason doit valoir ${REASONS.join(', ')}`);
      const targetId = parseId(body.target_id);
      const details = body.details ? requireString(body.details, 'details', { max: 500 }) : null;

      return transaction(db, () => {
        const target = db.prepare(OWNER_QUERIES[body.target_type]).get(targetId);
        if (!target) throw new HttpError(404, 'Élément à signaler introuvable');
        if (target.owner_id === user.id) {
          throw new HttpError(400, 'Vous ne pouvez pas vous signaler vous-même ni signaler vos propres contenus');
        }
        const already = db
          .prepare("SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'")
          .get(user.id, body.target_type, targetId);
        if (already) throw new HttpError(409, 'Vous avez déjà signalé cet élément : un administrateur va l\'examiner');

        const { lastInsertRowid } = db
          .prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?)')
          .run(user.id, body.target_type, targetId, body.reason, details);
        const report = db
          .prepare('SELECT id, target_type, target_id, reason, status, created_at FROM reports WHERE id = ?')
          .get(lastInsertRowid);
        return { status: 201, body: { report } };
      });
    },
  },
];
