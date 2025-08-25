Local dev note - API proxy

When running the frontend with `npm run dev` (Vite), the dev server proxies `/api` to the local Azure Functions host to avoid CORS errors.

Requirements:
- Start the Functions host: `cd api && npm start` (ensure it runs on http://localhost:7071)
- Start the frontend: `npm run dev` (Vite listens on http://localhost:5173)

If you prefer not to use the proxy, enable CORS on the Functions host or set VITE_API_BASE_URL to point to the proxied host.
