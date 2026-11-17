import { DUMMY_HASH, hashPassword, signToken, verifyPassword } from '../auth.js';
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
  is_admin: Boolean(user.is_admin),
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
      const photoUrl = body.photo_url ? parsePhotoUrl(body.photo_url) : null;

      // Profil « vérifié par l'e-mail de l'établissement » : seuls les domaines autorisés peuvent s'inscrire
      const domains = config.allowedEmailDomains;
      const emailDomain = email.split('@')[1];
      if (domains.length && !domains.some((d) => emailDomain === d || emailDomain.endsWith(`.${d}`))) {
        throw new HttpError(400, `Utilisez l'adresse e-mail de votre établissement (${domains.map((d) => `@${d}`).join(', ')})`);
      }

      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
        throw new HttpError(409, 'Cet email est déjà utilisé');
      }
      const { lastInsertRowid } = db
        .prepare('INSERT INTO users (email, password_hash, name, role, photo_url) VALUES (?, ?, ?, ?, ?)')
        .run(email, hashPassword(body.password), name, role, photoUrl);
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
    handler({ db, config, body, ip, loginLimiter }) {
      const wait = loginLimiter.retryAfter(ip);
      if (wait) {
        const minutes = Math.ceil(wait / 60);
        throw new HttpError(429, `Trop de tentatives de connexion. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`, {
          'Retry-After': String(wait),
        });
      }
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      // Même coût de calcul que l'e-mail existe ou non : évite de deviner quels comptes existent par le temps de réponse
      const password = typeof body.password === 'string' ? body.password : '';
      const valid = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
      if (!user || !valid) {
        loginLimiter.fail(ip);
        throw new HttpError(401, 'Email ou mot de passe incorrect');
      }
      // Après la vérification du mot de passe : l'état du compte n'est révélé qu'à son propriétaire
      if (user.suspended_at) {
        throw new HttpError(403, 'Votre compte a été suspendu. Contactez un administrateur.', undefined, 'account_suspended');
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
