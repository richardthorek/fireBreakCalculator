/**
 * Microsoft Clarity Consent Management
 * 
 * Manages user consent for Microsoft Clarity analytics integration.
 * Provides GDPR/privacy-compliant consent handling with banner UI.
 * 
 * @module clarityConsent
 * @version 1.0.0
 */

// Minimal Clarity consent helper
// Shows a non-blocking consent banner and calls Clarity Consent API v2

export function initClarityConsent() {
  // If clarity not available yet, still create banner — the script will honor consent when available
  const storageKey = 'clarity_consent';
  const existing = localStorage.getItem(storageKey);
  if (existing) return; // already decided

  const banner = document.createElement('div');
  banner.className = 'clarity-consent-banner';
  // Layout/responsive styling lives in styles.css (.clarity-consent-banner) so
  // the banner can compact itself on phones instead of covering the panel.
  banner.innerHTML = `
    <div class="clarity-consent-inner">
      <div class="clarity-consent-text">We use Microsoft Clarity to collect anonymous usage data to improve this tool. By consenting you allow session recording for analytics.</div>
      <div class="clarity-consent-actions">
        <button id="clarity-accept" class="clarity-consent-accept">Accept</button>
        <button id="clarity-reject" class="clarity-consent-reject">Reject</button>
      </div>
    </div>
  `;

  document.body.appendChild(banner);

  const accept = document.getElementById('clarity-accept')!;
  const reject = document.getElementById('clarity-reject')!;

  const setConsent = (granted: boolean) => {
    localStorage.setItem(storageKey, granted ? 'granted' : 'denied');
    try {
      // Clarity Consent API v2: clarity('consent', 'grant') or clarity('consent', 'revoke')
      if ((window as any).clarity) {
        if (granted) (window as any).clarity('consent', 'grant');
        else (window as any).clarity('consent', 'revoke');
      }
    } catch (e) {
      // ignore
    }
    banner.remove();
  };

  accept.addEventListener('click', () => setConsent(true));
  reject.addEventListener('click', () => setConsent(false));
}

export function applyStoredClarityConsent() {
  const storageKey = 'clarity_consent';
  const existing = localStorage.getItem(storageKey);
  if (!existing) return;
  try {
    if ((window as any).clarity) {
      if (existing === 'granted') (window as any).clarity('consent', 'grant');
      else (window as any).clarity('consent', 'revoke');
    }
  } catch (e) {
    // ignore
  }
}
