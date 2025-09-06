/**
 * Vegetation Mapping Configuration Panel component for managing vegetation formation to type mappings.
 * Allows administrators to configure which vegetation formations map to which vegetation types,
 * controlling how NSW vegetation data is interpreted in fire break calculations.
 * 
 * Features:
 * - Hierarchical view of vegetation (formation > class > type)
 * - Bulk modification capabilities
 * - Filter and search functionality
 * - Modern UI with expandable sections
 */

import React, { useState, useMemo, useEffect } from 'react';
import { VegetationFormationMappingApi, CreateVegetationMappingInput } from '../types/vegetationMappingApi';
import { VegetationType, VEGETATION_TYPES } from '../config/classification';
import { getVegetationTypeDisplayName, getVegetationTypeExample } from '../utils/formatters';

interface VegetationConfigPanelProps {
  mappings: VegetationFormationMappingApi[];
  loading: boolean;
  error: string | null;
  onCreate: (mapping: CreateVegetationMappingInput) => Promise<void>;
  onUpdate: (mapping: VegetationFormationMappingApi) => Promise<void>;
  onDelete: (mapping: VegetationFormationMappingApi) => Promise<void>;
  isOpen?: boolean;
  onToggle?: () => void;
}

// Vegetation type labels with descriptions
const vegetationTypeLabels: Record<VegetationType, { label: string, description: string }> = {
  grassland: { 
    label: 'Grassland', 
    description: 'Very light vegetation, easy to clear (factor 1.0)' 
  },
  lightshrub: { 
    label: 'Light Shrub', 
    description: 'Sparse vegetation, <10cm diameter (factor 1.1)' 
  },
  mediumscrub: { 
    label: 'Medium Scrub', 
    description: 'Medium density vegetation, 10-50cm diameter (factor 1.5)' 
  },
  heavyforest: { 
    label: 'Heavy Forest', 
    description: 'Dense vegetation, 50cm+ diameter (factor 2.0)' 
  }
};

