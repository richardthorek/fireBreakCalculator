# Changelog

All notable changes to the Fire Break Calculator project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed - February 2026: Dependency Audit and Security Update

#### Node.js Runtime Upgrade
- **Upgraded Node.js from 20.x to 22.x** across the entire project
  - Updated GitHub Actions CI/CD workflow to Node.js 22.x
  - Updated API `.nvmrc` file to specify Node 22
  - Updated API `package.json` engines requirement to `>=22.x`
  - Created `staticwebapp.config.json` to configure Azure Functions runtime as `node:22`
  - Updated API `@types/node` from 20.x to 22.x for TypeScript compatibility
  - Verified all dependencies compatible with Node.js 22.x
  - Benefits: Enhanced performance, latest security patches, modern V8 JavaScript engine

#### Webapp Dependencies
- Upgraded Vite from 7.1.4 to 7.3.1 - **Security Fix**
  - Fixed GHSA-g4jq-h2w9-997c: Vite middleware file serving vulnerability
  - Fixed GHSA-jqfw-vq24-v9c3: Vite server.fs settings not applied to HTML
  - Fixed GHSA-93m4-6634-74q7: Vite server.fs.deny bypass on Windows
- Upgraded mapbox-gl from 3.14.0 to 3.18.1
- Upgraded @mapbox/mapbox-gl-draw from 1.5.0 to 1.5.1
- Upgraded TypeScript from 5.9.2 to 5.9.3
- Upgraded @types/node from 24.3.1 to 24.10.12
- Upgraded @types/react from 18.3.24 to 18.3.28
- All dependencies updated to latest stable versions
- **Result:** 0 security vulnerabilities

#### API Dependencies
- Upgraded @azure/functions from 4.7.2 to 4.11.2 - **Security Fix**
  - Fixed undici vulnerability (GHSA-g9mf-h72j-4rw9)
  - Fixed fast-xml-parser vulnerability (GHSA-37qj-frw5-hhjh)
  - Fixed glob vulnerability (GHSA-5j98-mcp5-4vw2)
- Upgraded @azure/data-tables from 13.3.1 to 13.3.2
- Upgraded TypeScript from 4.9.5 to 5.9.3 - **Major Version Upgrade**
- Upgraded rimraf from 5.0.10 to 6.1.2
- Upgraded @types/node from 20.x to 22.x - **Node.js 22 Compatibility**
- **Result:** 0 security vulnerabilities

#### Scripts Dependencies
- Upgraded @azure/data-tables from 13.3.1 to 13.3.2
- Maintained node-fetch at 2.7.0 (v3 requires ESM, scripts use CommonJS)
- Applied npm audit fix to resolve transitive dependencies
- **Result:** 0 security vulnerabilities

### Added
- Created `staticwebapp.config.json` to configure Azure Static Web Apps
  - Explicitly sets API runtime to Node.js 22
  - Configures navigation fallback for SPA routing
  - Sets up 404 handling

### Fixed
- Corrected API test script path from `dist/test/e2e.test.js` to `dist/src/test/e2e.test.js`

### Security
- Resolved all security vulnerabilities across webapp, api, and scripts packages
- Total of 5 vulnerabilities patched (3 moderate, 2 high severity)

### Documentation
- Created master_plan.md to track major project initiatives and architectural decisions
- Created CHANGELOG.md to document version changes

### Notes
- React 18.3.1 retained (React 19 available but deferred for stability)
- All changes verified compatible with Azure Static Web Apps deployment
- **Node.js 22.x compatibility confirmed for all dependencies**
- Node.js 22 provides improved performance and security over Node 20

---

## Historical Context

This is the first formal changelog for the Fire Break Calculator project. Previous changes were tracked through Git commit history and GitHub issues.

For detailed commit history, see: https://github.com/richardthorek/fireBreakCalculator/commits/main

---

_Changelog format follows [Keep a Changelog](https://keepachangelog.com/) principles._
