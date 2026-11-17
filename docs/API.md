\# API CampusRide



API REST en JSON. Adresse de base en local : `http://localhost:3000`.



\## Conventions



\- \*\*Authentification\*\* : les routes marquées 🔒 exigent un jeton, obtenu à l'inscription ou à la connexion, envoyé dans l'en-tête `Authorization: Bearer <jeton>`. Les routes marquées 🛡️ exigent en plus le rôle administrateur.

\- \*\*Corps des requêtes\*\* : JSON (`Content-Type: application/json`).

\- \*\*Dates\*\* : format ISO 8601 en UTC (ex. `2026-12-01T07:00:00.000Z`).

\- \*\*Prix\*\* : en euros entiers.

\- \*\*Codes d'erreur\*\* : `400` données invalides, `401` non authentifié, `403` droits insuffisants, `404` introuvable, `409` conflit d'état (déjà traité, complet, déjà parti…), `429` trop de tentatives de connexion (en-tête `Retry-After`).



\## Statuts



| Objet | Valeurs |

|-------|---------|

| Réservation (`status`) | `pending` (en attente), `confirmed` (acceptée), `refused` (refusée), `cancelled` (annulée) |

| Trajet (`status`) | `open`, `cancelled` |

| Trajet côté passager (`trip\_state`) | `open`, `done` (déjà parti), `cancelled` |

| Signalement (`status`) | `open`, `resolved` |



Une demande `pending` \*\*ne retire aucune place\*\* : seul le conducteur, en acceptant, les attribue.



\## Santé



| Méthode | Route | Description |

|---------|-------|-------------|

| GET | `/api/health` | Renvoie `{ "status": "ok" }` |



\## Authentification et profil



| Méthode | Route | Accès | Description |

|---------|-------|-------|-------------|

| POST | `/api/auth/register` | public | Inscription. Renvoie `201` avec `token` et `user` |

| POST | `/api/auth/login` | public | Connexion. Renvoie `token` et `user` |

| GET | `/api/me` | 🔒 | Profil de l'utilisateur connecté |

| PATCH | `/api/me` | 🔒 | Modifier `name`, `role` ou `photo\_url` |



\*\*Inscription\*\* : `email` (valide, domaine autorisé si `ALLOWED\_EMAIL\_DOMAINS` est défini), `password` (8 à 200 caractères), `name` (2 à 80), `role` (`driver`, `passenger` ou `both`, défaut `both`), `photo\_url` (facultatif, `http://` ou `https://`). On ne devient jamais administrateur par l'inscription ni par le profil.



```json

{ "email": "lea@campus.test", "password": "password123", "name": "Léa Martin", "role": "passenger" }

```



\*\*Connexion\*\* : `email` et `password`. Mêmes réponses `401` pour un e-mail inconnu et un mauvais mot de passe. Un compte suspendu reçoit `403` (code `account\_suspended`). Trop d'échecs par IP : `429` avec `Retry-After`.



\## Trajets



| Méthode | Route | Accès | Description |

|---------|-------|-------|-------------|

| GET | `/api/trips` | public | Recherche. Filtres : `origin`, `destination`, `date` (`AAAA-MM-JJ`), `seats` (défaut 1). Trajets ouverts et à venir, 200 maximum |

| GET | `/api/trips/:id` | public | Détail d'un trajet |

| POST | `/api/trips` | 🔒 | Publier un trajet (interdit au profil `passenger`) |

| DELETE | `/api/trips/:id` | 🔒 | Annuler son trajet (conducteur uniquement) |

| GET | `/api/me/trips` | 🔒 | Mes trajets publiés, avec leurs réservations |



\*\*Publication\*\* : `origin` et `destination` (2 à 120 caractères, différents), `departure\_at` (dans le futur), `seats\_total` (1 à 8), `price` (0 ou plus).



```json

{ "origin": "Gare", "destination": "Campus Sciences", "departure\_at": "2026-12-01T08:00:00.000Z", "seats\_total": 3, "price": 2 }

```



\*\*Annulation\*\* : possible uniquement avant le départ. Les demandes en attente et les réservations acceptées passent en `cancelled`, et les passagers concernés sont notifiés.



\## Réservations



| Méthode | Route | Accès | Description |

|---------|-------|-------|-------------|

| POST | `/api/trips/:id/bookings` | 🔒 | Demander des places. Corps : `seats` (1 à 4, défaut 1). Crée une demande `pending` (`201`) |

| DELETE | `/api/bookings/:id` | 🔒 | Annuler sa demande ou sa réservation (passager uniquement) |

| PATCH | `/api/bookings/:id/accept` | 🔒 | Accepter une demande (conducteur du trajet) |

| PATCH | `/api/bookings/:id/refuse` | 🔒 | Refuser une demande (conducteur du trajet) |

