// Лимфа — эндпоинт клинического ответа (чат).
//
// ТРИ СЛОЯ ДОСТОВЕРНОСТИ:
//   1) Claude отвечает в СТРОГОМ JSON (рекомендация, GRADE, цитаты).
//   2) Существование: каждый PMID сверяется с Europe PMC (getArticle).
//   3) СООТВЕТСТВИЕ: заявленные Claude автор и год сравниваются с настоящими
//      метаданными статьи. Ловит случай «PMID реальный, но ведёт на другую
//      статью» (напр. Claude называет Esposito 2013 про имплантацию, а PMID
//      ведёт на статью про микрофлюидику). Без лишних вызовов Claude.

import { getArticle } from './europepmc.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Ты — Лимфа, клинический ассистент для врачей-стоматологов на основе доказательной медицины.
Отвечай строго научным языком для практикующего специалиста, без упрощений для пациентов.
Используй терминологию: РКИ, ОШ/ОР, ДИ, NNT, I², GRADE.
Иерархия доказательств: систематические обзоры Cochrane и мета-анализы > РКИ > когортные > мнение.

КРИТИЧЕСКИ ВАЖНО про цитаты: указывай PMID ТОЛЬКО если уверен, что статья реально существует
с этим PMID И этот PMID принадлежит именно этой статье. Если не уверен — НЕ придумывай,
оставь pmid пустым и опиши источник словами. Лучше без PMID, чем с неверным PMID.

Верни ТОЛЬКО валидный JSON, без markdown, без текста до или после:
{
  "grade": "high" | "mod" | "low" | "verylow",
  "recommendation": "клиническая рекомендация, 2-4 предложения",
  "evidence": [
    {"authors":"Фамилия И. и др.", "year":"2020", "journal":"J Clin Periodontol", "pmid":"12345678", "note":"ОШ/ОР/NNT/p"}
  ],
  "limitations": "клинические ограничения",
  "lang": "ru"
}
Отвечай на языке вопроса. Если вопрос вне стоматологии или слишком общий — скажи об этом в recommendation, evidence оставь пустым.`;

// --- Разбор JSON ответа модели ---
export function parseModelJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

// --- Извлечь фамилию первого автора из строки цитаты ---
// "Esposito M. et al." → "esposito"; "Lund B. et al." → "lund"
function firstSurname(authors) {
  if (!authors) return '';
  const first = String(authors).trim().split(/[\s,]+/)[0] || '';
  return first.replace(/[^\p{L}]/gu, '').toLowerCase();
}

// --- Соответствует ли реальная статья заявленной цитате? ---
// Сравниваем заявленных Claude автора и год с настоящими из Europe PMC.
// Чистая функция — тестируется без сети.
export function citationMatches(claim, article) {
  const claimedSurname = firstSurname(claim.authors);
  const realAuthors = String(article.authors || '').toLowerCase();

  // Автор: фамилия первого заявленного автора должна встречаться в реальном
  // списке авторов статьи.
  const authorOk = claimedSurname.length >= 3 && realAuthors.includes(claimedSurname);

  // Год: допускаем расхождение ±1 (epub vs print).
  const cy = parseInt(claim.year, 10);
  const ry = parseInt(article.pubYear, 10);
  const yearOk = !cy || !ry || Math.abs(cy - ry) <= 1;

  if (!authorOk) return { ok: false, reason: 'author_mismatch' };
  if (!yearOk) return { ok: false, reason: 'year_mismatch' };
  return { ok: true, reason: null };
}

// --- Проверка одной цитаты: существование + соответствие ---
async function verifyCitation(claim) {
  const pmid = claim.pmid;
  const base = {
    verified: false, matches: false, mismatchReason: 'no_pmid',
    realTitle: null, realAuthors: null, realJournal: null, realYear: null,
  };
  if (!pmid || !/^(PMC)?\d+$/i.test(String(pmid))) return base;
  try {
    const art = await getArticle(String(pmid));
    if (!art || !art.title) {
      return { ...base, mismatchReason: 'not_found' };
    }
    const match = citationMatches(claim, art);
    return {
      verified: true,                 // PMID существует в Europe PMC
      matches: match.ok,              // и метаданные совпадают с заявленной цитатой
      mismatchReason: match.ok ? null : match.reason,
      realTitle: art.title,
      realAuthors: art.authors || null,
      realJournal: art.journal || null,
      realYear: art.pubYear || null,
    };
  } catch {
    return { ...base, mismatchReason: 'error' };
  }
}

export async function askLympha(question) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: 'no_api_key', message: 'Сервис ИИ временно недоступен.' };
  if (!question || !String(question).trim()) return { error: 'empty_question', message: 'Пустой вопрос.' };

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
        max_tokens: 1500,               // без thinking ответу с цитатами этого хватает
        thinking: { type: 'disabled' }, // ЭКОНОМИЯ: не платим за невидимые размышления
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

  const text = (data?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const parsed = parseModelJson(text);
  if (!parsed) {
    return {
      error: 'bad_format',
      message: 'Не удалось разобрать ответ ИИ.',
      stopReason: data?.stop_reason || null,
      rawPreview: String(text || '').slice(0, 500),
    };
  }

  const rawEvidence = Array.isArray(parsed.evidence) ? parsed.evidence : [];
  const evidence = await Promise.all(
    rawEvidence.map(async (e) => {
      const claim = {
        authors: e.authors || '', year: e.year || '',
        journal: e.journal || '', pmid: e.pmid || null,
      };
      const check = await verifyCitation(claim);
      return {
        authors: claim.authors,
        year: claim.year,
        journal: claim.journal,
        pmid: claim.pmid,
        note: e.note || '',
        // трёхуровневый статус доверия:
        verified: check.verified,          // PMID существует
        matches: check.matches,            // и это та самая статья
        mismatchReason: check.mismatchReason,
        realTitle: check.realTitle,        // что за статья на самом деле
        realAuthors: check.realAuthors,
        realJournal: check.realJournal,
        realYear: check.realYear,
        // итоговый признак надёжности для клиента:
        trusted: check.verified && check.matches,
      };
    })
  );

  const trustedCount = evidence.filter((e) => e.trusted).length;

  return {
    grade: ['high', 'mod', 'low', 'verylow'].includes(parsed.grade) ? parsed.grade : 'mod',
    recommendation: parsed.recommendation || '',
    evidence,
    limitations: parsed.limitations || '',
    trustedCount,
    totalCitations: evidence.length,
    // есть ли цитаты с PMID, которым нельзя доверять (не найдены или не та статья)
    hasProblems: evidence.some((e) => e.pmid && !e.trusted),
  };
}
