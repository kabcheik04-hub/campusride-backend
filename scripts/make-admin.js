// Donne le rôle administrateur à un compte existant : npm run make-admin -- adresse@exemple.fr
// (le rôle admin ne s'obtient jamais par l'API : seule une personne ayant accès au serveur peut l'attribuer)
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email) {
  console.error('Usage : npm run make-admin -- adresse@exemple.fr');
  process.exit(1);
}

const db = openDb(loadConfig().dbPath);
const user = db.prepare('SELECT id, name, is_admin FROM users WHERE email = ?').get(email);
if (!user) {
  console.error(`Aucun compte avec l'adresse ${email}. Le compte doit d'abord être créé par l'inscription.`);
  db.close();
  process.exit(1);
}
db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
console.log(user.is_admin ? `${user.name} était déjà administrateur.` : `${user.name} est maintenant administrateur.`);
db.close();
