import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Hache un mot de passe avec scrypt et un sel aléatoire : "sel:hash" en hexadécimal. */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = (data, secret) => createHmac('sha256', secret).update(data).digest('base64url');

/** Crée un jeton JWT (HS256) valable `ttlSeconds` secondes. */
export function signToken(payload, secret, ttlSeconds) {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds });
  return `${header}.${body}.${sign(`${header}.${body}`, secret)}`;
}

/** Retourne le contenu du jeton s'il est valide et non expiré, sinon null. */
export function verifyToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;

  const expected = Buffer.from(sign(`${header}.${body}`, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}
