// Портреты людей. Картинки не помещаются в localStorage, поэтому лежат в
// IndexedDB браузера; в модели у человека только id фото. Загруженное фото
// ужимается до квадратного портрета PORTRAIT px в JPEG (~20–40 КБ).
const DB_NAME = 'memento-photos';
const STORE = 'photos';
export const PORTRAIT = 256;

let opening = null;
const urls = new Map(); // id фото → object URL

function db() {
  opening ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Браузер не даёт хранить фото (IndexedDB недоступен)'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function run(mode, action) {
  const base = await db();
  return new Promise((resolve, reject) => {
    const tx = base.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Квадратный портрет из файла. Кадр по центру, у вертикальных фото — чуть
// выше центра: там обычно лицо.
export async function portraitFrom(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Это не картинка');
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = PORTRAIT;
  canvas.height = PORTRAIT;
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) * 0.3;
  canvas.getContext('2d').drawImage(bitmap, sx, sy, side, side, 0, 0, PORTRAIT, PORTRAIT);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Не удалось сжать фото'))), 'image/jpeg', 0.86),
  );
}

export async function savePhoto(blob) {
  const id = `ph${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await run('readwrite', (store) => store.put(blob, id));
  urls.set(id, URL.createObjectURL(blob));
  return id;
}

// Загружает фото в кэш; потом его адрес отдаёт cachedPhoto без ожидания.
export async function loadPhoto(id) {
  if (!id) return null;
  if (urls.has(id)) return urls.get(id);
  const blob = await run('readonly', (store) => store.get(id));
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

export const cachedPhoto = (id) => (id ? urls.get(id) ?? null : null);

export async function deletePhoto(id) {
  if (!id) return;
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  await run('readwrite', (store) => store.delete(id));
}

// Удаляет фото, на которые больше никто не ссылается (удалённые люди,
// семья заданная заново текстом).
export async function prunePhotos(keep) {
  const ids = await run('readonly', (store) => store.getAllKeys());
  await Promise.all(ids.filter((id) => !keep.has(id)).map(deletePhoto));
}
