// Реестр официальных клинических руководств по специальностям.
//
// ПОЧЕМУ РЕЕСТР, А НЕ API:
// В отличие от статей (Europe PMC отдаёт их через API), у клинических
// руководств нет единого открытого API. ADA, AAP, EFP, Минздрав публикуют их
// на своих сайтах в разных форматах. OpenEvidence получает их через платные
// контракты с ассоциациями — нам это недоступно и не нужно на старте.
//
// Поэтому реестр — КУРИРУЕМЫЙ ВРУЧНУЮ список проверенных документов. Это
// честный подход: ничего не парсим нелегально, ссылаемся на официальные
// первоисточники в открытом доступе.
//
// ДВА ТИПА ЗАПИСЕЙ:
//   type: 'journal' — руководство опубликовано в рецензируемом журнале и есть
//     в PubMed/Europe PMC (поле pmid). Такие документы ПРОХОДЯТ через тот же
//     механизм статьи/полного текста, что и обычные публикации — бонус.
//   type: 'web' — руководство размещено на сайте организации (поле url).
//
// ВАЖНО ДЛЯ КОМАНДЫ: перед продакшеном проверить актуальность ссылок, годов
// и PMID — организации обновляют руководства, ссылки меняются. Этот список —
// стартовая основа, а не финальная истина.

export const GUIDELINES = [
  // ─── Пародонтология ───
  {
    id: 'efp-s3-periodontitis-i-iii',
    org: 'EFP',
    orgFull: 'European Federation of Periodontology',
    titleRu: 'Лечение пародонтита стадий I–III (S3-уровень)',
    titleEn: 'Treatment of stage I–III periodontitis — S3-level clinical practice guideline',
    year: 2020,
    specialties: ['perio'],
    type: 'journal',
    pmid: '32383274', // Sanz et al., J Clin Periodontol 2020 — проверить перед продом
  },
  {
    id: 'aap-efp-2017-classification',
    org: 'AAP / EFP',
    orgFull: 'American Academy of Periodontology / European Federation of Periodontology',
    titleRu: 'Классификация заболеваний пародонта и периимплантных тканей (Всемирный воркшоп 2017)',
    titleEn: 'A new classification scheme for periodontal and peri-implant diseases (2017 World Workshop)',
    year: 2018,
    specialties: ['perio', 'implant'],
    type: 'journal',
    pmid: '29926951', // Caton et al. — проверить перед продом
  },
  {
    id: 'aap-guidelines-hub',
    org: 'AAP',
    orgFull: 'American Academy of Periodontology',
    titleRu: 'Клинические и научные руководства AAP',
    titleEn: 'AAP Clinical and Scientific Resources',
    year: null,
    specialties: ['perio'],
    type: 'web',
    url: 'https://www.perio.org/for-professionals/clinical-and-scientific-resources/',
  },

  // ─── Имплантология ───
  {
    id: 'iti-treatment-guides',
    org: 'ITI',
    orgFull: 'International Team for Implantology',
    titleRu: 'Клинические руководства и консенсусы ITI',
    titleEn: 'ITI Treatment Guides and Consensus Statements',
    year: null,
    specialties: ['implant'],
    type: 'web',
    url: 'https://www.iti.org/',
  },

  // ─── Эндодонтия ───
  {
    id: 'aae-guidelines',
    org: 'AAE',
    orgFull: 'American Association of Endodontists',
    titleRu: 'Руководства и позиционные документы AAE',
    titleEn: 'AAE Guidelines and Position Statements',
    year: null,
    specialties: ['endo'],
    type: 'web',
    url: 'https://www.aae.org/specialty/clinical-resources/guidelines-position-statements/',
  },
  {
    id: 'ese-quality-guidelines',
    org: 'ESE',
    orgFull: 'European Society of Endodontology',
    titleRu: 'Руководства по качеству эндодонтического лечения ESE',
    titleEn: 'ESE Quality Guidelines for Endodontic Treatment',
    year: null,
    specialties: ['endo'],
    type: 'web',
    url: 'https://www.e-s-e.eu/',
  },

  // ─── Протезирование ───
  {
    id: 'acp-guidelines',
    org: 'ACP',
    orgFull: 'American College of Prosthodontists',
    titleRu: 'Клинические руководства ACP',
    titleEn: 'ACP Clinical Practice Guidelines',
    year: null,
    specialties: ['prosth'],
    type: 'web',
    url: 'https://www.prosthodontics.org/',
  },

  // ─── Ортодонтия ───
  {
    id: 'aao-resources',
    org: 'AAO',
    orgFull: 'American Association of Orthodontists',
    titleRu: 'Клинические ресурсы AAO',
    titleEn: 'AAO Clinical Practice Resources',
    year: null,
    specialties: ['ortho'],
    type: 'web',
    url: 'https://www.aaoinfo.org/',
  },

  // ─── Хирургия ───
  {
    id: 'aaoms-mronj',
    org: 'AAOMS',
    orgFull: 'American Association of Oral and Maxillofacial Surgeons',
    titleRu: 'Позиционный документ по медикаментозному остеонекрозу челюстей (MRONJ)',
    titleEn: 'Medication-Related Osteonecrosis of the Jaw — Position Paper',
    year: 2022,
    specialties: ['surgery'],
    type: 'web',
    url: 'https://www.aaoms.org/practice-resources/aaoms-position-papers',
  },

  // ─── Детская стоматология ───
  {
    id: 'aapd-reference-manual',
    org: 'AAPD',
    orgFull: 'American Academy of Pediatric Dentistry',
    titleRu: 'Справочник клинических руководств AAPD',
    titleEn: 'AAPD Reference Manual — Clinical Practice Guidelines',
    year: null,
    specialties: ['child'],
    type: 'web',
    url: 'https://www.aapd.org/research/oral-health-policies--recommendations/',
  },

  // ─── Общие / межспециальные (ADA) ───
  {
    id: 'ada-ebd',
    org: 'ADA',
    orgFull: 'American Dental Association',
    titleRu: 'Доказательные клинические руководства ADA',
    titleEn: 'ADA Clinical Practice Guidelines (Center for Evidence-Based Dentistry)',
    year: null,
    specialties: ['all'],
    type: 'web',
    url: 'https://www.ada.org/resources/research/science-and-research-institute/evidence-based-dental-research',
  },

  // ─── Россия ───
  {
    id: 'minzdrav-cr',
    org: 'Минздрав РФ',
    orgFull: 'Министерство здравоохранения Российской Федерации',
    titleRu: 'Клинические рекомендации по стоматологии (рубрикатор Минздрава)',
    titleEn: 'Russian Ministry of Health — Clinical Guidelines',
    year: null,
    specialties: ['all'],
    type: 'web',
    url: 'https://cr.minzdrav.gov.ru/',
  },
  {
    id: 'star-cr',
    org: 'СтАР',
    orgFull: 'Стоматологическая ассоциация России',
    titleRu: 'Клинические рекомендации СтАР',
    titleEn: 'Russian Dental Association — Clinical Guidelines',
    year: null,
    specialties: ['all'],
    type: 'web',
    url: 'https://www.e-stomatology.ru/',
  },
];

// Вернуть руководства для специальности. 'all'-руководства (ADA, Минздрав,
// СтАР) показываются для любой специальности.
export function getGuidelinesFor(specialty = null) {
  if (!specialty || specialty === 'all') return GUIDELINES;
  return GUIDELINES.filter(
    (g) => g.specialties.includes(specialty) || g.specialties.includes('all')
  );
}
