/**
 * Лимфа — retrieval-слой (ES module).
 *
 * Ищет реальные статьи в Europe PMC, классифицирует их по уровню
 * доказательности и собирает пронумерованный контекст для модели.
 *
 * Главный принцип: PMID приходит ТОЛЬКО отсюда, из ответа Europe PMC.
 * Модель никогда не печатает PMID — она ссылается на номер [1], [2].
 */

const EPMC_SEARCH = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

export const DEFAULTS = {
  yearsBack: 12,        // глубина поиска в годах
  perTier: 25,          // сколько тянуть из каждого запроса
  maxContext: 8,        // сколько статей уйдёт в контекст модели
  abstractChars: 1400,  // обрезка абстракта
  timeoutMs: 12000,
};

/* ------------------------------------------------------------------ */
/*  HTTP                                                               */
/* ------------------------------------------------------------------ */

async function epmcSearch(query, { pageSize, timeoutMs, sort }) {
  const url = new URL(EPMC_SEARCH);
  url.searchParams.set('query', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('resultType', 'core'); // core -> abstractText, pubTypeList
  url.searchParams.set('pageSize', String(pageSize));
  if (sort) url.searchParams.set('sort', sort);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Lympha/1.0 (evidence-based dentistry; benjaminvidin@gmail.com)',
      },
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}`, articles: [] };
    const json = await res.json();
    const list = (json && json.resultList && json.resultList.result) || [];
    return { ok: true, articles: list };
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : 'network', articles: [] };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/*  Построение запросов                                                */
/* ------------------------------------------------------------------ */

function escapeTerm(t) {
  return String(t).replace(/["\\]/g, ' ').trim();
}

/**
 * Запросы строит СЕРВЕР, а не модель. Модель даёт только английские
 * термины — синтаксис Europe PMC она путает, а мы нет.
 */
export function buildQueries(terms, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const clean = terms.map(escapeTerm).filter(Boolean);
  if (!clean.length) return [];

  const toYear = new Date().getFullYear();
  const fromYear = toYear - o.yearsBack;

  const core = clean.map((t) => `"${t}"`).join(' AND ');
  const base =
    `(${core})` +
    ` AND (HAS_ABSTRACT:Y)` +
    ` AND (LANG:eng)` +
    ` AND (FIRST_PDATE:[${fromYear}-01-01 TO ${toYear}-12-31])`;

  return [
    {
      tier: 'A',
      label: 'guidelines / SR / MA',
      query:
        `${base} AND (PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Meta-Analysis"` +
        ` OR PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")`,
    },
    {
      tier: 'B',
      label: 'RCT',
      query: `${base} AND (PUB_TYPE:"Randomized Controlled Trial")`,
    },
    {
      // Страховка: если фильтры по типу дадут ноль (Europe PMC бывает
      // капризен с PUB_TYPE), широкий запрос всё равно принесёт статьи,
      // а уровень доказательности мы определим сами из pubTypeList.
      tier: 'C',
      label: 'broad',
      query: base,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Классификация уровня доказательности                               */
/* ------------------------------------------------------------------ */

export function evidenceLevel(art) {
  const types = ((art.pubTypeList && art.pubTypeList.pubType) || [])
    .map((t) => String(t).toLowerCase());
  const title = String(art.title || '').toLowerCase();
  const has = (needle) => types.some((t) => t.includes(needle)) || title.includes(needle);

  if (has('guideline') || has('consensus statement')) {
    return { level: 5, design: 'Клиническая рекомендация' };
  }
  if (has('meta-analysis') || has('meta analysis')) {
    return { level: 4, design: 'Мета-анализ' };
  }
  if (has('systematic review')) {
    return { level: 4, design: 'Систематический обзор' };
  }
  if (has('randomized controlled trial') || has('randomised controlled trial')) {
    return { level: 3, design: 'РКИ' };
  }
  if (has('clinical trial') || has('randomized') || has('randomised')) {
    return { level: 3, design: 'Клиническое исследование' };
  }
  if (has('cohort')) return { level: 2, design: 'Когортное исследование' };
  if (has('case-control') || has('case control')) return { level: 2, design: 'Случай-контроль' };
  if (has('review')) return { level: 2, design: 'Обзор' };
  if (has('case report') || has('case series')) return { level: 1, design: 'Клинический случай' };
  return { level: 1, design: 'Оригинальное исследование' };
}

/* ------------------------------------------------------------------ */
/*  Нормализация и ранжирование                                        */
/* ------------------------------------------------------------------ */

export function truncateAbstract(text, limit) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit);
  const lastStop = cut.lastIndexOf('. ');
  return (lastStop > limit * 0.6 ? cut.slice(0, lastStop + 1) : cut) + ' […]';
}

