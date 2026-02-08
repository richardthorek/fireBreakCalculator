# UI Redesign Plan
**Fire Break Calculator - Comprehensive UI Uplift**

**Plan Date:** February 8, 2026
**Target Completion:** Phased implementation
**Based On:** [UI_AUDIT.md](UI_AUDIT.md)

---

## Implementation Philosophy

**Minimal Change, Maximum Impact:**
- Focus on highest-impact improvements first
- Maintain existing functionality and workflows
- Preserve what works well (map interaction, core calculations)
- Use modern design standards without over-engineering

---

## Phase 1: Critical Fixes (Accessibility & Safety)

**Priority:** MUST COMPLETE
**Estimated Effort:** 2-3 days
**Focus:** WCAG compliance, safety, touch usability

### 1.1 Confirmation Dialogs ⚠️ CRITICAL

**Problem:** Destructive actions (delete equipment, delete vegetation mapping) happen without confirmation.

**Solution:**
```typescript
// Add confirmation modal component
<ConfirmDialog
  title="Delete Equipment?"
  message="Are you sure you want to delete this equipment? This action cannot be undone."
  confirmText="Delete"
  cancelText="Cancel"
  onConfirm={handleDelete}
  onCancel={handleCancel}
  variant="danger"
/>
```

**Files to Modify:**
- `webapp/src/components/EquipmentConfigPanel.tsx` - Add delete confirmation
- `webapp/src/components/VegetationConfigPanel.tsx` - Add delete confirmation
- Create new: `webapp/src/components/ConfirmDialog.tsx`

### 1.2 Touch Target Sizes ⚠️ CRITICAL

**Problem:** Many interactive elements below 44x44px minimum (WCAG 2.1 AA requirement).

**Solutions:**

**Equipment Tags:**
```css
/* Current: padding: 1px 4px; font-size: 0.5rem; (too small) */
.tag {
  padding: 6px 12px; /* Minimum 44px touch target */
  font-size: 0.75rem; /* More readable */
  min-width: 44px;
  min-height: 44px;
}
```

**Formation Expand Icons:**
```css
/* Current: font-size: 8px; width: 12px; (nearly impossible to tap) */
.formation-expand-icon {
  font-size: 16px;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

**Equipment Action Buttons:**
```css
/* Current: padding: 2px 5px; font-size: 0.5rem; (too small) */
.eq-actions .btn {
  padding: 8px 16px;
  font-size: 0.875rem;
  min-width: 44px;
  min-height: 44px;
}
```

**Files to Modify:**
- `webapp/src/styles-config.css` - Update tag, button sizes
- `webapp/src/styles.css` - Update formation expand icons

### 1.3 Color Contrast Improvements ⚠️ CRITICAL

**Problem:** Equipment row hover state fails WCAG AA (3.2:1 vs required 4.5:1).

**Solutions:**

```css
/* Current: background: rgba(30,41,59,0.5); contrast: 3.2:1 ❌ */
.equip-row:hover {
  background: rgba(59, 130, 246, 0.15); /* Blue tint, higher contrast */
  border-color: #3b82f6;
}

/* Current: color: #64748b; contrast: ~4.8:1 (marginal) */
.search-box::placeholder {
  color: #94a3b8; /* Lighter gray, better contrast */
}

/* Formation expand icon barely visible */
.formation-expand-icon {
  opacity: 1; /* Was 0.8 */
  color: #cbd5e1; /* Was #94a3b8 - increase contrast */
}
```

**Files to Modify:**
- `webapp/src/styles-config.css` - Update hover states
- `webapp/src/styles.css` - Update placeholder colors

### 1.4 Reduced Motion Support ⚠️ CRITICAL

**Problem:** No `prefers-reduced-motion` support (WCAG 2.1 requirement).

**Solution:**
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }

  /* Disable pulse animation entirely */
  .user-location-marker {
    animation: none;
  }
}
```

**Files to Modify:**
- `webapp/src/styles.css` - Add reduced motion query

