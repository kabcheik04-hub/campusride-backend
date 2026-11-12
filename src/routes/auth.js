import { hashPassword, signToken, verifyPassword } from '../auth.js';
import { HttpError } from '../http.js';
import { requireString } from '../validation.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['driver', 'passenger', 'both'];

const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  photo_url: user.photo_url,
  created_at: user.created_at,
});

function parseRole(role) {
  if (!ROLES.includes(role)) throw new HttpError(400, `role doit valoir ${ROLES.join(', ')}`);
  return role;
}

function parsePhotoUrl(value) {
  if (value === null || value === '') return null;
  const url = requireString(value, 'photo_url', { max: 500 });
  if (!/^https?:\/\//i.test(url)) throw new HttpError(400, 'photo_url doit commencer par http:// ou https://');
  return url;
}

export const authRoutes = [
  {
    // F1 : inscription
    method: 'POST',
    path: '/api/auth/register',
    handler({ db, config, body }) {
      const email = requireString(body.email, 'email', { max: 254 }).toLowerCase();
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'email invalide');
      if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 200) {
        throw new HttpError(400, 'Le mot de passe doit contenir entre 8 et 200 caractères');
      }
      const name = requireString(body.name, 'nom', { min: 2, max: 80 });
      const role = parseRole(body.role ?? 'both');

      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
        throw new HttpError(409, 'Cet email est déjà utilisé');
      }
      const { lastInsertRowid } = db
        .prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)')
        .run(email, hashPassword(body.password), name, role);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);

      return {
        status: 201,
        body: { token: signToken({ sub: user.id }, config.jwtSecret, config.jwtTtlSeconds), user: publicUser(user) },
      };
    },
  },
  {
    // F1 : connexion
    method: 'POST',
    path: '/api/auth/login',
    handler({ db, config, body }) {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user || typeof body.password !== 'string' || !verifyPassword(body.password, user.password_hash)) {
        throw new HttpError(401, 'Email ou mot de passe incorrect');
      }
      return {
        body: { token: signToken({ sub: user.id }, config.jwtSecret, config.jwtTtlSeconds), user: publicUser(user) },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    auth: true,
    handler: ({ user }) => ({ body: { user: publicUser(user) } }),
  },
  {
    // Mise à jour du profil : nom, rôle, photo
    method: 'PATCH',
    path: '/api/me',
    auth: true,
    handler({ db, user, body }) {
      const name = body.name === undefined ? user.name : requireString(body.name, 'nom', { min: 2, max: 80 });
      const role = body.role === undefined ? user.role : parseRole(body.role);
      const photoUrl = body.photo_url === undefined ? user.photo_url : parsePhotoUrl(body.photo_url);
      db.prepare('UPDATE users SET name = ?, role = ?, photo_url = ? WHERE id = ?').run(name, role, photoUrl, user.id);
      return { body: { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) } };
    },
  },
];
