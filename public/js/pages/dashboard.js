// Écran F5 : tableau de bord (onglets Publiés et Réservés) et accès à l'avis (F6)

import { api, session } from '../api.js';
import { askReview } from '../review.js';
import { askConfirm, emptyState, errorState, esc, euro, icon, loading, pill, plural, refresh, setTitle, shortName, shortWhen, toast } from '../ui.js';

function bookingStatus(booking) {
  if (booking.trip_state === 'cancelled') return pill('off', 'Trajet annulé');
  if (booking.status === 'cancelled') return pill('off', 'Annulée');
  if (booking.status === 'refused') return pill('off', 'Refusée');
  if (booking.status === 'pending') {
    return booking.trip_state === 'done' ? pill('done', 'Sans réponse') : pill('info', 'En attente du conducteur');
  }
  if (booking.trip_state === 'done') return pill('done', 'Terminé');
  return pill('ok', 'Confirmé');
}

function tripStatus(trip, confirmed, pending) {
  if (trip.state === 'cancelled') return pill('off', 'Annulé');
  if (trip.state === 'done') return pill('done', 'Terminé');
  if (pending) return pill('info', plural(pending, 'demande') + ' en attente');
  return confirmed ? pill('ok', plural(confirmed, 'réservation')) : pill('info', 'Aucune réservation');
}

const route = (origin, destination) =>
  `<span>${esc(origin)}</span><span class="sr-only"> vers </span><span class="route-to">${icon('arrow', 'icon icon-sm')}<span>${esc(destination)}</span></span>`;

function bookingRow(booking) {
  const canCancel = ['pending', 'confirmed'].includes(booking.status) && booking.trip_state === 'open';
  const canReview = booking.status === 'confirmed' && booking.trip_state === 'done';
  const line = `${booking.origin} → ${booking.destination} · ${shortWhen(booking.departure_at)}`;
  return `
    <li class="row">
      <div class="row-head"><span class="row-when">${shortWhen(booking.departure_at)}</span>${bookingStatus(booking)}</div>
      <a class="row-route" href="#/trip/${booking.trip_id}">${route(booking.origin, booking.destination)}</a>
      <p class="muted">${esc(shortName(booking.driver_name))} · ${plural(booking.seats, 'place')} · ${euro(booking.price * booking.seats)}</p>
      ${
        canCancel || canReview
          ? `<div class="row-actions">
              ${canCancel ? `<button class="btn btn-danger" type="button" data-act="cancel-booking" data-id="${booking.id}">${booking.status === 'pending' ? 'Annuler ma demande' : 'Annuler ma réservation'}</button>` : ''}
              ${canReview ? `<button class="btn btn-secondary" type="button" data-act="review" data-trip="${booking.trip_id}" data-target="${booking.driver_id}" data-name="${esc(booking.driver_name)}" data-photo="${esc(booking.driver_photo_url ?? '')}" data-line="${esc(line)}">Noter le conducteur</button>` : ''}
            </div>`
          : ''
      }
    </li>`;
}

function tripRow(trip) {
  const confirmed = trip.bookings.filter((b) => b.status === 'confirmed').length;
  const pending = trip.bookings.filter((b) => b.status === 'pending').length;
  const line = `${trip.origin} → ${trip.destination} · ${shortWhen(trip.departure_at)}`;
  const people = trip.bookings.length
    ? `<ul class="people" aria-label="Passagers">${trip.bookings
        .map(
          (b) => `
        <li>
          <span class="who-line">${esc(shortName(b.passenger_name))} · ${plural(b.seats, 'place')}</span>
          ${b.status === 'cancelled' ? pill('off', 'Annulée') : ''}
          ${b.status === 'refused' ? pill('off', 'Refusée') : ''}
          ${b.status === 'pending' && trip.state !== 'open' ? pill('done', 'Sans réponse') : ''}
          ${
            b.status === 'pending' && trip.state === 'open'
              ? `<div class="row-actions">
                  <button class="btn btn-primary" type="button" data-act="accept-booking" data-id="${b.id}" aria-label="Accepter la demande de ${esc(shortName(b.passenger_name))}">Accepter</button>
                  <button class="btn btn-secondary" type="button" data-act="refuse-booking" data-id="${b.id}" aria-label="Refuser la demande de ${esc(shortName(b.passenger_name))}">Refuser</button>
                </div>`
              : ''
          }
          ${
            b.status === 'confirmed' && trip.state === 'done'
              ? `<button class="btn btn-secondary" type="button" data-act="review" data-trip="${trip.id}" data-target="${b.passenger_id}" data-name="${esc(b.passenger_name)}" data-photo="" data-line="${esc(line)}">Noter ${esc(shortName(b.passenger_name))}</button>`
              : ''
          }
        </li>`,
        )
        .join('')}</ul>`
    : '';
  return `
    <li class="row">
      <div class="row-head"><span class="row-when">${shortWhen(trip.departure_at)}</span>${tripStatus(trip, confirmed, pending)}</div>
      <a class="row-route" href="#/trip/${trip.id}">${route(trip.origin, trip.destination)}</a>
      <p class="muted">${trip.seats_left} place${trip.seats_left > 1 ? 's' : ''} libre${trip.seats_left > 1 ? 's' : ''} sur ${trip.seats_total} · ${euro(trip.price)}</p>
      ${people}
      ${trip.state === 'open' ? `<div class="row-actions"><button class="btn btn-danger" type="button" data-act="cancel-trip" data-id="${trip.id}">Annuler le trajet</button></div>` : ''}
    </li>`;
}

