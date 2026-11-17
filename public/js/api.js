// Session (jeton et profil gardés dans le navigateur) et appels à l'API

const TOKEN_KEY = 'campusride.token';
const USER_KEY = 'campusride.user';

// Le stockage peut être indisponible (navigation privée) : on ne plante jamais
const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* stockage indisponible : la session ne survivra pas à un rechargement */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* idem */
    }
  },
};

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

const memory = { token: storage.get(TOKEN_KEY), user: parseJson(storage.get(USER_KEY)) };

export const session = {
  get token() {
    return memory.token;
  },
  get user() {
    return memory.user;
  },
  save(token, user) {
    memory.token = token;
    memory.user = user;
    storage.set(TOKEN_KEY, token);
    storage.set(USER_KEY, JSON.stringify(user));
  },
  update(user) {
    memory.user = user;
    storage.set(USER_KEY, JSON.stringify(user));
  },
  clear() {
    memory.token = null;
    memory.user = null;
    storage.remove(TOKEN_KEY);
    storage.remove(USER_KEY);
  },
};

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Appelle l'API (/api + path). Lève une ApiError avec le message en français renvoyé par le serveur. */
export async function api(method, path, body) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Le serveur ne répond pas. Vérifiez votre connexion et réessayez.', 0);
  }

  const data = await response.json().catch(() => null);
  if (response.status === 401 && session.token) {
    session.clear();
    window.dispatchEvent(new Event('session-expired'));
  }
  if (!response.ok) throw new ApiError(data?.error ?? `Erreur ${response.status}`, response.status);
  return data;
}
