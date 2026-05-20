export type LabelAnalysis = {
  brandName: string | null;
  classType: string | null;
  alcoholContent: string | null;
  netContents: string | null;
  producerName: string | null;
  producerAddress: string | null;
  countryOfOrigin: string | null;
  governmentWarning: string | null;
  notes: string[];
  complianceScore: number;
  status: 'pass' | 'review' | 'fail';
  checks: Array<{
    id: string;
    label: string;
    status: 'pass' | 'review' | 'fail';
    detail: string;
  }>;
};

const GOV_WARNING_PREFIX = 'GOVERNMENT WARNING:';

const CLASS_TYPE_RX =
  /\b(bourbon|rye|whiskey|whisky|scotch|vodka|gin|rum|tequila|mezcal|brandy|cognac|liqueur|cordial|wine|beer|ale|lager|stout|porter|ipa|pilsner|cider|mead)\b/i;

const ALC_RX =
  /(\d+(?:\.\d+)?)\s*%\s*(alc\.?\s*\/?\s*vol|abv|alcohol\s+by\s+volume|by\s+volume|proof)/i;

const NET_RX = /\b(\d+(?:\.\d+)?)\s*(ml|mL|l|L|fl\.?\s*oz|oz)\b/;

const COUNTRY_RX =
  /\b(usa|united states|scotland|ireland|canada|france|mexico|japan|germany|england)\b/i;

const CLASS_SUFFIXES = [
  'Kentucky Straight Bourbon Whiskey',
  'Straight Bourbon Whiskey',
  'Bourbon Whiskey',
  'Rye Whiskey',
  'Malt Whiskey',
  'Blended Whiskey',
  'Single Malt Whiskey',
  'Whiskey',
  'Whisky',
  'Vodka',
  'Gin',
  'Rum',
  'Tequila',
  'Mezcal',
  'Brandy',
  'Cognac',
  'Liqueur',
  'Cordial',
  'Wine',
  'Beer',
  'Ale',
  'Lager',
  'Stout',
  'Porter',
  'IPA',
  'Pilsner',
  'Cider',
  'Mead',
] as const;

export function normalizeText(value: string | null | undefined) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function inferBrandAndClassType(brandName: string | null, classType: string | null) {
  const normalizedBrand = normalizeText(brandName);
  const normalizedClass = normalizeText(classType);

  if (normalizedClass) {
    return {
      brandName: normalizedBrand || null,
      classType: normalizedClass || null,
    };
  }

  for (const suffix of CLASS_SUFFIXES) {
    const suffixPattern = new RegExp(`\\b${escapeRegex(suffix)}$`, 'i');
    if (!suffixPattern.test(normalizedBrand)) continue;
    const brandPart = normalizeText(normalizedBrand.slice(0, normalizedBrand.length - suffix.length));
    return {
      brandName: brandPart || normalizedBrand || null,
      classType: suffix,
    };
  }

  return {
    brandName: normalizedBrand || null,
    classType: normalizedClass || null,
  };
}

function hasUsState(value: string) {
  const upper = ` ${normalizeText(value).toUpperCase()} `;
  const stateTokens = [
    ' AL ', ' AK ', ' AZ ', ' AR ', ' CA ', ' CO ', ' CT ', ' DE ', ' FL ', ' GA ', ' HI ', ' ID ', ' IL ', ' IN ',
    ' IA ', ' KS ', ' KY ', ' LA ', ' ME ', ' MD ', ' MA ', ' MI ', ' MN ', ' MS ', ' MO ', ' MT ', ' NE ', ' NV ',
    ' NH ', ' NJ ', ' NM ', ' NY ', ' NC ', ' ND ', ' OH ', ' OK ', ' OR ', ' PA ', ' RI ', ' SC ', ' SD ', ' TN ',
    ' TX ', ' UT ', ' VT ', ' VA ', ' WA ', ' WV ', ' WI ', ' WY ',
  ];
  return stateTokens.some((token) => upper.includes(token)) ||
    /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i.test(normalizeText(value));
}

