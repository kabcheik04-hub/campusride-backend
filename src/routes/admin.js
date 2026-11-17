// Administration : modération des signalements, des comptes, des trajets et des avis.
// Toutes ces routes exigent `admin: true` (vérifié dans app.js) et chaque action est écrite dans le journal.

import { HttpError } from '../http.js';
import { transaction } from '../db.js';
import { requireTrip } from '../queries.js';
import { escapeLike, parseId, requireString } from '../validation.js';

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function logAction(db, admin, action, targetType, targetId, details = null) {
  db.prepare('INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)').run(
    admin.id,
    action,
    targetType,
    targetId,
    details,
  );
}

/** Quand l'admin agit sur une cible, les signalements ouverts qui la concernent sont classés. */
function resolveReportsFor(db, admin, targetType, targetId) {
  db.prepare(
    `UPDATE reports SET status = 'resolved', resolved_at = ${NOW_SQL}, resolved_by = ?
     WHERE target_type = ? AND target_id = ? AND status = 'open'`,
  ).run(admin.id, targetType, targetId);
}

function cancelTripWithBookings(db, tripId) {
  db.prepare("UPDATE trips SET status = 'cancelled' WHERE id = ?").run(tripId);
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE trip_id = ? AND status IN ('pending', 'confirmed')").run(tripId);
}

const adminUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  is_admin: Boolean(u.is_admin),
  suspended_at: u.suspended_at,
  created_at: u.created_at,
});

const TARGET_SUMMARIES = {
  user: (db, id) => db.prepare('SELECT id, name, email, suspended_at, is_admin FROM users WHERE id = ?').get(id),
  trip: (db, id) =>
    db
      .prepare(
        `SELECT t.id, t.origin, t.destination, t.departure_at, t.status, t.driver_id, d.name AS driver_name
         FROM trips t JOIN users d ON d.id = t.driver_id WHERE t.id = ?`,
      )
      .get(id),
  review: (db, id) =>
    db
      .prepare(
        `SELECT r.id, r.rating, r.comment, r.trip_id, a.id AS author_id, a.name AS author_name, u.name AS target_name
         FROM reviews r JOIN users a ON a.id = r.author_id JOIN users u ON u.id = r.target_id WHERE r.id = ?`,
      )
      .get(id),
};

