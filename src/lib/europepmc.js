// Клиент Europe PMC REST API.
// Документация синтаксиса запросов: https://europepmc.org/RestfulWebService
//
// ВАЖНО про среду: публичный хост ebi.ac.uk доступен с обычного сервера,
// но НЕ из этой песочницы (ограниченный список доменов). Поэтому модуль
// написан так, чтобы при недоступности сети аккуратно бросать ошибку,
// которую планировщик логирует и пропускает цикл. На реальном сервере
// сетевые вызовы проходят без изменений в коде.

const BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest';

// --- Сборка поискового запроса для специальности (раздел 4 ТЗ) ---
//
// Пример итогового query:
//   ("dental implant" OR "osseointegration" OR "peri-implantitis")
//   AND (PUB_TYPE:"Randomized Controlled Trial" OR PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Meta-Analysis")
//   AND (FIRST_PDATE:[2026-05-16 TO 2026-06-15])
export function buildSpecialtyQuery({ terms, pubTypes, dateFrom, dateTo }) {
  const termBlock = '(' + terms.map((t) => `"${t}"`).join(' OR ') + ')';
  const typeBlock = '(' + pubTypes.map((t) => `PUB_TYPE:"${t}"`).join(' OR ') + ')';
  const dateBlock = `(FIRST_PDATE:[${dateFrom} TO ${dateTo}])`;
  return `${termBlock} AND ${typeBlock} AND ${dateBlock}`;
}

// --- Поиск статей (esearch-эквивалент) ---
// Возвращает массив "сырых" результатов Europe PMC (resultType=core).
export async function searchArticles({ query, pageSize = 25, sort = 'CITED desc' }) {
  const url =
    `${BASE}/search` +
    `?query=${encodeURIComponent(query)}` +
    `&sort=${encodeURIComponent(sort)}` +
    `&resultType=core&pageSize=${pageSize}&format=json`;

  const data = await fetchJsonWithRetry(url);
  return data?.resultList?.result ?? [];
}

// --- Получение одной статьи по PMID (для прокси-эндпоинта) ---
// Повторяет запрос, который прототип уже делает на клиенте (раздел 1 ТЗ).
export async function getArticleByPmid(pmid) {
  const query = `EXT_ID:${pmid} AND SRC:MED`;
  const url =
    `${BASE}/search` +
    `?query=${encodeURIComponent(query)}` +
    `&resultType=core&format=json`;

  const data = await fetchJsonWithRetry(url);
  const rec = data?.resultList?.result?.[0];
  if (!rec) return null;
  return normalizeArticle(rec);
}

// --- Нормализация записи Europe PMC → плоский объект для клиента ---
export function normalizeArticle(rec) {
  const isOA = rec.isOpenAccess === 'Y';
  const pmcid = rec.pmcid || null; // нужен для загрузки полного текста OA
  return {
    pmid: rec.pmid || rec.id || null,
    pmcid,
    title: rec.title || '',
    authors: rec.authorString || '',
    journal: rec.journalInfo?.journal?.title || rec.journalTitle || '',
    pubYear: rec.pubYear || '',
    firstPublishDate: rec.firstPublicationDate || '',
    doi: rec.doi || '',
    abstract: rec.abstractText || '',
    citedByCount: typeof rec.citedByCount === 'number' ? rec.citedByCount : 0,
    isOpenAccess: isOA,
    // Полный текст доступен только для OA-статей, у которых есть PMCID.
    fullTextAvailable: Boolean(isOA && pmcid),
    pubTypeList: rec.pubTypeList?.pubType || [],
  };
}

// --- Загрузка полного текста Open Access статьи по PMCID ---
// Europe PMC отдаёт JATS XML по адресу /{PMCID}/fullTextXML.
// Возвращает массив секций { heading, text } или null, если текст недоступен.
export async function getFullText(pmcid) {
  if (!pmcid) return null;
  const id = String(pmcid).toUpperCase().startsWith('PMC') ? pmcid : `PMC${pmcid}`;
  const url = `${BASE}/${id}/fullTextXML`;

  const xml = await fetchTextWithRetry(url);
  if (!xml) return null;

  const { jatsToSections } = await import('./fulltext.js');
  const sections = jatsToSections(xml);
  return sections.length ? sections : null;
}

// --- fetch с одним повтором при сбое (раздел 1: "при сбое — один повтор") ---
async function fetchJsonWithRetry(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Lympha-EvidenceEngine/1.0' },
    });
    if (!res.ok) throw new Error(`Europe PMC HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, 800));
      return fetchJsonWithRetry(url, attempt + 1);
    }
    throw err;
  }
}

// --- Загрузка текстового ответа (XML полного текста) с одним повтором ---
// Полный текст может отсутствовать (404) даже у OA-статьи — это не ошибка,
// просто возвращаем null, чтобы клиент показал аннотацию.
async function fetchTextWithRetry(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/xml', 'User-Agent': 'Lympha-EvidenceEngine/1.0' },
    });
    if (res.status === 404) return null; // полного текста нет — это нормально
    if (!res.ok) throw new Error(`Europe PMC fullText HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, 800));
      return fetchTextWithRetry(url, attempt + 1);
    }
    return null; // при стойком сбое не валим запрос — отдаём null
  }
}
