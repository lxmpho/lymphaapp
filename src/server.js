// Lympha Evidence Engine — HTTP API + планировщик.
//
// Эндпоинты:
//   GET /api/feed                — лента готовых статей (?specialty=)
//   GET /api/digest              — дайджест недели (топ-3 на специальность)
//   GET /api/article/:id         — содержимое статьи (PMID или PMCID)
//   GET /api/article/:id/fulltext— полный текст OA-статьи (секции)
//   GET /api/guidelines          — клинические руководства (?specialty=)
//   GET /api/health              — статус и время последней сборки
//
// Планировщик: node-cron, ежесуточно ночью (04:00) запускает runCollection.

import express from 'express';
import cron from 'node-cron';
import { getLatest } from './lib/storage.js';
import { getArticle, getFullText } from './lib/europepmc.js';
import { getGuidelinesFor } from './data/guidelines.js';
import { runCollection } from './jobs/collect.js';

const app = express();
const PORT = process.env.PORT || 3000;

// PATH B: идентификатор статьи — это PMID (цифры) ИЛИ PMCID (PMC + цифры).
const ID_RE = /^(PMC)?\d+$/i;

// CORS — Telegram Mini App грузится с другого домена.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// --- Лента ---
app.get('/api/feed', async (req, res) => {
  const snap = await getLatest();
  if (!snap) return res.status(503).json({ error: 'Подборки ещё не сформированы. Запустите сбор.' });
  const { specialty } = req.query;
  let feed = snap.feed || [];
  if (specialty) feed = feed.filter((a) => a.specialty === specialty);
  res.json({ feed, generatedAt: snap.generatedAt, window: snap.window });
});

// --- Дайджест ---
app.get('/api/digest', async (req, res) => {
  const snap = await getLatest();
  if (!snap) return res.status(503).json({ error: 'Подборки ещё не сформированы. Запустите сбор.' });
  const { specialty } = req.query;
  const digest = specialty
    ? { [specialty]: snap.digest?.[specialty] || [] }
    : snap.digest || {};
  res.json({ digest, generatedAt: snap.generatedAt });
});

// --- Статья по идентификатору (PMID или PMCID) ---
app.get('/api/article/:id', async (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'Некорректный идентификатор' });
  try {
    const article = await getArticle(id);
    if (!article) return res.status(404).json({ error: 'Статья не найдена' });
    res.json({ article });
  } catch (err) {
    res.status(502).json({ error: 'Источник недоступен', detail: err.message });
  }
});

// --- Полный текст Open Access статьи ---
// PATH B: принимаем PMID или PMCID; полный текст тянем по pmcid найденной статьи.
app.get('/api/article/:id/fulltext', async (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'Некорректный идентификатор' });
  try {
    const article = await getArticle(id);
    if (!article) return res.status(404).json({ error: 'Статья не найдена' });

    if (!article.fullTextAvailable || !article.pmcid) {
      return res.json({
        id,
        fullText: null,
        reason: 'not_open_access',
        message: 'Полный текст доступен только для статей открытого доступа.',
      });
    }

    const sections = await getFullText(article.pmcid);
    res.json({
      id,
      pmcid: article.pmcid,
      fullText: sections,
      reason: sections ? null : 'not_retrievable',
    });
  } catch (err) {
    res.status(502).json({ error: 'Источник недоступен', detail: err.message });
  }
});

// --- Клинические руководства ---
app.get('/api/guidelines', (req, res) => {
  const { specialty } = req.query;
  const guidelines = getGuidelinesFor(specialty || null);
  res.json({ guidelines, count: guidelines.length });
});

// --- Здоровье сервиса ---
app.get('/api/health', async (req, res) => {
  const snap = await getLatest();
  res.json({
    status: 'ok',
    lastCollection: snap?.generatedAt || null,
    feedSize: snap?.feed?.length || 0,
    specialties: snap?.digest ? Object.keys(snap.digest).length : 0,
  });
});

// --- Ручной триггер сбора ---
app.get('/api/admin/collect', async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (token && req.query.token !== token) return res.status(403).json({ error: 'forbidden' });
  try {
    const snap = await runCollection();
    res.json({ ok: true, feedSize: snap.feed.length, generatedAt: snap.generatedAt });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Планировщик: каждый день в 04:00 ---
cron.schedule('0 4 * * *', () => {
  console.log('[cron] запуск ночной сборки…');
  runCollection().catch((e) => console.error('[cron] сбой сборки:', e.message));
});

// PATH B бонус: автосбор при старте, если снимок пуст (лечит обнуление ленты
// после редеплоя на бесплатном Render с эфемерным диском).
app.listen(PORT, async () => {
  console.log(`Lympha Evidence Engine слушает порт ${PORT}`);
  console.log(`Планировщик: ежедневно 04:00. Ручной запуск: npm run collect`);
  try {
    const snap = await getLatest();
    if (!snap || !snap.feed || snap.feed.length === 0) {
      console.log('[startup] снимок пуст — запускаю первичный сбор…');
      runCollection().catch((e) => console.error('[startup] сбой сбора:', e.message));
    } else {
      console.log(`[startup] снимок на месте: ${snap.feed.length} статей`);
    }
  } catch (e) {
    console.error('[startup] проверка снимка не удалась:', e.message);
  }
});
