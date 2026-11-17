// Point d'entrée : navigation par l'adresse (#/...), barre de navigation, pages

import { session } from './api.js';
import { mountLogin, mountRegister } from './pages/auth.js';
import { mount as dashboard } from './pages/dashboard.js';
import { mount as publish } from './pages/publish.js';
import { mount as search } from './pages/search.js';
import { mount as trip } from './pages/trip.js';
import { emptyState, errorState, esc, icon, setTitle, shortName, toast } from './ui.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');

// [motif de l'adresse, page, connexion obligatoire]
const routes = [
  [/^\/$/, search, false],
  [/^\/login$/, mountLogin, false],
  [/^\/register$/, mountRegister, false],
  [/^\/publish$/, publish, true],
  [/^\/dashboard(?:\/(published|booked))?$/, dashboard, true],
  [/^\/trip\/(\d+)$/, trip, false],
];

function renderNav(path) {
  const user = session.user;
  const link = (href, label, iconName, active) =>
    `<a href="${href}"${active ? ' aria-current="page"' : ''}>${icon(iconName, 'icon nav-icon')}<span>${label}</span></a>`;

  const items = user
    ? [
        link('#/', 'Rechercher', 'search', path === '/'),
        user.role !== 'passenger' ? link('#/publish', 'Publier', 'plus', path === '/publish') : '',
        link('#/dashboard', 'Mon espace', 'list', path.startsWith('/dashboard')),
        `<button type="button" id="logout">${icon('logout', 'icon nav-icon')}<span>Déconnexion</span></button>`,
        `<span class="who">${esc(shortName(user.name))}</span>`,
      ]
    : [
        link('#/', 'Rechercher', 'search', path === '/'),
        link('#/login', 'Connexion', 'user', path === '/login'),
        link('#/register', 'Inscription', 'plus', path === '/register'),
      ];
  nav.innerHTML = items.join('');

  nav.querySelector('#logout')?.addEventListener('click', () => {
    session.clear();
    toast('Vous êtes déconnecté.');
    if (location.hash === '#/' || !location.hash) route();
    else location.hash = '#/';
  });
}

let current = 0;
let firstRender = true;

async function route() {
  const id = ++current;
  const ctx = { stale: () => id !== current };
  const hash = location.hash || '#/';
  const path = hash.slice(1).split('?')[0] || '/';

  app.onclick = null;
  renderNav(path);

  for (const [pattern, page, needsAuth] of routes) {
    const match = pattern.exec(path);
    if (!match) continue;

    if (needsAuth && !session.user) {
      toast('Connectez-vous pour accéder à cette page.', 'error');
      location.replace(`#/login?next=${encodeURIComponent(hash)}`);
      return;
    }
    try {
      await page(app, match.slice(1), ctx);
    } catch (error) {
      if (!ctx.stale()) app.innerHTML = errorState(error.message, { retry: false });
    }
    if (!ctx.stale()) {
      window.scrollTo(0, 0);
      // Au premier chargement, le focus reste en haut de page (lien « Aller au contenu » accessible au premier Tab)
      const heading = firstRender ? null : app.querySelector('h1');
      firstRender = false;
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }
    return;
  }

  setTitle('Page introuvable');
  app.innerHTML = `<h1>Page introuvable</h1>${emptyState("Cette page n'existe pas", 'Le lien est peut-être incorrect.', '<a class="btn btn-secondary" href="#/">Retour à la recherche</a>')}`;
}

window.addEventListener('hashchange', route);
window.addEventListener('session-expired', () => {
  toast('Votre session a expiré, reconnectez-vous.', 'error');
  location.hash = '#/login';
});

// Si une photo de profil ne se charge pas, les initiales restent visibles
document.addEventListener(
  'error',
  (event) => {
    if (event.target instanceof HTMLImageElement && event.target.hasAttribute('data-avatar')) event.target.remove();
  },
  true,
);

// Lien « Aller au contenu » : ne doit pas passer par le routeur
document.getElementById('skip').addEventListener('click', (event) => {
  event.preventDefault();
  app.focus();
});

route();