### 1.5 ARIA Labels & Focus Management

**Problem:** Missing ARIA attributes, focus not managed properly.

**Solutions:**

**Add ARIA Landmarks:**
```tsx
// In App.tsx
<main role="main" aria-label="Map and analysis workspace">
  <MapboxMapView ... />
  <AnalysisPanel role="complementary" aria-label="Fire break analysis results" ... />
</main>
```

**Tab Navigation:**
```tsx
// In IntegratedConfigPanel.tsx
<button
  role="tab"
  aria-selected={activeTab === 'equipment'}
  aria-controls="equipment-panel"
  onClick={() => setActiveTab('equipment')}
>
  Equipment
</button>
```

**Focus Management:**
```tsx
// When opening config panel
useEffect(() => {
  if (isOpen) {
    // Move focus into panel
    const firstFocusable = panelRef.current?.querySelector('button, input');
    firstFocusable?.focus();
  }
}, [isOpen]);

// When closing config panel
const handleClose = () => {
  setIsOpen(false);
  // Return focus to toggle button
  toggleButtonRef.current?.focus();
};
```

**Files to Modify:**
- `webapp/src/App.tsx` - Add main landmark
- `webapp/src/components/IntegratedConfigPanel.tsx` - Focus management
- `webapp/src/components/EquipmentConfigPanel.tsx` - ARIA attributes
- `webapp/src/components/VegetationConfigPanel.tsx` - ARIA attributes

---

## Phase 2: Visual Consistency & Polish

**Priority:** HIGH
**Estimated Effort:** 3-4 days
**Focus:** Design system, consistency, professionalism

### 2.1 Standardized Color System

**Problem:** 10+ shades of gray, inconsistent color coding.

**Solution: Create design tokens**

```css
/* Design tokens - colors.css */
:root {
  /* Backgrounds */
  --color-bg-primary: #0f1115;
  --color-bg-secondary: #1e293b;
  --color-bg-tertiary: #1e2937;
  --color-bg-elevated: #233040;

  /* Text */
  --color-text-primary: #f5f7fa;
  --color-text-secondary: #cbd5e1;
  --color-text-tertiary: #94a3b8;
  --color-text-muted: #64748b;

  /* Borders */
  --color-border-primary: #334155;
  --color-border-secondary: #475569;
  --color-border-subtle: #1f2937;

  /* Interactive */
  --color-accent-primary: #3b82f6;
  --color-accent-secondary: #2563eb;
  --color-accent-hover: rgba(59, 130, 246, 0.1);

  /* Status */
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;
  --color-info: #3b82f6;

  /* Terrain (standardized) */
  --color-terrain-flat: #10b981;
  --color-terrain-medium: #f59e0b;
  --color-terrain-steep: #ef4444;
  --color-terrain-very-steep: #7c2d12;

  /* Vegetation (standardized) */
  --color-veg-grassland: #84cc16;
  --color-veg-lightshrub: #f59e0b;
  --color-veg-mediumscrub: #ea580c;
  --color-veg-heavyforest: #166534;
}
```

**Files to Create:**
- `webapp/src/design-tokens.css` - New design token system

**Files to Modify:**
- `webapp/src/styles.css` - Replace hardcoded colors with tokens
- `webapp/src/styles-config.css` - Replace hardcoded colors with tokens

### 2.2 Typography System

**Problem:** Font sizes from 0.5rem to 1.6rem with no system.

**Solution: 5-level type scale**