export const adminRoutes = [
  {
    // File de signalements (par défaut : les ouverts, du plus ancien au plus récent)
    method: 'GET',
    path: '/api/admin/reports',
    auth: true,
    admin: true,
    handler({ db, query }) {
      const status = query.status ?? 'open';
      if (!['open', 'resolved', 'all'].includes(status)) throw new HttpError(400, 'status doit valoir open, resolved ou all');
      const rows = db
        .prepare(
          `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at, r.resolved_at,
                  p.id AS reporter_id, p.name AS reporter_name
           FROM reports r JOIN users p ON p.id = r.reporter_id
           WHERE (? = 'all' OR r.status = ?)
           ORDER BY CASE WHEN r.status = 'open' THEN 0 ELSE 1 END, r.created_at ${status === 'open' ? 'ASC' : 'DESC'}
           LIMIT 100`,
        )
        .all(status, status);
      const reports = rows.map((row) => ({ ...row, target: TARGET_SUMMARIES[row.target_type](db, row.target_id) ?? null }));
      return { body: { reports } };
    },
  },
  {
    method: 'PATCH',
    path: '/api/admin/reports/:id/resolve',
    auth: true,
    admin: true,
    handler({ db, user, params }) {
      const id = parseId(params.id);
      return transaction(db, () => {
        const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
        if (!report) throw new HttpError(404, 'Signalement introuvable');
        if (report.status === 'resolved') throw new HttpError(409, 'Ce signalement est déjà classé');
        db.prepare(`UPDATE reports SET status = 'resolved', resolved_at = ${NOW_SQL}, resolved_by = ? WHERE id = ?`).run(user.id, id);
        logAction(db, user, 'resolve_report', report.target_type, report.target_id, `signalement n°${id}`);
        return { body: { report: db.prepare('SELECT * FROM reports WHERE id = ?').get(id) } };
      });
    },
  },
  {
    // Recherche d'utilisateurs (nom ou e-mail)
    method: 'GET',
    path: '/api/admin/users',
    auth: true,
    admin: true,
    handler({ db, query }) {
      const q = (query.q ?? '').trim().slice(0, 100);
      const like = `%${escapeLike(q)}%`;
      const users = db
        .prepare(
          `SELECT u.*, (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'user' AND r.target_id = u.id AND r.status = 'open') AS open_reports
           FROM users u
           WHERE (? = '' OR u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')
           ORDER BY u.created_at DESC, u.id DESC LIMIT 100`,
        )
        .all(q, like, like);
      return { body: { users: users.map((u) => ({ ...adminUser(u), open_reports: u.open_reports })) } };
    },
  },
  {
    // Suspendre un compte : accès coupé tout de suite, trajets à venir et réservations à venir annulés
    method: 'POST',
    path: '/api/admin/users/:id/suspend',
    auth: true,
    admin: true,
    handler({ db, user, params, body }) {
      const id = parseId(params.id);
      const reason = body.reason ? requireString(body.reason, 'reason', { max: 200 }) : null;
      return transaction(db, () => {
        const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (!target) throw new HttpError(404, 'Utilisateur introuvable');
        if (target.id === user.id) throw new HttpError(409, 'Vous ne pouvez pas suspendre votre propre compte');
        if (target.is_admin) throw new HttpError(409, 'Un administrateur ne peut pas être suspendu');
        if (target.suspended_at) throw new HttpError(409, 'Ce compte est déjà suspendu');

        db.prepare(`UPDATE users SET suspended_at = ${NOW_SQL} WHERE id = ?`).run(id);
        const upcoming = db
          .prepare(`SELECT id FROM trips WHERE driver_id = ? AND status = 'open' AND departure_at > ${NOW_SQL}`)
          .all(id);
        for (const trip of upcoming) cancelTripWithBookings(db, trip.id);
        db.prepare(
          `UPDATE bookings SET status = 'cancelled'
           WHERE passenger_id = ? AND status IN ('pending', 'confirmed')
             AND trip_id IN (SELECT id FROM trips WHERE status = 'open' AND departure_at > ${NOW_SQL})`,
        ).run(id);

        resolveReportsFor(db, user, 'user', id);
        logAction(db, user, 'suspend_user', 'user', id, reason);
        return { body: { user: adminUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)), cancelled_trips: upcoming.length } };
      });
    },
  },
  {
    method: 'POST',
    path: '/api/admin/users/:id/unsuspend',
    auth: true,
    admin: true,
    handler({ db, user, params }) {
      const id = parseId(params.id);
      return transaction(db, () => {
        const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (!target) throw new HttpError(404, 'Utilisateur introuvable');
        if (!target.suspended_at) throw new HttpError(409, 'Ce compte n\'est pas suspendu');
        db.prepare('UPDATE users SET suspended_at = NULL WHERE id = ?').run(id);
        logAction(db, user, 'unsuspend_user', 'user', id);
        return { body: { user: adminUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) } };
      });
    },
  },
  {
    // Avis récents, pour repérer et supprimer un avis abusif
    method: 'GET',
    path: '/api/admin/reviews',
    auth: true,
    admin: true,
    handler({ db }) {
      const reviews = db
        .prepare(
          `SELECT r.id, r.trip_id, r.rating, r.comment, r.created_at,
                  a.id AS author_id, a.name AS author_name, u.id AS target_id, u.name AS target_name
           FROM reviews r JOIN users a ON a.id = r.author_id JOIN users u ON u.id = r.target_id
           ORDER BY r.created_at DESC, r.id DESC LIMIT 50`,
        )
        .all();
      return { body: { reviews } };
    },
  },
  {
    method: 'DELETE',
    path: '/api/admin/reviews/:id',
    auth: true,
    admin: true,
    handler({ db, user, params }) {
      const id = parseId(params.id);
      return transaction(db, () => {
        const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
        if (!review) throw new HttpError(404, 'Avis introuvable');
        db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
        resolveReportsFor(db, user, 'review', id);
        logAction(db, user, 'delete_review', 'review', id, `note ${review.rating}/5, auteur n°${review.author_id}`);
        return { body: { deleted: true } };
      });
    },
  },
  {
    // « Supprimer » un trajet = le retirer : annulé, réservations annulées, historique conservé
    method: 'DELETE',
    path: '/api/admin/trips/:id',
    auth: true,
    admin: true,
    handler({ db, user, params }) {
      const id = parseId(params.id);
      return transaction(db, () => {
        const trip = requireTrip(db, id);
        if (trip.status === 'cancelled') throw new HttpError(409, 'Ce trajet est déjà annulé');
        if (trip.departure_at <= new Date().toISOString()) throw new HttpError(409, 'Ce trajet est déjà parti');
        cancelTripWithBookings(db, id);
        resolveReportsFor(db, user, 'trip', id);
        logAction(db, user, 'remove_trip', 'trip', id, `${trip.origin} → ${trip.destination}, conducteur n°${trip.driver_id}`);
        return { body: { trip: requireTrip(db, id) } };
      });
    },
  },
  {
    method: 'GET',
    path: '/api/admin/actions',
    auth: true,
    admin: true,
    handler({ db }) {
      const actions = db
        .prepare(
          `SELECT a.id, a.action, a.target_type, a.target_id, a.details, a.created_at, u.name AS admin_name
           FROM admin_actions a JOIN users u ON u.id = a.admin_id
           ORDER BY a.id DESC LIMIT 50`,
        )
        .all();
      return { body: { actions } };
    },
  },
];
