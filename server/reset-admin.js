// Emergency password reset: `npm run reset-admin` (run on the server PC).
// Gives the "admin" user a new random temporary password, saved to data/initial-admin-password.txt.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, migrate, DATA_DIR, audit } from './db.js';
import { hashPassword } from './auth.js';

migrate();
const pw = crypto.randomBytes(6).toString('base64url');
const info = db.prepare("UPDATE users SET pass_hash = ?, must_change = 1, active = 1, role = 'admin' WHERE username = 'admin'").run(hashPassword(pw));
if (!info.changes) {
  db.prepare("INSERT INTO users (username, name, role, pass_hash, must_change) VALUES ('admin', 'Administrator', 'admin', ?, 1)").run(hashPassword(pw));
}
db.prepare("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'admin')").run();
audit('system', 'users', null, 'password reset', 'admin (reset-admin script)');
const file = path.join(DATA_DIR, 'initial-admin-password.txt');
fs.writeFileSync(file, `WIESPL CRM admin login (reset ${new Date().toLocaleString()})\nusername: admin\npassword: ${pw}\n\nYou will be asked to change it after logging in. Delete this file afterwards.\n`);
console.log(`Admin password reset. New temporary password saved in ${file}`);