```css
/* Typography system */
:root {
  /* Font sizes */
  --font-size-xs: 0.75rem;    /* 12px - minimum readable */
  --font-size-sm: 0.875rem;   /* 14px - body small */
  --font-size-base: 1rem;     /* 16px - body */
  --font-size-lg: 1.125rem;   /* 18px - large body */
  --font-size-xl: 1.25rem;    /* 20px - h3 */
  --font-size-2xl: 1.5rem;    /* 24px - h2 */
  --font-size-3xl: clamp(1.25rem, 2vw, 1.75rem); /* 20-28px - h1 responsive */

  /* Font weights */
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Line heights */
  --line-height-tight: 1.25;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.75;
}

/* Usage */
.app-title {
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-bold);
  line-height: var(--line-height-tight);
}

.panel-heading {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
}

.body-text {
  font-size: var(--font-size-base);
  line-height: var(--line-height-normal);
}

.label-text {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.caption-text {
  font-size: var(--font-size-xs);
  line-height: var(--line-height-normal);
}
```

**Eliminate sizes below 0.75rem:**
- Current `0.5rem` tags → `0.75rem` (minimum readable)
- Current `0.6rem` guidance → `0.75rem`
- Current `0.65rem` tabs → `0.875rem`

**Files to Modify:**
- `webapp/src/design-tokens.css` - Add typography tokens
- `webapp/src/styles.css` - Apply typography system
- `webapp/src/styles-config.css` - Apply typography system

### 2.3 Spacing System

**Problem:** No consistent spacing scale (2px, 3px, 4px, 6px, 8px, 12px all used).

**Solution: 8px baseline grid**

```css
/* Spacing system - 8px baseline */
:root {
  --space-0: 0;
  --space-1: 0.25rem;  /* 4px */
  --space-2: 0.5rem;   /* 8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;     /* 16px */
  --space-6: 1.5rem;   /* 24px */
  --space-8: 2rem;     /* 32px */
  --space-12: 3rem;    /* 48px */
  --space-16: 4rem;    /* 64px */
}

/* Usage */
.config-header {
  padding: var(--space-3) var(--space-4);
}

.equipment-row {
  padding: var(--space-2) var(--space-3);
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.panel-content {
  padding: var(--space-4);
}
```

**Files to Modify:**
- `webapp/src/design-tokens.css` - Add spacing tokens
- `webapp/src/styles.css` - Apply spacing system
- `webapp/src/styles-config.css` - Apply spacing system

### 2.4 Standardized Button Components

**Problem:** 6 different button styles with no consistency.

**Solution: Button component system**

```css
/* Button base */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-tight);
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  min-height: 44px; /* Touch target */
  text-decoration: none;
}

.btn:focus-visible {
  outline: 2px solid var(--color-accent-primary);
  outline-offset: 2px;
}

/* Button variants */
.btn-primary {
  background: var(--color-accent-primary);
  color: white;
}

.btn-primary:hover {
  background: var(--color-accent-secondary);
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(59, 130, 246, 0.3);
}

.btn-success {
  background: var(--color-success);
  color: white;
}

.btn-success:hover {
  background: #059669;
  transform: translateY(-1px);
}

.btn-danger {
  background: var(--color-danger);
  color: white;
}

.btn-danger:hover {
  background: #dc2626;
  transform: translateY(-1px);
}

.btn-secondary {
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  border-color: var(--color-border-primary);
}

.btn-secondary:hover {
  background: var(--color-border-primary);
  color: var(--color-text-primary);
}

.btn-ghost {
  background: transparent;
  color: var(--color-text-secondary);
}

.btn-ghost:hover {
  background: var(--color-accent-hover);
  color: var(--color-accent-primary);
}

/* Button sizes */
.btn-sm {
  padding: var(--space-1) var(--space-3);
  font-size: var(--font-size-xs);
  min-height: 36px;
}

.btn-lg {
  padding: var(--space-3) var(--space-6);
  font-size: var(--font-size-base);
}

/* Button states */
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}
```

**Files to Create:**
- `webapp/src/components/Button.tsx` - Reusable button component

**Files to Modify:**
- Replace all custom button styles with standardized button classes

### 2.5 Loading & Skeleton States

**Problem:** No loading skeletons, emoji spinners.

**Solution: Add skeleton screens**

