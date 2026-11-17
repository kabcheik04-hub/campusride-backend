// Écran F3 : rechercher un trajet (critères conservés dans l'adresse : #/?origin=Gare&date=2026-11-14)

import { api, session } from '../api.js';
import { fieldHtml } from '../forms.js';
import { dayLabel, emptyState, errorState, esc, euro, fmtRating, icon, loading, plural, setTitle, shortName, timeOf, todayISO } from '../ui.js';

const CRITERIA = ['origin', 'destination', 'date'];

function rideItem(trip) {
  const rating = trip.driver_reviews_count
    ? ` · ${icon('star', 'icon icon-sm')}<span class="sr-only">Note </span>${fmtRating(trip.driver_rating)}`
    : '';
  return `
    <li>
      <a class="ride" href="#/trip/${trip.id}">
        <span class="ride-time">${timeOf(trip.departure_at)}</span>
        <span class="ride-main">
          <span class="ride-route">
            <span>${esc(trip.origin)}</span><span class="sr-only"> vers </span><span class="route-to">${icon('arrow', 'icon icon-sm')}<span>${esc(trip.destination)}</span></span>
          </span>
          <span class="ride-meta">${esc(shortName(trip.driver_name))}${rating} · ${plural(trip.seats_left, 'place')}</span>
        </span>
        <span class="ride-price">${euro(trip.price)}</span>
      </a>
    </li>`;
}

function resultsHtml(trips) {
  const days = new Map();
  for (const trip of trips) {
    const key = new Date(trip.departure_at).toDateString();
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(trip);
  }
  const groups = [...days.values()]
    .map(
      (group) => `
      <section>
        <h2 class="day">${esc(dayLabel(group[0].departure_at))}</h2>
        <ul class="rides">${group.map(rideItem).join('')}</ul>
      </section>`,
    )
    .join('');
  return `<p class="count">${plural(trips.length, 'trajet')} · triés par horaire</p>${groups}`;
}

export async function mount(app, _params, ctx) {
  setTitle('Rechercher un trajet');
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const value = (key) => params.get(key) ?? '';

  app.innerHTML = `
    <h1>Rechercher un trajet</h1>
    <p class="lead">Partagez le trajet, pas la galère.</p>
    <form class="search" id="search" role="search" novalidate>
      ${fieldHtml({ name: 'origin', label: 'Départ', required: false, value: value('origin'), attrs: 'autocomplete="off" placeholder="Ex. Résidence Les Lilas"' })}
      ${fieldHtml({ name: 'destination', label: 'Arrivée', required: false, value: value('destination'), attrs: 'autocomplete="off" placeholder="Ex. Campus Sciences"' })}
      ${fieldHtml({ name: 'date', label: 'Date', type: 'date', required: false, value: value('date'), attrs: `min="${todayISO()}"` })}
      <button class="btn btn-primary" type="submit">${icon('search')}Rechercher</button>
    </form>
    <div id="results"></div>`;

  const results = app.querySelector('#results');

  async function load() {
    results.setAttribute('aria-busy', 'true');
    results.innerHTML = loading('Recherche en cours…');
    try {
      const query = new URLSearchParams();
      for (const key of CRITERIA) if (value(key)) query.set(key, value(key));
      const { trips } = await api('GET', `/trips${query.toString() ? `?${query}` : ''}`);
      if (ctx.stale()) return;
      results.innerHTML = trips.length
        ? resultsHtml(trips)
        : emptyState(
            'Aucun trajet ne correspond',
            'Essayez d\'autres critères, ou proposez vous-même ce trajet.',
            session.user?.role === 'passenger'
              ? ''
              : `<a class="btn btn-secondary" href="${session.user ? '#/publish' : '#/register'}">${session.user ? 'Publier un trajet' : 'Créer un compte'}</a>`,
          );
    } catch (error) {
      if (ctx.stale()) return;
      results.innerHTML = errorState(error.message);
      results.querySelector('[data-retry]').addEventListener('click', load);
    } finally {
      results.removeAttribute('aria-busy');
    }
  }

  app.querySelector('#search').addEventListener('submit', (event) => {
    event.preventDefault();
    const query = new URLSearchParams();
    for (const [key, val] of new FormData(event.target)) if (val) query.set(key, val.trim());
    const target = query.toString() ? `#/?${query}` : '#/';
    if (target === (location.hash || '#/')) {
      params.clear();
      for (const [key, val] of query) params.set(key, val);
      load();
    } else {
      location.hash = target;
    }
  });

  await load();
}
