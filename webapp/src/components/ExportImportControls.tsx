/**
 * Export / import controls for the plan toolbar.
 *
 * Export: dropdown offering the full GIS pack (GeoJSON, KML, KMZ, Shapefile,
 * GPX) — every format carries the plan's provenance flags.
 * Import: file picker (GeoJSON/KML/KMZ/GPX) → small in-panel dialog to choose
 * between "use as plan line" (runs the full analysis) and "add as map overlay"
 * (reference layer, e.g. a fire perimeter).
 */

import React, { useRef, useState, useEffect } from 'react';
import { Download, Upload, ChevronDown, X } from 'lucide-react';
import {
  ExportPlanInput,
  toGeoJSON,
  toKML,
  toKMZ,
  toShapefileZip,
  downloadBlob,
  exportFilename,
} from '../utils/gisExport';
import { toGPX, downloadFile } from '../utils/planSharing';
import { parseGisFile, validateImportSize, ImportedFeatures } from '../utils/gisImport';
import { LatLng } from '../utils/chainage';
import { logger } from '../utils/logger';

interface ExportImportControlsProps {
  /** Export payload; null while no line is drawn (export disabled). */
  exportInput: ExportPlanInput | null;
  /** Replace the drawn line with an imported one (full re-analysis). */
  onImportAsPlan: (coords: LatLng[]) => void;
  /** Add imported features as a reference overlay on the map. */
  onAddOverlay: (features: ImportedFeatures) => void;
  /** Number of overlays currently on the map (shows the clear chip). */
  overlayCount: number;
  onClearOverlays: () => void;
}

type ExportFormat = 'geojson' | 'kml' | 'kmz' | 'shp' | 'gpx';

const FORMAT_LABELS: Record<ExportFormat, { label: string; hint: string }> = {
  geojson: { label: 'GeoJSON', hint: 'FireMapper, QGIS, ArcGIS' },
  kml: { label: 'KML', hint: 'Google Earth, Avenza' },
  kmz: { label: 'KMZ', hint: 'Zipped KML with briefing' },
  shp: { label: 'Shapefile (.zip)', hint: 'Legacy agency GIS' },
  gpx: { label: 'GPX', hint: 'Vehicle / handheld GPS' },
};