```tsx
// Skeleton component
export const Skeleton: React.FC<{ width?: string; height?: string; variant?: 'text' | 'rectangular' | 'circular' }> = ({
  width = '100%',
  height = '1rem',
  variant = 'text'
}) => {
  return (
    <div
      className={`skeleton skeleton-${variant}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
};

// CSS
.skeleton {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.05) 25%,
    rgba(255, 255, 255, 0.1) 50%,
    rgba(255, 255, 255, 0.05) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s ease-in-out infinite;
  border-radius: 4px;
}

@keyframes skeleton-loading {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.skeleton-text {
  border-radius: 4px;
}

.skeleton-rectangular {
  border-radius: 6px;
}

.skeleton-circular {
  border-radius: 50%;
}
```

**Usage:**
```tsx
// In AnalysisPanel.tsx when loading
{isAnalyzing ? (
  <div className="analysis-loading">
    <Skeleton height="60px" />
    <Skeleton height="40px" />
    <Skeleton height="40px" />
  </div>
) : (
  <div className="analysis-results">
    {/* actual results */}
  </div>
)}
```

**Files to Create:**
- `webapp/src/components/Skeleton.tsx`

**Files to Modify:**
- `webapp/src/components/AnalysisPanel.tsx` - Add skeleton loading
- `webapp/src/components/EquipmentConfigPanel.tsx` - Add skeleton loading
- `webapp/src/components/VegetationConfigPanel.tsx` - Add skeleton loading

---

## Phase 3: UX Enhancements

**Priority:** MEDIUM
**Estimated Effort:** 3-4 days
**Focus:** Modern UX patterns, user feedback

### 3.1 Toast Notification System

**Problem:** No feedback for saves, errors appear as text in panels.

**Solution:**

```tsx
// Toast component
interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, type, duration = 3000, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div className={`toast toast-${type}`} role="alert" aria-live="polite">
      <span className="toast-icon">{getIcon(type)}</span>
      <span className="toast-message">{message}</span>
      <button className="toast-close" onClick={onClose} aria-label="Close notification">
        ×
      </button>
    </div>
  );
};

// Toast manager hook
export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = (message: string, type: ToastType) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
  };

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return { toasts, showToast, removeToast };
};
```

**CSS:**
```css
.toast-container {
  position: fixed;
  top: var(--space-4);
  right: var(--space-4);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.toast {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--color-bg-elevated);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  border-left: 4px solid;
  min-width: 300px;
  max-width: 500px;
  animation: slide-in-right 0.3s ease;
}

.toast-success {
  border-left-color: var(--color-success);
}

.toast-error {
  border-left-color: var(--color-danger);
}

.toast-warning {
  border-left-color: var(--color-warning);
}

.toast-info {
  border-left-color: var(--color-info);
}

