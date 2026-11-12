/** Erreur renvoyée telle quelle au client avec son code HTTP. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

/** Lit le corps de la requête en JSON (limité à 100 Ko). Corps vide = objet vide. */
export async function readJson(req, limit = 100_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Corps de requête trop volumineux');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
}
