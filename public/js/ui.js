// Outils d'affichage partagés : échappement, formats, icônes, avatars, états, messages

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
export const euro = (price) => (price === 0 ? 'Gratuit' : `${price} €`);
export const fmtRating = (rating) => String(rating).replace('.', ',');
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export function setTitle(title) {
  document.title = title ? `${title} · CampusRide` : 'CampusRide · Le covoiturage entre étudiants';
}

// ---------- Dates (affichées en heure locale) ----------
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const timeOf = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** « Aujourd'hui », « Demain » ou « Samedi 14 novembre ». */
export function dayLabel(iso) {
  const date = new Date(iso);
  const diff = Math.round((startOfDay(date) - startOfDay(new Date())) / 86_400_000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Demain';
  return capitalize(date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
}

/** « Lun 12 · 08:15 ». */
export function shortWhen(iso) {
  const date = new Date(iso);
  const weekday = capitalize(date.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''));
  return `${weekday} ${date.getDate()} · ${timeOf(iso)}`;
}

export function todayISO() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

// ---------- Personnes ----------
export const shortName = (name) => {
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
};

export function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Avatar rond : initiales, recouvertes par la photo si elle existe (et se charge). */
export function avatar(name, photoUrl, size = 'md') {
  const photo = photoUrl ? `<img src="${esc(photoUrl)}" alt="" loading="lazy" data-avatar>` : '';
  return `<span class="avatar avatar-${size}" aria-hidden="true"><span>${esc(initials(name))}</span>${photo}</span>`;
}

export function ratingText(trip) {
  if (!trip.driver_reviews_count) return "Pas encore d'avis";
  return `Note ${fmtRating(trip.driver_rating)} / 5 · ${trip.driver_reviews_count} avis`;
}

// ---------- Icônes (SVG en ligne, décoratives) ----------
const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  star: '<path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z"/>',
  flag: '<path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  logout: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
};

export function icon(name, className = 'icon') {
  return `<svg class="${className}${name === 'star' ? ' star' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

// ---------- Pastilles de statut ----------
export const pill = (kind, label) => {
  const map = { ok: ['pill-ok', 'check'], off: ['pill-off', 'x'], done: ['pill-done', 'flag'], info: ['pill-info', 'user'] };
  const [cls, ic] = map[kind];
  return `<span class="pill ${cls}">${icon(ic, 'icon icon-sm')}${esc(label)}</span>`;
};

// ---------- États : chargement, erreur, liste vide ----------
export const loading = (label = 'Chargement…') =>
  `<div class="state" role="status"><span class="spinner" aria-hidden="true"></span>${esc(label)}</div>`;

export const errorState = (message, { retry = true } = {}) =>
  `<div class="state state-error" role="alert"><p>${esc(message)}</p>${retry ? '<button class="btn btn-secondary" type="button" data-retry>Réessayer</button>' : ''}</div>`;

export const emptyState = (title, text, actionHtml = '') =>
  `<div class="state"><h2>${esc(title)}</h2><p>${esc(text)}</p>${actionHtml}</div>`;

// ---------- Messages et confirmations ----------
let toastTimer;
export function toast(message, type = 'ok') {
  const element = document.getElementById('toast');
  element.textContent = message;
  element.className = `toast show${type === 'error' ? ' toast-error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.className = 'toast';
  }, 4500);
}

/** Demande de confirmation dans une fenêtre accessible. Retourne true si l'utilisateur confirme. */
export function askConfirm({ title, text, confirmLabel, danger = false }) {
  const dialog = document.getElementById('confirm-dialog');
  dialog.setAttribute('aria-labelledby', 'confirm-title');
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="confirm-title">${esc(title)}</h2>
      <p>${esc(text)}</p>
      <div class="dialog-actions">
        <button class="btn btn-secondary" type="submit" value="cancel">Retour</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="submit" value="ok">${esc(confirmLabel)}</button>
      </div>
    </form>`;
  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    dialog.showModal();
  });
}

/** Redessine la page courante (après une annulation, un avis…). */
export const refresh = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
