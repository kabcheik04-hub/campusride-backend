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
    nodeEnv: env.NODE_ENV ?? 'development',
    ...overrides,
  };

  if (!config.jwtSecret) {
    if (config.nodeEnv === 'production') {
      throw new Error('JWT_SECRET est obligatoire en production');
    }
    config.jwtSecret = 'secret-de-developpement-a-changer';
  }
  return config;
}
