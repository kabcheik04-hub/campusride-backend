import http from 'node:http';
import { verifyToken } from './auth.js';
import { openDb } from './db.js';
import { HttpError, readJson, sendJson } from './http.js';
import { routes } from './routes/index.js';

// Transforme "/api/trips/:id" en expression régulière avec un groupe nommé "id"
const compiledRoutes = routes.map((route) => ({
  ...route,
  regex: new RegExp(`^${route.path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`),
}));

function findRoute(method, pathname) {
  let pathExists = false;
  for (const route of compiledRoutes) {
    const match = route.regex.exec(pathname);
    if (!match) continue;
    pathExists = true;
    if (route.method === method) return { route, params: { ...match.groups } };
  }
  if (pathExists) throw new HttpError(405, 'Méthode non autorisée');
  throw new HttpError(404, 'Route introuvable');
}

function authenticate(req, db, config) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? verifyToken(token, config.jwtSecret) : null;
  const user = payload ? db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub) : null;
  if (!user) throw new HttpError(401, 'Authentification requise');
  return user;
}

export function createApp({ db, config }) {
  const headers = {
    'Access-Control-Allow-Origin': config.corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };

  return async function handle(req, res) {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, headers);
        res.end();
        return;
      }

      const url = new URL(req.url, 'http://localhost');
      const { route, params } = findRoute(req.method, url.pathname);
      const user = route.auth ? authenticate(req, db, config) : null;

      const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : {};
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, 'Le corps de la requête doit être un objet JSON');
      }

      const result = await route.handler({
        db,
        config,
        user,
        params,
        body,
        query: Object.fromEntries(url.searchParams),
      });
      sendJson(res, result.status ?? 200, result.body, headers);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message }, headers);
      } else {
        console.error(error);
        sendJson(res, 500, { error: 'Erreur interne du serveur' }, headers);
      }
    }
  };
}

/** Crée le serveur HTTP et sa base de données (utilisé par server.js et par les tests). */
export function createServer(config) {
  const db = openDb(config.dbPath);
  const server = http.createServer(createApp({ db, config }));
  server.on('close', () => db.close());
  return { server, db };
}
