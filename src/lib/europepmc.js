// Клиент Europe PMC REST API.
// Документация синтаксиса запросов: https://europepmc.org/RestfulWebService
//
// ВАЖНО про среду: публичный хост ebi.ac.uk доступен с обычного сервера,
// но НЕ из этой песочницы (ограниченный список доменов). Логика маршрутизации
// идентификаторов тестируется отдельно (test/identifier.test.js), сетевые
// вызовы проходят без изменений на реальном сервере.

const BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest';

// --- Сборка поискового запроса для специальности (раздел 4 ТЗ) ---
export function buildSpecialtyQuery({ terms, pubTypes, dateFrom, dateTo }) {
  const termBlock = '(' + terms.map((t) => `"${t}"`).join(' OR ') + ')';
  const typeBlock = '(' + pubTypes.map((t) => `PUB_TYPE:"${t}"`).join(' OR ') + ')';
  const dateBlock = `(FIRST_PDATE:[${dateFrom} TO ${dateTo}])`;
  return `${termBlock} AND ${typeBlock} AND ${dateBlock}`;
}

// --- Поиск статей (esearch-эквивалент) ---
export async function searchArticles({ query, pageSize = 25, sort = 'CITED desc' }) {
  const url =
    `${BASE}/search` +
    `?query=${encodeURIComponent(query)}` +
    `&sort=${encodeURIComponent(sort)}` +
    `&resultType=core&pageSize=${pageSize}&format=json`;
  const data = await fetchJsonWithRetry(url);
  return data?.resultList?.result ?? [];
}

// ─────────────────────────────────────────────────────────────
// PATH B: раздельная работа с идентификаторами PMID и PMCID.
//
// Проблема, которую это решает: у части статей в Europe PMC нет обычного
// числового PMID — есть только PMCID (вида "PMC13290632"). Раньше такой
// идентификатор попадал в поле pmid и ломал и поиск статьи, и полный текст,
// потому что искали его как PMID по базе MEDLINE (SRC:MED), где его нет.
//
// Теперь идентификатор классифицируется, и для каждого типа строится
// правильный запрос. Функция чистая — её легко протестировать без сети.
// ─────────────────────────────────────────────────────────────

// Классификация идентификатора: 'pmcid' | 'pmid'.
export function classifyIdentifier(id) {
  return /^PMC\d+$/i.test(String(id)) ? 'pmcid' : 'pmid';
}

// Построить поисковый query Europe PMC под тип идентификатора.
//   PMCID → ищем по полю PMCID
//   PMID  → ищем по внешнему ID в MEDLINE
export function buildLookupQuery(id) {
  if (classifyIdentifier(id) === 'pmcid') {
    const pmc = String(id).toUpperCase();
    return `PMCID:${pmc}`;
  }
  return `EXT_ID:${id} AND SRC:MED`;
}

// --- Получение одной статьи по идентификатору (PMID или PMCID) ---
export async function getArticle(identifier) {
  const query = buildLookupQuery(identifier);
  const url =
    `${BASE}/search` +
    `?query=${encodeURIComponent(query)}` +
    `&resultType=core&format=json`;
  const data = await fetchJsonWithRetry(url);
  const rec = data?.resultList?.result?.[0];
  if (!rec) return null;
  return normalizeArticle(rec);
}

// Обратная совместимость: старое имя, если где-то ещё вызывается.
export const getArticleByPmid = getArticle;

// --- Нормализация записи Europe PMC → плоский объект для клиента ---
export function normalizeArticle(rec) {
  const isOA = rec.isOpenAccess === 'Y';
  // PATH B: pmid и pmcid хранятся РАЗДЕЛЬНО. pmid — только настоящий числовой
  // PMID (без подстановки id/PMCID). pmcid — отдельное поле для полного текста.
  const pmid = rec.pmid || null;
  const pmcid = rec.pmcid || null;
  // Стабильный идентификатор для клиента: предпочитаем PMID, иначе PMCID.
  const id = pmid || pmcid || rec.id || null;
  return {
    id,
    pmid,
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

// --- fetch JSON с одним повтором ---
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

// --- fetch текста (XML полного текста) с одним повтором ---
async function fetchTextWithRetry(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/xml', 'User-Agent': 'Lympha-EvidenceEngine/1.0' },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Europe PMC fullText HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, 800));
      return fetchTextWithRetry(url, attempt + 1);
    }
    return null;
  }
}