async function handleAction(button) {
  const { act, id, trip, target, name, photo, line } = button.dataset;

  if (act === 'accept-booking') {
    await api('PATCH', `/bookings/${id}/accept`);
    toast('Demande acceptée.');
  } else if (act === 'refuse-booking') {
    const ok = await askConfirm({ title: 'Refuser cette demande ?', text: 'Le passager sera informé que sa demande est refusée.', confirmLabel: 'Refuser la demande', danger: true });
    if (!ok) return;
    await api('PATCH', `/bookings/${id}/refuse`);
    toast('Demande refusée.');
  } else if (act === 'cancel-booking') {
    const ok = await askConfirm({ title: 'Annuler cette réservation ?', text: 'Les places seront libérées pour les autres étudiants.', confirmLabel: 'Annuler la réservation', danger: true });
    if (!ok) return;
    await api('DELETE', `/bookings/${id}`);
    toast('Réservation annulée.');
  } else if (act === 'cancel-trip') {
    const ok = await askConfirm({ title: 'Annuler ce trajet ?', text: 'Toutes les réservations de ce trajet seront annulées.', confirmLabel: 'Annuler le trajet', danger: true });
    if (!ok) return;
    await api('DELETE', `/trips/${id}`);
    toast('Trajet annulé.');
  } else if (act === 'review') {
    const review = await askReview({ name, photo: photo || undefined, line });
    if (!review) return;
    await api('POST', `/trips/${trip}/reviews`, { target_id: Number(target), ...review });
    toast('Merci pour votre avis !');
  }
  refresh();
}

export async function mount(app, [tab], ctx) {
  setTitle('Mon espace');
  const user = session.user;
  const current = tab ?? (user.role === 'passenger' ? 'booked' : 'published');
  app.innerHTML = `<h1>Mon espace</h1>${loading()}`;

  let bookings;
  let trips;
  try {
    [{ bookings }, { trips }] = await Promise.all([api('GET', '/me/bookings'), api('GET', '/me/trips')]);
  } catch (error) {
    if (ctx.stale()) return;
    app.innerHTML = `<h1>Mon espace</h1>${errorState(error.message)}`;
    app.querySelector('[data-retry]').addEventListener('click', () => mount(app, [tab], ctx));
    return;
  }
  if (ctx.stale()) return;

  const canPublish = user.role !== 'passenger';
  const tabLink = (key, label, count) =>
    `<a href="#/dashboard/${key}" ${current === key ? 'aria-current="page"' : ''}>${label} (${count})</a>`;

  let content;
  if (current === 'booked') {
    content = bookings.length
      ? `<ul class="rows">${bookings.map(bookingRow).join('')}</ul>`
      : emptyState('Aucune réservation', 'Trouvez un trajet vers le campus et réservez votre place.');
    content += '<div class="footer-action"><a class="btn btn-secondary" href="#/">Rechercher un trajet</a></div>';
  } else {
    content = trips.length
      ? `<ul class="rows">${trips.map(tripRow).join('')}</ul>`
      : emptyState('Aucun trajet publié', canPublish ? 'Proposez vos places libres aux autres étudiants.' : 'Passez en conducteur pour publier un trajet.');
    content += '<div class="footer-action"><a class="btn btn-primary" href="#/publish">' + icon('plus') + 'Publier un trajet</a></div>';
  }

  app.innerHTML = `
    <h1>Mon espace</h1>
    <nav class="segmented segmented-tabs" aria-label="Mes trajets">${tabLink('published', 'Publiés', trips.length)}${tabLink('booked', 'Réservés', bookings.length)}</nav>
    <div id="panel">${content}</div>`;

  app.onclick = async (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    button.disabled = true;
    try {
      await handleAction(button);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  };
}
