// Логика ранжирования и отбора (раздел 5 ТЗ).
//
// Правила:
//  - Уровень доказательности: приоритет SR/мета-анализам, затем РКИ.
//  - Цитируемость и журнал: citedByCount.
//  - Свежесть: чем новее firstPublishDate, тем выше.
//  - Антидубли: исключать уже показанные ранее PMID.

import { classifyPubType, evidenceWeight } from './specialties.js';

// Композитный скор статьи. Веса подобраны так, чтобы тип исследования
// доминировал, цитируемость давала вторичный вклад, свежесть — третичный.
export function scoreArticle(article, now = new Date()) {
  const typeCode = classifyPubType(article.pubTypeList);
  const evidence = evidenceWeight(typeCode);

  // Цитируемость: логарифмическое сглаживание, чтобы пара супер-цитируемых
  // статей не задавила всё остальное.
  const citationScore = Math.log10((article.citedByCount || 0) + 1) * 15;

  // Свежесть: линейно убывает в окне 30 дней.
  let freshnessScore = 0;
  const pdate = article.firstPublishDate ? new Date(article.firstPublishDate) : null;
  if (pdate && !isNaN(pdate)) {
    const ageDays = (now - pdate) / (1000 * 60 * 60 * 24);
    freshnessScore = Math.max(0, 30 - ageDays); // 0..30
  }

  // Небольшой бонус за открытый доступ — врач сможет прочитать полный текст.
  const oaBonus = article.isOpenAccess ? 5 : 0;

  return {
    total: evidence + citationScore + freshnessScore + oaBonus,
    typeCode,
    parts: { evidence, citationScore, freshnessScore, oaBonus },
  };
}

// Ранжирование списка с исключением ранее показанных PMID (антидубли).
export function rankArticles(articles, { excludePmids = new Set(), now = new Date() } = {}) {
  return articles
    .filter((a) => a.pmid && !excludePmids.has(String(a.pmid)))
    .map((a) => {
      const s = scoreArticle(a, now);
      return { ...a, typeCode: s.typeCode, _score: s.total, _scoreParts: s.parts };
    })
    .sort((x, y) => y._score - x._score);
}

// Топ-N для дайджеста недели.
export function pickDigest(rankedArticles, n = 3) {
  return rankedArticles.slice(0, n);
}

// Эвристика "почему это важно" — запасной вариант, если не используется
// генерация резюме через LLM. Опирается на тип, цитируемость, свежесть.
export function fallbackWhy(article) {
  const bits = [];
  if (article.typeCode === 'sr') bits.push('Систематический обзор — высший уровень доказательности');
  else if (article.typeCode === 'rct') bits.push('Рандомизированное контролируемое исследование');
  if ((article.citedByCount || 0) > 0) bits.push(`${article.citedByCount} цитирований`);
  if (article.isOpenAccess) bits.push('полный текст в открытом доступе');
  return bits.join(' · ') || 'Свежая публикация по специальности';
}
