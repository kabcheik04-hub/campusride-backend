# ADR 002 : Choix de la base de données

- **Statut** : acceptée
- **Date** : 12 novembre 2026
- **Projet** : CampusRide, application de covoiturage étudiant (TD Projet Web, MIAGE 2)

## Contexte

Les données de CampusRide sont fortement liées entre elles : un utilisateur publie des trajets,
un trajet reçoit des réservations, et des avis relient des utilisateurs après un trajet.
Deux règles métier demandent de la cohérence : on ne doit jamais réserver plus de places qu'il n'en
reste, et un passager ne peut avoir qu'une réservation active par trajet.

Contraintes : le projet doit se lancer sans installer ni configurer un serveur de base de données,
et l'évaluateur doit pouvoir le démarrer avec le README seul.

## Décision

Utiliser une base de données **relationnelle SQLite**, fournie par le module `node:sqlite` intégré à
Node.js 22, stockée dans un fichier (`data/campusride.db`, ignoré par Git).

Le schéma comporte 4 tables : `users`, `trips`, `bookings`, `reviews`, avec :

- des clés étrangères activées (`PRAGMA foreign_keys = ON`) ;
- des contraintes de validité en base (`CHECK` sur les rôles, les statuts, les notes de 1 à 5, le nombre de places) ;
- un **index unique partiel** sur les réservations confirmées `(trip_id, passenger_id)`, qui interdit
  les doublons même si deux requêtes arrivent en même temps ;
- une réservation faite dans une **transaction** (`BEGIN IMMEDIATE`) : le calcul des places libres et
  l'enregistrement sont indivisibles, ce qui empêche la surréservation.

## Alternatives étudiées

| Option | Avantage | Raison du rejet |
| --- | --- | --- |
| PostgreSQL | Très robuste, adapté à de gros volumes | Demande d'installer et de configurer un serveur sur chaque poste, trop lourd pour un MVP de TD |
| MySQL / MariaDB | Très répandu | Même contrainte d'installation, sans bénéfice pour ce projet |
| MongoDB (base documents) | Schéma souple | Les données sont très relationnelles (réservations, avis) : jointures et contraintes d'intégrité à refaire à la main |
| Fichiers JSON | Aucun outil à apprendre | Aucune transaction ni contrainte : risque de surréservation et de données corrompues |

## Conséquences

- **Positives** : aucune installation ni configuration, démarrage immédiat, données cohérentes grâce
  aux contraintes et aux transactions, base facile à remettre à zéro (supprimer le fichier).
- **Négatives** : SQLite n'est pas pensé pour beaucoup d'écritures simultanées ni pour plusieurs serveurs
  d'API en parallèle. Le module `node:sqlite` est encore marqué « expérimental » et affiche un
  avertissement au lancement, sans effet sur le fonctionnement.
- **Évolution possible** : le SQL utilisé reste standard. Un passage à PostgreSQL en production demanderait
  d'adapter `src/db.js` et quelques fonctions propres à SQLite (dates, `strftime`), sans changer le modèle
  de données ni les routes.
