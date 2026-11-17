# ADR-004 : notifications internes

## Contexte
Le conducteur doit savoir qu'une demande l'attend, et le passager que sa demande a été traitée ou que son trajet est annulé, sans quitter l'application.

## Décision
- Table `notifications` (une ligne par destinataire), écrite **dans la transaction** de l'action qui la déclenche : une notification n'existe jamais sans l'action, ni l'inverse.
- Le client interroge `GET /api/notifications/unread-count` toutes les 30 secondes (en pause quand l'onglet est caché). Pas de WebSocket ni de SSE : plus simple, suffisant pour la démo.
- Une notification d'un autre utilisateur répond 404 (on ne révèle pas son existence).
- La liste est limitée aux 30 plus récentes.

## Conséquences
- Délai d'apparition de 30 secondes au plus.
- Pas de notification à un compte suspendu (il ne peut plus se connecter).
- Pas de notification au conducteur quand un passager suspendu voit ses réservations annulées : amélioration possible.
- Pas de purge des anciennes notifications.