export const ExportImportControls: React.FC<ExportImportControlsProps> = ({
  exportInput,
  onImportAsPlan,
  onAddOverlay,
  overlayCount,
  onClearOverlays,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<ImportedFeatures | null>(null);
  const [selectedLineIdx, setSelectedLineIdx] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the export menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const handleExport = async (format: ExportFormat) => {
    if (!exportInput) return;
    setMenuOpen(false);
    setExporting(format);
    try {
      switch (format) {
        case 'geojson':
          downloadFile(exportFilename('geojson'), toGeoJSON(exportInput), 'application/geo+json');
          break;
        case 'kml':
          downloadFile(exportFilename('kml'), toKML(exportInput), 'application/vnd.google-earth.kml+xml');
          break;
        case 'kmz':
          downloadBlob(exportFilename('kmz'), await toKMZ(exportInput));
          break;
        case 'shp':
          downloadBlob(exportFilename('zip'), await toShapefileZip(exportInput));
          break;
        case 'gpx':
          downloadFile(exportFilename('gpx'), toGPX(exportInput.coords, exportInput.name || 'Fire break plan'), 'application/gpx+xml');
          break;
      }
    } catch (e) {
      logger.error(`Export failed (${format})`, e);
      setImportError(`Export failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setExporting(null);
    }
  };

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setImportError(null);
    try {
      const features = await parseGisFile(file);
      validateImportSize(features);
      setSelectedLineIdx(0);
      setPendingImport(features);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not read file');
      setPendingImport(null);
    }
  };

  const confirmImportAsPlan = () => {
    if (!pendingImport || pendingImport.lines.length === 0) return;
    const line = pendingImport.lines[Math.min(selectedLineIdx, pendingImport.lines.length - 1)];
    onImportAsPlan(line.coords);
    setPendingImport(null);
  };

  const confirmAddOverlay = () => {
    if (!pendingImport) return;
    onAddOverlay(pendingImport);
    setPendingImport(null);
  };

  return (
    <>
      <div className="export-menu-wrap" ref={menuRef}>
        <button
          type="button"
          className="plan-export-btn"
          disabled={!exportInput || exporting !== null}
          onClick={() => setMenuOpen(v => !v)}
          title="Export the plan for other GIS tools"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <Download size={14} strokeWidth={2} aria-hidden />{' '}
          {exporting ? `Exporting ${FORMAT_LABELS[exporting].label}…` : 'Export'}{' '}
          <ChevronDown size={12} strokeWidth={2} aria-hidden />
        </button>
        {menuOpen && (
          <div className="export-menu" role="menu">
            {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map(fmt => (
              <button key={fmt} type="button" role="menuitem" className="export-menu-item" onClick={() => handleExport(fmt)}>
                <span className="export-menu-label">{FORMAT_LABELS[fmt].label}</span>
                <span className="export-menu-hint">{FORMAT_LABELS[fmt].hint}</span>
              </button>
            ))}
            <div className="export-menu-note">All formats keep estimated-data flags.</div>
          </div>
        )}
      </div>

      <button
        type="button"
        className="plan-export-btn"
        onClick={() => fileInputRef.current?.click()}
        title="Import GeoJSON, KML, KMZ or GPX (e.g. a fire perimeter or a line from FireMapper)"
      >
        <Upload size={14} strokeWidth={2} aria-hidden /> Import
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".geojson,.json,.kml,.kmz,.gpx"
        style={{ display: 'none' }}
        onChange={handleFileChosen}
        aria-hidden
      />

      {overlayCount > 0 && (
        <button
          type="button"
          className="plan-export-btn overlay-clear-btn"
          onClick={onClearOverlays}
          title="Remove imported reference overlays from the map"
        >
          <X size={13} strokeWidth={2} aria-hidden /> Overlays ({overlayCount})
        </button>
      )}

      {importError && (
        <div className="import-error" role="alert">
          {importError}
          <button type="button" aria-label="Dismiss" onClick={() => setImportError(null)}>×</button>
        </div>
      )}

      {pendingImport && (
        <div className="import-dialog" role="dialog" aria-label="Import options">
          <div className="import-dialog-title">
            <strong>{pendingImport.sourceName}</strong>
            <span className="import-dialog-counts">
              {pendingImport.lines.length > 0 && `${pendingImport.lines.length} line${pendingImport.lines.length > 1 ? 's' : ''}`}
              {pendingImport.lines.length > 0 && pendingImport.polygons.length > 0 && ' · '}
              {pendingImport.polygons.length > 0 && `${pendingImport.polygons.length} polygon${pendingImport.polygons.length > 1 ? 's' : ''}`}
            </span>
          </div>
          {pendingImport.lines.length > 1 && (
            <select
              aria-label="Choose which line to use as the plan"
              value={selectedLineIdx}
              onChange={e => setSelectedLineIdx(Number(e.target.value))}
            >
              {pendingImport.lines.map((l, i) => (
                <option key={i} value={i}>{l.name} ({l.coords.length} pts)</option>
              ))}
            </select>
          )}
          <div className="import-dialog-actions">
            {pendingImport.lines.length > 0 && (
              <button type="button" className="import-plan-btn" onClick={confirmImportAsPlan}>
                Use as plan line
              </button>
            )}
            <button type="button" className="import-overlay-btn" onClick={confirmAddOverlay}>
              Add as map overlay
            </button>
            <button type="button" className="import-cancel-btn" onClick={() => setPendingImport(null)}>
              Cancel
            </button>
          </div>
          {pendingImport.lines.length > 0 && (
            <div className="import-dialog-hint">
              "Use as plan line" replaces the drawn line and re-runs the full analysis.
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default ExportImportControls;
