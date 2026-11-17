# ADR-003 : rôle administrateur, signalements et suspension

**Statut :** accepté

## Contexte

La V5 ajoute la modération : les utilisateurs signalent un trajet, un compte ou un avis, et des administrateurs agissent (suspendre, retirer, supprimer).

## Décisions

1. **Le rôle administrateur est une colonne séparée (`users.is_admin`)**, pas une valeur de `users.role`. `role` est choisi librement par l'utilisateur (conducteur, passager ou les deux) ; un droit d'administration ne doit jamais pouvoir passer par ce champ. L'attribution se fait uniquement depuis le serveur (`npm run make-admin`).
2. **L'état de suspension est lu en base à chaque requête authentifiée.** Un jeton JWT reste valide jusqu'à son expiration : sans cette vérification, un compte suspendu garderait son accès pendant plusieurs jours. Le coût est une lecture déjà faite pour charger l'utilisateur.
3. **Une suspension annule les trajets à venir et les réservations à venir du compte**, pour ne laisser aucune réservation sans conducteur ou sans passager.
4. **« Supprimer » un trajet signifie l'annuler** : l'historique (réservations, avis) reste cohérent et la clé étrangère n'est jamais cassée. Les avis, eux, sont supprimés pour de bon.
5. **Un signalement ouvert est unique par personne et par cible** (index unique partiel), pour éviter le harcèlement par signalements répétés. Une action de l'administrateur sur la cible classe automatiquement ses signalements ouverts.
6. **Un journal des actions d'administration** (`admin_actions`) enregistre chaque action réussie dans la même transaction que l'action elle-même : on ne peut pas avoir l'une sans l'autre.

## Conséquences

- Un administrateur ne peut être ni suspendu ni se suspendre : aucun risque de se retrouver sans administrateur par une action de l'interface.
- Pas de notification automatique à l'utilisateur sanctionné pour l'instant (prévu avec les notifications internes).
