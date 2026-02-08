# GitHub Copilot Instructions - Fire Break Calculator

## ⚠️ MANDATORY: Master Plan Workflow

**BEFORE STARTING ANY WORK:**
1. **READ** `/master_plan.md` completely - understand current state, goals, and roadmap
2. **REVIEW** the Forward Roadmap section for your task context
3. **CHECK** if your work aligns with documented goals and priorities

**AFTER COMPLETING ANY WORK:**
1. **UPDATE** `/master_plan.md` with what was accomplished
2. **ADD** dated entry in Recent Updates section
3. **LINK** to PR/issue in the relevant roadmap item
4. **MARK** roadmap items complete (📋 → ✅) when done

**DO NOT:**
- ❌ Create separate "summary" documents after work
- ❌ Make status reports in separate files
- ❌ Duplicate information from master_plan.md
- ❌ Create post-work documentation that isn't the master plan

## Project Overview
Fire Break Calculator is a modern geospatial planning tool for rural firefighters and emergency response teams. The application enables efficient fire break and trail planning with instant estimates for time, cost, and resource requirements.

## Critical Documentation

### 1. Master Plan (THE SOURCE OF TRUTH)
- **Path**: `/master_plan.md`
- **Status**: **LIVING DOCUMENT - CONSTANTLY MAINTAINED**
- **Purpose**: Single source of truth for project vision, current state, decisions, and roadmap
- **Update**: MANDATORY before starting work AND after completing work
- **Contains**: Goals, recent updates, forward roadmap, architecture, risks, rollback plans

### 2. Machine-Readable Registers (CONSTANTLY MAINTAINED)
These are the ONLY auxiliary documents that matter:

#### API Register
- **Path**: `/docs/api-register.md` (to be created when needed)
- **Purpose**: Machine-readable catalog of all API endpoints
- **Format**: Structured data (JSON/YAML or markdown tables)
- **Update**: Every time an API endpoint is added/modified/removed
- **Contains**: Endpoint, method, parameters, responses, authentication

#### Function/Component Register  
- **Path**: `/docs/component-register.md` (to be created when needed)
- **Purpose**: Machine-readable catalog of all React components and functions
- **Format**: Structured data (markdown tables, can be parsed)
- **Update**: Every time a component is added/modified/removed
- **Contains**: Component name, path, props interface, purpose, dependencies

### 3. Reference Documentation (REFERENCE ONLY)
- **Path**: `/docs/current_state/` (reference only, not primary)
- **Status**: Supplementary detail, NOT the source of truth
- **Update**: Only when providing helpful context, not routinely
- **Purpose**: Detailed breakdowns IF needed for complex areas

### Screenshot Documentation
- **Path**: `/docs/screenshots/`
- **Purpose**: Visual documentation of UI/UX changes
- **Naming Convention**: `YYYY-MM-DD-feature-name-[before|after].png`

## Branching Strategy

### Branch Naming Conventions
- **Feature branches**: `feature/short-descriptive-name`
- **Bug fixes**: `bugfix/issue-number-short-description`
- **Copilot branches**: `copilot/task-description`
- **Hotfix branches**: `hotfix/critical-issue-description`

### Branch Workflow
1. **Main Branch (`main`)**: Production-ready code only
2. **Development Flow**: Create feature/bugfix branch from `main` → Implement → PR → Review → Merge to `main`
3. **No Direct Commits**: All changes must go through Pull Requests
4. **PR Requirements**: 
   - Descriptive title and description
   - Link to related issue(s)
   - Update relevant documentation
   - Pass all CI checks

## CI/CD, Linting, and Testing Policy

### Continuous Integration
- **Platform**: GitHub Actions
- **Workflow Location**: `.github/workflows/`
- **Triggers**: Push to any branch, Pull Request to `main`

### Linting Requirements
- **Frontend (webapp/)**:
  - ESLint configuration in `webapp/.eslintrc` or `package.json`
  - TypeScript strict mode enabled
  - Run: `npm run lint` before committing
  
- **Backend (api/)**:
  - ESLint configuration for Node.js/TypeScript
  - TypeScript strict mode enabled
  - Run: `npm run lint` before committing

- **Pre-commit Expectations**: Code must pass linting before PR approval

### Testing Policy
- **Frontend Tests**: 
  - Location: `webapp/src/test/`
  - Framework: Vite test suite
  - Run: `npm test`
  - Coverage target: Core calculation logic and critical user flows
  
- **Backend Tests**:
  - Location: `api/src/test/`
  - Framework: Node.js testing framework
  - Run: `npm test`
  - Coverage target: API endpoints and data access logic

- **Testing Requirements**:
  - All new features must include tests
  - Bug fixes must include regression tests
  - PRs with failing tests will not be merged
  - Aim for >80% code coverage on new code

### Build Requirements
- **Frontend**: Must build without errors (`npm run build`)
- **Backend**: Must compile TypeScript without errors (`npm run build`)
- **Type Safety**: No TypeScript `any` types without justification

## Code Quality Standards

### TypeScript Usage
- Use TypeScript for all new code
- Avoid `any` types; use proper type definitions
- Define interfaces for data structures
- Use type guards for runtime type checking

