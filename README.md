![CI](https://github.com/kabcheik04-hub/campusride-backend/actions/workflows/ci.yml/badge.svg)

# CampusRide

Application de covoiturage entre étudiants d'un même établissement
(projet web MIAGE 2). Un conducteur publie un trajet, les passagers
envoient une demande, le conducteur l'accepte ou la refuse, et chacun
est prévenu par notification.

## Fonctionnalités

- Inscription et connexion, avec restriction possible aux e-mails de l'établissement
- Publication et recherche de trajets
- Réservation avec **validation par le conducteur** (en attente, acceptée, refusée)
- **Notifications internes** (cloche) pour le conducteur et les passagers
- Avis et notes sur les conducteurs
- **Administration et modération** : signalements, suspension de compte,
  retrait de trajet, suppression d'avis, journal des actions

## Technologies

- Node.js 22.13 ou plus, API REST, aucune dépendance d'exécution
- Base de données SQLite (fichier créé automatiquement)
- Front-end en HTML, CSS et JavaScript, servi par le même serveur (dossier `public/`)
- Tests avec le lanceur intégré de Node (`node --test`), lint avec ESLint
- CI avec GitHub Actions

Les choix sont justifiés dans les [ADR](docs/adr/).

## Installation

```bash
git clone https://github.com/kabcheik04-hub/campusride-backend.git
cd campusride-backend
npm install
cp .env.example .env     # Windows : copy .env.example .env
```

## Configuration

Toutes les variables sont facultatives en développement.

| Variable | Rôle | Défaut |
|----------|------|--------|
| `PORT` | Port d'écoute | `3000` |
| `DB_PATH` | Fichier SQLite | `./data/campusride.db` |
| `JWT_SECRET` | Secret de signature des jetons. **Obligatoire en production.** Vide en développement : un secret aléatoire est généré à chaque lancement | (vide) |
| `JWT_TTL_SECONDS` | Durée de validité d'un jeton | `604800` (7 jours) |
| `LOGIN_MAX_ATTEMPTS` | Échecs de connexion tolérés par IP et par fenêtre | `10` |
| `LOGIN_WINDOW_SECONDS` | Durée de la fenêtre | `900` |
| `ALLOWED_EMAIL_DOMAINS` | Domaines d'e-mail acceptés, séparés par des virgules (vide = tous) | (vide) |
| `CORS_ORIGIN` | Origine du front-end autorisée (CORS) | `http://localhost:5173` |
| `NODE_ENV` | `development` ou `production` | `development` |

## Lancer l'application

```bash
npm start        # serveur sur http://localhost:3000
npm run dev      # rechargement automatique
npm run seed     # données de démonstration
```

### Créer un administrateur

On ne devient jamais admin par l'inscription. Après avoir créé un compte :

```bash
npm run make-admin
```

## Comptes de démo

À COMPLÉTER (comptes créés par `npm run seed`)

## Tests et qualité

```bash
npm test         # 73 tests
npm run lint     # ESLint
```

Les tests couvrent l'authentification, la validation par le conducteur,
les notifications, l'administration, la concurrence (30 demandes
simultanées sur 3 places), les jetons falsifiés, les données malveillantes
et la charge. Ils sont lancés par GitHub Actions à chaque push.

## Documentation

- [Documentation de l'API](docs/API.md)
- [Décisions d'architecture (ADR)](docs/adr/)
  - ADR-001 : stack technique
  - ADR-002 : base de données
  - ADR-003 : modération et rôles
  - ADR-004 : notifications

## Captures d'écran

À AJOUTER

## Hors périmètre de cette version

Vérification d'e-mail, photo de profil, mode sombre, PWA, jetons de
renouvellement, pagination, limiteurs d'écriture, journaux structurés,
sauvegardes automatiques.