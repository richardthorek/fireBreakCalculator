/**
 * Saved plans API client.
 *
 * Cloud persistence for drawn plans, available to signed-in Station Manager
 * subscribers whose plan grants `fireBreakEnabled`. The payload is the same
 * compact encoded string the shareable-URL feature produces
 * (`planSharing.encodePlan`), so a stored plan restores through the exact
 * hardened decode path a shared link uses.
 */

// Same base as the other API utils: relative /api by default so the Vite dev
// proxy forwards to the Functions host.
const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

export interface SavedPlanApi {
  id: string;
  userId: string;
  name: string;
  /** URL-safe-base64 payload as produced by encodePlan(). */
  data: string;
  createdAt: string;
  updatedAt: string;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: { error?: string } | null = null;
    try {
      detail = await res.json();
    } catch {
      // non-JSON error body
    }
    throw new Error(detail?.error || res.statusText);
  }
  return res.json() as Promise<T>;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function listSavedPlans(token: string): Promise<SavedPlanApi[]> {
  const res = await fetch(`${baseUrl}/plans`, { headers: authHeaders(token) });
  return handle<SavedPlanApi[]>(res);
}

export async function createSavedPlan(
  token: string,
  input: { name: string; data: string }
): Promise<SavedPlanApi> {
  const res = await fetch(`${baseUrl}/plans`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handle<SavedPlanApi>(res);
}

export async function deleteSavedPlan(token: string, planId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/plans/${encodeURIComponent(planId)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 204) {
    let detail: { error?: string } | null = null;
    try {
      detail = await res.json();
    } catch {
      // non-JSON error body
    }
    throw new Error(detail?.error || res.statusText);
  }
}
