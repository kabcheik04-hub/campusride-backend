// Page d'administration : signalements, utilisateurs, avis et journal des actions

import { api, session } from '../api.js';
import { REASONS } from '../report.js';
import { askConfirm, emptyState, errorState, esc, loading, pill, plural, refresh, setTitle, shortWhen, toast } from '../ui.js';

const TABS = [
  ['reports', 'Signalements'],
  ['users', 'Utilisateurs'],
  ['reviews', 'Avis'],
  ['log', 'Journal'],
];

const ACTIONS = {
  suspend_user: 'Compte suspendu',
  unsuspend_user: 'Compte réactivé',
  delete_review: 'Avis supprimé',
  remove_trip: 'Trajet retiré',
  resolve_report: 'Signalement classé',
};

let userQuery = '';

const button = (act, id, label, kind = 'btn-secondary', extra = '') =>
  `<button class="btn ${kind}" type="button" data-act="${act}" data-id="${id}" ${extra}>${esc(label)}</button>`;

function reportRow(r) {
  const t = r.target;
  let what = 'Élément déjà supprimé';
  let action = '';
  if (r.target_type === 'user' && t) {
    what = `Compte : ${t.name} (${t.email})`;
    if (!t.suspended_at && !t.is_admin) action = button('suspend-user', t.id, 'Suspendre le compte', 'btn-danger');
  } else if (r.target_type === 'trip' && t) {
    what = `Trajet : ${t.origin} → ${t.destination} · ${shortWhen(t.departure_at)} · conducteur ${t.driver_name}`;
    if (t.status === 'open' && new Date(t.departure_at) > new Date()) action = button('remove-trip', t.id, 'Retirer le trajet', 'btn-danger');
  } else if (r.target_type === 'review' && t) {
    what = `Avis ${t.rating}/5 de ${t.author_name} sur ${t.target_name}${t.comment ? ` : « ${t.comment} »` : ''}`;
    action = button('delete-review', t.id, "Supprimer l'avis", 'btn-danger');
  }
  return `
    <li class="row">
      <div class="row-head"><span class="row-when">${shortWhen(r.created_at)}</span>${pill('info', REASONS[r.reason] ?? r.reason)}</div>
      <p>${esc(what)}</p>
      <p class="muted">Signalé par ${esc(r.reporter_name)}${r.details ? ` : ${esc(r.details)}` : ''}</p>
      <div class="row-actions">${action}${button('resolve-report', r.id, 'Classer sans suite')}</div>
    </li>`;
}

function userRow(u, meId) {
  const pills = [
    u.is_admin ? pill('done', 'Administrateur') : '',
    u.suspended_at ? pill('off', 'Suspendu') : '',
    u.open_reports ? pill('info', `${plural(u.open_reports, 'signalement')} en cours`) : '',
  ].join('');
  let action = '';
  if (u.suspended_at) action = button('unsuspend-user', u.id, 'Réactiver le compte');
  else if (!u.is_admin && u.id !== meId) action = button('suspend-user', u.id, 'Suspendre', 'btn-danger', `aria-label="Suspendre ${esc(u.name)}"`);
  return `
    <li class="row">
      <div class="row-head"><span class="row-when">${esc(u.name)}</span>${pills}</div>
      <p class="muted">${esc(u.email)} · ${esc(u.role)}</p>
      ${action ? `<div class="row-actions">${action}</div>` : ''}
    </li>`;
}

const reviewRow = (r) => `
  <li class="row">
    <div class="row-head"><span class="row-when">${esc(r.author_name)} → ${esc(r.target_name)}</span>${pill('info', `${r.rating}/5`)}</div>
    <p>${r.comment ? esc(r.comment) : '<span class="muted">Sans commentaire</span>'}</p>
    <div class="row-actions">${button('delete-review', r.id, "Supprimer l'avis", 'btn-danger')}</div>
  </li>`;

const logRow = (a) => `
  <li class="row">
    <div class="row-head"><span class="row-when">${shortWhen(a.created_at)}</span>${pill('done', ACTIONS[a.action] ?? a.action)}</div>
    <p class="muted">Par ${esc(a.admin_name)}${a.details ? ` · ${esc(a.details)}` : ''}</p>
  </li>`;

const list = (items, render, empty) =>
  items.length ? `<ul class="rows">${items.map(render).join('')}</ul>` : emptyState(empty[0], empty[1]);

