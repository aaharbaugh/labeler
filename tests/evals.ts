import assert from 'node:assert/strict';
import {
  buildComplianceChecks,
  localFallbackAnalysis,
  normalizeFieldChecks,
  normalizeText,
  type LabelAnalysis,
} from '../src/lib/ttb';

const sampleAnalysis: LabelAnalysis = {
  brandName: 'WHISTLEPIG PiggyBack',
  classType: 'Rye Whiskey',
  alcoholContent: '43% Alc./Vol.',
  netContents: '750 mL',
  producerName: 'WhistlePig Whiskey Co.',
  producerAddress: 'Shoreham, VT',
  countryOfOrigin: null,
  governmentWarning: 'GOVERNMENT WARNING: Keep out of reach of children.',
  notes: [],
  complianceScore: 0,
  status: 'review',
  checks: [],
};

function testNormalizeText() {
  assert.equal(normalizeText('  hello   world  '), 'hello world');
  assert.equal(normalizeText(null), '');
}

function testNormalizeFieldChecks() {
  const checks = normalizeFieldChecks(sampleAnalysis);
  const origin = checks.find((check) => check.id === 'countryOfOrigin');
  assert.ok(origin);
  assert.equal(origin?.status, 'pass');
}

function testComplianceScore() {
  const reviewed = buildComplianceChecks({
    ...sampleAnalysis,
    checks: normalizeFieldChecks(sampleAnalysis),
  });
  assert.ok(reviewed.complianceScore > 0);
  assert.ok(['pass', 'review', 'fail'].includes(reviewed.status));
}

function testFallbackAnalysis() {
  const fallback = localFallbackAnalysis(`
WHISTLEPIG PiggyBack
Rye Whiskey
43% Alc./Vol.
750 mL
WhistlePig Whiskey Co.
Shoreham, VT
GOVERNMENT WARNING: Keep out of reach of children.
`);
  assert.equal(fallback.brandName, 'WHISTLEPIG PiggyBack');
  assert.equal(fallback.classType, 'Rye Whiskey');
  assert.equal(fallback.netContents, '750 mL');
  assert.equal(fallback.governmentWarning?.startsWith('GOVERNMENT WARNING:'), true);
}

function main() {
  testNormalizeText();
  testNormalizeFieldChecks();
  testComplianceScore();
  testFallbackAnalysis();
  console.log('evals passed');
}

main();
