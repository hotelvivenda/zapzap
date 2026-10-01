// Uso: printf '%s' "nova-senha" | node server/src/reset-password.js <usuario>
// Define a senha de um atendente direto no banco (recuperação de acesso pelo terminal do servidor).
import { db } from './db.js';
import { hashPassword } from './auth.js';

const username = String(process.argv[2] || 'admin').trim().toLowerCase();
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const password = input.replace(/\r?\n$/, '');
  if (password.length < 8) {
    console.error('A senha precisa ter pelo menos 8 caracteres.');
    process.exit(1);
  }
  const r = db.prepare('UPDATE users SET password_hash = ?, active = 1 WHERE username = ?').run(hashPassword(password), username);
  if (!r.changes) {
    console.error(`Usuário "${username}" não encontrado.`);
    process.exit(1);
  }
  console.log(`Senha de "${username}" alterada.`);
});