export function normalize(art, abstractChars) {
  const { level, design } = evidenceLevel(art);
  const year = parseInt(String(art.pubYear || ''), 10) || null;
  return {
    pmid: art.pmid || null,
    pmcid: art.pmcid || null,
    doi: art.doi || null,
    title: String(art.title || '').replace(/\s+/g, ' ').trim(),
    authors: String(art.authorString || '').trim(),
    journal:
      (art.journalInfo && art.journalInfo.journal && art.journalInfo.journal.title) ||
      art.journalTitle ||
      '',
    year,
    design,
    level,
    citedByCount: Number(art.citedByCount) || 0,
    isOpenAccess: art.isOpenAccess === 'Y',
    abstract: truncateAbstract(art.abstractText, abstractChars),
  };
}

function dedupeKey(a) {
  return a.pmid || a.pmcid || a.doi || a.title.toLowerCase();
}

export function score(a) {
  const nowYear = new Date().getFullYear();
  const age = a.year ? nowYear - a.year : 15;
  const recency = Math.max(0, 12 - age) * 1.2;      // свежее — выше
  const impact = Math.log10(a.citedByCount + 1) * 2; // цитируемость, мягко
  return a.level * 10 + recency + impact;
}

/* ------------------------------------------------------------------ */
/*  Публичное API                                                      */
/* ------------------------------------------------------------------ */

/**
 * @param {string[]} terms  английские поисковые термины (2–4 шт)
 * @returns {{ok:boolean, articles:Array, tried:Array, reason?:string}}
 */
export async function retrieve(terms, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const queries = buildQueries(terms, o);
  if (!queries.length) return { ok: false, reason: 'no_terms', articles: [], tried: [] };

  const results = await Promise.all(
    queries.map((q) =>
      epmcSearch(q.query, { pageSize: o.perTier, timeoutMs: o.timeoutMs, sort: '' })
        .then((r) => ({ ...q, ...r }))
    )
  );

  const tried = results.map((r) => ({
    tier: r.tier,
    label: r.label,
    ok: r.ok,
    found: r.articles.length,
    reason: r.reason || null,
  }));

  const seen = new Map();
  for (const r of results) {
    if (!r.ok) continue;
    for (const raw of r.articles) {
      const a = normalize(raw, o.abstractChars);
      if (!a.abstract || a.abstract.length < 120) continue; // без абстракта нечем отвечать
      if (!a.pmid && !a.pmcid) continue;                     // нечем сослаться
      const key = dedupeKey(a);
      const prev = seen.get(key);
      // при дубле оставляем запись с более высоким уровнем доказательности
      if (!prev || a.level > prev.level) seen.set(key, a);
    }
  }

  const ranked = [...seen.values()].sort((x, y) => score(y) - score(x));
  const anyOk = results.some((r) => r.ok);

  if (!ranked.length) {
    return {
      ok: anyOk,
      reason: anyOk ? 'no_results' : 'search_failed',
      articles: [],
      tried,
    };
  }

  return { ok: true, articles: ranked.slice(0, o.maxContext), tried, totalFound: ranked.length };
}

/**
 * Пронумерованный контекст. Номер = позиция в массиве + 1.
 * Это единственный идентификатор, который увидит модель.
 */
export function buildContext(articles) {
  return articles
    .map((a, i) => {
      const n = i + 1;
      return [
        `[${n}] ${a.title}`,
        `Design: ${a.design} | Journal: ${a.journal || 'n/a'} | Year: ${a.year || 'n/a'} | Cited by: ${a.citedByCount}`,
        `Authors: ${a.authors || 'n/a'}`,
        `Abstract: ${a.abstract}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');
}
