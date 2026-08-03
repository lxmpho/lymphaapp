/**
 * Лимфа — /api/ask v3 (RAG, ES module).
 *
 * Отличие от v2: модель больше не вспоминает статьи по памяти и не печатает
 * PMID. Пайплайн:
 *
 *   1. planSearch()  — Claude Haiku переводит клинический вопрос в английские
 *                      поисковые термины (сам синтаксис запроса строит сервер).
 *   2. retrieve()    — Europe PMC отдаёт реальные статьи с абстрактами.
 *   3. answer()      — Claude Sonnet отвечает ТОЛЬКО по этим абстрактам и
 *                      ссылается на номера [1..8], не на PMID.
 *   4. mapSources()  — сервер подставляет PMID по номеру из своего же массива.
 *
 * Подмена PMID структурно невозможна: модель не имеет доступа к PMID.
 *
 * Экспортируется как askLympha — имя, которое импортирует server.js.
 */

import { retrieve, buildContext } from './retrieve.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL_PLAN = process.env.LYMPHA_MODEL_PLAN || 'claude-haiku-4-5';
const MODEL_ANSWER = process.env.LYMPHA_MODEL_ANSWER || 'claude-sonnet-5';
export const MAX_SOURCES = 8; // должно совпадать с retrieve DEFAULTS.maxContext

/* ------------------------------------------------------------------ */
/*  Вызов Claude со structured outputs                                 */
/* ------------------------------------------------------------------ */

async function callClaude({ model, system, user, schema, maxTokens = 2000, timeoutMs = 45000 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: 'no_api_key' };

  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema } },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || `http_${res.status}`;
      return { ok: false, error: 'ai_error', detail: msg };
    }
    if (data.stop_reason === 'refusal') return { ok: false, error: 'ai_refusal' };
    if (data.stop_reason === 'max_tokens') return { ok: false, error: 'ai_truncated' };

    // при adaptive thinking в content могут быть thinking-блоки — берём только text
    const text = (data.content || [])
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text)
      .join('');

    // structured outputs гарантируют валидный JSON, но парсим защищённо
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: false, error: 'bad_format' };
    }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'ai_timeout' : 'ai_unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/*  Шаг 1. План поиска                                                 */
/* ------------------------------------------------------------------ */

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    isClinical: { type: 'boolean' },
    terms: { type: 'array', items: { type: 'string' } },
    fallbackTerms: { type: 'array', items: { type: 'string' } },
  },
  required: ['isClinical', 'terms', 'fallbackTerms'],
  additionalProperties: false,
};

const PLAN_SYSTEM = `You convert a dentist's clinical question (usually in Russian) into English search terms for the Europe PMC biomedical literature database.

Rules:
- isClinical: false if the question is not a clinical/biomedical question (chit-chat, admin, off-topic). Then return empty arrays.
- terms: 2-4 precise English concepts that will be ANDed together. Use standard biomedical vocabulary (MeSH-style) — e.g. "dental implant", "antibiotic prophylaxis", "peri-implantitis", "alveolar ridge augmentation".
- Do NOT include study-design words ("systematic review", "RCT") — the server adds those filters.
- Do NOT include boolean operators, quotes, field codes or wildcards. Plain concepts only.
- fallbackTerms: 1-2 broader concepts, used only if the precise search returns nothing.

Example: "Нужна ли антибиотикопрофилактика при дентальной имплантации?"
-> terms: ["dental implants", "antibiotic prophylaxis"], fallbackTerms: ["dental implants"]`;

export async function planSearch(question) {
  return callClaude({
    model: MODEL_PLAN,
    system: PLAN_SYSTEM,
    user: question,
    schema: PLAN_SCHEMA,
    maxTokens: 300,
    timeoutMs: 15000,
  });
}

/* ------------------------------------------------------------------ */
/*  Шаг 3. Ответ строго по контексту                                   */
/* ------------------------------------------------------------------ */

// enum фиксирован 1..8 намеренно: схема не меняется между запросами,
// значит скомпилированная грамматика берётся из кэша (быстрее).
// Номера больше фактического числа статей сервер отбросит сам.
const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    sufficient: { type: 'boolean' },
    grade: { type: 'string', enum: ['high', 'mod', 'low', 'verylow', 'none'] },
    recommendation: { type: 'string' },
    statements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          sources: {
            type: 'array',
            items: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7, 8] },
          },
        },
        required: ['text', 'sources'],
        additionalProperties: false,
      },
    },
    limitations: { type: 'string' },
  },
  required: ['sufficient', 'grade', 'recommendation', 'statements', 'limitations'],
  additionalProperties: false,
};