const VegetationMappingForm: React.FC<{
  initialValues?: Partial<VegetationFormationMappingApi>;
  onSubmit: (values: CreateVegetationMappingInput) => Promise<void>;
  onCancel?: () => void;
  isEdit?: boolean;
}> = ({ initialValues = {}, onSubmit, onCancel, isEdit = false }) => {
  const [values, setValues] = useState<Partial<CreateVegetationMappingInput>>({
    formationName: '',
    className: '',
    typeName: '',
    vegetationType: 'mediumscrub',
    description: '',
    isOverride: false,
    ...initialValues
  });

  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    
    // Handle number inputs
    if (type === 'number') {
      setValues(prev => ({ ...prev, [name]: parseFloat(value) }));
    } else {
      setValues(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.formationName || !values.vegetationType) return;
    
    try {
      setSubmitting(true);
      await onSubmit(values as CreateVegetationMappingInput);
      if (!isEdit) {
        // Reset form for new entry if not editing
        setValues({
          formationName: '',
          className: '',
          typeName: '',
          vegetationType: 'mediumscrub',
          description: '',
          isOverride: false
        });
      }
    } catch (error) {
      console.error('Form submission error:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="vegetation-mapping-form">
      <div className="form-group">
        <label htmlFor="formationName">Formation Name*</label>
        <input
          id="formationName"
          name="formationName"
          type="text"
          value={values.formationName || ''}
          onChange={handleChange}
          placeholder="e.g. Rainforests"
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="className">Class Name</label>
        <input
          id="className"
          name="className"
          type="text"
          value={values.className || ''}
          onChange={handleChange}
          placeholder="e.g. Subtropical Rainforest"
        />
      </div>

      <div className="form-group">
        <label htmlFor="typeName">Type Name</label>
        <input
          id="typeName"
          name="typeName"
          type="text"
          value={values.typeName || ''}
          onChange={handleChange}
          placeholder="e.g. Specific vegetation type"
        />
      </div>

      <div className="form-group">
        <label htmlFor="vegetationType">Vegetation Type*</label>
        <select
          id="vegetationType"
          name="vegetationType"
          value={values.vegetationType || 'mediumscrub'}
          onChange={handleChange}
          required
        >
          {VEGETATION_TYPES.map(vt => (
            <option key={vt} value={vt}>
              {getVegetationTypeDisplayName(vt)} - {vegetationTypeLabels[vt].description}
            </option>
          ))}
        </select>
      </div>
      
      <div className="form-group checkbox-group">
        <label>
          <input
            type="checkbox"
            name="isOverride"
            checked={values.isOverride || false}
            onChange={(e) => setValues(prev => ({ ...prev, isOverride: e.target.checked }))}
          />
          Override parent settings
        </label>
      </div>

      <div className="form-group">
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          name="description"
          value={values.description || ''}
          onChange={handleChange}
          placeholder="Optional notes about this vegetation formation"
        />
      </div>

      <div className="form-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving...' : isEdit ? 'Update Mapping' : 'Add Mapping'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
};

const VegetationMappingRow: React.FC<{
  mapping: VegetationFormationMappingApi;
  onEdit: (mapping: VegetationFormationMappingApi) => void;
  onDelete: (mapping: VegetationFormationMappingApi) => void;
  isSelected?: boolean;
  onSelect?: () => void;
}> = ({ mapping, onEdit, onDelete, isSelected = false, onSelect }) => {
  let fullName = mapping.formationName;
  
  if (mapping.className) {
    fullName += ` > ${mapping.className}`;
  }
  
  if (mapping.typeName) {
    fullName += ` > ${mapping.typeName}`;
  }

  const confirmDelete = () => {
    if (window.confirm(`Are you sure you want to delete the mapping for "${fullName}"?`)) {
      onDelete(mapping);
    }
  };

  return (
    <div className="vegetation-mapping-item">
      <div className="mapping-header">
        <div className="mapping-name">
          <strong>{fullName}</strong>
        </div>
        <div className="mapping-actions">
          <button onClick={() => onEdit(mapping)} className="action-btn edit-btn">Edit</button>
          <button onClick={confirmDelete} className="action-btn delete-btn">Delete</button>
        </div>
      </div>
      <div className="mapping-details">
        <span className={`vegetation-type-tag ${mapping.vegetationType}`}>
          {getVegetationTypeDisplayName(mapping.vegetationType)}
        </span>
        {mapping.isOverride && <span className="override-badge">Override</span>}
        {mapping.description && <div className="description">{mapping.description}</div>}
      </div>
    </div>
  );
};

// Type definitions for hierarchical view
type FormationGroup = {
  formation: string;
  vegetationType: VegetationType;
  classes: Map<string, ClassGroup>;
  mappingId?: string;
  mapping?: VegetationFormationMappingApi;
  count: number;
};

type ClassGroup = {
  formation: string;
  className: string;
  vegetationType: VegetationType;
  types: Map<string, VegetationFormationMappingApi>;
  mappingId?: string;
  mapping?: VegetationFormationMappingApi;
  count: number;
};

// Component for bulk editing vegetation types
const BulkVegetationTypeEditor: React.FC<{
  selectedType: VegetationType;
  onTypeChange: (type: VegetationType) => void;
  onApply: () => Promise<void>;
  isApplying: boolean;
}> = ({ selectedType, onTypeChange, onApply, isApplying }) => {
  return (
    <div className="bulk-vegetation-editor">
      <div className="editor-controls">
        <label htmlFor="bulkVegetationType">Set vegetation type:</label>
        <select
          id="bulkVegetationType"
          value={selectedType}
          onChange={(e) => onTypeChange(e.target.value as VegetationType)}
          className="bulk-type-select"
        >
          {VEGETATION_TYPES.map(vt => (
            <option key={vt} value={vt}>
              {getVegetationTypeDisplayName(vt)}
            </option>
          ))}
        </select>
        <button 
          onClick={onApply}
          disabled={isApplying}
          className="apply-button"
        >
          {isApplying ? 'Applying...' : 'Apply to Selected'}
        </button>
      </div>
      <div className="editor-help">
        <small>Select items from the list below and apply changes to multiple mappings at once</small>
      </div>
    </div>
  );
};

const VegetationConfigPanel: React.FC<VegetationConfigPanelProps> = ({
  mappings,
  loading,
  error,
  onCreate,
  onUpdate,
  onDelete,
  isOpen = false,
  onToggle
}) => {
  const [editMapping, setEditMapping] = useState<VegetationFormationMappingApi | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFormations, setExpandedFormations] = useState<Set<string>>(new Set());
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkVegetationType, setBulkVegetationType] = useState<VegetationType>('mediumscrub');
  const [isApplyingBulk, setIsApplyingBulk] = useState(false);
  const [viewMode, setViewMode] = useState<'hierarchical' | 'flat'>('hierarchical');
  
  // Component initialization

  // Organize mappings into a hierarchical structure
  const { formationGroups, filteredMappings } = useMemo(() => {
    // First create the hierarchical structure
    const formGroups = new Map<string, FormationGroup>();
    
    // Process all mappings to build the hierarchy
    mappings.forEach(mapping => {
      const { formationName, className, typeName } = mapping;
      
      // Handle formation level
      if (!formGroups.has(formationName)) {
        formGroups.set(formationName, {
          formation: formationName,
          vegetationType: mapping.vegetationType,
          classes: new Map(),
          count: 0,
        });
      }
      
      const formationGroup = formGroups.get(formationName)!;
      
      // If this is a formation-level mapping, store the ID
      if (!className && !typeName) {
        formationGroup.mappingId = mapping.id;
        formationGroup.mapping = mapping;
      }
      
      // Handle class level
      if (className) {
        if (!formationGroup.classes.has(className)) {
          formationGroup.classes.set(className, {
            formation: formationName,
            className,
            vegetationType: mapping.vegetationType,
            types: new Map(),
            count: 0,
          });
        }
        
        const classGroup = formationGroup.classes.get(className)!;
        formationGroup.count++;
        
        // If this is a class-level mapping, store the ID
        if (!typeName) {
          classGroup.mappingId = mapping.id;
          classGroup.mapping = mapping;
        }
        
        // Handle type level
        if (typeName) {
          classGroup.types.set(typeName, mapping);
          classGroup.count++;
        }
      }
    });
    
    // Filter mappings based on search term
    const filtered = searchTerm ? 
      mappings.filter(m => 
        m.formationName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.className && m.className.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (m.typeName && m.typeName.toLowerCase().includes(searchTerm.toLowerCase()))
      ) :
      mappings;
    
    return {
      formationGroups: formGroups,
      filteredMappings: filtered
    };
  }, [mappings, searchTerm]);

  const handleEdit = (mapping: VegetationFormationMappingApi) => {
    setEditMapping(mapping);
    setShowForm(true);
  };

  const handleCancelEdit = () => {
    setEditMapping(null);
    setShowForm(false);
  };

  const handleCreateNew = () => {
    setEditMapping(null);
    setShowForm(true);
  };

  const handleSubmit = async (values: CreateVegetationMappingInput) => {
    if (editMapping) {
      // Update existing mapping
      await onUpdate({
        ...editMapping,
        ...values
      });
      setEditMapping(null);
    } else {
      // Create new mapping
      await onCreate(values);
    }
    setShowForm(false);
  };

  // Toggle formation expansion
  const toggleFormation = (formation: string) => {
    setExpandedFormations(prev => {
      const newSet = new Set(prev);
      if (newSet.has(formation)) {
        newSet.delete(formation);
      } else {
        newSet.add(formation);
      }
      return newSet;
    });
  };

  // Toggle class expansion
  const toggleClass = (formationClass: string) => {
    setExpandedClasses(prev => {
      const newSet = new Set(prev);
      if (newSet.has(formationClass)) {
        newSet.delete(formationClass);
      } else {
        newSet.add(formationClass);
      }
      return newSet;
    });
  };

  // Handle selection for bulk operations
  const toggleItemSelection = (id: string) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Bulk update vegetation types
  const applyBulkVegetationType = async () => {
    if (selectedItems.size === 0) return;
    
    try {
      setIsApplyingBulk(true);
      
      // Get all selected mappings
      const selectedMappings = mappings.filter(m => selectedItems.has(m.id));
      
      // Update each one
      for (const mapping of selectedMappings) {
        await onUpdate({
          ...mapping,
          vegetationType: bulkVegetationType
        });
      }
      
      // Clear selection after successful update
      setSelectedItems(new Set());
    } catch (error) {
      console.error('Failed to apply bulk updates:', error);
    } finally {
      setIsApplyingBulk(false);
    }
  };

  // When embedded in IntegratedConfigPanel, we don't need this conditional rendering
  // as the parent component handles visibility
  if (onToggle && !isOpen) {
    return null;
  }

  return (
    <div className="vegetation-config-panel">
      <div className="panel-description">
        <h3>Vegetation Formation Mappings</h3>
        <p>
          Configure how vegetation formations from NSW data are mapped to the application's 
          vegetation categories. These mappings affect equipment compatibility and clearing rates.
        </p>
      </div>
      
      <div className="search-toolbar">
        <input
          type="text"
          placeholder="Search vegetation mappings..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-box"
        />
        
        <div className="view-controls">
          <button 
            className={`view-control-btn ${viewMode === 'hierarchical' ? 'active' : ''}`}
            onClick={() => setViewMode('hierarchical')}
          >
            Hierarchical
          </button>
          <button 
            className={`view-control-btn ${viewMode === 'flat' ? 'active' : ''}`}
            onClick={() => setViewMode('flat')}
          >
            Flat List
          </button>
        </div>
        
        <button onClick={handleCreateNew} className="add-mapping-btn">
          + Add New Mapping
        </button>
      </div>
      
      <div className="mapping-stats">
        {loading ? 'Loading mappings...' : `Found ${filteredMappings.length} vegetation mappings`}
        {selectedItems.size > 0 && ` (${selectedItems.size} selected)`}
      </div>

      {error && <div className="error-message">{error}</div>}

      {selectedItems.size > 0 && (
        <BulkVegetationTypeEditor
          selectedType={bulkVegetationType}
          onTypeChange={setBulkVegetationType}
          onApply={applyBulkVegetationType}
          isApplying={isApplyingBulk}
        />
      )}

      {!showForm ? (
        <div className={`mappings-container ${viewMode === 'hierarchical' ? 'hierarchical-view' : 'flat-view'}`}>
          {loading ? (
            <div className="loading">Loading vegetation mappings...</div>
          ) : viewMode === 'hierarchical' ? (
            // Hierarchical view
            <div className="hierarchical-mappings">
              {Array.from(formationGroups.keys()).sort().map(formationName => {
                const formationGroup = formationGroups.get(formationName)!;
                const isFormationExpanded = expandedFormations.has(formationName);
                const formationId = formationGroup.mappingId;
                
                return (
                  <div key={formationName} className="formation-group">
                    <div 
                      className={`formation-header ${formationId && selectedItems.has(formationId) ? 'selected' : ''}`}
                      onClick={() => toggleFormation(formationName)}
                    >
                      <div className="formation-expand-icon">
                        {formationGroup.classes.size > 0 ? (isFormationExpanded ? '▼' : '▶') : '•'}
                      </div>
                      
                      {formationId && (
                        <input 
                          type="checkbox"
                          checked={selectedItems.has(formationId)}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleItemSelection(formationId);
                          }}
                          className="selection-checkbox"
                          title={`Select ${formationName} formation for bulk operations`}
                          aria-label={`Select ${formationName} formation for bulk operations`}
                        />
                      )}
                      
                      <div className="formation-title">
                        <span className="formation-name">{formationName}</span>
                        <span className={`vegetation-type-badge ${formationGroup.vegetationType}`}>
                          {vegetationTypeLabels[formationGroup.vegetationType].label}
                        </span>
                      </div>
                      
                      <div className="formation-actions">
                        {formationId && (
                          <>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(formationGroup.mapping!);
                              }}
                              className="edit-button"
                            >
                              Edit
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(`Delete formation mapping for "${formationName}"?`)) {
                                  onDelete(formationGroup.mapping!);
                                }
                              }}
                              className="delete-button"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    
                    {isFormationExpanded && formationGroup.classes.size > 0 && (
                      <div className="formation-classes">
                        {Array.from(formationGroup.classes.keys()).sort().map(className => {
                          const classGroup = formationGroup.classes.get(className)!;
                          const isClassExpanded = expandedClasses.has(`${formationName}|${className}`);
                          const classId = classGroup.mappingId;
                          
                          return (
                            <div key={`${formationName}|${className}`} className="class-group">
                              <div 
                                className={`class-header ${classId && selectedItems.has(classId) ? 'selected' : ''}`}
                                onClick={() => toggleClass(`${formationName}|${className}`)}
                              >
                                <div className="class-expand-icon">
                                  {classGroup.types.size > 0 ? (isClassExpanded ? '▼' : '▶') : '•'}
                                </div>
                                
                                {classId && (
                                  <input 
                                    type="checkbox"
                                    checked={selectedItems.has(classId)}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      toggleItemSelection(classId);
                                    }}
                                    className="selection-checkbox"
                                    title={`Select ${className} class for bulk operations`}
                                    aria-label={`Select ${className} class for bulk operations`}
                                  />
                                )}
                                
                                <div className="class-title">
                                  <span className="class-name">{className}</span>
                                  <span className={`vegetation-type-badge ${classGroup.vegetationType}`}>
                                    {vegetationTypeLabels[classGroup.vegetationType].label}
                                  </span>
                                </div>
                                
                                <div className="class-actions">
                                  {classId && (
                                    <>
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleEdit(classGroup.mapping!);
                                        }}
                                        className="edit-button"
                                      >
                                        Edit
                                      </button>
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (window.confirm(`Delete class mapping for "${className}"?`)) {
                                            onDelete(classGroup.mapping!);
                                          }
                                        }}
                                        className="delete-button"
                                      >
                                        Delete
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                              
                              {isClassExpanded && classGroup.types.size > 0 && (
                                <div className="class-types">
                                  {Array.from(classGroup.types.keys()).sort().map(typeName => {
                                    const typeMapping = classGroup.types.get(typeName)!;
                                    
                                    return (
                                      <div 
                                        key={`${formationName}|${className}|${typeName}`} 
                                        className={`type-item ${selectedItems.has(typeMapping.id) ? 'selected' : ''}`}
                                      >
                                        <div className="type-checkbox">
                                          <input 
                                            type="checkbox"
                                            checked={selectedItems.has(typeMapping.id)}
                                            onChange={() => toggleItemSelection(typeMapping.id)}
                                            className="selection-checkbox"
                                            title={`Select ${typeName} for bulk operations`}
                                            aria-label={`Select ${typeName} for bulk operations`}
                                          />
                                        </div>
                                        
                                        <div className="type-title">
                                          <span className="type-name">{typeName}</span>
                                          <span className={`vegetation-type-badge ${typeMapping.vegetationType}`}>
                                            {vegetationTypeLabels[typeMapping.vegetationType].label}
                                          </span>
                                        </div>
                                        
                                        <div className="type-actions">
                                          <button 
                                            onClick={() => handleEdit(typeMapping)}
                                            className="edit-button"
                                          >
                                            Edit
                                          </button>
                                          <button 
                                            onClick={() => {
                                              if (window.confirm(`Delete type mapping for "${typeName}"?`)) {
                                                onDelete(typeMapping);
                                              }
                                            }}
                                            className="delete-button"
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              
              {Array.from(formationGroups.keys()).length === 0 && !loading && (
                <div className="no-mappings">No vegetation mappings found</div>
              )}
            </div>
          ) : (
            // Flat list view
            <div className="flat-mappings">
              {filteredMappings.length === 0 ? (
                <div className="no-mappings">No vegetation mappings found</div>
              ) : (
                filteredMappings.map(mapping => (
                  <VegetationMappingRow
                    key={mapping.id}
                    mapping={mapping}
                    onEdit={handleEdit}
                    onDelete={onDelete}
                    isSelected={selectedItems.has(mapping.id)}
                    onSelect={() => toggleItemSelection(mapping.id)}
                  />
                ))
              )}
            </div>
          )}
        </div>
      ) : (
        <VegetationMappingForm
          initialValues={editMapping || {}}
          onSubmit={handleSubmit}
          onCancel={handleCancelEdit}
          isEdit={!!editMapping}
        />
      )}
    </div>
  );
}

export default VegetationConfigPanel;
