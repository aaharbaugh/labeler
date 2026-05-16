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

export function normalizeText(value: string | null | undefined) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function buildComplianceChecks(analysis: LabelAnalysis) {
  const checks = analysis.checks;
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

  return buildComplianceChecks({
    brandName,
    classType,
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

export function summarizeAnalysis(analysis: LabelAnalysis) {
  const missing = analysis.checks.filter((check) => check.status === 'fail').length;
  const review = analysis.checks.filter((check) => check.status === 'review').length;
  const pass = analysis.checks.length - missing - review;
  return { pass, review, missing };
}
