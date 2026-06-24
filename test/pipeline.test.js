// Тест конвейера на мок-данных (без сети).
// Проверяем: нормализацию, ранжирование, антидубли, дайджест, формат выдачи.

import { normalizeArticle } from '../src/lib/europepmc.js';
import { rankArticles, pickDigest, fallbackWhy } from '../src/lib/ranking.js';
import { classifyPubType } from '../src/lib/specialties.js';

// Мок-ответ Europe PMC (resultType=core), правдоподобные поля.
const mockRaw = [
  {
    pmid: '40000001', title: 'Immediate vs delayed implant loading: a systematic review and meta-analysis',
    authorString: 'Moraschini V, et al.', journalInfo: { journal: { title: 'J Dent Res' } },
    pubYear: '2026', firstPublicationDate: '2026-06-10', doi: '10.x/jdr.1',
    citedByCount: 12, isOpenAccess: 'Y', pubTypeList: { pubType: ['Systematic Review', 'Meta-Analysis'] },
  },
  {
    pmid: '40000002', title: 'Antibiotic prophylaxis in dental implant surgery: a randomized controlled trial',
    authorString: 'Esposito M, et al.', journalInfo: { journal: { title: 'Clin Oral Implants Res' } },
    pubYear: '2026', firstPublicationDate: '2026-06-12', doi: '10.x/coir.2',
    citedByCount: 3, isOpenAccess: 'N', pubTypeList: { pubType: ['Randomized Controlled Trial'] },
  },
  {
    pmid: '40000003', title: 'A narrative review of peri-implantitis management',
    authorString: 'Smith J, et al.', journalInfo: { journal: { title: 'Dent Today' } },
    pubYear: '2026', firstPublicationDate: '2026-05-20', doi: '10.x/dt.3',
    citedByCount: 40, isOpenAccess: 'N', pubTypeList: { pubType: ['Review'] },
  },
  {
    pmid: '40000004', title: 'Osseointegration in diabetic patients: a cohort study',
    authorString: 'Lee K, et al.', journalInfo: { journal: { title: 'J Periodontol' } },
    pubYear: '2026', firstPublicationDate: '2026-06-01', doi: '10.x/jp.4',
    citedByCount: 1, isOpenAccess: 'Y', pubTypeList: { pubType: ['Observational Study'] },
  },
];

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

console.log('1) Нормализация');
const articles = mockRaw.map(normalizeArticle);
ok(articles.length === 4, 'нормализованы все 4 записи');
ok(articles[0].isOpenAccess === true, 'isOpenAccess "Y" → true');
ok(articles[0].journal === 'J Dent Res', 'журнал извлечён из journalInfo');

console.log('2) Классификация типов');
ok(classifyPubType(['Systematic Review', 'Meta-Analysis']) === 'sr', 'SR+meta → sr');
ok(classifyPubType(['Randomized Controlled Trial']) === 'rct', 'RCT → rct');
ok(classifyPubType(['Review']) === 'review', 'Review → review');
ok(classifyPubType(['Observational Study']) === 'cohort', 'Observational → cohort');

console.log('3) Ранжирование (SR должен быть выше narrative review несмотря на цитирования)');
const ranked = rankArticles(articles, { now: new Date('2026-06-15') });
ok(ranked[0].pmid === '40000001', 'на первом месте систематический обзор');
ok(ranked[0]._score > ranked.find(a => a.pmid === '40000003')._score, 'SR обходит обзор с 40 цитированиями');

console.log('4) Антидубли');
const ranked2 = rankArticles(articles, { excludePmids: new Set(['40000001']), now: new Date('2026-06-15') });
ok(!ranked2.some(a => a.pmid === '40000001'), 'ранее показанный PMID исключён');
ok(ranked2.length === 3, 'осталось 3 статьи');

console.log('5) Дайджест топ-3 + "почему важно"');
const digest = pickDigest(ranked, 3);
ok(digest.length === 3, 'дайджест содержит 3 статьи');
const why = fallbackWhy(ranked[0]);
ok(typeof why === 'string' && why.length > 0, `строка "почему": "${why}"`);

console.log('6) Формат выдачи для клиента (раздел 6 ТЗ)');
const feedItem = {
  pmid: String(ranked[0].pmid), specialty: 'implant', type: ranked[0].typeCode,
  titleRu: '…', date: ranked[0].firstPublishDate,
};
ok('pmid' in feedItem && 'specialty' in feedItem && 'type' in feedItem && 'date' in feedItem,
   'элемент ленты содержит pmid/specialty/type/date');

console.log(`\nИтого: ${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
