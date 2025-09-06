/**
 * Shared configuration panel components that can be used across different config sections.
 * These components provide consistent UI patterns for the configuration interface.
 */

import React, { ReactNode } from 'react';

interface TabProps {
  id: string;
  label: string;
  icon?: string;
  count?: number;
  isActive: boolean;
  onClick: () => void;
}

export const ConfigTab: React.FC<TabProps> = ({ 
  id, 
  label, 
  icon, 
  count, 
  isActive, 
  onClick 
}) => {
  return (
    <button 
      id={id}
      className={`config-tab ${isActive ? 'active' : ''}`} 
      onClick={onClick}
      aria-selected={isActive ? true : false}
      role="tab"
      aria-controls={`${id}-panel`}
    >
      {icon && <span className="tab-icon">{icon}</span>}
      <span className="tab-label">{label}</span>
      {count !== undefined && <span className="tab-count">{count}</span>}
    </button>
  );
};

interface TabGroupProps {
  ariaLabel: string;
  children: ReactNode;
}

export const ConfigTabGroup: React.FC<TabGroupProps> = ({ ariaLabel, children }) => {
  // This div has role="tablist" and should contain elements with role="tab"
  return (
    <div 
      className="config-tab-group" 
      role="tablist"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
};

interface TabPanelProps {
  id: string;
  isActive: boolean;
  children: ReactNode;
}

export const ConfigTabPanel: React.FC<TabPanelProps> = ({ id, isActive, children }) => {
  if (!isActive) return null;
  
  return (
    <div 
      id={`${id}-panel`}
      className="config-tab-panel"
      role="tabpanel"
      aria-labelledby={id}
    >
      {children}
    </div>
  );
};

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export const ConfigSection: React.FC<SectionProps> = ({ 
  title, 
  description, 
  children 
}) => {
  return (
    <section className="config-section">
      <div className="section-header">
        <h3 className="section-title">{title}</h3>
        {description && <p className="section-description">{description}</p>}
      </div>
      <div className="section-content">
        {children}
      </div>
    </section>
  );
};

interface ActionBarProps {
  children: ReactNode;
}

export const ConfigActionBar: React.FC<ActionBarProps> = ({ children }) => {
  return (
    <div className="config-action-bar">
      {children}
    </div>
  );
};
