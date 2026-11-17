/**
 * Limiteur de tentatives de connexion, en mémoire : au-delà de `max` échecs par adresse IP
 * pendant la fenêtre `windowSeconds`, les tentatives suivantes sont refusées (429).
 * Seuls les échecs comptent : un utilisateur légitime n'est jamais bloqué par ses connexions réussies.
 * Limite : le compteur est perdu au redémarrage et propre à chaque processus (suffisant ici ;
 * en multi-serveurs, il faudrait un stockage partagé comme Redis).
 */
export function createRateLimiter({ max, windowSeconds }) {
  const failures = new Map(); // clé -> { count, resetAt }

  function current(key, now) {
    const entry = failures.get(key);
    if (entry && entry.resetAt <= now) {
      failures.delete(key);
      return null;
    }
    return entry ?? null;
  }

  return {
    /** Secondes à attendre si la clé est bloquée, sinon 0. */
    retryAfter(key, now = Date.now()) {
      const entry = current(key, now);
      return entry && entry.count >= max ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : 0;
    },
    fail(key, now = Date.now()) {
      const entry = current(key, now);
      if (entry) entry.count += 1;
      else failures.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      // Nettoyage opportuniste pour que la table ne grossisse pas indéfiniment
      if (failures.size > 10_000) for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
    },
  };
}