@keyframes slide-in-right {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
```

**Files to Create:**
- `webapp/src/components/Toast.tsx`
- `webapp/src/hooks/useToast.ts`

**Files to Modify:**
- `webapp/src/App.tsx` - Add toast container
- `webapp/src/components/EquipmentConfigPanel.tsx` - Show toast on save/delete
- `webapp/src/components/VegetationConfigPanel.tsx` - Show toast on save/delete

### 3.2 Drawing Gesture Help Overlay

**Problem:** Touch drawing gestures unclear, no visual feedback.

**Solution:**

```tsx
// Help overlay for drawing mode
export const DrawingHelpOverlay: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => {
  return (
    <div className="drawing-help-overlay" role="dialog" aria-labelledby="drawing-help-title">
      <div className="drawing-help-content">
        <h3 id="drawing-help-title">Drawing Controls</h3>

        <div className="help-section">
          <h4>Desktop</h4>
          <ul>
            <li><strong>Click</strong> to place points</li>
            <li><strong>Double-click</strong> or press <kbd>Enter</kbd> to finish</li>
            <li>Press <kbd>Esc</kbd> to cancel</li>
          </ul>
        </div>

        <div className="help-section">
          <h4>Mobile/Touch</h4>
          <ul>
            <li><strong>Tap and hold (1 second)</strong> for intermediate points</li>
            <li><strong>Quick tap</strong> to finish drawing</li>
          </ul>
        </div>

        <button className="btn btn-primary" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>
  );
};
```

**Show automatically on first draw, then store in localStorage:**
```tsx
const [showDrawingHelp, setShowDrawingHelp] = useState(() => {
  return !localStorage.getItem('drawing-help-seen');
});

const handleDismissHelp = () => {
  localStorage.setItem('drawing-help-seen', 'true');
  setShowDrawingHelp(false);
};
```

**Files to Create:**
- `webapp/src/components/DrawingHelpOverlay.tsx`

**Files to Modify:**
- `webapp/src/components/MapboxMapView.tsx` - Show help on first draw

### 3.3 Result Export Functionality

**Problem:** No way to export analysis results.

**Solution:**

```tsx
// Export button in AnalysisPanel
const handleExportPDF = () => {
  // Generate PDF report (using jsPDF or similar)
  const doc = new jsPDF();
  doc.text('Fire Break Analysis Report', 10, 10);
  doc.text(`Distance: ${distance.toFixed(2)}m`, 10, 20);
  // ... add equipment results, terrain/vegetation analysis
  doc.save('fire-break-analysis.pdf');
};

const handleExportCSV = () => {
  // Generate CSV of equipment results
  const csv = equipmentResults.map(r =>
    `${r.name},${r.type},${r.time},${r.cost},${r.compatible}`
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'equipment-analysis.csv';
  a.click();
};
```

**Add export dropdown:**
```tsx
<div className="export-actions">
  <button className="btn btn-secondary" onClick={() => setShowExportMenu(!showExportMenu)}>
    Export Results ▾
  </button>
  {showExportMenu && (
    <div className="export-menu">
      <button onClick={handleExportPDF}>Export as PDF</button>
      <button onClick={handleExportCSV}>Export as CSV</button>
      <button onClick={handlePrint}>Print</button>
    </div>
  )}
</div>
```

**Files to Modify:**
- `webapp/src/components/AnalysisPanel.tsx` - Add export functionality

**New Dependencies:**
- `jspdf` - PDF generation library

### 3.4 Equipment Presets/Favorites

**Problem:** Users can't save common equipment configurations.

**Solution:**

```tsx
// Preset manager
interface EquipmentPreset {
  id: string;
  name: string;
  equipmentIds: string[];
  createdAt: Date;
}

export const PresetManager: React.FC = () => {
  const [presets, setPresets] = useState<EquipmentPreset[]>(() => {
    const saved = localStorage.getItem('equipment-presets');
    return saved ? JSON.parse(saved) : [];
  });

  const savePreset = (name: string, equipmentIds: string[]) => {
    const preset: EquipmentPreset = {
      id: Date.now().toString(),
      name,
      equipmentIds,
      createdAt: new Date()
    };
    const updated = [...presets, preset];
    setPresets(updated);
    localStorage.setItem('equipment-presets', JSON.stringify(updated));
  };

  const loadPreset = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      // Apply preset equipment selection
      onEquipmentSelectionChange(preset.equipmentIds);
    }
  };

  return (
    <div className="preset-manager">
      <h4>Equipment Presets</h4>
      <select onChange={(e) => loadPreset(e.target.value)}>
        <option value="">Load preset...</option>
        {presets.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <button onClick={() => {
        const name = prompt('Enter preset name:');
        if (name) savePreset(name, selectedEquipmentIds);
      }}>
        Save Current Selection
      </button>
    </div>
  );
};
```

**Files to Create:**
- `webapp/src/components/PresetManager.tsx`

**Files to Modify:**
- `webapp/src/components/AnalysisPanel.tsx` - Add preset manager

---

## Phase 4: Polish & Delight

**Priority:** LOW
**Estimated Effort:** 2-3 days
**Focus:** Micro-interactions, animations, enhancements

### 4.1 Micro-Interactions

**Button Hover Effects:**
```css
.btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.btn:active {
  transform: translateY(0);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}
```

**Card Hover:**
```css
.equipment-row {
  transition: all 0.2s ease;
}

.equipment-row:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
  border-color: var(--color-accent-primary);
}
```

**Focus Indicators:**
```css
*:focus-visible {
  outline: 2px solid var(--color-accent-primary);
  outline-offset: 2px;
  border-radius: 4px;
}
```

### 4.2 Smooth Transitions

**Panel Open/Close:**
```css
.integrated-config-panel {
  transform: translateX(100%);
  transition: transform 0.3s ease-in-out;
}

