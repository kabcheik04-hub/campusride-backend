// Écran F4 : détail d'un trajet et réservation

import { api, session } from '../api.js';
import { attachForm, errorSummaryHtml } from '../forms.js';
import { avatar, dayLabel, errorState, esc, euro, icon, loading, plural, ratingText, setTitle, shortName, timeOf, toast } from '../ui.js';

const BACK = `<a class="back" href="#/">${icon('arrow-left')}Retour à la recherche</a>`;

function bookingPanel(trip, myBooking) {
  const here = encodeURIComponent(`#/trip/${trip.id}`);

  if (trip.state === 'cancelled') return '<p class="notice notice-off">Ce trajet a été annulé par le conducteur.</p>';
  if (trip.state === 'done') return '<p class="notice">Ce trajet est terminé.</p>';
  if (session.user?.id === trip.driver_id) {
    return '<p class="notice">C\'est votre trajet.</p><a class="btn btn-secondary btn-block" href="#/dashboard/published">Voir mes trajets publiés</a>';
  }
  if (myBooking) {
    return `<p class="notice notice-ok">Vous avez réservé ${plural(myBooking.seats, 'place')} sur ce trajet.</p>
      <a class="btn btn-secondary btn-block" href="#/dashboard/booked">Voir mes réservations</a>`;
  }
  if (trip.seats_left === 0) {
    return '<p class="notice notice-off">Ce trajet est complet.</p><a class="btn btn-secondary btn-block" href="#/">Chercher un autre trajet</a>';
  }
  if (!session.user) {
    return `<a class="btn btn-primary btn-block" href="#/login?next=${here}">Se connecter pour réserver</a>
      <p class="muted">Pas encore de compte ? <a href="#/register?next=${here}">S'inscrire</a></p>`;
  }

  const options = Array.from({ length: Math.min(4, trip.seats_left) }, (_, i) => `<option value="${i + 1}">${plural(i + 1, 'place')}</option>`).join('');
  return `
    <form id="book" novalidate>
      ${errorSummaryHtml()}
      ${
        trip.seats_left > 1
          ? `<div class="field"><label for="f-seats">Nombre de places</label>
             <select id="f-seats" name="seats" aria-describedby="f-seats-error">${options}</select>
             <p class="field-error" id="f-seats-error" hidden></p></div>`
          : '<input type="hidden" name="seats" value="1">'
      }
      <p class="total" id="total" aria-live="polite">Total : ${euro(trip.price)}</p>
      <button class="btn btn-primary btn-block" type="submit">Réserver</button>
    </form>`;
}

export async function mount(app, [id], ctx) {
  app.innerHTML = `${BACK}${loading('Chargement du trajet…')}`;

  let trip;
  let myBooking = null;
  try {
    ({ trip } = await api('GET', `/trips/${id}`));
    if (session.user && session.user.id !== trip.driver_id) {
      const { bookings } = await api('GET', '/me/bookings');
      myBooking = bookings.find((b) => b.trip_id === trip.id && b.status === 'confirmed') ?? null;
    }
  } catch (error) {
    if (ctx.stale()) return;
    app.innerHTML = `${BACK}${errorState(error.message, { retry: error.status !== 404 })}`;
    app.querySelector('[data-retry]')?.addEventListener('click', () => mount(app, [id], ctx));
    return;
  }
  if (ctx.stale()) return;

  setTitle(`${trip.origin} → ${trip.destination}`);
  app.innerHTML = `
    ${BACK}
    <h1>Détail du trajet</h1>
    <div class="detail">
      <div class="detail-main">
        <section class="panel" aria-labelledby="journey-title">
          <h2 class="sr-only" id="journey-title">Itinéraire</h2>
          <ol class="stops">
            <li><span class="stop-dot" aria-hidden="true"></span><span><span class="sr-only">Départ : </span>${esc(trip.origin)}</span></li>
            <li><span class="stop-square" aria-hidden="true"></span><span><span class="sr-only">Arrivée : </span>${esc(trip.destination)}</span></li>
          </ol>
          <p class="when">${esc(dayLabel(trip.departure_at))} · ${timeOf(trip.departure_at)}</p>
        </section>
        <section class="panel" aria-labelledby="driver-title">
          <h2 class="sr-only" id="driver-title">Conducteur</h2>
          <div class="person person-flush">
            ${avatar(trip.driver_name, trip.driver_photo_url, 'lg')}
            <div><p class="person-name">${esc(shortName(trip.driver_name))}</p><p class="muted">${esc(ratingText(trip))}</p></div>
          </div>
        </section>
      </div>
      <div class="detail-side">
        <section class="panel" aria-labelledby="book-title">
          <h2 class="sr-only" id="book-title">Réservation</h2>
          <p class="price-line"><strong>${euro(trip.price)}</strong> par personne · ${plural(trip.seats_left, 'place')} libre${trip.seats_left > 1 ? 's' : ''}</p>
          ${bookingPanel(trip, myBooking)}
        </section>
      </div>
    </div>`;

  const form = app.querySelector('#book');
  if (!form) return;

  const total = app.querySelector('#total');
  form.addEventListener('change', () => {
    total.textContent = `Total : ${euro(trip.price * Number(form.elements.seats.value))}`;
  });
  attachForm(form, async (values) => {
    await api('POST', `/trips/${trip.id}/bookings`, { seats: Number(values.seats) });
    toast('Réservation confirmée !');
    location.hash = '#/dashboard/booked';
  });
}
