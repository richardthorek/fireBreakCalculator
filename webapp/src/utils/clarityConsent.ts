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
  const storageKey = 'rfs_clarity_consent';
  const existing = localStorage.getItem(storageKey);
  if (existing) return; // already decided

  const banner = document.createElement('div');
  banner.className = 'clarity-consent-banner';
  banner.style.position = 'fixed';
  banner.style.left = '12px';
  banner.style.right = '12px';
  banner.style.bottom = '12px';
  banner.style.zIndex = '10000';
  banner.style.background = 'rgba(30,36,51,0.98)';
  banner.style.border = '1px solid #2a3442';
  banner.style.padding = '12px';
  banner.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
  banner.style.borderRadius = '6px';
  banner.style.fontSize = '14px';
  banner.style.color = '#f5f7fa';
  banner.style.backdropFilter = 'blur(8px)';
  (banner.style as any).webkitBackdropFilter = 'blur(8px)';
  banner.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;justify-content:space-between">
      <div style="flex:1;color:#f5f7fa;line-height:1.4">We use Microsoft Clarity to collect anonymous usage data to improve this tool. By consenting you allow session recording for analytics.</div>
      <div style="flex-shrink:0;display:flex;gap:8px">
        <button id="clarity-accept" style="background:#10b981;color:#fff;border:none;padding:8px 12px;border-radius:4px;cursor:pointer;font-weight:500;transition:background 0.2s">Accept</button>
        <button id="clarity-reject" style="background:rgba(107,114,128,0.2);color:#94a3b8;border:1px solid #374151;padding:8px 12px;border-radius:4px;cursor:pointer;font-weight:500;transition:all 0.2s">Reject</button>
      </div>
    </div>
  `;

  document.body.appendChild(banner);

  const accept = document.getElementById('clarity-accept')!;
  const reject = document.getElementById('clarity-reject')!;

  // Add hover effects
  accept.addEventListener('mouseenter', () => {
    accept.style.background = '#059669';
  });
  accept.addEventListener('mouseleave', () => {
    accept.style.background = '#10b981';
  });

  reject.addEventListener('mouseenter', () => {
    reject.style.background = 'rgba(107,114,128,0.3)';
    reject.style.borderColor = '#4b5563';
  });
  reject.addEventListener('mouseleave', () => {
    reject.style.background = 'rgba(107,114,128,0.2)';
    reject.style.borderColor = '#374151';
  });;

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
  const storageKey = 'rfs_clarity_consent';
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
