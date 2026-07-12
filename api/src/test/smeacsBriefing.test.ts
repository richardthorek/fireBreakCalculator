/**
 * Unit tests for SMEACS briefing builder.
 * Plain node + assert (matches the project's framework-free test convention).
 * Run after build: node ./dist/src/test/smeacsBriefing.test.js
 */

import * as assert from 'node:assert';
import { buildSmeacsBriefing } from '../services/smeacsBriefingBuilder';
import { renderSmeacsAsText } from '../services/smeacsTextRenderer';
import { AssistantPayload } from '../types/assistant';

const mockPayload: AssistantPayload = {
  distanceM: 2500,
  breakWidthM: 3,
  maxSlopeDeg: 28,
  meanSlopeDeg: 15,
  predominantVegetation: 'medium scrub',
  vegetationConfidence: 0.87,
  estimatedData: false,
  difficultyScore: 62,
  difficultyLabel: 'Moderate',
  topEquipment: [
    {
      name: 'Dozer with winch',
      type: 'dozer',
      timeHours: 4.2,
      cost: 1200,
      compatibilityLevel: 'High',
    },
  ],
  insights: [
    {
      severity: 'warning',
      title: 'Slope exceeds 25°',
      detail: '~800 m of line is 25–30° grade, within machinery operating range but production drops significantly.',
    },
  ],
  locality: 'Goulburn NSW, Wingello State Forest',
  taskedResourceTypes: ['dozer', 'escort appliance'],
};

// Test: build a SMEACS briefing with six sections
{
  const briefing = buildSmeacsBriefing(mockPayload);
  assert.strictEqual(briefing.sections.length, 6);
  assert.deepStrictEqual(
    briefing.sections.map((s) => s.section),
    ['situation', 'mission', 'execution', 'administration', 'command', 'safety']
  );
}

// Test: include estimated data caveat when flagged
{
  const payload = { ...mockPayload, estimatedData: true };
  const briefing = buildSmeacsBriefing(payload);
  assert(briefing.dataHonestyCaveat !== undefined);
  assert(briefing.dataHonestyCaveat.includes('estimated'));
}

// Test: include equipment details in Execution section
{
  const briefing = buildSmeacsBriefing(mockPayload);
  const exec = briefing.sections.find((s) => s.section === 'execution');
  assert(exec?.lines.some((l) => l.includes('Dozer with winch')));
  assert(exec?.lines.some((l) => l.includes('4.2 h')));
}

// Test: include supervision thresholds for heavy plant
{
  const payload = {
    ...mockPayload,
    taskedResourceTypes: ['dozer', 'dozer', 'dozer', 'dozer', 'dozer', 'escort appliance'],
  };
  const briefing = buildSmeacsBriefing(payload);
  const cmd = briefing.sections.find((s) => s.section === 'command');
  assert(cmd?.lines.some((l) => l.includes('Plant Operations Manager')));
}

// Test: render sections as plain text
{
  const briefing = buildSmeacsBriefing(mockPayload);
  const text = renderSmeacsAsText(briefing);
  assert(text.includes('SITUATION'));
  assert(text.includes('MISSION'));
  assert(text.includes('EXECUTION'));
  assert(text.includes('ADMINISTRATION & LOGISTICS'));
  assert(text.includes('COMMAND & COMMUNICATIONS'));
  assert(text.includes('SAFETY'));
}

// Test: mark user-editable sections correctly
{
  const briefing = buildSmeacsBriefing(mockPayload);
  const mission = briefing.sections.find((s) => s.section === 'mission');
  assert.strictEqual(mission?.userEditable, true);
  const situation = briefing.sections.find((s) => s.section === 'situation');
  assert.strictEqual(situation?.userEditable, false);
}

// Test: include hazard warnings in Execution
{
  const briefing = buildSmeacsBriefing(mockPayload);
  const exec = briefing.sections.find((s) => s.section === 'execution');
  assert(exec?.lines.some((l) => l.includes('Slope exceeds 25°')));
}

// Test: include citations for heavy plant safety requirements
{
  const briefing = buildSmeacsBriefing(mockPayload);
  const safety = briefing.sections.find((s) => s.section === 'safety');
  assert(safety?.citations.length && safety.citations.length > 0);
  assert(safety?.citations.some((c) => c.id.includes('rfs-plant')));
}

console.log('✓ SMEACS briefing tests passed');
