import { HttpError } from '../http.js';
import { parseId } from '../validation.js';

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const COLUMNS = 'id, type, message, trip_id, booking_id, read_at, created_at';

const countUnread = (db, userId) =>
  db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;

// Chaque utilisateur ne voit et ne modifie que ses notifications : celles des autres répondent 404
export const notificationRoutes = [
  {
    method: 'GET',
    path: '/api/notifications',
    auth: true,
    handler({ db, user }) {
      const notifications = db
        .prepare(`SELECT ${COLUMNS} FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30`)
        .all(user.id);
      return { body: { notifications, unread_count: countUnread(db, user.id) } };
    },
  },
  {
    method: 'GET',
    path: '/api/notifications/unread-count',
    auth: true,
    handler({ db, user }) {
      return { body: { unread_count: countUnread(db, user.id) } };
    },
  },
  {
    method: 'POST',
    path: '/api/notifications/read-all',
    auth: true,
    handler({ db, user }) {
      const result = db
        .prepare(`UPDATE notifications SET read_at = ${NOW_SQL} WHERE user_id = ? AND read_at IS NULL`)
        .run(user.id);
      return { body: { marked: Number(result.changes), unread_count: 0 } };
    },
  },
  {
    method: 'POST',
    path: '/api/notifications/:id/read',
    auth: true,
    handler({ db, user, params }) {
      const id = parseId(params.id);
      const result = db
        .prepare(`UPDATE notifications SET read_at = COALESCE(read_at, ${NOW_SQL}) WHERE id = ? AND user_id = ?`)
        .run(id, user.id);
      if (result.changes === 0) throw new HttpError(404, 'Notification introuvable');
      return {
        body: {
          notification: db.prepare(`SELECT ${COLUMNS} FROM notifications WHERE id = ?`).get(id),
          unread_count: countUnread(db, user.id),
        },
      };
    },
  },
];