import { jatsToSections, jatsToPlainText } from '../src/lib/fulltext.js';

// Образец JATS XML, как его отдаёт Europe PMC fullTextXML.
const sampleJats = `<?xml version="1.0"?>
<article>
<front><article-meta><title-group><article-title>Sample</article-title></title-group></article-meta></front>
<body>
<sec id="s1">
<title>Introduction</title>
<p>Dental implants are a <italic>widely</italic> used treatment <xref ref-type="bibr" rid="b1">[1]</xref> for tooth loss.</p>
<p>This study evaluates survival rates over 10 years.</p>
</sec>
<sec id="s2">
<title>Methods</title>
<p>We enrolled 120 patients in a randomized design with two arms&#x2009;each.</p>
<sec id="s2a">
<title>Statistical analysis</title>
<p>Data were analyzed using Cox regression (p&lt;0.05).</p>
</sec>
</sec>
<sec id="s3">
<title>Results</title>
<p>Survival was 94.2% at 10 years (95% CI 91-97).</p>
</sec>
</body>
</article>`;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

console.log('Парсинг JATS XML полного текста:');
const sections = jatsToSections(sampleJats);

ok(sections.length === 3, `извлечено 3 секции (получено ${sections.length})`);
ok(sections[0].heading === 'Introduction', 'первая секция — Introduction');
ok(sections[1].heading === 'Methods', 'вторая секция — Methods');
ok(sections[2].heading === 'Results', 'третья секция — Results');
ok(sections[0].text.includes('widely used treatment'), 'инлайн-теги <italic> убраны, текст склеен');
ok(!sections[0].text.includes('[1]'), 'ссылка <xref> [1] удалена');
ok(sections[1].text.includes('120 patients'), 'текст методов на месте');
ok(sections[1].text.includes('each'), 'entity &#x2009; преобразован в пробел');
ok(sections[2].text.includes('94.2%'), 'числовой результат сохранён');
ok(sections[2].text.includes('p<0.05') || sections[1].text.includes('p<0.05'), '&lt; раскодирован в <');

const plain = jatsToPlainText(sampleJats);
ok(plain.includes('## Introduction') && plain.includes('## Results'), 'plain text содержит заголовки секций');

// Запасной путь: только abstract, без body.
const absOnly = `<article><front><abstract><p>Short abstract text here.</p></abstract></front></article>`;
const absSections = jatsToSections(absOnly);
ok(absSections.length === 1 && absSections[0].heading === 'Аннотация', 'без body — берётся аннотация');

console.log(`\nИтого: ${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
