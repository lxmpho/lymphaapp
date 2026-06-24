// Перевод заголовков (и опционально аннотаций) на русский через Claude API.
//
// На бэкенде перевод делается ОДИН раз при формировании подборки и кэшируется
// в снимке (поле titleRu). Это снимает нагрузку перевода "на лету" с клиента
// и экономит токены: переведённый заголовок отдаётся уже готовым.
//
// Ключ берётся из переменной окружения ANTHROPIC_API_KEY. Если ключа нет —
// модуль возвращает оригинал (graceful degradation), чтобы сборка не падала.

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

export async function translateTitles(titles) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || titles.length === 0) return titles; // нет ключа — отдаём как есть

  const numbered = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const prompt =
    'Переведи на русский язык названия научных медицинских статей по стоматологии. ' +
    'Сохрани профессиональную терминологию. Верни ТОЛЬКО переводы, по одному на строку, ' +
    'пронумерованные так же, без пояснений и без markdown.\n\n' + numbered;

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
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.content?.find((b) => b.type === 'text')?.text || '';

    // Парсим пронумерованные строки обратно в массив.
    const lines = text
      .split('\n')
      .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter(Boolean);

    // Если число строк совпало — используем перевод, иначе подстраховка оригиналом.
    return titles.map((orig, i) => lines[i] || orig);
  } catch (err) {
    console.warn('[translate] перевод не выполнен, отдаю оригиналы:', err.message);
    return titles;
  }
}
