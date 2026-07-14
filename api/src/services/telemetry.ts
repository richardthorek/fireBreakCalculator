/**
 * Minimal production telemetry helper.
 *
 * The app degrades silently by design (NVIS → flagged fallback, equipment API
 * → built-in catalogue, Overpass → mirrors), which means the single most
 * safety-relevant production signal — *what fraction of analyses ran on
 * fallback/estimated data* — is otherwise invisible until a field user
 * questions an estimate. This emits one structured line per notable event so it
 * can be alerted on from Application Insights / Log Analytics without pulling in
 * the App Insights SDK (which the SWA managed-Functions host wires up via the
 * APPLICATIONINSIGHTS_CONNECTION_STRING app setting and host.json sampling).
 *
 * Query these in Log Analytics by the stable `metric` marker, e.g.:
 *
 *   traces
 *   | where message startswith "METRIC "
 *   | extend p = parse_json(substring(message, 7))
 *   | where p.metric == "analysis_completed"
 *   | summarize total=count(), fallback=countif(p.anyFallback == true) by bin(timestamp, 1h)
 *   | extend fallbackRate = todouble(fallback) / total
 *
 * Alert when `fallbackRate` exceeds an agreed threshold — a spike usually means
 * an upstream (NVIS/SVTM/DEM) is degraded, not that the ground changed.
 */

import { InvocationContext } from '@azure/functions';

export type MetricName =
  | 'analysis_completed'
  | 'assistant_call'
  | 'elevation_profile';

/**
 * Emit a single structured metric line. Kept deliberately small and dependency
 * free; the leading `METRIC ` marker + JSON payload is what the KQL above keys
 * on. Never throws.
 */
export function emitMetric(
  ctx: InvocationContext,
  metric: MetricName,
  fields: Record<string, unknown>
): void {
  try {
    ctx.log(`METRIC ${JSON.stringify({ metric, ...fields })}`);
  } catch {
    // Telemetry must never break the request path.
  }
}
