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
  banner.style.background = 'rgba(255,255,255,0.95)';
  banner.style.border = '1px solid #ddd';
  banner.style.padding = '12px';
  banner.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
  banner.style.borderRadius = '6px';
  banner.style.fontSize = '14px';
  banner.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;justify-content:space-between">
      <div style="flex:1">We use Microsoft Clarity to collect anonymous usage data to improve this tool. By consenting you allow session recording for analytics.</div>
      <div style="flex-shrink:0;display:flex;gap:8px">
        <button id="clarity-accept" style="background:#0b5cff;color:#fff;border:none;padding:8px 12px;border-radius:4px;cursor:pointer">Accept</button>
        <button id="clarity-reject" style="background:#eee;color:#333;border:none;padding:8px 12px;border-radius:4px;cursor:pointer">Reject</button>
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