const ANSWER_SYSTEM = `You are Lympha, an evidence-based dentistry assistant for practising dentists. You answer in RUSSIAN, in a precise scientific clinical register.

You are given a numbered list of real articles retrieved from Europe PMC. These are your ONLY permitted source of factual claims.

HARD RULES:
1. Every factual claim MUST come from the provided abstracts. Never use your own memory of the literature. If the abstracts don't say it, don't say it.
2. Cite by NUMBER only, via the "sources" field. Never write PMIDs, DOIs, journal names or author names inside "text" — the server attaches those itself.
3. Never cite a number that is not in the provided list.
4. If the retrieved articles do not actually answer the question, set sufficient=false, grade="none", explain briefly in "recommendation" that the evidence base found is insufficient, and leave statements empty. This is a correct, valuable answer — do not paper over gaps.
5. Do not overstate. A single small trial is not "shown"; it is "suggested by limited data".

Fields:
- grade: overall GRADE certainty of the body of evidence you used — "high" | "mod" | "low" | "verylow" | "none".
  Weigh study design (guidelines/meta-analyses/systematic reviews > RCT > observational), consistency across sources, and how directly they address the question.
- recommendation: 2-4 sentences in Russian. The actionable clinical bottom line. No citations here.
- statements: the evidence, broken into individual claims. Each has "text" (one clear sentence in Russian) and "sources" (numbers backing exactly that claim). 3-6 statements.
- limitations: 1-3 sentences in Russian on what the found evidence does NOT settle (heterogeneity, short follow-up, narrow population, etc.). Be honest.`;

export async function answerFromContext(question, articles) {
  const context = buildContext(articles);
  const user = [
    `КЛИНИЧЕСКИЙ ВОПРОС:\n${question}`,
    '',
    `НАЙДЕННЫЕ СТАТЬИ (${articles.length}) — единственный разрешённый источник:`,
    '',
    context,
  ].join('\n');

  return callClaude({
    model: MODEL_ANSWER,
    system: ANSWER_SYSTEM,
    user,
    schema: ANSWER_SCHEMA,
    maxTokens: 2500,
    timeoutMs: 60000,
  });
}

/* ------------------------------------------------------------------ */
/*  Шаг 4. Сервер подставляет PMID по номеру                           */
/* ------------------------------------------------------------------ */

export function mapSources(parsed, articles) {
  const used = new Map(); // index -> [statement texts]
  const statements = [];

  for (const st of (parsed && parsed.statements) || []) {
    const text = String(st.text || '').trim();
    if (!text) continue;
    // отбрасываем номера вне диапазона фактически найденных статей
    const valid = [...new Set(st.sources || [])]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= articles.length);
    if (!valid.length) continue; // утверждение без источника не показываем
    statements.push({ text, sources: valid });
    for (const n of valid) {
      if (!used.has(n)) used.set(n, []);
      used.get(n).push(text);
    }
  }

  const evidence = [...used.keys()]
    .sort((a, b) => a - b)
    .map((n) => {
      const a = articles[n - 1];
      return {
        n,
        title: a.title,
        authors: a.authors,
        year: a.year,
        journal: a.journal,
        design: a.design,
        pmid: a.pmid,
        pmcid: a.pmcid,
        doi: a.doi,
        url: a.pmid
          ? `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`
          : `https://europepmc.org/article/PMC/${a.pmcid}`,
        isOpenAccess: a.isOpenAccess,
        note: used.get(n).join(' '),
        // Совместимость с текущим фронтендом. Теперь эти флаги всегда true
        // по построению: метаданные пришли из Europe PMC, а не от модели.
        trusted: true,
        verified: true,
        matches: true,
      };
    });

  return { statements, evidence };
}

/* ------------------------------------------------------------------ */
/*  Оркестрация                                                        */
/* ------------------------------------------------------------------ */

export async function askLympha(question) {
  const q = String(question || '').trim();
  if (q.length < 5) return { error: 'empty_question' };
  if (q.length > 1000) return { error: 'question_too_long' };

  // 1. План поиска
  const plan = await planSearch(q);
  if (!plan.ok) return { error: plan.error, detail: plan.detail };
  if (!plan.data.isClinical || !plan.data.terms.length) {
    return { error: 'not_clinical' };
  }

  // 2. Поиск (+ один расширенный ретрай)
  let terms = plan.data.terms;
  let found = await retrieve(terms);

  if ((!found.ok || !found.articles.length) && (plan.data.fallbackTerms || []).length) {
    terms = plan.data.fallbackTerms;
    found = await retrieve(terms);
  }

  if (!found.ok && found.reason === 'search_failed') return { error: 'pmc_unreachable' };
  if (!found.articles.length) {
    return {
      ok: true,
      sufficient: false,
      grade: 'none',
      recommendation:
        'По этому вопросу не найдено публикаций с абстрактами в Europe PMC за последние 12 лет. ' +
        'Попробуйте переформулировать вопрос или сузить его до конкретного вмешательства.',
      statements: [],
      evidence: [],
      limitations: '',
      retrieval: { terms, totalFound: 0, shown: 0, tried: found.tried },
      trustedCount: 0,
      totalCitations: 0,
      hasProblems: false,
    };
  }

  // 3. Ответ строго по найденному
  const res = await answerFromContext(q, found.articles);
  if (!res.ok) return { error: res.error, detail: res.detail };

  // 4. Номера -> реальные PMID
  const { statements, evidence } = mapSources(res.data, found.articles);
  const sufficient = res.data.sufficient !== false && statements.length > 0;

  return {
    ok: true,
    sufficient,
    grade: sufficient ? res.data.grade : 'none',
    recommendation: res.data.recommendation,
    statements,
    evidence,
    limitations: res.data.limitations,
    retrieval: {
      terms,
      totalFound: found.totalFound || found.articles.length,
      shown: found.articles.length,
      tried: found.tried,
    },
    trustedCount: evidence.length,
    totalCitations: evidence.length,
    hasProblems: false, // выдуманных PMID больше не бывает by design
  };
}

// Совместимость на случай, если где-то в коде ждут имя ask
export { askLympha as ask };
