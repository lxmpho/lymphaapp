// Маппинг специальностей → ключевые термины для Europe PMC.
// Основано на разделе 4-5 ТЗ. Каждая специальность даёт набор терминов,
// которые объединяются в один OR-блок при сборке запроса.

export const SPECIALTIES = {
  implant: {
    labelRu: 'Имплантология',
    terms: ['dental implant', 'osseointegration', 'peri-implantitis'],
  },
  endo: {
    labelRu: 'Эндодонтия',
    terms: ['root canal', 'endodontic', 'NiTi instrumentation'],
  },
  perio: {
    labelRu: 'Пародонтология',
    terms: ['periodontitis', 'scaling root planing', 'periodontal therapy'],
  },
  prosth: {
    labelRu: 'Протезирование',
    terms: ['zirconia crown', 'CAD/CAM dental', 'fixed prosthodontics'],
  },
  ortho: {
    labelRu: 'Ортодонтия',
    terms: ['orthodontic treatment', 'clear aligners', 'malocclusion'],
  },
  surgery: {
    labelRu: 'Хирургия',
    terms: ['oral surgery', 'third molar extraction', 'alveolar ridge augmentation'],
  },
  child: {
    labelRu: 'Детская стоматология',
    terms: ['pediatric dentistry', 'pulpotomy primary teeth', 'fissure sealant'],
  },
};

// Типы публикаций, которые считаем доказательными (раздел 5: приоритет SR и РКИ).
export const EVIDENCE_PUB_TYPES = [
  'Randomized Controlled Trial',
  'Systematic Review',
  'Meta-Analysis',
];

// Нормализация типа публикации из ответа Europe PMC → внутренний код.
// Используется и для бейджей на клиенте, и для ранжирования.
export function classifyPubType(pubTypeList = []) {
  const lower = pubTypeList.map((t) => String(t).toLowerCase());
  if (lower.some((t) => t.includes('randomized'))) return 'rct';
  if (lower.some((t) => t.includes('meta-analysis') || t.includes('meta analysis'))) return 'sr';
  if (lower.some((t) => t.includes('systematic'))) return 'sr';
  if (lower.some((t) => t.includes('review'))) return 'review';
  if (lower.some((t) => t.includes('cohort') || t.includes('observational'))) return 'cohort';
  return 'other';
}

// Вес типа исследования для ранжирования (раздел 5).
export function evidenceWeight(typeCode) {
  switch (typeCode) {
    case 'sr': return 100;   // систематические обзоры и мета-анализы — высший приоритет
    case 'rct': return 80;   // РКИ
    case 'review': return 40;
    case 'cohort': return 30;
    default: return 10;
  }
}
