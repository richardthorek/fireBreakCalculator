/**
 * Application Entry Point
 * 
 * Main entry point for the Fire Break Calculator React application.
 * Configures React rendering and Microsoft Clarity analytics integration.
 * 
 * @module main
 * @version 1.0.0
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { applyStoredClarityConsent, initClarityConsent } from './utils/clarityConsent';

// Apply any stored consent early so Clarity honors it when the script loads
applyStoredClarityConsent();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);

// Show consent prompt after initial render so UI is interactive
setTimeout(() => {
	initClarityConsent();
}, 1200);

// Register the service worker in production for offline field use. The SW does
// runtime caching (app shell, already-viewed map tiles, equipment list) so the
// tool keeps working with no signal. Dev is skipped to avoid caching churn.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('/sw.js').catch(() => {
			/* offline support is best-effort; ignore registration failures */
		});
	});
}
