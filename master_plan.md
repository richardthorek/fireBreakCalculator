# Fire Break Calculator - Master Plan

This document tracks major initiatives, technical decisions, and project milestones for the Fire Break Calculator application.

## Recent Updates

### February 2026 - Comprehensive Dependency Audit and Upgrade

**Issue Reference:** Conduct full dependency audit and upgrade to latest versions

**Objective:** Modernize all project dependencies to their latest stable versions while maintaining Azure Static Web Apps compatibility and resolving all security vulnerabilities. **Upgraded to Node.js 22.x** as the runtime environment.

#### Node.js Version Upgrade

Node.js: 20.x → 22.x
- Updated GitHub Actions workflow to use Node.js 22.x
- Updated API `.nvmrc` to specify Node 22
- Updated API `package.json` engines field to `>=22.x`
- Created `staticwebapp.config.json` to configure Azure Functions runtime as `node:22`
- Updated API `@types/node` from 20.x to 22.x for TypeScript compatibility
- Verified all dependencies are compatible with Node.js 22.x

#### Changes Implemented

##### Webapp Dependencies (`/webapp`)
- **Vite**: 7.1.4 → 7.3.1
  - Resolved 3 moderate security vulnerabilities (GHSA-g4jq-h2w9-997c, GHSA-jqfw-vq24-v9c3, GHSA-93m4-6634-74q7)
- **mapbox-gl**: 3.14.0 → 3.18.1
  - Latest features and bug fixes for map rendering
- **@mapbox/mapbox-gl-draw**: 1.5.0 → 1.5.1
  - Minor improvements to drawing tools
- **TypeScript**: 5.9.2 → 5.9.3
  - Latest patch release with bug fixes
- **@types/node**: 24.3.1 → 24.10.12
  - Updated type definitions
- **@types/react**: 18.3.24 → 18.3.28
  - Latest React 18 type definitions

**Security Status:** ✅ 0 vulnerabilities

##### API Dependencies (`/api`)
- **@azure/functions**: 4.7.2 → 4.11.2
  - Resolved 2 moderate + 2 high security vulnerabilities (undici, fast-xml-parser, glob)
  - Latest Azure Functions runtime compatibility
- **@azure/data-tables**: 13.3.1 → 13.3.2
  - Latest Azure Table Storage client improvements
- **TypeScript**: 4.9.5 → 5.9.3
  - Major version upgrade (4.x → 5.x) with improved type checking and performance
- **rimraf**: 5.0.10 → 6.1.2
  - Updated file cleanup utility
- **@types/node**: 20.x → 22.x
  - Updated to match Node.js 22 runtime

**Bug Fix:** Updated test script path from `dist/test/e2e.test.js` to `dist/src/test/e2e.test.js` to match TypeScript output structure.

**Security Status:** ✅ 0 vulnerabilities

##### Scripts Dependencies (`/scripts`)
- **@azure/data-tables**: 13.3.1 → 13.3.2
  - Consistency with API version
- **node-fetch**: Maintained at 2.7.0
  - Version 3.x is ESM-only and would break CommonJS scripts
  - Applied npm audit fix to resolve transitive fast-xml-parser vulnerability

**Security Status:** ✅ 0 vulnerabilities

#### Verification Results
- ✅ Webapp builds successfully with all upgraded dependencies
- ✅ Webapp tests pass (machine-compatibility test suite)
- ✅ API builds successfully with TypeScript 5.x
- ✅ No security vulnerabilities across all packages
- ✅ Compatible with Node.js 20.x (Azure SWA requirement)

#### React 19 Consideration
React 19 was available (19.2.4) but **not upgraded** due to:
- React 19 is relatively new and includes breaking changes
- Current React 18.3.1 is stable and fully functional
- Risk/benefit analysis favors stability for production deployment
- Can be revisited in a future dedicated upgrade once React 19 ecosystem matures

#### Node.js Compatibility
- **Production Environment:** Node.js 22.x (Azure Static Web Apps CI/CD)
- **API Engine Requirement:** `>=22.x` (explicitly configured via staticwebapp.config.json)
- **Azure Functions Runtime:** node:22
- All dependencies confirmed compatible with Node 22.x
- Node.js 22 provides enhanced performance, security updates, and latest V8 JavaScript engine features

#### Dependabot Status
- No specific Dependabot configuration file found in `.github/dependabot.yml`
- Recommendation: Consider adding Dependabot configuration for automated dependency updates
- Suggested configuration would monitor webapp, api, and scripts directories separately

#### Future Considerations
1. **React 19 Migration:** Re-evaluate in Q2 2026 once ecosystem stabilizes
2. **Dependabot Setup:** Add `.github/dependabot.yml` for automated security updates
3. **ESM Migration for Scripts:** Consider converting scripts to ES modules to enable node-fetch 3.x+
4. **Regular Audits:** Schedule quarterly dependency reviews to stay current

---

## Project Architecture

### Technology Stack
- **Frontend:** React 18 + Vite 7 + TypeScript 5
- **Backend:** Azure Functions (Node.js 22) + TypeScript 5
- **Database:** Azure Table Storage
- **Mapping:** Mapbox GL JS
- **Deployment:** Azure Static Web Apps
- **Runtime:** Node.js 22.x

### Key Components
- **Webapp** (`/webapp`): React-based frontend application
- **API** (`/api`): Azure Functions serverless backend
- **Scripts** (`/scripts`): Data management and seeding utilities

---

## Version Control
- **Repository:** https://github.com/richardthorek/fireBreakCalculator
- **Primary Branch:** main
- **Node Version:** 22.x (LTS)

---

_This document should be updated with each major milestone, architectural decision, or significant feature implementation._
