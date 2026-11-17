// Écran F2 : publier un trajet

import { api, session } from '../api.js';
import { attachForm, errorSummaryHtml, fieldHtml } from '../forms.js';
import { setTitle, todayISO, toast } from '../ui.js';

export function mount(app) {
  setTitle('Publier un trajet');

  // Un compte « passager » ne peut pas publier : on propose de passer en conducteur
  if (session.user.role === 'passenger') {
    app.innerHTML = `
      <div class="form-page">
        <h1>Publier un trajet</h1>
        <div class="panel">
          <p>Votre profil est « passager ». Pour proposer des trajets, passez en « conducteur et passager ».</p>
          <button class="btn btn-primary btn-block" type="button" id="become-driver">Passer en conducteur et passager</button>
        </div>
      </div>`;
    app.querySelector('#become-driver').addEventListener('click', async (event) => {
      event.target.disabled = true;
      try {
        const { user } = await api('PATCH', '/me', { role: 'both' });
        session.update(user);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (error) {
        toast(error.message, 'error');
        event.target.disabled = false;
      }
    });
    return;
  }

  app.innerHTML = `
    <div class="form-page">
      <h1>Publier un trajet</h1>
      <form class="panel" id="publish" novalidate>
        ${errorSummaryHtml()}
        ${fieldHtml({ name: 'origin', label: 'Départ', attrs: 'minlength="2" maxlength="120" autocomplete="off" placeholder="Ex. Résidence Les Lilas"' })}
        ${fieldHtml({ name: 'destination', label: 'Arrivée', attrs: 'minlength="2" maxlength="120" autocomplete="off" placeholder="Ex. Campus Sciences"' })}
        ${fieldHtml({ name: 'date', label: 'Date', type: 'date', attrs: `min="${todayISO()}"` })}
        <div class="field-row">
          ${fieldHtml({ name: 'time', label: 'Heure', type: 'time' })}
          ${fieldHtml({ name: 'seats_total', label: 'Places', type: 'number', value: '3', attrs: 'min="1" max="8" step="1" inputmode="numeric"' })}
        </div>
        ${fieldHtml({ name: 'price', label: 'Prix par personne (€)', type: 'number', value: '3', hint: 'Montant entier en euros, 0 pour un trajet gratuit.', attrs: 'min="0" max="1000" step="1" inputmode="numeric"' })}
        <button class="btn btn-primary btn-block" type="submit">Publier</button>
      </form>
    </div>`;

  attachForm(app.querySelector('#publish'), async (values) => {
    const departure = new Date(`${values.date}T${values.time}`);
    if (Number.isNaN(departure.getTime()) || departure <= new Date()) {
      throw new Error('La date et l\'heure de départ doivent être dans le futur.');
    }
    const { trip } = await api('POST', '/trips', {
      origin: values.origin,
      destination: values.destination,
      departure_at: departure.toISOString(),
      seats_total: Number(values.seats_total),
      price: Number(values.price),
    });
    toast('Trajet publié : il apparaît dans la recherche.');
    location.hash = `#/trip/${trip.id}`;
  });
}