async function handleAction(btn) {
  const { act, id } = btn.dataset;
  if (act === 'resolve-report') {
    await api('PATCH', `/admin/reports/${id}/resolve`);
    toast('Signalement classé.');
  } else if (act === 'suspend-user') {
    const ok = await askConfirm({
      title: 'Suspendre ce compte ?',
      text: 'La personne perd l\'accès tout de suite. Ses trajets à venir et ses réservations à venir sont annulés.',
      confirmLabel: 'Suspendre',
      danger: true,
    });
    if (!ok) return;
    await api('POST', `/admin/users/${id}/suspend`);
    toast('Compte suspendu.');
  } else if (act === 'unsuspend-user') {
    await api('POST', `/admin/users/${id}/unsuspend`);
    toast('Compte réactivé.');
  } else if (act === 'remove-trip') {
    const ok = await askConfirm({
      title: 'Retirer ce trajet ?',
      text: 'Le trajet est annulé et toutes ses réservations aussi.',
      confirmLabel: 'Retirer le trajet',
      danger: true,
    });
    if (!ok) return;
    await api('DELETE', `/admin/trips/${id}`);
    toast('Trajet retiré.');
  } else if (act === 'delete-review') {
    const ok = await askConfirm({ title: 'Supprimer cet avis ?', text: 'Cette action est définitive.', confirmLabel: "Supprimer l'avis", danger: true });
    if (!ok) return;
    await api('DELETE', `/admin/reviews/${id}`);
    toast('Avis supprimé.');
  }
  refresh();
}

export async function mount(app, [tab], ctx) {
  setTitle('Administration');
  const me = session.user;
  if (!me?.is_admin) {
    app.innerHTML = `<h1>Administration</h1>${errorState('Cette page est réservée aux administrateurs.', { retry: false })}`;
    return;
  }
  const current = tab ?? 'reports';
  app.innerHTML = `<h1>Administration</h1>${loading()}`;

  const detail = {
    reports: () => Promise.resolve(null),
    users: () => api('GET', `/admin/users?q=${encodeURIComponent(userQuery)}`),
    reviews: () => api('GET', '/admin/reviews'),
    log: () => api('GET', '/admin/actions'),
  }[current];

  let reports;
  let extra;
  try {
    [{ reports }, extra] = await Promise.all([api('GET', '/admin/reports'), detail()]);
  } catch (error) {
    if (ctx.stale()) return;
    app.innerHTML = `<h1>Administration</h1>${errorState(error.message)}`;
    app.querySelector('[data-retry]')?.addEventListener('click', () => mount(app, [tab], ctx));
    return;
  }
  if (ctx.stale()) return;

  const tabLink = ([key, label]) =>
    `<a href="#/admin/${key}" ${current === key ? 'aria-current="page"' : ''}>${label}${key === 'reports' ? ` (${reports.length})` : ''}</a>`;

  let content;
  if (current === 'reports') {
    content = list(reports, reportRow, ['Aucun signalement en attente', 'Tout est à jour.']);
  } else if (current === 'users') {
    content = `
      <form class="admin-search" role="search" id="user-search">
        <div class="field">
          <label for="f-q">Rechercher un utilisateur</label>
          <input id="f-q" name="q" type="search" value="${esc(userQuery)}" maxlength="100" placeholder="Nom ou e-mail">
        </div>
        <button class="btn btn-primary" type="submit">Rechercher</button>
      </form>
      ${list(extra.users, (u) => userRow(u, me.id), ['Aucun utilisateur trouvé', 'Essayez un autre nom ou une autre adresse.'])}`;
  } else if (current === 'reviews') {
    content = list(extra.reviews, reviewRow, ['Aucun avis', 'Les avis laissés apparaîtront ici.']);
  } else {
    content = list(extra.actions, logRow, ['Journal vide', 'Les actions de modération apparaîtront ici.']);
  }

  app.innerHTML = `
    <h1>Administration</h1>
    <nav class="segmented segmented-tabs segmented-wide" aria-label="Sections d'administration">${TABS.map(tabLink).join('')}</nav>
    <div id="panel">${content}</div>`;

  app.querySelector('#user-search')?.addEventListener('submit', (event) => {
    event.preventDefault();
    userQuery = new FormData(event.target).get('q').trim();
    refresh();
  });
  app.onclick = async (event) => {
    const btn = event.target.closest('button[data-act]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await handleAction(btn);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };
}