export function buildComplianceChecks(analysis: LabelAnalysis) {
  const checks = normalizeFieldChecks(analysis);
  const score = checks.reduce((acc, check) => {
    if (check.status === 'pass') return acc + 1;
    if (check.status === 'review') return acc + 0.45;
    return acc;
  }, 0);
  const normalized = Math.round((score / Math.max(1, checks.length)) * 100);

  return {
    ...analysis,
    complianceScore: normalized,
    status: normalized >= 85 ? 'pass' : normalized >= 60 ? 'review' : 'fail',
  } satisfies LabelAnalysis;
}

export function normalizeFieldChecks(analysis: LabelAnalysis) {
  const existing = analysis.checks ?? [];
  const fields: Array<keyof Pick<
    LabelAnalysis,
    'brandName' | 'classType' | 'alcoholContent' | 'netContents' | 'producerName' | 'producerAddress' | 'countryOfOrigin' | 'governmentWarning'
  >> = [
    'brandName',
    'classType',
    'alcoholContent',
    'netContents',
    'producerName',
    'producerAddress',
    'countryOfOrigin',
    'governmentWarning',
  ];

  return fields.map((field) => {
    const fieldLabel = field === 'classType' ? 'Class/type' : field === 'producerName' ? 'Producer / bottler' : field === 'governmentWarning' ? 'Government warning' : field === 'brandName' ? 'Brand name' : field === 'alcoholContent' ? 'Alcohol content' : field === 'netContents' ? 'Net contents' : field === 'producerAddress' ? 'Producer address' : 'Country of origin';
    const value = analysis[field];
    const matching = existing.find((check) => normalizeText(check.id).toLowerCase().replace(/[^a-z0-9]+/g, '') === field.toLowerCase());
    const status = determineFieldStatus(field, value, analysis);
    return {
      id: field,
      label: fieldLabel,
      status,
      detail: matching?.detail ?? buildFieldDetail(field, value, analysis, status),
    };
  }) as LabelAnalysis['checks'];
}

function determineFieldStatus(
  field: 'brandName' | 'classType' | 'alcoholContent' | 'netContents' | 'producerName' | 'producerAddress' | 'countryOfOrigin' | 'governmentWarning',
  value: string | null,
  analysis: LabelAnalysis,
) {
  const text = normalizeText(value);
  const domesticText = `${normalizeText(analysis.producerName)} ${normalizeText(analysis.producerAddress)}`;
  const looksDomestic = hasUsState(domesticText) || /usa|united states|domestic/i.test(domesticText);

  if (!text) {
    if (field === 'countryOfOrigin' && looksDomestic) return 'pass';
    return 'fail';
  }

  if (field === 'alcoholContent') return ALC_RX.test(text) ? 'pass' : 'review';
  if (field === 'netContents') return NET_RX.test(text) ? 'pass' : 'review';
  if (field === 'governmentWarning') return text.toUpperCase().startsWith(GOV_WARNING_PREFIX) ? 'pass' : 'review';
  if (field === 'countryOfOrigin') return looksDomestic ? 'pass' : 'review';
  return 'pass';
}

function buildFieldDetail(
  field: 'brandName' | 'classType' | 'alcoholContent' | 'netContents' | 'producerName' | 'producerAddress' | 'countryOfOrigin' | 'governmentWarning',
  value: string | null,
  analysis: LabelAnalysis,
  status: 'pass' | 'review' | 'fail',
) {
  const text = normalizeText(value);
  if (!text) {
    if (field === 'countryOfOrigin' && (hasUsState(`${analysis.producerName ?? ''} ${analysis.producerAddress ?? ''}`) || /usa|united states|domestic/i.test(`${analysis.producerName ?? ''} ${analysis.producerAddress ?? ''}`))) {
      return 'Domestic labels can omit a country of origin statement.';
    }
    return 'Blank field. This should be present.';
  }
  if (status === 'pass') return `Detected: ${text}`;
  if (field === 'governmentWarning') return `Warning text is present, but the header does not start with "${GOV_WARNING_PREFIX}". Detected: ${text}`;
  if (field === 'countryOfOrigin') return `Country of origin may be optional for domestic labels. Detected: ${text}`;
  if (field === 'alcoholContent') return `Expected alcohol by volume text with a numeric percent or proof. Detected: ${text}`;
  if (field === 'netContents') return `Expected a packaged volume like 750 mL. Detected: ${text}`;
  return `Detected: ${text}`;
}

