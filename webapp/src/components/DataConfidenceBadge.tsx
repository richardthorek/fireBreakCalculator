/**
 * Small pill badge communicating how much a displayed number can be
 * trusted, for Mobility Mode's tactical skin: measured > published >
 * estimated > generic-fallback.
 */

import React from 'react';
import type { ConfidenceTier } from '@firebreak/terrain';

export type { ConfidenceTier };

export interface DataConfidenceBadgeProps {
  tier: ConfidenceTier;
  label?: string;
}

const TIER_TEXT: Record<ConfidenceTier, string> = {
  measured: 'MEASURED',
  published: 'PUBLISHED',
  estimated: 'ESTIMATED',
  'generic-fallback': 'GENERIC FALLBACK'
};

const TIER_MODIFIER: Record<ConfidenceTier, string> = {
  measured: 'tac-badge--measured',
  published: 'tac-badge--published',
  estimated: 'tac-badge--estimated',
  'generic-fallback': 'tac-badge--generic'
};

export const DataConfidenceBadge: React.FC<DataConfidenceBadgeProps> = ({ tier, label }) => {
  const text = label ? `${TIER_TEXT[tier]} · ${label}` : TIER_TEXT[tier];

  return (
    <span className={`tac-badge ${TIER_MODIFIER[tier]}`}>
      {text}
    </span>
  );
};

export default DataConfidenceBadge;