.integrated-config-panel.open {
  transform: translateX(0);
}
```

**Tab Switching:**
```css
.tab-content {
  opacity: 0;
  transition: opacity 0.2s ease;
}

.tab-content.active {
  opacity: 1;
}
```

### 4.3 Keyboard Shortcuts Documentation

**Create shortcuts modal:**
```tsx
export const KeyboardShortcuts: React.FC = () => {
  return (
    <div className="shortcuts-modal">
      <h3>Keyboard Shortcuts</h3>
      <dl className="shortcuts-list">
        <dt><kbd>?</kbd></dt>
        <dd>Show this help</dd>

        <dt><kbd>Enter</kbd></dt>
        <dd>Finish drawing fire break</dd>

        <dt><kbd>Esc</kbd></dt>
        <dd>Cancel drawing / Close panels</dd>

        <dt><kbd>C</kbd></dt>
        <dd>Open configuration panel</dd>

        <dt><kbd>H</kbd></dt>
        <dd>Show help content</dd>

        <dt><kbd>Tab</kbd></dt>
        <dd>Navigate interactive elements</dd>
      </dl>
    </div>
  );
};
```

**Implement shortcuts:**
```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === '?') {
      setShowShortcuts(true);
    } else if (e.key === 'Escape') {
      setIsConfigOpen(false);
    } else if (e.key === 'c' && !e.ctrlKey && !e.metaKey) {
      setIsConfigOpen(true);
    }
    // ... more shortcuts
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []);
```

### 4.4 Dark Mode Toggle

**Problem:** Dark theme hardcoded, no user preference.

**Solution:**

```tsx
export const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    return (saved as 'light' | 'dark') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <button
      className="theme-toggle"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
};
```

**CSS variables for light theme:**
```css
[data-theme='light'] {
  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f5f7fa;
  --color-text-primary: #0f1115;
  --color-text-secondary: #475569;
  /* ... etc */
}
```

**Files to Create:**
- `webapp/src/components/ThemeToggle.tsx`

**Files to Modify:**
- `webapp/src/App.tsx` - Add theme toggle to header
- `webapp/src/styles.css` - Add light theme variables

---

## Implementation Checklist

### Phase 1: Critical (Complete First)
- [ ] Add `ConfirmDialog` component
- [ ] Increase touch target sizes (tags, buttons, icons)
- [ ] Improve color contrast (hover states, placeholders)
- [ ] Add `prefers-reduced-motion` support
- [ ] Add ARIA landmarks and labels
- [ ] Implement focus management

### Phase 2: Visual Consistency
- [ ] Create `design-tokens.css` with color/typography/spacing
- [ ] Replace all hardcoded colors with design tokens
- [ ] Apply typography system across all components
- [ ] Apply spacing system across all components
- [ ] Create standardized `Button` component
- [ ] Add `Skeleton` loading component
- [ ] Replace emoji spinners with skeleton screens

### Phase 3: UX Enhancements
- [ ] Create `Toast` notification system
- [ ] Add toast notifications for saves/deletes/errors
- [ ] Create `DrawingHelpOverlay` component
- [ ] Add export functionality (PDF/CSV)
- [ ] Create `PresetManager` for equipment favorites
- [ ] Implement preset save/load

### Phase 4: Polish
- [ ] Add button hover lift effects
- [ ] Add panel open/close transitions
- [ ] Create `KeyboardShortcuts` modal
- [ ] Implement keyboard shortcuts
- [ ] Create `ThemeToggle` component
- [ ] Add light theme CSS variables

---

## Testing Requirements

### Accessibility Testing
- [ ] Run Lighthouse accessibility audit (target: 95+)
- [ ] Test keyboard navigation in all panels
- [ ] Test screen reader compatibility (NVDA/JAWS)
- [ ] Verify WCAG 2.1 AA compliance
- [ ] Test with `prefers-reduced-motion` enabled

### Visual Testing
- [ ] Test on Chrome, Firefox, Safari, Edge
- [ ] Test on mobile (iOS Safari, Android Chrome)
- [ ] Test on tablet (landscape and portrait)
- [ ] Verify design token consistency
- [ ] Check dark mode and light mode

### Interaction Testing
- [ ] Test touch drawing on mobile devices
- [ ] Test confirmation dialogs (cancel and confirm)
- [ ] Test toast notifications (all types)
- [ ] Test export functionality (PDF/CSV)
- [ ] Test preset save/load
- [ ] Test keyboard shortcuts

### Performance Testing
- [ ] Verify no layout shift during loading
- [ ] Check animation performance (60fps)
- [ ] Test with slow network (loading states)
- [ ] Verify bundle size hasn't grown significantly

---

## Screenshots Plan

### Before Screenshots (Required)
1. **Desktop - Main View** - Full app with map and analysis panel
2. **Desktop - Config Panel** - Equipment configuration open
3. **Mobile - Main View** - Stacked layout
4. **Mobile - Config Panel** - Full-width configuration
5. **Equipment Row - Before** - Current compact layout
6. **Vegetation Hierarchy - Before** - Current hierarchical view

### After Screenshots (Required)
1. **Desktop - Main View** - Improved layout with better spacing
2. **Desktop - Config Panel** - Redesigned configuration with better hierarchy
3. **Mobile - Main View** - Touch-optimized interface
4. **Mobile - Config Panel** - Improved mobile experience
5. **Equipment Row - After** - Larger touch targets, better readability
6. **Vegetation Hierarchy - After** - Clearer hierarchy, better contrast

### New Features Screenshots
7. **Confirmation Dialog** - Delete confirmation modal
8. **Toast Notification** - Success/error notifications
9. **Drawing Help Overlay** - Touch gesture instructions
10. **Keyboard Shortcuts** - Shortcuts modal
11. **Theme Toggle** - Light mode demonstration

---

## Success Metrics

### Quantitative
- **Accessibility Score:** Target 95+ (Lighthouse)
- **Touch Target Compliance:** 100% of interactive elements ≥44x44px
- **Color Contrast:** 100% WCAG AA compliance, 90% AAA compliance
- **Loading Time:** No increase in bundle size
- **Animation Performance:** 60fps on modern devices

### Qualitative
- **Visual Consistency:** Single design system throughout
- **Information Hierarchy:** Clear content priorities
- **Mobile Experience:** Touch-optimized workflows
- **Professional Polish:** Modern, refined appearance
- **User Confidence:** Clear feedback for all actions

---

## Documentation Updates

After implementation, update:

1. **README.md** - Add section on accessibility features
2. **USER_GUIDE.md** - Document keyboard shortcuts, new features
3. **UI_AUDIT.md** - Add "After Implementation" section
4. **ARCHITECTURE.md** - Document design system structure

---

## Conclusion

This phased approach prioritizes critical accessibility and safety fixes first, followed by visual consistency improvements, then modern UX enhancements, and finally polish. Each phase delivers tangible value independently, allowing for iterative deployment and user feedback.

**Estimated Total Effort:** 10-14 days
**Priority Order:** Phase 1 → Phase 2 → Phase 3 → Phase 4
**Risk Level:** Low (incremental changes, no breaking functionality)
