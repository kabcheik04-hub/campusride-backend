import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// Pages du front-end (dossier public/), servies par la même application
const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname, headers) {
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Adresse invalide');
  }
  if (relative === '/') relative = '/index.html';

  // Le fichier doit rester dans public/ : bloque les adresses du type ../../secret
  const file = resolve(PUBLIC_DIR, `.${relative}`);
  const type = MIME_TYPES[extname(file)];
  if (!type || !file.startsWith(PUBLIC_DIR + sep) || !existsSync(file) || !statSync(file).isFile()) {
    throw new HttpError(404, 'Page introuvable');
  }
  res.writeHead(200, {
    ...headers,
    'Content-Type': type,
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; frame-ancestors 'none'",
  });
  res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
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
      if ((req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api')) {
        serveStatic(req, res, url.pathname, headers);
        return;
      }
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
        // Après un corps trop gros, la requête n'a pas été lue en entier : on ferme la connexion
        const extra = error.status === 413 ? { Connection: 'close' } : {};
        sendJson(res, error.status, { error: error.message }, { ...headers, ...extra });
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
