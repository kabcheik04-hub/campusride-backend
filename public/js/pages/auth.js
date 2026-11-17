// Écran F1 : inscription et connexion

import { api, session } from '../api.js';
import { attachForm, errorSummaryHtml, fieldHtml } from '../forms.js';
import { avatar, icon, initials, setTitle, toast } from '../ui.js';

const placeholderAvatar = `<span class="avatar avatar-lg" aria-hidden="true">${icon('user')}</span>`;

// Seules les adresses internes (#/...) sont acceptées après connexion
const safeNext = (value) => (value && value.startsWith('#/') ? value : '#/');
const nextParam = () => new URLSearchParams(location.hash.split('?')[1] ?? '').get('next');
const withNext = (path) => (nextParam() ? `${path}?next=${encodeURIComponent(safeNext(nextParam()))}` : path);

export function mountLogin(app) {
  setTitle('Connexion');
  app.innerHTML = `
    <div class="form-page">
      <h1>Connexion</h1>
      <form class="panel" id="login" novalidate>
        ${errorSummaryHtml()}
        ${fieldHtml({ name: 'email', label: 'E-mail', type: 'email', attrs: 'autocomplete="email"' })}
        ${fieldHtml({ name: 'password', label: 'Mot de passe', type: 'password', attrs: 'autocomplete="current-password"' })}
        <button class="btn btn-primary btn-block" type="submit">Se connecter</button>
      </form>
      <p class="alt">Pas encore de compte ? <a href="#${withNext('/register')}">S'inscrire</a></p>
    </div>`;

  attachForm(app.querySelector('#login'), async (values) => {
    const { token, user } = await api('POST', '/auth/login', values);
    session.save(token, user);
    toast(`Bienvenue ${user.name.split(' ')[0]} !`);
    location.hash = safeNext(nextParam());
  });
}

export function mountRegister(app) {
  setTitle('Créer un compte');
  const role = (value, label, checked = false) => `
    <input type="radio" name="role" id="f-role-${value}" value="${value}" required ${checked ? 'checked' : ''} aria-describedby="f-role-error">
    <label for="f-role-${value}">${label}</label>`;

  app.innerHTML = `
    <div class="form-page">
      <h1>Créer un compte</h1>
      <form class="panel" id="register" novalidate>
        ${errorSummaryHtml()}
        <div class="person">
          <span id="preview">${placeholderAvatar}</span>
          <p class="muted">Votre photo et votre nom seront visibles des autres étudiants.</p>
        </div>
        ${fieldHtml({ name: 'name', label: 'Nom complet', attrs: 'autocomplete="name" minlength="2" maxlength="80"' })}
        ${fieldHtml({ name: 'email', label: "E-mail de l'établissement", type: 'email', hint: 'Votre adresse universitaire ou scolaire.', attrs: 'autocomplete="email"' })}
        ${fieldHtml({ name: 'password', label: 'Mot de passe', type: 'password', hint: '8 caractères minimum.', attrs: 'autocomplete="new-password" minlength="8" maxlength="200"' })}
        ${fieldHtml({ name: 'photo_url', label: 'Photo de profil', type: 'url', required: false, optional: true, hint: "Lien vers une image (https://…).", attrs: 'autocomplete="off" maxlength="500"' })}
        <fieldset class="field" data-required-message="Choisissez votre rôle">
          <legend>Je serai</legend>
          <div class="segmented segmented-radio">${role('driver', 'Conducteur')}${role('passenger', 'Passager')}${role('both', 'Les deux', true)}</div>
          <p class="field-error" id="f-role-error" hidden></p>
        </fieldset>
        <button class="btn btn-primary btn-block" type="submit">S'inscrire</button>
      </form>
      <p class="alt">Déjà inscrit ? <a href="#${withNext('/login')}">Se connecter</a></p>
    </div>`;

  // L'avatar affiche les initiales saisies, puis la photo si le lien est valide
  const preview = app.querySelector('#preview');
  const nameInput = app.querySelector('#f-name');
  const photoInput = app.querySelector('#f-photo_url');
  const render = () => {
    const name = nameInput.value.trim();
    const photo = photoInput.value.trim();
    preview.innerHTML = name || photo ? avatar(name || '?', /^https?:\/\//i.test(photo) ? photo : '', 'lg') : placeholderAvatar;
  };
  nameInput.addEventListener('input', () => {
    const initialsElement = preview.querySelector('.avatar > span');
    const name = nameInput.value.trim();
    if (initialsElement && name) initialsElement.textContent = initials(name);
    else render();
  });
  photoInput.addEventListener('change', render);

  attachForm(app.querySelector('#register'), async (values) => {
    const body = { ...values };
    if (!body.photo_url) delete body.photo_url;
    const { token, user } = await api('POST', '/auth/register', body);
    session.save(token, user);
    toast('Compte créé, bienvenue !');
    location.hash = safeNext(nextParam());
  });
}
