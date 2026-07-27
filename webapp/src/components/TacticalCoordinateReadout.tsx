/**
 * Coordinate readout panel for Mobility Mode's tactical skin.
 *
 * Shows the current cursor/point location as decimal degrees, DMS, and a
 * UTM-derived grid reference. This is deliberately labelled as UTM, not
 * MGRS — we compute an easting/northing/zone via utm-latlng for demo
 * realism, but we do not implement the 100km-square lettering that full
 * NATO MGRS requires, so the caption says so plainly.
 */

import React, { useEffect, useRef, useState } from 'react';

export interface TacticalCoordinateReadoutProps {
  lat: number | null;
  lng: number | null;
}

// Lazily loaded, matching webapp/src/utils/gridReference.ts's pattern — keeps
// utm-latlng out of the main bundle's static import graph (it's only needed
// while this readout is visible, i.e. inside Mobility Mode).
let utmConverter: any = null;
async function getUtmConverter() {
  if (!utmConverter) {
    const UtmLatLng = (await import('utm-latlng')).default;
    utmConverter = new UtmLatLng();
  }
  return utmConverter;
}

/** Formats a decimal-degree value as D°M'S.s"H, e.g. 33°27'07.6"S. */
function toDms(value: number, isLatitude: boolean): string {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = (minutesFloat - minutes) * 60;
  const hemisphere = isLatitude
    ? (value >= 0 ? 'N' : 'S')
    : (value >= 0 ? 'E' : 'W');
  const secondsText = seconds.toFixed(1).padStart(4, '0');
  return `${degrees}°${String(minutes).padStart(2, '0')}'${secondsText}"${hemisphere}`;
}

/**
 * Computes a UTM grid reference string using the same call shape as
 * webapp/src/utils/gridReference.ts (`convertLatLngToUtm(lat, lng, 0)`).
 *
 * utm-latlng's bundled .d.ts is out of sync with its runtime API — it
 * declares `ConvertLatLngToUtm` (capitalised) while the shipped JS only
 * ever defines lowercase `convertLatLngToUtm` — so, matching the existing
 * gridReference.ts precedent, the call is routed through `any` rather than
 * fighting the incorrect upstream types. Returns null if the library
 * reports an error string or throws.
 */
async function computeUtmGrid(lat: number, lng: number): Promise<string | null> {
  try {
    const converter: any = await getUtmConverter();
    const result = converter.convertLatLngToUtm(lat, lng, 0);
    if (!result || typeof result === 'string') {
      return null;
    }
    const easting = Math.round(result.Easting);
    const northing = Math.round(result.Northing);
    return `${result.ZoneNumber}${result.ZoneLetter} ${easting}mE ${northing}mN`;
  } catch {
    return null;
  }
}

export const TacticalCoordinateReadout: React.FC<TacticalCoordinateReadoutProps> = ({ lat, lng }) => {
  const [utmText, setUtmText] = useState('—');
  const requestToken = useRef(0);

  useEffect(() => {
    if (lat === null || lng === null) {
      setUtmText('—');
      return;
    }
    const token = ++requestToken.current;
    computeUtmGrid(lat, lng).then(text => {
      if (requestToken.current === token) setUtmText(text ?? 'UTM —');
    });
  }, [lat, lng]);

  let ddText = '—';
  let dmsText = '—';

  if (lat !== null && lng !== null) {
    ddText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    dmsText = `${toDms(lat, true)} ${toDms(lng, false)}`;
  }

  return (
    <div className="tac-panel tac-mono" aria-label="Coordinate readout">
      <div className="tac-readout-grid">
        <span className="tac-label">DD</span>
        <span>{ddText}</span>

        <span className="tac-label">DMS</span>
        <span>{dmsText}</span>

        <span className="tac-label">UTM</span>
        <span>{utmText}</span>
      </div>
      <span className="tac-label">UTM GRID — NOT NATO MGRS</span>
    </div>
  );
};

export default TacticalCoordinateReadout;
