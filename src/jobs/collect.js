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

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

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

      // ШАГ 2 — ОТБОР (антидубли + ранжирование).
      // PATH B: антидубли ведём по стабильному id (pmid или pmcid).
      const excludePmids = await getSeenPmids(key);
      const ranked = rankArticles(articles, { excludePmids, now });

      const topForFeed = ranked.slice(0, 10);
      const titlesRu = await translateTitles(topForFeed.map((a) => a.title));
      topForFeed.forEach((a, i) => { a.titleRu = titlesRu[i]; });

      // PATH B: в ленту кладём стабильный id (pmid ИЛИ pmcid) как ключ для
      // открытия статьи, и pmcid отдельно — для полного текста. Раньше сюда
      // попадал только pmid, который у части статей отсутствует.
      topForFeed.forEach((a) => {
        feed.push({
          id: String(a.id),                 // ключ, по которому клиент открывает статью
          pmid: a.pmid || null,             // настоящий PMID (может отсутствовать)
          pmcid: a.pmcid || null,           // PMCID для полного текста
          specialty: key,
          type: a.typeCode,
          titleRu: a.titleRu || a.title,
          title: a.title,
          journal: a.journal,
          date: a.firstPublishDate || `${a.pubYear}`,
          citedByCount: a.citedByCount,
          isOpenAccess: a.isOpenAccess,
          fullTextAvailable: a.fullTextAvailable,
        });
      });

      digest[key] = pickDigest(ranked, digestSize).map((a, i) => ({
        id: String(a.id),
        pmid: a.pmid || null,
        pmcid: a.pmcid || null,
        titleRu: titlesRu[i] || a.title,
        why: fallbackWhy(a),
      }));

      // Антидубли по стабильному id.
      await addSeenPmids(key, topForFeed.map((a) => String(a.id)));

      console.log(`[collect] ${key}: собрано ${articles.length}, в ленту ${topForFeed.length}`);
    } catch (err) {
      console.warn(`[collect] ${key}: ошибка — ${err.message}`);
      errors.push({ specialty: key, error: err.message });
    }
  }

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

const isDirectRun = process.argv[1] && process.argv[1].endsWith('collect.js');
if (isDirectRun) {
  runCollection()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
