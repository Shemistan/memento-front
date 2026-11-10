// Администраторы семьи — те, кто может публиковать её для всех.
//   npm run admin -- add <логин>      добавить или сменить пароль (спросит пароль)
//   npm run admin -- remove <логин>   убрать (права пропадают сразу)
//   npm run admin -- list             кто сейчас администратор
// Пароль можно передать в ADMIN_PASSWORD (для скриптов). Данные — в DATA_DIR.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { LOGIN, MIN_PASSWORD, hashPassword, readAdmins, writeAdmins } from '../server/auth.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DATA_DIR = resolve(process.env.DATA_DIR || resolve(ROOT, 'data'));
const FILE = resolve(DATA_DIR, 'admins.json');
const [command, login] = process.argv.slice(2);

// Пароль спрашиваем, не показывая вводимые символы.
function askPassword(question) {
  if (process.env.ADMIN_PASSWORD) return Promise.resolve(process.env.ADMIN_PASSWORD);
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (text) => {
      if (!muted) process.stdout.write(text);
    };
    rl.question(question, (answer) => {
      process.stdout.write('\n');
      rl.close();
      done(answer);
    });
    muted = true;
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
const admins = await readAdmins(FILE);

if (command === 'list') {
  const names = Object.keys(admins);
  console.log(names.length ? names.join('\n') : 'Администраторов пока нет');
} else if (command === 'add') {
  if (!LOGIN.test(login ?? '')) fail('Логин: 2–40 символов, латиница, цифры, «.», «_», «-»');
  const password = await askPassword(`Пароль для ${login}: `);
  if (password.length < MIN_PASSWORD) fail(`Пароль слишком короткий: нужно не меньше ${MIN_PASSWORD} символов`);
  if (!process.env.ADMIN_PASSWORD && (await askPassword('Ещё раз: ')) !== password) fail('Пароли не совпали');
  const existed = Object.hasOwn(admins, login);
  admins[login] = await hashPassword(password);
  await writeAdmins(FILE, admins);
  console.log(existed ? `Пароль ${login} изменён` : `${login} теперь администратор`);
} else if (command === 'remove') {
  if (!Object.hasOwn(admins, login ?? '')) fail(`${login} — не администратор`);
  delete admins[login];
  await writeAdmins(FILE, admins);
  console.log(`${login} больше не администратор`);
} else {
  fail('Команды: add <логин>, remove <логин>, list');
}
