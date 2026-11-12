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

Vérification : `curl http://localhost:3000/api/health` doit répondre `{"status":"ok"}`.

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
tests/api.test.js  tests du parcours complet
```

## Utilisation de l'API

Les corps de requête et les réponses sont en JSON. Les routes marquées 🔒 demandent
l'en-tête `Authorization: Bearer <token>` (le token est renvoyé à l'inscription et à la connexion).
Les erreurs ont la forme `{ "error": "message lisible" }` avec le code HTTP adapté (400, 401, 403, 404, 409).

| Fonction | Méthode et route | Corps ou paramètres |
| --- | --- | --- |
| F1 Inscription | `POST /api/auth/register` | `email`, `password` (8 caractères min.), `name`, `role` (`driver`, `passenger` ou `both`) |
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
- Les dates sont stockées et filtrées en UTC. `price` est un entier, sans devise imposée.

## Notes techniques

SQLite est fourni par le module `node:sqlite` de Node.js, qui peut afficher un avertissement
« experimental » au lancement : c'est normal. Pour passer à PostgreSQL, seul `src/db.js` et les
requêtes SQL des routes sont à adapter.
