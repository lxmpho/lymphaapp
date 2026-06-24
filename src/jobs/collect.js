// Задание сбора — ядро планировщика (разделы 2 и 5 ТЗ).
//
// ШАГ 1 СБОР: опрос Europe PMC по запросу каждой специальности за окно дат.
// ШАГ 2 ОТБОР: нормализация, антидубли, ранжирование, топ-3 для дайджеста.
// ШАГ 3 ВЫДАЧА: формирование снимка в формате клиента (раздел 6) и сохранение.

import { SPECIALTIES, EVIDENCE_PUB_TYPES } from '../lib/specialties.js';
import { buildSpecialtyQuery, searchArticles, normalizeArticle } from '../lib/europepmc.js';
import { rankArticles, pickDigest, fallbackWhy } from '../lib/ranking.js';
import { saveSnapshot, getSeenPmids, addSeenPmids } from '../lib/storage.js';
import { translateTitles } from '../lib/translate.js';

// Формат даты YYYY-MM-DD для FIRST_PDATE.
function ymd(date) {
  return date.toISOString().slice(0, 10);
}

// Окно сбора: последние N дней (по умолчанию 30, раздел 5 — окно 7–30 дней).
function dateWindow(days = 30) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { dateFrom: ymd(from), dateTo: ymd(to) };
}

export async function runCollection({ windowDays = 30, perSpecialty = 25, digestSize = 3 } = {}) {
  const now = new Date();
  const { dateFrom, dateTo } = dateWindow(windowDays);

  const feed = [];
  const digest = {};
  const errors = [];

  for (const [key, spec] of Object.entries(SPECIALTIES)) {
    try {
      // ШАГ 1 — СБОР
      const query = buildSpecialtyQuery({
        terms: spec.terms,
        pubTypes: EVIDENCE_PUB_TYPES,
        dateFrom,
        dateTo,
      });
      const raw = await searchArticles({ query, pageSize: perSpecialty, sort: 'CITED desc' });
      const articles = raw.map(normalizeArticle);

      // ШАГ 2 — ОТБОР (антидубли + ранжирование)
      const excludePmids = await getSeenPmids(key);
      const ranked = rankArticles(articles, { excludePmids, now });

      // Перевод заголовков топ-результатов (раздел: перевод на бэкенде).
      const topForFeed = ranked.slice(0, 10);
      const titlesRu = await translateTitles(topForFeed.map((a) => a.title));
      topForFeed.forEach((a, i) => { a.titleRu = titlesRu[i]; });

      // Наполняем общую ленту.
      topForFeed.forEach((a) => {
        feed.push({
          pmid: String(a.pmid),
          specialty: key,
          type: a.typeCode,
          titleRu: a.titleRu || a.title,
          title: a.title,
          journal: a.journal,
          date: a.firstPublishDate || `${a.pubYear}`,
          citedByCount: a.citedByCount,
          isOpenAccess: a.isOpenAccess,
        });
      });

      // ШАГ 3 (частично) — дайджест топ-3 с "почему важно".
      digest[key] = pickDigest(ranked, digestSize).map((a, i) => ({
        pmid: String(a.pmid),
        titleRu: titlesRu[i] || a.title,
        why: fallbackWhy(a),
      }));

      // Запоминаем показанные PMID для будущих антидублей.
      await addSeenPmids(key, topForFeed.map((a) => String(a.pmid)));

      console.log(`[collect] ${key}: собрано ${articles.length}, в ленту ${topForFeed.length}`);
    } catch (err) {
      console.warn(`[collect] ${key}: ошибка — ${err.message}`);
      errors.push({ specialty: key, error: err.message });
    }
  }

  // ШАГ 3 — ВЫДАЧА: формат раздела 6 ТЗ.
  const snapshot = {
    feed: feed.sort((a, b) => new Date(b.date) - new Date(a.date)),
    digest,
    generatedAt: now.toISOString(),
    window: { from: dateFrom, to: dateTo },
    errors: errors.length ? errors : undefined,
  };

  await saveSnapshot(snapshot);
  console.log(`[collect] снимок сохранён: ${feed.length} статей в ленте, ${Object.keys(digest).length} специальностей`);
  return snapshot;
}

// Позволяет запускать сбор вручную: `npm run collect`
const isDirectRun = process.argv[1] && process.argv[1].endsWith('collect.js');
if (isDirectRun) {
  runCollection()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