### Code Style
- 2 spaces for indentation
- Meaningful variable and function names
- JSDoc comments for public APIs
- Follow existing code patterns in the codebase

### Accessibility Requirements
- WCAG 2.1 AA compliance minimum
- All interactive elements must be keyboard accessible
- Proper ARIA labels and semantic HTML
- Color contrast ratios must meet AA standards (4.5:1 for normal text)

### Documentation Requirements
- **MANDATORY**: Update master_plan.md for all significant work
- **OPTIONAL**: Update machine-readable registers (API, component) when relevant
- **AVOID**: Creating summary documents, status reports, or duplicate tracking docs
- Update README.md ONLY for user-facing changes
- Add inline comments for complex logic only
- Screenshots in /docs/screenshots/ for UI changes

## Project Ownership & Contact

### Primary Maintainer
- **Repository Owner**: richardthorek
- **Project Name**: fireBreakCalculator
- **Organization**: Personal Project / Rural Fire Service Community Tool

### Communication Channels
- **Issues**: [GitHub Issues](https://github.com/richardthorek/fireBreakCalculator/issues)
- **Feature Requests**: Use the "💡 Suggest Feature" button in the app or create an issue with `enhancement` label
- **Bug Reports**: Use bug report template in GitHub Issues
- **Pull Requests**: Follow contributing guidelines in CONTRIBUTING.md

### Contribution Process
1. Check existing issues and PRs to avoid duplication
2. For significant changes, create an issue first to discuss
3. Fork the repository and create a branch
4. Implement changes following code quality standards
5. Write/update tests and documentation
6. Submit PR with clear description and link to issue
7. Respond to review feedback promptly

## Dependencies and Security

### Dependency Management
- **Node.js Version**: 22.x (specified in `.nvmrc` and `package.json`)
- **Package Manager**: npm
- **Security Audits**: Run `npm audit` regularly
- **Updates**: Keep dependencies up to date, prioritize security patches

### Security Guidelines
- No secrets or API keys in code
- Use environment variables for configuration
- Validate all user inputs
- Sanitize data before rendering
- Follow OWASP security best practices

### External Services
- **Mapbox**: Requires valid access token (stored in environment variables)
- **Azure Services**: Storage and Functions (configured via Azure portal)
- **NSW Government APIs**: Vegetation data (public, attribution required)

## Project-Specific Conventions

### File Organization
- **Components**: `webapp/src/components/` - React components
- **Utilities**: `webapp/src/utils/` - Helper functions
- **Types**: `webapp/src/types/` - TypeScript type definitions
- **Styles**: `webapp/src/styles.css` and component-level CSS
- **API Functions**: `api/src/functions/` - Azure Functions endpoints
- **Shared Logic**: `api/src/utils/` - Reusable backend utilities

### Naming Conventions
- **Components**: PascalCase (e.g., `EquipmentConfigPanel.tsx`)
- **Files**: kebab-case for non-components (e.g., `use-toast.ts`)
- **Functions**: camelCase (e.g., `calculateDistance`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_DISTANCE_KM`)
- **CSS Classes**: kebab-case (e.g., `.equipment-row`)

### State Management
- React hooks for local state
- Props for component communication
- Context API for shared state (if needed)
- Avoid prop drilling; use composition

### Error Handling
- Use try-catch for async operations
- Provide user-friendly error messages
- Log errors for debugging (avoid exposing sensitive info)
- Implement proper loading and error states in UI

## Special Notes for AI Assistants

### MANDATORY WORKFLOW
1. **BEFORE ANY WORK**: Read `/master_plan.md` completely
2. **DURING WORK**: Reference master_plan.md for context and decisions
3. **AFTER ANY WORK**: Update master_plan.md with changes, link PR/issue
4. **NEVER**: Create post-work summary documents separate from master_plan.md

### When Making Changes
1. **Always read** `master_plan.md` first - it's mandatory, not optional
2. **Update** `master_plan.md` at the end - add dated entries, link PRs/issues
3. **Reference** UI_AUDIT.md and UI_REDESIGN_PLAN.md for UI/UX work (reference only)
4. **Update** API/component registers IF adding/modifying endpoints or components
5. **Take screenshots** for UI changes and save to `docs/screenshots/`
6. **DO NOT** create new status documents, summaries, or tracking files

### Documentation Philosophy
- **Master Plan = Source of Truth**: One living document, constantly maintained
- **Registers = Machine Readable**: API and component catalogs, updated when code changes
- **Everything Else = Reference**: Historical, can be archived, not actively maintained

### Roadmap Planning
- All roadmap items in `master_plan.md` must include:
  - Clear acceptance criteria
  - Links to related issues/PRs
  - Reference to current_state documentation
  - Risk assessment and rollback plan (for major changes)
  - Estimated effort and priority level

### Design System Conventions
- Use design tokens (CSS custom properties) for consistency
- Follow 8px baseline grid for spacing
- Maintain WCAG AA color contrast minimum
- Touch targets minimum 44x44px
- Responsive breakpoints: 480px (mobile), 768px (tablet), 1024px (desktop)

---

**Last Updated**: February 2026
**Maintained By**: Project maintainers and AI contributors
**Version**: 1.0
