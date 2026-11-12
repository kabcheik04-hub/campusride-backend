import { HttpError } from './http.js';

/** Chaîne obligatoire, nettoyée des espaces autour, avec une longueur minimale et maximale. */
export function requireString(value, label, { min = 1, max = 200 } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, `${label} est obligatoire`);
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new HttpError(400, `${label} doit contenir entre ${min} et ${max} caractères`);
  }
  return text;
}

/** Entier obligatoire compris entre min et max (inclus). */
export function requireInt(value, label, { min, max }) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, `${label} doit être un entier entre ${min} et ${max}`);
  }
  return value;
}

/** Identifiant présent dans l'URL : entier strictement positif. */
export function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Identifiant invalide');
  return id;
}

/** Date ISO valide, retournée au format UTC normalisé. */
export function requireDate(value, label) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(time)) throw new HttpError(400, `${label} doit être une date valide (format ISO 8601)`);
  return new Date(time).toISOString();
}

/** Protège les caractères spéciaux d'une recherche LIKE. */
export function escapeLike(text) {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