export function localFallbackAnalysis(ocrText: string): LabelAnalysis {
  const lines = ocrText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const brandName = lines.find((line) =>
    line.length > 3 &&
    line.length < 55 &&
    !CLASS_TYPE_RX.test(line) &&
    !ALC_RX.test(line) &&
    !NET_RX.test(line) &&
    !/warning/i.test(line) &&
    !/bottled|produced|distilled|imported/i.test(line),
  ) ?? null;

  const classType = lines.find((line) => CLASS_TYPE_RX.test(line)) ?? null;
  const alcoholContent = lines.find((line) => ALC_RX.test(line)) ?? null;
  const netContents = lines.find((line) => NET_RX.test(line)) ?? null;
  const producerName = lines.find((line) => /bottled by|produced by|distilled by|imported by|distillery|winery|brewery/i.test(line)) ?? null;
  const producerAddress = lines.find((line) => /[A-Za-z]+,\s*[A-Z]{2}/.test(line)) ?? null;
  const countryOfOrigin = lines.find((line) => COUNTRY_RX.test(line)) ?? null;
  const governmentWarning = lines.find((line) => /government warning/i.test(line)) ?? null;

  const checks = [
    requiredCheck('brandName', 'Brand name', brandName),
    requiredCheck('classType', 'Class/type', classType),
    formatCheck('alcoholContent', 'Alcohol content', alcoholContent, ALC_RX, 'Expected alcohol by volume text with a numeric percent or proof.'),
    formatCheck('netContents', 'Net contents', netContents, NET_RX, 'Expected a packaged volume like 750 mL.'),
    requiredCheck('producerName', 'Producer / bottler', producerName),
    requiredCheck('producerAddress', 'Producer address', producerAddress),
    warningCheck('governmentWarning', 'Government warning', governmentWarning),
  ];

  const inferred = inferBrandAndClassType(brandName, classType);

  return buildComplianceChecks({
    brandName: inferred.brandName,
    classType: inferred.classType,
    alcoholContent,
    netContents,
    producerName,
    producerAddress,
    countryOfOrigin,
    governmentWarning,
    notes: [
      'Local fallback analysis used because the remote vision request failed or was unavailable.',
    ],
    checks,
    complianceScore: 0,
    status: 'review',
  });
}

function requiredCheck(id: string, label: string, value: string | null) {
  return {
    id,
    label,
    status: value ? ('pass' as const) : ('fail' as const),
    detail: value ? `Detected: ${value}` : 'Not confidently detected.',
  };
}

function formatCheck(
  id: string,
  label: string,
  value: string | null,
  pattern: RegExp,
  failureMessage: string,
) {
  if (!value) {
    return {
      id,
      label,
      status: 'fail' as const,
      detail: 'Not confidently detected.',
    };
  }
  if (pattern.test(value)) {
    return {
      id,
      label,
      status: 'pass' as const,
      detail: `Detected: ${value}`,
    };
  }
  return {
    id,
    label,
    status: 'review' as const,
    detail: `${failureMessage} Detected: ${value}`,
  };
}

function warningCheck(id: string, label: string, value: string | null) {
  if (!value) {
    return {
      id,
      label,
      status: 'fail' as const,
      detail: `Expected a warning beginning with "${GOV_WARNING_PREFIX}".`,
    };
  }
  if (value.toUpperCase().startsWith(GOV_WARNING_PREFIX)) {
    return {
      id,
      label,
      status: 'pass' as const,
      detail: `Detected: ${value}`,
    };
  }
  return {
    id,
    label,
    status: 'review' as const,
    detail: `Warning text is present, but the header does not start with "${GOV_WARNING_PREFIX}". Detected: ${value}`,
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function summarizeAnalysis(analysis: LabelAnalysis) {
  const missing = analysis.checks.filter((check) => check.status === 'fail').length;
  const review = analysis.checks.filter((check) => check.status === 'review').length;
  const pass = analysis.checks.length - missing - review;
  return { pass, review, missing };
}
