import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * Lit la configuration depuis le fichier .env (s'il existe) et les variables d'environnement.
 * `overrides` permet aux tests de forcer des valeurs.
 */
export function loadConfig(overrides = {}) {
  try {
    process.loadEnvFile();
  } catch {
    // Pas de fichier .env : on utilise uniquement les variables du système.
  }

  const env = process.env;
  const config = {
    port: Number(env.PORT ?? 3000),
    dbPath: env.DB_PATH ?? resolve('data/campusride.db'),
    jwtSecret: env.JWT_SECRET,
    jwtTtlSeconds: Number(env.JWT_TTL_SECONDS ?? 60 * 60 * 24 * 7),
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
    // Domaines d'e-mail acceptés à l'inscription (ex. "univ-lyon.fr,etu.univ-lyon.fr"). Vide = tous acceptés.
    allowedEmailDomains: (env.ALLOWED_EMAIL_DOMAINS ?? '')
      .split(',')
      .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean),
    // Limite de tentatives de connexion échouées par adresse IP et par fenêtre de temps
    loginMaxAttempts: Number(env.LOGIN_MAX_ATTEMPTS ?? 10),
    loginWindowSeconds: Number(env.LOGIN_WINDOW_SECONDS ?? 15 * 60),
    nodeEnv: env.NODE_ENV ?? 'development',
    ...overrides,
  };

  if (!config.jwtSecret) {
    if (config.nodeEnv === 'production') {
      throw new Error('JWT_SECRET est obligatoire en production');
    }
    // Secret aléatoire propre à ce lancement : aucun secret connu n'existe dans le code.
    // Conséquence : les sessions ne survivent pas à un redémarrage tant que JWT_SECRET n'est pas défini.
    config.jwtSecret = randomBytes(32).toString('hex');
    if (config.nodeEnv !== 'test') {
      console.warn('[CampusRide] JWT_SECRET non défini : secret aléatoire généré, les connexions seront perdues au redémarrage.');
    }
  }
  return config;
}
