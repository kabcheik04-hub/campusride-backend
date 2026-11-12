# ADR 001 : Choix de la stack technique

- **Statut** : acceptée
- **Date** : 12 novembre 2026
- **Projet** : CampusRide, application de covoiturage étudiant (TD Projet Web, MIAGE 2)

## Contexte

CampusRide permet à des étudiants de proposer et de réserver des trajets vers le campus.
Le MVP (inscription, publication, recherche, réservation, tableau de bord, avis) doit être codé,
testé et livré en quelques semaines par une équipe de 4 personnes, avec un front-end connecté
à un back-end et à une base de données.

Contraintes qui pèsent sur le choix :

- peu de temps : il faut une installation simple, que chaque membre du groupe réussit en quelques minutes ;
- le projet est évalué sur sa propreté et sur sa capacité à démarrer avec le README seul ;
- le front-end et le back-end sont développés en parallèle, ils doivent se parler par une API claire.

## Décision

- **Back-end** : Node.js 22 en JavaScript, avec le serveur HTTP intégré (sans framework). L'API est REST,
  en JSON, organisée en routes (`auth`, `trips`, `bookings`, `reviews`).
- **Authentification** : mots de passe hachés avec scrypt (module `crypto` de Node) et jetons JWT signés
  en HMAC SHA-256, envoyés dans l'en-tête `Authorization`.
- **Front-end** : application web indépendante, qui appelle l'API par `fetch`. Le back-end autorise son
  adresse par CORS (variable `CORS_ORIGIN`).
- **Qualité** : tests automatiques avec le module `node:test`, linter ESLint, configuration par fichier `.env`.

## Alternatives étudiées

| Option | Avantage | Raison du rejet |
| --- | --- | --- |
| Express (ou Fastify) | Très répandu, nombreux exemples | Une dépendance de plus à installer, alors que les besoins du MVP (une dizaine de routes) se couvrent avec Node seul |
| PHP / Laravel | Tout-en-un, nombreux outils | Le groupe travaille déjà en JavaScript, un deuxième langage ralentirait le front et le back |
| Python / Django | Administration et sécurité intégrées | Même raison, et stack plus lourde pour un MVP de cette taille |
| Back-end as a service (Firebase, Supabase) | Très rapide à mettre en place | Le TD demande de coder le back-end et la base de données, et de justifier ces choix |

## Conséquences

- **Positives** : un seul langage pour toute l'équipe, installation en 4 commandes (`npm install`, puis
  `npm start`), aucune dépendance d'exécution à maintenir, code simple à lire et à tester.
- **Négatives** : le routage, la validation des données et la gestion des erreurs sont écrits à la main
  (environ 150 lignes dans `src/app.js` et `src/validation.js`). Pas de limitation du nombre de requêtes
  ni de mécanisme de renouvellement des jetons dans cette version.
- **Évolution possible** : si l'API grossit, la structure en routes séparées permet de passer à Express ou
  Fastify en ne modifiant que `src/app.js`.
