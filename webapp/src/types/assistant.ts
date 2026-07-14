/**
 * Frontend-side mirror of the SMEACS briefing shape returned by
 * `POST /api/assistant/smeacs` (see api/src/types/assistant.ts for the
 * source of truth). Kept minimal — only what the client renders/exports.
 */
export interface AssistantCitation {
  id: string;
  title: string;
  source: string;
}

export interface SmeacsBriefingSection {
  section: 'situation' | 'mission' | 'execution' | 'administration' | 'command' | 'safety';
  heading: string;
  lines: string[];
  userEditable: boolean;
  citations: AssistantCitation[];
}

export interface SmeacsBriefing {
  sections: SmeacsBriefingSection[];
  generatedAt: string;
  dataHonestyCaveat?: string;
  /** Standing legal/operational disclaimer — always present. */
  disclaimer?: string;
  /** Reproducibility stamp: which estimate engine produced these numbers. */
  provenance?: string;
}