| GET | `/api/me/bookings` | 🔒 | Mes demandes et réservations |



\*\*Règles\*\*

\- On ne peut pas réserver son propre trajet (`403`), ni avoir deux demandes actives sur le même trajet (`409`).

\- Accepter revérifie la capacité : on ne dépasse jamais le nombre de places (`409`).

\- On ne répond qu'une fois à une demande (`409` si elle est déjà traitée).

\- Aucune action possible sur un trajet annulé ou déjà parti (`409`).

\- Ordre des contrôles pour accepter et refuser : existence (`404`), droits (`403`), état (`409`).



\## Avis



| Méthode | Route | Accès | Description |

|---------|-------|-------|-------------|

| POST | `/api/trips/:id/reviews` | 🔒 | Laisser un avis. Corps : `target\_id`, `rating` (1 à 5), `comment` (facultatif, 500 caractères max) |

| GET | `/api/users/:id/reviews` | public | Avis reçus par un utilisateur, avec `average` et `count` |



\*\*Règles\*\* : le trajet doit être effectué et non annulé, l'auteur et la cible doivent y avoir participé (réservation acceptée ou conducteur), pas d'auto-évaluation, un seul avis par personne et par trajet. Une demande seulement en attente ne donne pas le droit de laisser un avis.



\## Signalements



| Méthode | Route | Accès | Description |

|---------|-------|-------|-------------|

| POST | `/api/reports` | 🔒 | Signaler un utilisateur, un trajet ou un avis |



Corps : `target\_type` (`user`, `trip` ou `review`), `target\_id`, `reason` (`inappropriate`, `spam`, `dangerous`, `fraud`, `other`), `details` (facultatif, 500 max).



On ne peut pas se signaler soi-même ni signaler ses propres contenus (`400`). Signaler deux fois le même élément tant que le premier signalement est ouvert renvoie `409`.



\## Notifications



Chaque utilisateur ne voit et ne modifie que ses propres notifications (celles des autres répondent `404`).



| Méthode | Route | Accès | Description |

|---------|-------|-------|-------------|

| GET | `/api/notifications` | 🔒 | 30 dernières notifications (plus récentes d'abord) et `unread\_count` |

| GET | `/api/notifications/unread-count` | 🔒 | Nombre de notifications non lues (pour la cloche) |

| POST | `/api/notifications/read-all` | 🔒 | Tout marquer comme lu (l'historique est conservé) |

| POST | `/api/notifications/:id/read` | 🔒 | Marquer une notification comme lue (idempotent) |



Types d'événements : `booking\_request` (nouvelle demande, vers le conducteur), `booking\_accepted` et `booking\_refused` (vers le passager), `booking\_cancelled` (annulation par le passager, vers le conducteur), ainsi que les annulations de trajet (par le conducteur, par un admin ou par suspension).



\## Administration 🛡️



Toutes ces routes refusent les visiteurs (`401`) et les non-admins (`403`). Chaque action est écrite dans le journal.



| Méthode | Route | Description |

|---------|-------|-------------|

| GET | `/api/admin/reports` | File de signalements. `status` : `open` (défaut), `resolved` ou `all`. Chaque signalement contient un résumé de sa cible |

| PATCH | `/api/admin/reports/:id/resolve` | Classer un signalement |

| GET | `/api/admin/users` | Rechercher des utilisateurs. Paramètre `q` (nom ou e-mail), avec le nombre de signalements ouverts |

| POST | `/api/admin/users/:id/suspend` | Suspendre un compte. Corps facultatif : `reason` (200 max) |

| POST | `/api/admin/users/:id/unsuspend` | Réactiver un compte |

| GET | `/api/admin/reviews` | 50 avis les plus récents |

| DELETE | `/api/admin/reviews/:id` | Supprimer un avis (la note du conducteur est recalculée) |

| DELETE | `/api/admin/trips/:id` | Retirer un trajet (annulé, historique conservé) |

| GET | `/api/admin/actions` | Journal des 50 dernières actions d'administration |



\*\*Suspension\*\* : l'accès est coupé immédiatement (le jeton existant ne fonctionne plus), les trajets et réservations à venir du compte sont annulés, les passagers concernés sont notifiés et les signalements ouverts sur ce compte sont classés. Garde-fous : pas d'auto-suspension, pas de suspension d'un administrateur, pas de double suspension (`409`).



\*\*Retrait d'un trajet\*\* : impossible s'il est déjà annulé ou déjà parti (`409`).Après `npm run seed`, tous les comptes ont le mot de passe `password123` :



| E-mail | Rôle |

|--------|------|

| `awa@campus.test` | Conducteur |

| `yann@campus.test` | Conducteur et passager |

| `lea@campus.test` | Passager |

| `admin@campus.test` | Administrateur |

