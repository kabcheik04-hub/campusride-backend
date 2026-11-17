# CampusRide : API (back-end)

API REST de **CampusRide**, une application de covoiturage entre étudiants (TD Projet Web, MIAGE 2).
Elle gère les comptes, les trajets, les réservations et les avis. Le front-end consomme cette API en JSON.

## Prérequis

- Node.js **22.13 ou plus récent** (`node -v` pour vérifier)
- Aucune base de données à installer : l'API utilise SQLite, intégré à Node.js

## Installation et lancement

```bash
git clone <url-du-depot>
cd campusride-backend
cp .env.example .env     # puis modifiez JWT_SECRET
npm install              # uniquement pour le linter (ESLint)
npm run seed             # optionnel : données de démonstration
npm start                # API sur http://localhost:3000
```

Vérification : ouvrez **http://localhost:3000** dans le navigateur : l'interface web de CampusRide s'affiche
(elle est servie par la même application que l'API, aucun second serveur à lancer).
L'API répond sur `/api` : `http://localhost:3000/api/health` doit afficher `{"status":"ok"}`.

Comptes de démonstration (après `npm run seed`), mot de passe `password123` :
`awa@campus.test` (conducteur), `yann@campus.test` (les deux), `lea@campus.test` (passager).

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm start` | Lance l'API |
| `npm run dev` | Lance l'API et la relance à chaque modification |
| `npm test` | Lance les tests automatiques |
| `npm run lint` | Vérifie le style du code avec ESLint |
| `npm run seed` | Ajoute des données de démonstration |

## Variables d'environnement

Voir `.env.example`. `JWT_SECRET` est obligatoire quand `NODE_ENV=production`.
`ALLOWED_EMAIL_DOMAINS` (facultatif) limite l'inscription aux e-mails d'établissements, par exemple
`univ-lyon.fr,etu.univ-lyon.fr` (les sous-domaines sont acceptés). Vide, toutes les adresses sont acceptées.
`CORS_ORIGIN` doit contenir l'adresse du front-end (par défaut `http://localhost:5173`).

## Structure du projet

```
src/
  server.js        point d'entrée : démarre le serveur
  app.js           routage, authentification, gestion des erreurs, CORS
  config.js        lecture de la configuration (.env)
  db.js            base SQLite : schéma des 4 tables et transactions
  auth.js          hachage des mots de passe (scrypt) et jetons JWT
  queries.js       requêtes partagées (lecture d'un trajet, places libres)
  validation.js    contrôle des données reçues
  routes/          une route par fonctionnalité : auth, trips, bookings, reviews
scripts/seed.js    données de démonstration
tests/             tests automatiques : parcours, solidité (concurrence, jetons, injections), données du pitch
public/            interface web (voir « Interface web » plus bas)
  index.html       page unique
  styles/          tokens.css (charte graphique du pitch) et app.css
  js/              main.js (navigation), api.js, ui.js, forms.js, review.js
  js/pages/        une page par écran : search, trip, auth, publish, dashboard
```

## Interface web

L'interface reprend la charte et les écrans du pitch (« CampusRide Pitch v7 ») : bleu nuit `#0B1B34`,
teal `#0E7C86`, orange `#E4682B`, menthe `#BFE3E3`, brume `#ECF6F6` ; Georgia gras pour les titres, Calibri pour les textes.
Pour modifier l'identité, il suffit d'éditer `public/styles/tokens.css`.

| Écran du pitch | Adresse |
| --- | --- |
| F3 Recherche | `#/` (les critères restent dans l'adresse : `#/?origin=Gare&date=2026-11-14`) |
| F4 Détail et réservation | `#/trip/:id` |
| F1 Inscription, connexion | `#/register`, `#/login` |
| F2 Publication | `#/publish` |
| F5 Tableau de bord | `#/dashboard/published`, `#/dashboard/booked` |
| F6 Avis | fenêtre ouverte depuis le tableau de bord, une fois le trajet terminé |

Choix de conception, d'après les règles du skill `ui-ux-pro-max` :

- **Mobile d'abord** : barre de navigation en bas (4 entrées), puis barre en haut dès 768 px. Testé à 375, 768 et 1440 px.
- **Accessibilité** : contraste de 4,5:1 minimum (texte bleu nuit sur le bouton orange, le blanc n'atteignant que 3,3:1), zones cliquables de 44 px,
  focus visible, lien « Aller au contenu », fenêtres de dialogue natives, mouvement réduit respecté.
- **Formulaires** : message sous chaque champ en erreur, plus un résumé annoncé aux lecteurs d'écran dont chaque ligne mène au champ.
- **Statuts** : toujours un texte et une icône (Confirmé, Annulée, Terminé), jamais la couleur seule.
- **États** : chargement, erreur avec bouton « Réessayer », liste vide avec une action proposée.
- **Aucune donnée fictive** : tout vient de l'API. Les notifications (F7) et la validation par le conducteur ne sont pas dans cette version.

## Utilisation de l'API

Les corps de requête et les réponses sont en JSON. Les routes marquées 🔒 demandent
l'en-tête `Authorization: Bearer <token>` (le token est renvoyé à l'inscription et à la connexion).
Les erreurs ont la forme `{ "error": "message lisible" }` avec le code HTTP adapté (400, 401, 403, 404, 409).

| Fonction | Méthode et route | Corps ou paramètres |
| --- | --- | --- |
| F1 Inscription | `POST /api/auth/register` | `email`, `password` (8 caractères min.), `name`, `role` (`driver`, `passenger` ou `both`), `photo_url` (facultatif, lien http ou https) |
| F1 Connexion | `POST /api/auth/login` | `email`, `password` |
| Profil 🔒 | `GET /api/me`, `PATCH /api/me` | `name`, `role`, `photo_url` (facultatifs) |
| F2 Publier 🔒 | `POST /api/trips` | `origin`, `destination`, `departure_at` (date ISO future), `seats_total` (1 à 8), `price` (entier) |
| F3 Rechercher | `GET /api/trips` | `origin`, `destination`, `date` (AAAA-MM-JJ), `seats` (tous facultatifs) |
| Détail d'un trajet | `GET /api/trips/:id` | |
| Annuler un trajet 🔒 | `DELETE /api/trips/:id` | conducteur uniquement |
| F4 Réserver 🔒 | `POST /api/trips/:id/bookings` | `seats` (1 à 4, défaut 1) |
| F4 Annuler une réservation 🔒 | `DELETE /api/bookings/:id` | |
| F5 Mes trajets 🔒 | `GET /api/me/trips` | trajets publiés avec leurs réservations |
| F5 Mes réservations 🔒 | `GET /api/me/bookings` | |
| F6 Donner un avis 🔒 | `POST /api/trips/:id/reviews` | `target_id`, `rating` (1 à 5), `comment` (facultatif) |
| F6 Avis d'un utilisateur | `GET /api/users/:id/reviews` | renvoie aussi la note moyenne |

Exemple :

```bash
# Connexion
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"awa@campus.test","password":"password123"}'

# Recherche de trajets
curl "http://localhost:3000/api/trips?origin=gare&date=2026-11-13"

# Publier un trajet (remplacez TOKEN)
curl -X POST http://localhost:3000/api/trips \
  -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" \
  -d '{"origin":"Gare","destination":"Campus","departure_at":"2026-11-20T07:30:00Z","seats_total":3,"price":500}'
```

## Règles métier

- Le nombre de places libres (`seats_left`) est calculé : places du trajet moins réservations confirmées.
- Une réservation est faite dans une transaction : impossible de dépasser le nombre de places.
- Un passager n'a qu'une réservation active par trajet ; le conducteur ne réserve pas son propre trajet.
- Annuler un trajet annule toutes ses réservations.
- Un avis n'est possible qu'après le départ, entre personnes ayant participé au trajet, une fois par personne et par trajet.
- Les dates sont stockées et filtrées en UTC. `price` est un entier en euros.
- Chaque trajet porte un `state` (`open`, `done` ou `cancelled`), la note moyenne du conducteur (`driver_rating`), son nombre d'avis (`driver_reviews_count`) et sa photo.

## Notes techniques

SQLite est fourni par le module `node:sqlite` de Node.js, qui peut afficher un avertissement
« experimental » au lancement : c'est normal. Pour passer à PostgreSQL, seul `src/db.js` et les
requêtes SQL des routes sont à adapter.
