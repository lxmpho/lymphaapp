// Парсер полного текста Open Access статей.
//
// Europe PMC отдаёт полный текст в формате JATS XML (тег <body> с секциями
// <sec>, заголовками <title> и абзацами <p>). Нам не нужна идеальная
// структура — нужен читаемый текст, разбитый на секции, для показа в карточке
// статьи. Поэтому используем лёгкий извлекатель на регулярках без сторонних
// XML-библиотек (ноль нативных зависимостей — важно для деплоя на Render).
//
// Граница легальности: полный текст доступен ТОЛЬКО для Open Access статей.
// Для остальных отдаётся аннотация. Это сознательное ограничение.

// Убираем инлайновые теги (xref, italic, bold, sup и пр.), оставляя текст.
function stripInlineTags(s) {
  return s
    .replace(/<xref[^>]*>.*?<\/xref>/gis, '')      // ссылки на источники — убираем метки
    .replace(/<[^>]+>/g, '')                        // все прочие теги → их содержимое
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&#x2009;/g, ' ')
    .replace(/&#?\w+;/g, ' ')                        // прочие entity → пробел
    .replace(/\s+/g, ' ')
    .trim();
}

// Извлекаем содержимое первого <body>…</body>.
function extractBody(xml) {
  const m = xml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : '';
}

// Извлекаем аннотацию из <abstract> (запасной вариант, если нет body).
function extractAbstract(xml) {
  const m = xml.match(/<abstract[^>]*>([\s\S]*?)<\/abstract>/i);
  if (!m) return '';
  const paras = [...m[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((x) => stripInlineTags(x[1]));
  return paras.filter(Boolean).join('\n\n');
}

// Главная функция: JATS XML → массив секций { heading, text }.
export function jatsToSections(xml) {
  if (!xml || typeof xml !== 'string') return [];

  const body = extractBody(xml);
  if (!body) {
    const abs = extractAbstract(xml);
    return abs ? [{ heading: 'Аннотация', text: abs }] : [];
  }

  const sections = [];

  // Идём по верхнеуровневым <sec>. JATS вкладывает секции, но для читаемого
  // вида достаточно вытащить заголовок секции и все её абзацы (включая
  // вложенные подсекции — их заголовки тоже попадут как абзацы-подзаголовки).
  const secRegex = /<sec\b[^>]*>([\s\S]*?)<\/sec>/gi;
  let match;
  let found = false;

  while ((match = secRegex.exec(body)) !== null) {
    found = true;
    const secContent = match[1];

    // Заголовок секции — первый <title> внутри.
    const titleMatch = secContent.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const heading = titleMatch ? stripInlineTags(titleMatch[1]) : '';

    // Все абзацы секции.
    const paras = [...secContent.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((p) => stripInlineTags(p[1]))
      .filter((t) => t.length > 0);

    if (paras.length > 0) {
      sections.push({ heading: heading || 'Раздел', text: paras.join('\n\n') });
    }
  }

  // Если секций нет — берём просто все абзацы body подряд.
  if (!found) {
    const paras = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((p) => stripInlineTags(p[1]))
      .filter(Boolean);
    if (paras.length > 0) sections.push({ heading: 'Текст статьи', text: paras.join('\n\n') });
  }

  return sections;
}

// Удобная обёртка: вернуть полный текст одной строкой (с заголовками).
export function jatsToPlainText(xml) {
  return jatsToSections(xml)
    .map((s) => (s.heading ? `## ${s.heading}\n${s.text}` : s.text))
    .join('\n\n');
}
