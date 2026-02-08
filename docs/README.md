# Fire Break Calculator - UI Review and Uplift

**Status:** In Progress
**Issue:** [#XX - Comprehensive UI Review and Uplift](#)
**Branch:** `claude/conduct-ui-review-and-uplift`

---

## Overview

This directory contains documentation for the comprehensive UI/UX review and uplift of the Fire Break Calculator application. The goal is to transform the functional but dated UI into a modern, accessible, and professional interface.

---

## Documentation Files

### [UI_AUDIT.md](UI_AUDIT.md)
**Complete UI/UX audit report** documenting:
- Current state analysis
- Information hierarchy issues
- Visual design deficiencies
- Accessibility gaps (WCAG compliance)
- Mobile/desktop responsiveness
- Interaction pattern inconsistencies
- Missing modern design patterns

**Key Findings:**
- 12 accessibility issues identified
- 6+ inconsistent button styles
- Touch targets below 44x44px minimum
- No confirmation dialogs for destructive actions
- Inconsistent typography (0.5rem - 1.6rem range)
- No design token system

### [UI_REDESIGN_PLAN.md](UI_REDESIGN_PLAN.md)
**Phased implementation plan** with:
- Phase 1: Critical accessibility fixes
- Phase 2: Visual consistency improvements
- Phase 3: Modern UX enhancements
- Phase 4: Polish & delight
- Implementation checklist
- Testing requirements
- Success metrics

---

## Implementation Progress

### ✅ Phase 0: Foundation (Completed)

**Design Token System** - `webapp/src/design-tokens.css`
- 50+ color tokens (backgrounds, text, borders, status)
- 8-level typography system (0.75rem - 1.75rem)
- 8px baseline spacing grid
- Standardized shadows, borders, radius, transitions
- Light theme support (ready for toggle)
- WCAG 2.1 reduced motion support
- Z-index scale for proper layering
- Component-specific tokens (touch targets, input heights)

**ConfirmDialog Component** - `webapp/src/components/ConfirmDialog.tsx`
- Accessible modal for destructive actions
- Focus trapping within dialog
- Keyboard navigation (Enter to confirm, Escape to cancel)
- ARIA roles and labels (`alertdialog`, `aria-modal`)
- Mobile responsive (full-width on small screens)
- 3 variants: danger, warning, info

**Button Component System** - `webapp/src/styles.css`
- Standardized button classes (`.btn`, `.btn-primary`, etc.)
- 6 variants: primary, success, danger, warning, secondary, ghost
- 3 sizes: small (36px), default (44px), large (52px)
- Consistent hover/active/focus/disabled states
- Lift effect on hover (translateY + shadow)
- Loading state support
- **All buttons meet 44x44px minimum touch target**

### 🚧 Phase 1: Critical Fixes (In Progress)

**Next Steps:**
1. Add delete confirmations using ConfirmDialog
   - Equipment panel delete actions
   - Vegetation panel delete actions
2. Increase touch target sizes
   - Equipment tags (currently 24x16px → 44x44px)
   - Formation expand icons (currently 12x12px → 44x44px)
   - Equipment action buttons (standardize to .btn classes)
3. Improve color contrast
   - Equipment row hover states
   - Placeholder text
   - Formation expand icons
4. Add ARIA labels
   - Main content landmarks
   - Tab navigation (aria-selected)
   - Collapsible sections (aria-expanded)
5. Implement focus management
   - Config panel open/close
   - Equipment edit mode

### 📋 Phase 2-4: Planned

**Phase 2: Visual Consistency**
- Replace all hardcoded colors with design tokens
- Apply typography system (eliminate 0.5rem sizes)
- Apply spacing system throughout
- Add skeleton loading states
- Standardize all button usage

**Phase 3: UX Enhancements**
- Toast notification system
- Drawing gesture help overlay
- Result export (PDF/CSV)
- Equipment presets/favorites

**Phase 4: Polish**
- Micro-interactions
- Smooth transitions
- Keyboard shortcuts modal
- Dark mode toggle

---

## How to Use This Documentation

### For Developers

1. **Starting New UI Work:**
   - Review [UI_AUDIT.md](UI_AUDIT.md) section relevant to your component
   - Check [UI_REDESIGN_PLAN.md](UI_REDESIGN_PLAN.md) for design decisions
   - Use design tokens from `webapp/src/design-tokens.css`
   - Follow accessibility requirements (44px touch targets, contrast, ARIA)

2. **Using the Design System:**
   ```css
   /* ✅ Good - uses design tokens */
   .my-component {
     color: var(--color-text-primary);
     font-size: var(--font-size-base);
     padding: var(--space-4);
     border-radius: var(--radius-md);
   }

   /* ❌ Bad - hardcoded values */
   .my-component {
     color: #f5f7fa;
     font-size: 16px;
     padding: 1rem;
     border-radius: 6px;
   }
   ```

3. **Using ConfirmDialog:**
   ```tsx
   import { ConfirmDialog } from './components/ConfirmDialog';

   const [showConfirm, setShowConfirm] = useState(false);

   <ConfirmDialog
     title="Delete Equipment?"
     message="This action cannot be undone."
     confirmText="Delete"
     cancelText="Cancel"
     variant="danger"
     onConfirm={handleDelete}
     onCancel={() => setShowConfirm(false)}
     isOpen={showConfirm}
   />
   ```

4. **Using Button System:**
   ```tsx
   <button className="btn btn-primary">Save</button>
   <button className="btn btn-danger btn-sm">Delete</button>
   <button className="btn btn-secondary btn-lg">Cancel</button>
   ```

### For Testers

**Accessibility Testing Checklist:**
- [ ] All interactive elements ≥44x44px (use browser devtools)
- [ ] Color contrast ≥4.5:1 (use Lighthouse or axe DevTools)
- [ ] Keyboard navigation works (Tab, Enter, Escape)
- [ ] Screen reader compatible (test with NVDA/JAWS)
- [ ] Focus indicators visible
- [ ] Reduced motion respected (`prefers-reduced-motion: reduce`)

**Visual Testing Checklist:**
- [ ] Design tokens applied consistently
- [ ] Typography readable (no text below 0.75rem)
- [ ] Spacing consistent (8px baseline grid)
- [ ] Buttons have hover/focus/active states
- [ ] Modals trap focus properly

---

## Key Decisions

### Why Design Tokens?
Design tokens provide a single source of truth for design decisions. Instead of scattering colors, spacing, and typography values throughout the codebase, we define them once and reference them everywhere. This makes the UI consistent, maintainable, and easy to theme.

### Why 44px Minimum Touch Targets?
WCAG 2.1 Level AA (success criterion 2.5.5) requires interactive elements to be at least 44x44 CSS pixels for users with motor impairments. This was a critical gap in the current UI.

### Why ConfirmDialog?
The audit identified lack of delete confirmations as a critical safety issue. Users could accidentally delete equipment or vegetation mappings with a single click. ConfirmDialog provides a standardized, accessible solution.

### Why Standardized Buttons?
The audit found 6+ different button styles, making the UI inconsistent and confusing. The standardized button system provides clear visual hierarchy (primary vs secondary actions) and consistent behavior.

---

## Resources

### Internal
- [Main README](../README.md)
- [Architecture Documentation](../webapp/Documentation/ARCHITECTURE.md)
- [User Guide](../webapp/Documentation/USER_GUIDE.md)

### External
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [MDN Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [A11y Project Checklist](https://www.a11yproject.com/checklist/)
- [Material Design Accessibility](https://m3.material.io/foundations/accessible-design/overview)

---

## Contact

For questions about this UI uplift:
- Review the audit and plan documents first
- Check existing component implementations
- Open a discussion issue if clarification needed

---

**Last Updated:** February 8, 2026
**Next Review:** After Phase 1 completion
