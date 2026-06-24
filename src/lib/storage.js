// Хранилище готовых подборок.
//
// Решение: JSON-на-диске вместо БД. Для MVP, который отдаёт ПРЕДВЫЧИСЛЕННЫЕ
// подборки раз в сутки, этого более чем достаточно: запись редкая (1 раз/ночь),
// чтение частое и тривиальное. Ноль нативных зависимостей, ноль настройки,
// легко дебажить глазами. Когда понадобится персонализация и история по
// пользователям — переключение на SQLite/Postgres затронет только этот файл,
// интерфейс (getLatest/saveSnapshot/getSeenPmids) останется прежним.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const SNAPSHOT_FILE = join(DATA_DIR, 'snapshot.json');   // последняя готовая выдача
const SEEN_FILE = join(DATA_DIR, 'seen.json');           // показанные ранее PMID (антидубли)

async function ensureDir() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
}

// --- Снимок выдачи (то, что отдаём клиенту) ---
export async function saveSnapshot(snapshot) {
  await ensureDir();
  await writeFile(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
}

export async function getLatest() {
  if (!existsSync(SNAPSHOT_FILE)) return null;
  try {
    return JSON.parse(await readFile(SNAPSHOT_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// --- Антидубли: множество ранее показанных PMID по специальностям ---
// Структура: { implant: ["123","456"], endo: [...] }. Храним последние N на специальность.
export async function getSeen() {
  if (!existsSync(SEEN_FILE)) return {};
  try {
    return JSON.parse(await readFile(SEEN_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export async function getSeenPmids(specialtyKey) {
  const seen = await getSeen();
  return new Set((seen[specialtyKey] || []).map(String));
}

export async function addSeenPmids(specialtyKey, pmids, keepLast = 300) {
  await ensureDir();
  const seen = await getSeen();
  const prev = seen[specialtyKey] || [];
  const merged = [...pmids.map(String), ...prev];
  // dedupe сохраняя порядок (свежие впереди), обрезаем хвост
  seen[specialtyKey] = [...new Set(merged)].slice(0, keepLast);
  await writeFile(SEEN_FILE, JSON.stringify(seen, null, 2), 'utf8');
}
