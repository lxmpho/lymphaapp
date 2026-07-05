// Лимфа — эндпоинт клинического ответа (чат).
//
// ПОЧЕМУ ЭТО УСТРОЕНО ИМЕННО ТАК:
// Продукт доказательный — значит цитата должна быть настоящей, а не
// правдоподобно выдуманной. LLM может сгенерировать похожий на правду PMID,
// которого не существует или который ведёт на другую статью. Это худший
// провал для evidence-based инструмента. Поэтому здесь два слоя:
//   1) Claude отвечает в СТРОГОМ JSON с рекомендацией, GRADE и списком цитат.
//   2) Бэкенд ПРОВЕРЯЕТ каждый PMID против Europe PMC (getArticle). Цитаты,
//      которые не подтвердились, помечаются verified:false — клиент их
//      показывает с пометкой «не проверено», а не как доказанный факт.
//
// Это не полный RAG (сначала найти статьи, потом отвечать только по ним) —
// это следующий, более крупный шаг. Но верификация цитат уже отсекает
// главный риск: выдуманные ссылки не выдаются за доказательство.

import { getArticle } from './europepmc.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Ты — Лимфа, клинический ассистент для врачей-стоматологов на основе доказательной медицины.
Отвечай строго научным языком для практикующего специалиста, без упрощений для пациентов.
Используй профессиональную терминологию: РКИ, ОШ/ОР, ДИ, NNT, I², GRADE.
Иерархия доказательств: систематические обзоры Cochrane и мета-анализы > РКИ > когортные > мнение.

КРИТИЧЕСКИ ВАЖНО про цитаты: указывай PMID ТОЛЬКО если ты уверен, что статья реально существует
с этим PMID. Если не уверен в конкретном PMID — НЕ придумывай его, оставь поле pmid пустым и
опиши источник словами. Выдуманная ссылка недопустима.

Верни ОТВЕТ СТРОГО как валидный JSON без markdown, без пояснений вокруг:
{
  "grade": "high" | "mod" | "low" | "verylow",
  "recommendation": "клиническая рекомендация, 2-4 предложения с уровнем доказательности",
  "evidence": [
    {"authors":"Автор и др.", "year":"2020", "journal":"J Clin Periodontol", "pmid":"12345678", "note":"ключевые данные: ОШ/ОР/NNT/p"}
  ],
  "limitations": "клинические ограничения: гетерогенность, применимость, риски",
  "lang": "ru"
}
Отвечай на языке вопроса. Если вопрос вне стоматологии или слишком общий — честно скажи об этом в recommendation и оставь evidence пустым.`;

// Извлечь JSON из ответа модели (на случай обрамления текстом).
export function parseModelJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

// Проверить один PMID против Europe PMC. Возвращает { verified, realTitle }.
async function verifyCitation(pmid) {
  if (!pmid || !/^(PMC)?\d+$/i.test(String(pmid))) return { verified: false, realTitle: null };
  try {
    const art = await getArticle(String(pmid));
    if (art && art.title) return { verified: true, realTitle: art.title };
    return { verified: false, realTitle: null };
  } catch {
    return { verified: false, realTitle: null };
  }
}

// Главная функция: вопрос → проверенный доказательный ответ.
export async function askLympha(question) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { error: 'no_api_key', message: 'Сервис ИИ временно недоступен.' };
  }
  if (!question || !String(question).trim()) {
    return { error: 'empty_question', message: 'Пустой вопрос.' };
  }

  // 1) Ответ Claude в структурированном виде.
  let data;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: String(question) }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { error: 'ai_error', status: res.status, detail: body.slice(0, 300) };
    }
    data = await res.json();
  } catch (err) {
    return { error: 'ai_unreachable', message: err.message };
  }

  const text = data?.content?.find((b) => b.type === 'text')?.text || '';
  const parsed = parseModelJson(text);
  if (!parsed) {
    return { error: 'bad_format', message: 'Не удалось разобрать ответ ИИ.' };
  }

  // 2) Верификация каждой цитаты против Europe PMC (параллельно).
  const rawEvidence = Array.isArray(parsed.evidence) ? parsed.evidence : [];
  const evidence = await Promise.all(
    rawEvidence.map(async (e) => {
      const check = e.pmid ? await verifyCitation(e.pmid) : { verified: false, realTitle: null };
      return {
        authors: e.authors || '',
        year: e.year || '',
        journal: e.journal || '',
        pmid: e.pmid || null,
        note: e.note || '',
        verified: check.verified,          // подтверждён ли PMID в Europe PMC
        realTitle: check.realTitle,        // настоящее название статьи (если нашлось)
      };
    })
  );

  const verifiedCount = evidence.filter((e) => e.verified).length;

  return {
    grade: ['high', 'mod', 'low', 'verylow'].includes(parsed.grade) ? parsed.grade : 'mod',
    recommendation: parsed.recommendation || '',
    evidence,
    limitations: parsed.limitations || '',
    verifiedCount,
    totalCitations: evidence.length,
    // Явный сигнал клиенту: были ли непроверенные цитаты.
    hasUnverified: evidence.some((e) => e.pmid && !e.verified),
  };
}
