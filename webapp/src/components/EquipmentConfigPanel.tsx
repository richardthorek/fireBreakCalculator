/**
 * Equipment Configuration Panel component for managing fire break calculator resources.
 * Allows administrators to configure machinery, aircraft, and hand crew specifications
 * including clearing rates, costs, and terrain/vegetation constraints.
 */

import React, { useState } from 'react';
import { EquipmentApi, EquipmentCoreType, CreateEquipmentInput, MachineryApi, AircraftApi, HandCrewApi } from '../types/equipmentApi';

interface EquipmentConfigPanelProps {
  equipment: EquipmentApi[];
  loading: boolean;
  error: string | null;
  onCreate: (partial: Partial<EquipmentApi> & { type: EquipmentApi['type']; name: string; }) => Promise<void>;
  onUpdate: (item: EquipmentApi) => Promise<void>;
  onDelete: (item: EquipmentApi) => Promise<void>;
  isOpen?: boolean;
  onToggle?: () => void;
}

type EquipmentTab = EquipmentCoreType;

// Top-level Inline editor component (hoisted to avoid remount on parent render)
const InlineEditComponent: React.FC<{
  item: EquipmentApi;
  onSave: (item: EquipmentApi) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  terrainOptions: EquipmentApi['allowedTerrain'];
  vegetationOptions: EquipmentApi['allowedVegetation'];
  terrainLabel: (t: string) => string;
  vegLabel: (v: string) => string;
  terrainExample: (t: string) => string;
  vegExample: (v: string) => string;
}> = ({ item, onSave, onCancel, saving, terrainOptions, vegetationOptions, terrainLabel, vegLabel, terrainExample, vegExample }) => {
  const [form, setForm] = useState<EquipmentApi>(item);

  // Type-safe form update helpers
  const updateMachinery = (updates: Partial<MachineryApi>) => {
    if (form.type === 'Machinery') {
      setForm({ ...form, ...updates } as MachineryApi);
    }
  };

  const updateAircraft = (updates: Partial<AircraftApi>) => {
    if (form.type === 'Aircraft') {
      setForm({ ...form, ...updates } as AircraftApi);
    }
  };

  const updateHandCrew = (updates: Partial<HandCrewApi>) => {
    if (form.type === 'HandCrew') {
      setForm({ ...form, ...updates } as HandCrewApi);
    }
  };
  return (
    <div className="equip-row editing">
      <label className="visually-hidden" htmlFor={`name-${item.id}`}>Name</label>
      <input id={`name-${item.id}`} aria-label="Name" className="eq-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
      {item.type === 'Machinery' && (
        <>
          <label className="visually-hidden" htmlFor={`rate-${item.id}`}>Clearing rate</label>
          <input 
            id={`rate-${item.id}`} 
            aria-label="Clearing rate" 
            type="number" 
            className="eq-small" 
            placeholder="Rate" 
            value={(form as MachineryApi).clearingRate ?? ''} 
            onChange={e => updateMachinery({ clearingRate: Number(e.target.value) })} 
          />
        </>
      )}
      {item.type === 'Aircraft' && (
        <>
          <label className="visually-hidden" htmlFor={`drop-${item.id}`}>Drop length</label>
          <input 
            id={`drop-${item.id}`} 
            aria-label="Drop length" 
            type="number" 
            className="eq-small" 
            placeholder="Drop m" 
            value={(form as AircraftApi).dropLength ?? ''} 
            onChange={e => updateAircraft({ dropLength: Number(e.target.value) })} 
          />
          <label className="visually-hidden" htmlFor={`turn-${item.id}`}>Turnaround (minutes)</label>
          <input 
            id={`turn-${item.id}`} 
            aria-label="Turnaround minutes" 
            type="number" 
            className="eq-small" 
            placeholder="Turn (m)" 
            value={(form as AircraftApi).turnaroundMinutes ?? ''} 
            onChange={e => updateAircraft({ turnaroundMinutes: Number(e.target.value) })} 
          />
          {(form as AircraftApi).turnaroundMinutes && (form as AircraftApi).dropLength ? (
            <div className="cycle-hint" aria-hidden>
              <small>Est cycle: {(form as AircraftApi).turnaroundMinutes} min turnaround between drops.</small>
            </div>
          ) : null}
        </>
      )}
      {item.type === 'HandCrew' && (
        <>
          <label className="visually-hidden" htmlFor={`crew-${item.id}`}>Crew size</label>
          <input 
            id={`crew-${item.id}`} 
            aria-label="Crew size" 
            type="number" 
            className="eq-xsmall" 
            title="Crew Size" 
            placeholder="Crew" 
            value={(form as HandCrewApi).crewSize ?? ''} 
            onChange={e => updateHandCrew({ crewSize: Number(e.target.value) })} 
          />
          <label className="visually-hidden" htmlFor={`rateperson-${item.id}`}>Clearing rate per person</label>
          <input 
            id={`rateperson-${item.id}`} 
            aria-label="Clearing rate per person" 
            type="number" 
            className="eq-xsmall" 
            title="Rate / person" 
            placeholder="/person" 
            value={(form as HandCrewApi).clearingRatePerPerson ?? ''} 
            onChange={e => updateHandCrew({ clearingRatePerPerson: Number(e.target.value) })} 
          />
        </>
      )}
      <label className="visually-hidden" htmlFor={`cost-${item.id}`}>Cost per hour</label>
      <input id={`cost-${item.id}`} aria-label="Cost per hour" type="number" className="eq-small" placeholder="$/h" value={form.costPerHour ?? ''} onChange={e => setForm({ ...form, costPerHour: Number(e.target.value) })} />
      <div className="eq-tags">
        {terrainOptions.map((t: string) => (
          <button
            aria-label={`Terrain ${t}`}
            key={t}
            type="button"
            className={(form.allowedTerrain ?? []).includes(t as any) ? 'tag on' : 'tag'}
            title={terrainExample(t)}
            onClick={() => setForm({ ...form, allowedTerrain: (form.allowedTerrain ?? []).includes(t as any) ? (form.allowedTerrain ?? []).filter((x: string) => x !== t) : [...(form.allowedTerrain ?? []), t] } as EquipmentApi)}
          >{terrainLabel(t)}</button>
        ))}
      </div>
      <div className="eq-tags">
        {vegetationOptions.map((v: string) => (
          <button
            aria-label={`Vegetation ${v}`}
            key={v}
            type="button"
            className={(form.allowedVegetation ?? []).includes(v as any) ? 'tag on' : 'tag'}
            title={vegExample(v)}
            onClick={() => setForm({ ...form, allowedVegetation: (form.allowedVegetation ?? []).includes(v as any) ? (form.allowedVegetation ?? []).filter((x: string) => x !== v) : [...(form.allowedVegetation ?? []), v] } as EquipmentApi)}
          >{vegLabel(v)}</button>
        ))}
      </div>
  {/* per-row helpers removed; guidance now shown once in the tab guide above */}
      <div className="eq-actions">
        <button className="btn save" disabled={saving} onClick={() => onSave(form)}>{saving ? '...' : 'Save'}</button>
        <button className="btn cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};

// Top-level Equipment list component (hoisted)
const EquipmentListComponent: React.FC<{
  equipment: EquipmentApi[];
  activeTab: EquipmentTab;
  adding: boolean;
  draft: Record<string, any>;
  setDraft: (d: Record<string, any>) => void;
  saveNew: () => Promise<void>;
  setAdding: (b: boolean) => void;
  resetDraft: (t?: EquipmentCoreType) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  saveEdit: (item: EquipmentApi) => Promise<void>;
  remove: (item: EquipmentApi) => Promise<void>;
  saving: boolean;
  terrainOptions: EquipmentApi['allowedTerrain'];
  vegetationOptions: EquipmentApi['allowedVegetation'];
  terrainLabel: (t: string) => string;
  vegLabel: (v: string) => string;
  terrainExample: (t: string) => string;
  vegExample: (v: string) => string;
}> = ({ equipment, activeTab, adding, draft, setDraft, saveNew, setAdding, resetDraft, editingId, setEditingId, saveEdit, remove, saving, terrainOptions, vegetationOptions, terrainLabel, vegLabel, terrainExample, vegExample }) => {
  const filtered = equipment.filter(e => e.type === activeTab);
  return (
    <div className="equip-list">
      {adding && (
        <div className="equip-row adding">
          <label className="visually-hidden" htmlFor="draft-name">Name</label>
          <input id="draft-name" className="eq-name" placeholder={`${activeTab} name`} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          {activeTab === 'Machinery' && (
            <>
              <label className="visually-hidden" htmlFor="draft-rate">Rate</label>
              <input id="draft-rate" type="number" className="eq-small" placeholder="Rate" value={draft.clearingRate ?? ''} onChange={e => setDraft({ ...draft, clearingRate: Number(e.target.value) })} />
            </>
          )}
          {activeTab === 'Aircraft' && (
            <>
              <label className="visually-hidden" htmlFor="draft-drop">Drop m</label>
              <input id="draft-drop" type="number" className="eq-small" placeholder="Drop m" value={draft.dropLength ?? ''} onChange={e => setDraft({ ...draft, dropLength: Number(e.target.value) })} />
                  <label className="visually-hidden" htmlFor="draft-turn">Turnaround minutes</label>
                  <input id="draft-turn" type="number" className="eq-small" placeholder="Turn (m)" value={draft.turnaroundMinutes ?? ''} onChange={e => setDraft({ ...draft, turnaroundMinutes: Number(e.target.value) })} />
            </>
          )}
          {activeTab === 'HandCrew' && (
            <>
              <label className="visually-hidden" htmlFor="draft-crew">Crew</label>
              <input id="draft-crew" type="number" className="eq-xsmall" placeholder="Crew" value={draft.crewSize ?? ''} onChange={e => setDraft({ ...draft, crewSize: Number(e.target.value) })} />
              <label className="visually-hidden" htmlFor="draft-rateperson">Rate/person</label>
              <input id="draft-rateperson" type="number" className="eq-xsmall" placeholder="/person" value={draft.clearingRatePerPerson ?? ''} onChange={e => setDraft({ ...draft, clearingRatePerPerson: Number(e.target.value) })} />
            </>
          )}
          <label className="visually-hidden" htmlFor="draft-cost">$/h</label>
          <input id="draft-cost" type="number" className="eq-small" placeholder="$/h" value={draft.costPerHour ?? ''} onChange={e => setDraft({ ...draft, costPerHour: Number(e.target.value) })} />
          <div className="eq-tags">
            {terrainOptions.map(t => (
              <button key={t} type="button" className={(draft.allowedTerrain ?? []).includes(t) ? 'tag on' : 'tag'} title={terrainExample(t)} onClick={() => setDraft({ ...draft, allowedTerrain: (draft.allowedTerrain ?? []).includes(t) ? (draft.allowedTerrain ?? []).filter((x: string) => x !== t) : [...(draft.allowedTerrain ?? []), t] })}>{terrainLabel(t)}</button>
            ))}
          </div>
          {/* per-row helpers removed; guidance shown in top-level tab guide */}
          <div className="eq-tags">
            {vegetationOptions.map(v => (
              <button key={v} type="button" className={(draft.allowedVegetation ?? []).includes(v) ? 'tag on' : 'tag'} title={vegExample(v)} onClick={() => setDraft({ ...draft, allowedVegetation: (draft.allowedVegetation ?? []).includes(v) ? (draft.allowedVegetation ?? []).filter((x: string) => x !== v) : [...(draft.allowedVegetation ?? []), v] })}>{vegLabel(v)}</button>
            ))}
          </div>
          {/* per-row helpers removed; guidance shown in top-level tab guide */}
          <div className="eq-actions">
            <button className="btn save" disabled={saving} onClick={saveNew}>{saving ? '...' : 'Add'}</button>
            <button className="btn cancel" onClick={() => { setAdding(false); resetDraft(activeTab); }}>X</button>
          </div>
        </div>
      )}
      {filtered.map(item => (
        editingId === item.id ? (
          <InlineEditComponent key={item.id} item={item} onSave={saveEdit} onCancel={() => setEditingId(null)} saving={saving} terrainOptions={terrainOptions} vegetationOptions={vegetationOptions} terrainLabel={terrainLabel} vegLabel={vegLabel} terrainExample={terrainExample} vegExample={vegExample} />
        ) : (
          <div key={item.id} className="equip-row" onDoubleClick={() => setEditingId(item.id)}>
            <div className="eq-name text" title={item.name}>{item.name}</div>
            {item.type === 'Machinery' && <div className="eq-small text">{(item as MachineryApi).clearingRate || '-'} m/h</div>}
            {item.type === 'Aircraft' && (
              <div className="eq-small text" title={`Turnaround ${(item as AircraftApi).turnaroundMinutes ?? '-'} min`}>
                {(item as AircraftApi).dropLength || '-'} m
                {(item as AircraftApi).turnaroundMinutes ? <span className="inline-sub"> / {(item as AircraftApi).turnaroundMinutes}m</span> : null}
              </div>
            )}
            {item.type === 'HandCrew' && <div className="eq-small text">{(item as HandCrewApi).crewSize || '-'} / {(item as HandCrewApi).clearingRatePerPerson || '-'} </div>}
            <div className="eq-small text">{item.costPerHour ? `$${item.costPerHour}` : '-'}</div>
            <div className="eq-tags readonly">
              {item.allowedTerrain.map(t => <span key={t} className="tag on mini" title={terrainExample(t)}>{terrainLabel(t)}</span>)}
            </div>
            <div className="eq-tags readonly">
              {item.allowedVegetation.map(v => <span key={v} className="tag on mini" title={vegExample(v)}>{vegLabel(v)}</span>)}
            </div>
            <div className="eq-actions">
              <button className="btn edit" onClick={() => setEditingId(item.id)}>Edit</button>
              <button className="btn del" onClick={() => remove(item)}>✕</button>
            </div>
          </div>
        )
      ))}
      {!filtered.length && !adding && (
        <div className="empty">No {activeTab} yet.</div>
      )}
    </div>
  );
};

export const EquipmentConfigPanel: React.FC<EquipmentConfigPanelProps> = ({
  equipment, loading, error, onCreate, onUpdate, onDelete, isOpen, onToggle
}) => {
  const [activeTab, setActiveTab] = useState<EquipmentTab>('Machinery');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Record<string, any>>({ 
    type: 'Machinery', 
    name: '', 
    allowedTerrain: ['easy'], 
    allowedVegetation: ['grassland'], 
    active: true 
  });
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const terrainOptions: EquipmentApi['allowedTerrain'] = ['easy','moderate','difficult','extreme'];
  const vegetationOptions: EquipmentApi['allowedVegetation'] = ['grassland','lightshrub','mediumscrub','heavyforest'];

  // Short, compact labels for the tag buttons and helpful examples shown as tooltips.
  const terrainLabel = (t: string) => {
    switch (t) {
      case 'easy': return 'Easy';
      case 'moderate': return 'Moderate';
      case 'difficult': return 'Difficult';
      case 'extreme': return 'Extreme';
      default: return t;
    }
  };
  const terrainExample = (t: string) => {
    // Updated to reflect standardized slope bands: 0–10, 10–20, 20–30, 30°+
    switch (t) {
      case 'easy': return '0–10° — flat or gentle slopes (paddock, grass)';
      case 'moderate': return '10–20° — rolling hills, light obstacles';
      case 'difficult': return '20–30° — steep slopes, rocky or dense scrub';
      case 'extreme': return '30°+ — very steep / technical terrain';
      default: return '';
    }
  };

  const vegLabel = (v: string) => {
    switch (v) {
      case 'grassland': return 'Grass';
      case 'lightshrub': return 'Light shrub';
      case 'mediumscrub': return 'Medium scrub';
      case 'heavyforest': return 'Heavy forest';
      default: return v;
    }
  };
  const vegExample = (v: string) => {
    switch (v) {
      case 'grassland': return 'Grassland — open grass, low fuel loads';
      case 'lightshrub': return 'Light shrub / scrub — low bushes, scattered shrubs';
      case 'mediumscrub': return 'Medium scrub — dense shrub, mixed groundcover';
      case 'heavyforest': return 'Heavy timber / forest — tall trees, closed canopy';
      default: return '';
    }
  };

  const filtered = equipment.filter(e => e.type === activeTab);

  const resetDraft = (type: EquipmentCoreType = activeTab) => setDraft({ 
    type, 
    name: '', 
    allowedTerrain: ['easy'], 
    allowedVegetation: ['grassland'], 
    active: true 
  });

  const startAdd = () => { resetDraft(activeTab); setAdding(true); setEditingId(null); };

  const saveNew = async () => {
    if (!draft.name?.trim()) { setLocalError('Name required'); return; }
    setSaving(true); setLocalError(null);
    try { 
      await onCreate(draft as any); 
      setAdding(false); 
      resetDraft(activeTab); 
    } catch (error: unknown) { 
      const errorMessage = error instanceof Error ? error.message : 'Failed to create equipment';
      setLocalError(errorMessage); 
    } finally { 
      setSaving(false); 
    }
  };

  const saveEdit = async (item: EquipmentApi) => {
    setSaving(true); setLocalError(null);
    try { 
      await onUpdate(item); 
      setEditingId(null); 
    } catch (error: unknown) { 
      const errorMessage = error instanceof Error ? error.message : 'Failed to update equipment';
      setLocalError(errorMessage); 
    } finally { 
      setSaving(false); 
    }
  };

  const remove = async (item: EquipmentApi) => {
    // TODO: Replace with a proper modal dialog for better UX
    if (!confirm(`Delete ${item.name}? This action cannot be undone.`)) return;
    try { 
      await onDelete(item); 
    } catch (error: unknown) { 
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete equipment';
      setLocalError(errorMessage); 
    }
  };

  // InlineEdit moved to top-level InlineEditComponent

  // EquipmentList moved to top-level EquipmentListComponent

  if (!isOpen) return null;

  return (
    <div className="equipment-config-panel sidebar">
      <div className="config-header">
        <h3>Equipment Configuration</h3>
        <button 
          className="close-button"
          onClick={() => onToggle?.()}
        >
          ✕
        </button>
      </div>

      <div className="config-tabs equip-tabs">
        {(['Machinery','Aircraft','HandCrew'] as EquipmentTab[]).map(t => (
          <button key={t} className={`tab-button ${activeTab === t ? 'active' : ''}`} onClick={() => { setActiveTab(t); setAdding(false); setEditingId(null); }}>
            {t} ({equipment.filter(e => e.type === t).length})
          </button>
        ))}
        <div className="equip-tab-spacer" />
        <button className="quick-add" onClick={startAdd} disabled={adding}>＋ Add {activeTab}</button>
      </div>

      {/* Single top-level guide for the visible tab to avoid repeating helpers in every row */}
      <div className="tab-guide" aria-hidden>
  <div className="guide-line"><strong>Slope guide:</strong> 0–10° (Easy), 10–20° (Moderate), 20–30° (Difficult), &gt;=30° (Extreme)</div>
        <div className="guide-line"><strong>Vegetation examples:</strong> Grassland · Light shrub · Medium scrub · Heavy timber</div>
        <div className="guide-line"><small className="muted">Tip: click tags to toggle terrain/vegetation inclusion for each equipment item.</small></div>
      </div>

      <div className="config-content equip-content">
        {error && <div className="equip-error">{error}</div>}
        {localError && <div className="equip-error">{localError}</div>}
        {loading && <div className="equip-loading">Loading...</div>}
        <EquipmentListComponent
          equipment={equipment}
          activeTab={activeTab}
          adding={adding}
          draft={draft}
          setDraft={setDraft}
          saveNew={saveNew}
          setAdding={setAdding}
          resetDraft={resetDraft}
          editingId={editingId}
          setEditingId={setEditingId}
          saveEdit={saveEdit}
          remove={remove}
          saving={saving}
          terrainOptions={terrainOptions}
          vegetationOptions={vegetationOptions}
          terrainLabel={terrainLabel}
          vegLabel={vegLabel}
          terrainExample={terrainExample}
          vegExample={vegExample}
        />
        <p className="equip-hint">Double-click a row to edit. Tags toggle inclusion. Changes save instantly.</p>
      </div>
    </div>
  );
};