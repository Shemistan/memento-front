// Сервер семьи (server/app.js): опубликованная семья и вход администраторов.
// Адреса относительные — приложение может жить не в корне сайта. Без сервера
// (статический хостинг) family() и me() возвращают null и приложение
// работает только с данными этого браузера.
const HEADERS = { 'content-type': 'application/json', 'x-memento': '1' };

async function call(method, path, body) {
  const res = await fetch(path, { method, headers: HEADERS, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || `Сервер ответил ${res.status}`), { status: res.status });
  if (data === null) throw new Error('Сервер ответил не JSON');
  return data;
}

async function quiet(promise) {
  try {
    return await promise;
  } catch {
    return null;
  }
}

// { savedAt, by, family } или null — опубликованной семьи нет или нет сервера.
export const publishedFamily = () => quiet(call('GET', 'api/family'));
// { admin: логин | null } или null — сервера с входом нет.
export const whoAmI = () => quiet(call('GET', 'api/me'));
export const logIn = (login, password) => call('POST', 'api/login', { login, password });
export const logOut = () => call('POST', 'api/logout', {});
// base — savedAt версии, от которой шли правки: сервер не даст затереть более новую.
export const publish = (bundle, base) => call('PUT', 'api/family', { bundle, base });
