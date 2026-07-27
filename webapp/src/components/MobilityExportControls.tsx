/**
 * Export control for Terrain Mobility & Counter-Mobility results — the
 * scouting/planning handoff (docs §29): corridors, chokepoints, the min-cut
 * barrier and any counter-measure placements, as one GIS pack. Mirrors
 * ExportImportControls.tsx's dropdown pattern exactly; import is not offered
 * here since there is no equivalent "load a corridor field back in" concept.
 */

import React, { useRef, useState, useEffect } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import {
  ExportMobilityInput,
  toMobilityGeoJSON,
  toMobilityKML,
  toMobilityKMZ,
  mobilityExportFilename,
} from '../utils/mobilityGisExport';
import { downloadBlob } from '../utils/gisExport';
import { downloadFile } from '../utils/planSharing';
import { logger } from '../utils/logger';

interface MobilityExportControlsProps {
  /** Null while there is nothing analysed yet (export disabled). */
  exportInput: ExportMobilityInput | null;
}

type MobilityExportFormat = 'geojson' | 'kml' | 'kmz';

const FORMAT_LABELS: Record<MobilityExportFormat, { label: string; hint: string }> = {
  geojson: { label: 'GeoJSON', hint: 'QGIS, ArcGIS, FireMapper' },
  kml: { label: 'KML', hint: 'Google Earth, Avenza' },
  kmz: { label: 'KMZ', hint: 'Zipped KML with briefing' },
};

export const MobilityExportControls: React.FC<MobilityExportControlsProps> = ({ exportInput }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState<MobilityExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const handleExport = async (format: MobilityExportFormat) => {
    if (!exportInput) return;
    setMenuOpen(false);
    setExporting(format);
    setError(null);
    try {
      switch (format) {
        case 'geojson':
          downloadFile(mobilityExportFilename('geojson'), toMobilityGeoJSON(exportInput), 'application/geo+json');
          break;
        case 'kml':
          downloadFile(mobilityExportFilename('kml'), toMobilityKML(exportInput), 'application/vnd.google-earth.kml+xml');
          break;
        case 'kmz':
          downloadBlob(mobilityExportFilename('kmz'), await toMobilityKMZ(exportInput));
          break;
      }
    } catch (e) {
      logger.error(`Mobility export failed (${format})`, e);
      setError(`Export failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="export-menu-wrap mobility-export-wrap" ref={menuRef}>
      <button
        type="button"
        className="plan-export-btn"
        disabled={!exportInput || exporting !== null}
        onClick={() => setMenuOpen(v => !v)}
        title="Export corridors, chokepoints, barrier and placements for scouting/planning in other GIS tools"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <Download size={14} strokeWidth={2} aria-hidden />{' '}
        {exporting ? `Exporting ${FORMAT_LABELS[exporting].label}…` : 'Export appreciation'}{' '}
        <ChevronDown size={12} strokeWidth={2} aria-hidden />
      </button>
      {menuOpen && (
        <div className="export-menu" role="menu">
          {(Object.keys(FORMAT_LABELS) as MobilityExportFormat[]).map(fmt => (
            <button key={fmt} type="button" role="menuitem" className="export-menu-item" onClick={() => handleExport(fmt)}>
              <span className="export-menu-label">{FORMAT_LABELS[fmt].label}</span>
              <span className="export-menu-hint">{FORMAT_LABELS[fmt].hint}</span>
            </button>
          ))}
          <div className="export-menu-note">Corridors, chokepoints, barrier &amp; placements — all flags travel with the file.</div>
        </div>
      )}
      {error && (
        <div className="import-error" role="alert">
          {error}
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>×</button>
        </div>
      )}
    </div>
  );
};

export default MobilityExportControls;
