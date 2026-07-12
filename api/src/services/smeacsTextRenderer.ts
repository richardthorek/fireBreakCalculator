/**
 * Plain-text SMEACS renderer for SMS/clipboard sharing.
 * No markdown, short lines, fits in text messages.
 */

import { SmeacsBriefing } from '../types/assistant';

export function renderSmeacsAsText(briefing: SmeacsBriefing): string {
  const lines: string[] = [];

  lines.push('=== FIRE BREAK BRIEFING ===\n');

  for (const section of briefing.sections) {
    lines.push(`## ${section.heading.toUpperCase()}`);
    for (const line of section.lines) {
      lines.push(line);
    }
    if (section.citations.length > 0) {
      lines.push('Sources:');
      for (const cit of section.citations) {
        lines.push(`  • [[${cit.id}]] ${cit.title}`);
      }
    }
    lines.push('');
  }

  if (briefing.dataHonestyCaveat) {
    lines.push(`⚠️  ${briefing.dataHonestyCaveat}`);
    lines.push('');
  }

  lines.push(`Generated: ${new Date(briefing.generatedAt).toLocaleString()}`);

  return lines.join('\n');
}
