// Cloche de notifications : compteur de non-lues, panneau déroulant, rafraîchissement toutes les 30 s

import { api, session } from './api.js';
import { esc } from './ui.js';

const POLL_MS = 30_000;

// Où mène chaque type de notification (Mon espace, onglet conducteur ou passager)
const TARGETS = {
  booking_request: '#/dashboard/published',
  booking_cancelled: '#/dashboard/published',
  trip_removed: '#/dashboard/published',
  booking_accepted: '#/dashboard/booked',
  booking_refused: '#/dashboard/booked',
  trip_cancelled: '#/dashboard/booked',
};

const BELL_SVG =
  '<svg class="icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

const TEMPLATE = `
<button type="button" class="bell-btn" id="bell-toggle" aria-label="Notifications" aria-expanded="false" aria-controls="bell-panel">
  ${BELL_SVG}<span class="bell-badge" id="bell-badge" aria-hidden="true" hidden>0</span>
</button>
<div class="bell-panel" id="bell-panel" role="region" aria-label="Notifications" hidden>
  <div class="bell-head">
    <h2>Notifications</h2>
    <button type="button" class="bell-readall" id="bell-read-all" hidden>Tout marquer comme lu</button>
  </div>
  <ul class="bell-list" id="bell-list"></ul>
</div>
<span class="bell-sr" id="bell-live" role="status" aria-live="polite"></span>`;

let root = null;
let timer = null;
let currentUserId = null;
let known = false; // le premier relevé ne doit pas être « annoncé » comme une nouveauté
let unread = 0;
let items = [];
let open = false;

const $ = (id) => root.querySelector(`#${id}`);
const formatDate = (iso) =>
  new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function renderCount(announce = false) {
  const badge = $('bell-badge');
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.hidden = unread === 0;
  $('bell-toggle').setAttribute(
    'aria-label',
    unread === 0 ? 'Notifications' : `Notifications, ${unread} non lue${unread > 1 ? 's' : ''}`,
  );
  $('bell-read-all').hidden = unread === 0;
  if (announce) {
    const live = $('bell-live');
    live.textContent = 'Nouvelle notification';
    setTimeout(() => {
      live.textContent = '';
    }, 3000);
  }
}

function renderList() {
  $('bell-list').innerHTML = items.length
    ? items
        .map(
          (n) => `<li><a class="bell-item${n.read_at ? '' : ' is-unread'}" href="${TARGETS[n.type] ?? '#/dashboard'}" data-id="${n.id}">
  ${n.read_at ? '' : '<span class="bell-sr">Non lue. </span>'}<span class="bell-msg">${esc(n.message)}</span>
  <time class="bell-time" datetime="${esc(n.created_at)}">${esc(formatDate(n.created_at))}</time></a></li>`,
        )
        .join('')
    : '<li class="bell-empty">Aucune notification pour le moment.</li>';
}

async function loadList() {
  const uid = currentUserId;
  try {
    const data = await api('GET', '/notifications');
    if (uid !== currentUserId) return;
    items = data.notifications;
    unread = data.unread_count;
    renderCount();
    renderList();
  } catch {
    if (uid === currentUserId) $('bell-list').innerHTML = '<li class="bell-empty">Impossible de charger les notifications.</li>';
  }
}

async function pollCount() {
  const uid = currentUserId;
  try {
    const data = await api('GET', '/notifications/unread-count');
    if (uid !== currentUserId) return;
    const increased = known && data.unread_count > unread;
    known = true;
    unread = data.unread_count;
    renderCount(increased && !open);
    if (open && increased) await loadList();
  } catch {
    /* silencieux : la cloche ne doit jamais gêner la navigation */
  }
}

function openPanel() {
  open = true;
  $('bell-panel').hidden = false;
  $('bell-toggle').setAttribute('aria-expanded', 'true');
  $('bell-list').innerHTML = '<li class="bell-empty">Chargement…</li>';
  loadList();
}

function closePanel(returnFocus) {
  if (!open) return;
  open = false;
  $('bell-panel').hidden = true;
  $('bell-toggle').setAttribute('aria-expanded', 'false');
  if (returnFocus) $('bell-toggle').focus();
}

async function markRead(id) {
  const item = items.find((n) => n.id === id);
  if (!item || item.read_at) return;
  item.read_at = new Date().toISOString();
  unread = Math.max(0, unread - 1);
  renderCount();
  try {
    await api('POST', `/notifications/${id}/read`);
  } catch {
    pollCount(); // en cas d'échec, on se recale sur le serveur
  }
}

async function markAll() {
  try {
    await api('POST', '/notifications/read-all');
    await loadList();
  } catch {
    /* le compteur se recalera au prochain relevé */
  }
}

function onClick(event) {
  const link = event.target.closest('.bell-item');
  if (link) {
    closePanel(false); // la navigation se fait par le lien lui-même
    markRead(Number(link.dataset.id));
  } else if (event.target.closest('#bell-toggle')) {
    if (open) closePanel(true);
    else openPanel();
  } else if (event.target.closest('#bell-read-all')) {
    markAll();
  }
}

function stop() {
  clearInterval(timer);
  timer = null;
  currentUserId = null;
  known = false;
  unread = 0;
  items = [];
  open = false;
  if (root) root.innerHTML = '';
}

/** À appeler à chaque changement de page : démarre ou arrête la cloche selon la session. */
export function syncBell() {
  const user = session.user;
  if (!user) return stop();
  if (currentUserId === user.id) return undefined;
  stop();
  currentUserId = user.id;
  root.innerHTML = TEMPLATE;
  pollCount();
  timer = setInterval(() => {
    if (!document.hidden) pollCount();
  }, POLL_MS);
  return undefined;
}

export function initBell(element) {
  root = element;
  root.addEventListener('click', onClick);
  document.addEventListener('click', (event) => {
    if (open && !root.contains(event.target)) closePanel(false);
  });
  document.addEventListener('keydown', (event) => {
    if (open && event.key === 'Escape') closePanel(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentUserId) pollCount();
  });
  window.addEventListener('hashchange', () => closePanel(false));
}