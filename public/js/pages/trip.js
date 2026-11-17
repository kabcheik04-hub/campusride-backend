// Écran F4 : détail d'un trajet et réservation

import { api, session } from '../api.js';
import { attachForm, errorSummaryHtml } from '../forms.js';
import { askReport } from '../report.js';
import { avatar, dayLabel, errorState, esc, euro, icon, loading, plural, ratingText, setTitle, shortName, timeOf, toast } from '../ui.js';

const BACK = `<a class="back" href="#/">${icon('arrow-left')}Retour à la recherche</a>`;

function bookingPanel(trip, myBooking) {
  const here = encodeURIComponent(`#/trip/${trip.id}`);

  if (trip.state === 'cancelled') return '<p class="notice notice-off">Ce trajet a été annulé par le conducteur.</p>';
  if (trip.state === 'done') return '<p class="notice">Ce trajet est terminé.</p>';
  if (session.user?.id === trip.driver_id) {
    return '<p class="notice">C\'est votre trajet.</p><a class="btn btn-secondary btn-block" href="#/dashboard/published">Voir mes trajets publiés</a>';
  }
  if (myBooking?.status === 'pending') {
    return `<p class="notice">Votre demande de ${plural(myBooking.seats, 'place')} est en attente de la réponse du conducteur.</p>
      <a class="btn btn-secondary btn-block" href="#/dashboard/booked">Voir mes réservations</a>`;
  }
  if (myBooking) {
    return `<p class="notice notice-ok">Votre réservation de ${plural(myBooking.seats, 'place')} est confirmée.</p>
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
      <button class="btn btn-primary btn-block" type="submit">Envoyer la demande</button>
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
      myBooking = bookings.find((b) => b.trip_id === trip.id && ['pending', 'confirmed'].includes(b.status)) ?? null;
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
        ${
          session.user && session.user.id !== trip.driver_id
            ? `<section class="panel" aria-labelledby="report-title">
                <h2 class="sr-only" id="report-title">Signaler un problème</h2>
                <p class="muted">Un problème avec ce trajet ou ce conducteur ?</p>
                <div class="row-actions">
                  <button class="btn btn-secondary" type="button" data-report="trip">Signaler le trajet</button>
                  <button class="btn btn-secondary" type="button" data-report="user">Signaler le conducteur</button>
                </div>
              </section>`
            : ''
        }
      </div>
    </div>`;

  // Signalements : seulement pour une personne connectée qui n'est pas le conducteur
  app.querySelectorAll('[data-report]').forEach((button) =>
    button.addEventListener('click', async () => {
      const aboutTrip = button.dataset.report === 'trip';
      const result = await askReport({
        title: aboutTrip ? 'Signaler ce trajet' : 'Signaler le conducteur',
        subject: aboutTrip ? `${trip.origin} → ${trip.destination}` : trip.driver_name,
      });
      if (!result) return;
      try {
        await api('POST', '/reports', { target_type: aboutTrip ? 'trip' : 'user', target_id: aboutTrip ? trip.id : trip.driver_id, ...result });
        toast('Merci, votre signalement a été transmis aux administrateurs.');
      } catch (error) {
        toast(error.message, 'error');
      }
    }),
  );

  const form = app.querySelector('#book');
  if (!form) return;

  const total = app.querySelector('#total');
  form.addEventListener('change', () => {
    total.textContent = `Total : ${euro(trip.price * Number(form.elements.seats.value))}`;
  });
  attachForm(form, async (values) => {
    await api('POST', `/trips/${trip.id}/bookings`, { seats: Number(values.seats) });
    toast('Demande envoyée au conducteur.');
    location.hash = '#/dashboard/booked';
  });
}
