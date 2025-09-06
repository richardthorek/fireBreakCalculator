# UI Design Documentation

## Drawing Tools Enhancement (v2.0)

### Visual Improvements
- **Professional Icons**: Replaced text-based controls with clean SVG icons
- **Consistent Styling**: Icons follow the application's design language
- **Visual Hierarchy**: Clear distinction between active and disabled states

### Icon Set
- **Draw Tool**: Multi-point line icon with fire break orange color (#ff6b35)
- **Edit Tool**: Pencil and document icon for editing existing lines
- **Delete Tool**: Trash can icon in warning red for removal actions

### Touch and Mobile Optimization
- **Large Touch Targets**: 44px minimum size on mobile devices
- **Responsive Scaling**: Icons scale appropriately across screen sizes
- **Touch-Friendly Spacing**: Adequate spacing between interactive elements

## Preview Pane Redesign (v2.0)

### Overview
The preview pane has been redesigned to maximize space usage and improve option visibility through visual icons and better organization. The new design follows the Pace Applied Solutions style guide conventions for consistent branding and accessibility.

### Design Goals
- **Space Efficiency**: Minimal footprint in collapsed state
- **Visual Clarity**: Icons and emojis for immediate equipment type recognition
- **Better Organization**: Categorized equipment display in expanded state
- **Accessibility**: Maintains WCAG 2.1 AA compliance standards
- **Brand Consistency**: Follows PacePublicShare design conventions

## Collapsed State Design

### Layout Structure
```
┌─ Quick Options ─────────────────────────┐
│ 🛠️ Machinery    │ Motor Grader │ 2.5h   │
│ ✈️ Aircraft      │ Air Tractor  │ 17 drops│
│ 👨‍🚒 Hand Crew   │ Standard     │ 16.7h  │
└─────────────────────────────────────────┘
```

### Visual Elements
- **Equipment Icons**: 
  - 🛠️ General machinery (graders)
  - 🚜 Heavy bulldozers
  - ✈️ Fixed-wing aircraft
  - 🚁 Helicopters  
  - 👨‍🚒 Hand crews
- **Compact Layout**: Reduced padding and optimized spacing
- **Essential Information**: Equipment name and time/drops only

### Implementation Features
- Hover effects for better interactivity
- Responsive design for mobile devices
- Clear visual hierarchy with icons

## Expanded State Design

### Categorized Sections
The expanded view organizes equipment into three distinct categories:

#### 1. Machinery Section
```
┌─ 🛠️ Machinery ─────────────────────────┐
│ Equipment     │ Time │ Cost  │ Status  │
├───────────────┼──────┼───────┼─────────┤
│ 🛠️ Motor Grader│ 2.5h │ $1250 │ ✓ Valid │
│ 🚜 D6 Dozer   │ N/A  │ -     │ ✗ Invalid│
└───────────────┴──────┴───────┴─────────┘
```

#### 2. Aircraft Section  
```
┌─ ✈️ Aircraft ──────────────────────────┐
│ Equipment        │ Drops│ Cost   │ Status│
├──────────────────┼──────┼────────┼───────┤
│ ✈️ Air Tractor   │ 17   │ $29750 │ ✓ Valid│
│ 🚁 Bell 212      │ 34   │ $56667 │ ✓ Valid│
└──────────────────┴──────┴────────┴───────┘
```

#### 3. Hand Crews Section
```
┌─ 👨‍🚒 Hand Crews ──────────────────────┐
│ Equipment       │ Time │ Cost  │ Status │
├─────────────────┼──────┼───────┼────────┤
│ 👨‍🚒 Standard    │ 16.7h│ $7000 │ ✓ Valid │
│ 👨‍🚒 Rapid Resp. │ 20.8h│ $6667 │ ✓ Valid │
└─────────────────┴──────┴───────┴────────┘
```

### Enhanced Features
- **Visual Grouping**: Each category has its own section with header icons
- **Equipment Type Icons**: Specific icons for different equipment subtypes
- **Sorting**: Equipment sorted by quickest estimated time within each category
- **Compatibility Filtering**: Incompatible equipment clearly marked and de-emphasized
- **Cost Display**: Optional cost information when available

## Icon System

### Equipment Category Icons
- **🛠️**: General machinery and tools
- **✈️**: Fixed-wing aircraft
- **🚁**: Helicopters
- **👨‍🚒**: Hand crews and personnel

### Equipment Type Icons
- **🛠️**: Motor graders and general machinery
- **🚜**: Bulldozers (D4, D6, D7, D8)
- **✈️**: Fixed-wing aircraft (Air Tractor, etc.)
- **🚁**: Helicopters (Light, Medium, Heavy)
- **👨‍🚒**: All hand crew types

### Status Icons
- **✓**: Compatible/Available equipment
- **✗**: Incompatible equipment for current conditions

## Responsive Design

### Mobile Optimizations
- Reduced icon sizes and padding
- Simplified grid layouts
- Status information moved to separate row on narrow screens
- Touch-friendly interaction areas

### Desktop Enhancements
- Full grid layout with all columns visible
- Hover effects for better interactivity
- Optimal icon and text sizing

## Accessibility Features

### Consent Banner and Layer Controls Accessibility (v2.1)

**Microsoft Clarity Consent Banner**
- **High Contrast Design**: Dark background (rgba(30,36,51,0.98)) with white text (#f5f7fa) ensuring 4.5:1+ contrast ratio
- **Interactive Feedback**: Hover states with color transitions for Accept (emerald green) and Reject (gray) buttons
- **Focus Management**: Clear focus indicators with 2px blue outline following WCAG guidelines
- **Modern Styling**: Backdrop blur effects and consistent dark theme integration
- **Keyboard Accessibility**: Full keyboard navigation support with proper tab order

**Map Layer Controls**
- **Consistent Theme**: Dark background matching the application's design language
- **Readable Labels**: White text with sufficient contrast on dark control panels
- **Interactive States**: Hover effects for labels and focus indicators for form inputs
- **Touch Targets**: Properly sized controls for both desktop and mobile interaction
- **Visual Hierarchy**: Clear grouping of basemap options and layer toggles

### WCAG 2.1 AA Compliance
- **Color Contrast**: All text maintains minimum 4.5:1 contrast ratio
- **Keyboard Navigation**: Full keyboard support for all interactive elements including drawing tools
- **Screen Reader Support**: Proper ARIA labels and semantic markup throughout
- **Focus Management**: Clear focus indicators with 2px outline and proper focus order
- **Skip Navigation**: Skip link for quick access to main content
- **Form Labels**: All form controls have associated labels or aria-label attributes

### Drawing Tools Accessibility
- **Keyboard Navigation**: All drawing tools are keyboard accessible with Tab navigation
- **ARIA Labels**: Descriptive labels for screen readers ("Draw fire break line", "Edit fire break lines", etc.)
- **Focus Indicators**: Clear visual focus states with proper contrast
- **Touch Targets**: Minimum 44px touch targets on mobile devices (WCAG AAA compliance)
- **Role Attributes**: Proper button roles and states for interactive elements

### Icon Accessibility
- **Visual Icons**: SVG icons replace text labels for professional appearance
- **Screen Reader Text**: Icons include proper alt text and ARIA descriptions
- **Color Independence**: Icons don't rely solely on color to convey meaning
- **Progressive Enhancement**: Text fallbacks available for accessibility tools

### Loading States and Progress Indicators
- **Analysis Spinner**: Animated spinner with descriptive text during terrain analysis
- **Visual Feedback**: Clear indication when long-running operations are in progress
- **Non-blocking UI**: Loading states don't prevent other interactions
- **Accessible Loading**: Screen reader announcements for loading state changes

### Interactive Elements Accessibility
- **Analysis Panel**: Collapsible header with proper aria-expanded and aria-controls
- **Loading States**: Visual and textual indicators for long-running operations
- **Form Controls**: Proper labeling and keyboard navigation for all inputs
- **Button States**: Clear disabled/enabled states with appropriate ARIA attributes

## Technical Implementation

### CSS Architecture
- Modular CSS with component-specific styles
- CSS Grid for responsive layouts
- Flexbox for icon and text alignment
- CSS Custom Properties for consistent theming

### Component Structure
```tsx
AnalysisPanel
├── Quick Options (collapsed state)
│   ├── Category Icons + Labels
│   └── Best Option Display
└── Equipment Categories (expanded state)
    ├── Machinery Section
    ├── Aircraft Section
    └── Hand Crews Section
```

### Performance Considerations
- Efficient React rendering with useMemo for calculations
- Optimized CSS for smooth hover animations
- Minimal DOM updates during state changes

## Design Rationale

### Space Efficiency
The new collapsed state reduces vertical space usage by ~30% while maintaining readability through strategic use of icons and compact layouts.

### Visual Hierarchy
Clear categorization helps users quickly identify and compare options within each equipment type, improving decision-making efficiency.

### Brand Consistency
The design follows Pace Applied Solutions style guide:
- Uses established color palette
- Maintains consistent typography scale
- Follows component design patterns
- Respects spacing and layout conventions

### User Experience
- **Faster Recognition**: Icons enable quicker equipment identification
- **Better Organization**: Categorized view reduces cognitive load
- **Improved Scanning**: Visual grouping supports efficient information scanning
- **Consistent Interaction**: Familiar expand/collapse patterns

## Future Enhancements

### Potential Improvements
1. **Equipment Filtering**: Toggle to hide/show incompatible equipment
2. **Custom Icons**: Equipment-specific icons for better recognition
3. **Sort Options**: User-selectable sorting (time, cost, name)
4. **Comparison Mode**: Side-by-side equipment comparison
5. **Favoriting**: Mark preferred equipment for quick access

### Implementation Notes
- All changes maintain backward compatibility
- Design system supports easy icon updates
- Responsive patterns scale to new features
- Accessibility patterns are established for future components