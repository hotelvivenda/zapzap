// Uso: node server/src/hash-password.js   (lê a senha da entrada padrão e imprime o hash)
import { hashPassword } from './auth.js';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const password = input.replace(/\r?\n$/, '');
  if (password.length < 8) {
    console.error('A senha precisa ter pelo menos 8 caracteres.');
    process.exit(1);
  }
  console.log(hashPassword(password));
});
