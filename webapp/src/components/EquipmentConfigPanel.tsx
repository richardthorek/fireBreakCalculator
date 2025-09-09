/**
 * Equipment Configuration Panel component for managing fire break calculator resources.
 * Two-column layout: left side = info/controls, right side = list (scrollable).
 */

import React, { useState, useEffect } from 'react';
import { EquipmentApi, EquipmentCoreType, MachineryApi, AircraftApi, HandCrewApi } from '../types/equipmentApi';
import { getVegetationTypeDisplayName, getVegetationTypeExample, getTerrainLevelDisplayName, getTerrainLevelExample } from '../utils/formatters';
import { VegetationType, TerrainLevel } from '../config/classification';

interface EquipmentConfigPanelProps {
  equipment: EquipmentApi[];
  loading: boolean;
  error: string | null;
  onCreate: (partial: Partial<EquipmentApi> & { type: EquipmentApi['type']; name: string; }) => Promise<void>;
  onUpdate: (item: EquipmentApi) => Promise<void>;
  onDelete: (item: EquipmentApi) => Promise<void>;
  isOpen?: boolean;
  onToggle?: () => void;
  initialTab?: EquipmentCoreType;
  showOwnTabs?: boolean; // Control whether to show its own tabs
  triggerAdd?: number; // Trigger add mode when this value changes
  showDescription?: boolean;
  showGuide?: boolean;
  filter?: string; // Filter text for equipment
  compactMode?: boolean; // Use compact layout for integrated panel
}

type EquipmentTab = EquipmentCoreType;

// Inline editor for a row
const InlineEditComponent: React.FC<{
  item: EquipmentApi;
  onSave: (item: EquipmentApi) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  terrainOptions: string[];
  vegetationOptions: string[];
  terrainLabel: (t: string) => string;
  vegLabel: (v: string) => string;
  terrainExample: (t: string) => string;
  vegExample: (v: string) => string;
}> = ({ item, onSave, onCancel, saving, terrainOptions, vegetationOptions, terrainLabel, vegLabel, terrainExample, vegExample }) => {
  const [form, setForm] = useState<EquipmentApi>(item);

  const updateMachinery = (updates: Partial<MachineryApi>) => {
    if (form.type === 'Machinery') setForm({ ...form, ...updates } as MachineryApi);
  };
  const updateAircraft = (updates: Partial<AircraftApi>) => {
    if (form.type === 'Aircraft') setForm({ ...form, ...updates } as AircraftApi);
  };
  const updateHandCrew = (updates: Partial<HandCrewApi>) => {
    if (form.type === 'HandCrew') setForm({ ...form, ...updates } as HandCrewApi);
  };

  // helpers to toggle allowed terrain/vegetation
  const toggleTerrain = (t: string) => {
    const current = (form.allowedTerrain ?? []) as any[];
    const next = current.includes(t) ? current.filter(x => x !== t) : [...current, t];
    setForm({ ...form, allowedTerrain: next as any } as EquipmentApi);
  };
  const toggleVegetation = (v: string) => {
    const current = (form.allowedVegetation ?? []) as any[];
    const next = current.includes(v) ? current.filter(x => x !== v) : [...current, v];
    setForm({ ...form, allowedVegetation: next as any } as EquipmentApi);
  };

  return (
    <div className="equip-row editing">
      <label className="visually-hidden" htmlFor={`name-${item.id}`}>Name</label>
      <input id={`name-${item.id}`} aria-label="Name" className="eq-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />

      {form.type === 'Machinery' && (
        <input aria-label="Clearing rate" className="eq-small" type="number" placeholder="Rate" value={(form as MachineryApi).clearingRate ?? ''} onChange={e => updateMachinery({ clearingRate: Number(e.target.value) })} />
      )}

      {form.type === 'Aircraft' && (
        <>
          <input aria-label="Drop length" className="eq-small" type="number" placeholder="Drop m" value={(form as AircraftApi).dropLength ?? ''} onChange={e => updateAircraft({ dropLength: Number(e.target.value) })} />
          <input aria-label="Turnaround minutes" className="eq-small" type="number" placeholder="Turn (m)" value={(form as AircraftApi).turnaroundMinutes ?? ''} onChange={e => updateAircraft({ turnaroundMinutes: Number(e.target.value) })} />
        </>
      )}

      {form.type === 'HandCrew' && (
        <>
          <input aria-label="Crew size" className="eq-xsmall" type="number" placeholder="Crew" value={(form as HandCrewApi).crewSize ?? ''} onChange={e => updateHandCrew({ crewSize: Number(e.target.value) })} />
          <input aria-label="Rate / person" className="eq-xsmall" type="number" placeholder="/person" value={(form as HandCrewApi).clearingRatePerPerson ?? ''} onChange={e => updateHandCrew({ clearingRatePerPerson: Number(e.target.value) })} />
        </>
      )}

      <input aria-label="Cost per hour" id={`cost-${item.id}`} type="number" className="eq-small" placeholder="$/h" value={form.costPerHour ?? ''} onChange={e => setForm({ ...form, costPerHour: Number(e.target.value) })} />

      <div className="eq-tags">
        {terrainOptions.map(t => (
          <button key={t} type="button" className={(form.allowedTerrain ?? []).includes(t as any) ? `tag on terrain-${t}` : 'tag'} title={terrainExample(t)} onClick={() => toggleTerrain(t as any)}>{terrainLabel(t)}</button>
        ))}
      </div>

      <div className="eq-tags">
        {vegetationOptions.map(v => (
          <button key={v} type="button" className={(form.allowedVegetation ?? []).includes(v as any) ? `tag on veg-${v}` : 'tag'} title={vegExample(v)} onClick={() => toggleVegetation(v as any)}>{vegLabel(v)}</button>
        ))}
      </div>

      <div className="eq-actions">
        <button className="btn save" disabled={saving} onClick={() => onSave(form)}>{saving ? '...' : 'Save'}</button>
        <button className="btn cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};

// Equipment list component
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
  terrainOptions: string[];
  vegetationOptions: string[];
  terrainLabel: (t: string) => string;
  vegLabel: (v: string) => string;
  terrainExample: (t: string) => string;
  vegExample: (v: string) => string;
  filter?: string;
  compactMode?: boolean;
}> = ({ equipment, activeTab, adding, draft, setDraft, saveNew, setAdding, resetDraft, editingId, setEditingId, saveEdit, remove, saving, terrainOptions, vegetationOptions, terrainLabel, vegLabel, terrainExample, vegExample, filter = '', compactMode = false }) => {
  const filtered = equipment
    .filter(e => e.type === activeTab)
    .filter(e => filter === '' || e.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className={`equip-list ${compactMode ? 'compact' : ''}`}>
      {adding && (
        <div className="equip-row adding">
          <label className="visually-hidden" htmlFor="draft-name">Name</label>
          <input id="draft-name" className="eq-name" placeholder={`${activeTab} name`} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />

          {activeTab === 'Machinery' && (
            <input id="draft-rate" type="number" className="eq-small" placeholder="Rate" value={draft.clearingRate ?? ''} onChange={e => setDraft({ ...draft, clearingRate: Number(e.target.value) })} />
          )}

          {activeTab === 'Aircraft' && (
            <>
              <input id="draft-drop" type="number" className="eq-small" placeholder="Drop m" value={draft.dropLength ?? ''} onChange={e => setDraft({ ...draft, dropLength: Number(e.target.value) })} />
              <input id="draft-turn" type="number" className="eq-small" placeholder="Turn (m)" value={draft.turnaroundMinutes ?? ''} onChange={e => setDraft({ ...draft, turnaroundMinutes: Number(e.target.value) })} />
            </>
          )}

          {activeTab === 'HandCrew' && (
            <>
              <input id="draft-crew" type="number" className="eq-xsmall" placeholder="Crew" value={draft.crewSize ?? ''} onChange={e => setDraft({ ...draft, crewSize: Number(e.target.value) })} />
              <input id="draft-rateperson" type="number" className="eq-xsmall" placeholder="/person" value={draft.clearingRatePerPerson ?? ''} onChange={e => setDraft({ ...draft, clearingRatePerPerson: Number(e.target.value) })} />
            </>
          )}

          <input id="draft-cost" type="number" className="eq-small" placeholder="$/h" value={draft.costPerHour ?? ''} onChange={e => setDraft({ ...draft, costPerHour: Number(e.target.value) })} />

          <div className="eq-tags">
            {terrainOptions.map(t => (
              <button key={t} type="button" className={(draft.allowedTerrain ?? []).includes(t) ? `tag on terrain-${t}` : 'tag'} title={terrainExample(t)} onClick={() => {
                const cur = draft.allowedTerrain ?? [];
                const next = cur.includes(t) ? cur.filter((x: string) => x !== t) : [...cur, t];
                setDraft({ ...draft, allowedTerrain: next });
              }}>{terrainLabel(t)}</button>
            ))}
          </div>

          <div className="eq-tags">
            {vegetationOptions.map(v => (
              <button key={v} type="button" className={(draft.allowedVegetation ?? []).includes(v) ? `tag on veg-${v}` : 'tag'} title={vegExample(v)} onClick={() => {
                const cur = draft.allowedVegetation ?? [];
                const next = cur.includes(v) ? cur.filter((x: string) => x !== v) : [...cur, v];
                setDraft({ ...draft, allowedVegetation: next });
              }}>{vegLabel(v)}</button>
            ))}
          </div>

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
              {item.allowedTerrain.map(t => <span key={t} className={`tag on mini terrain-${t}`} title={terrainExample(t)}>{terrainLabel(t)}</span>)}
            </div>
            <div className="eq-tags readonly">
              {item.allowedVegetation.map(v => <span key={v} className={`tag on mini veg-${v}`} title={vegExample(v)}>{vegLabel(v)}</span>)}
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
  equipment, loading, error, onCreate, onUpdate, onDelete, isOpen, onToggle, initialTab = 'Machinery', showOwnTabs = true, triggerAdd,
  showDescription = true, showGuide = true, filter = '', compactMode = false
}) => {
  const [activeTab, setActiveTab] = useState<EquipmentTab>(initialTab);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Record<string, any>>({ 
    type: 'Machinery', 
    name: '', 
    allowedTerrain: ['flat'], 
    allowedVegetation: ['grassland'], 
    active: true 
  });
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);
  useEffect(() => { if (triggerAdd && triggerAdd > 0) startAdd(); }, [triggerAdd]);

  const terrainOptions: string[] = ['flat','medium','steep','very_steep'];
  const vegetationOptions: string[] = ['grassland','lightshrub','mediumscrub','heavyforest'];

  const terrainLabel = (t: string) => getTerrainLevelDisplayName(t as TerrainLevel);
  const terrainExample = (t: string) => getTerrainLevelExample(t as TerrainLevel);
  const vegLabel = (v: string) => getVegetationTypeDisplayName(v as VegetationType);
  const vegExample = (v: string) => getVegetationTypeExample(v as VegetationType);

  const resetDraft = (type: EquipmentCoreType = activeTab) => setDraft({ type, name: '', allowedTerrain: ['flat'], allowedVegetation: ['grassland'], active: true });
  const startAdd = () => { resetDraft(activeTab); setAdding(true); setEditingId(null); };

  const saveNew = async () => {
    if (!draft.name?.trim()) { setLocalError('Name required'); return; }
    setSaving(true); setLocalError(null);
    try { await onCreate(draft as any); setAdding(false); resetDraft(activeTab); } catch (e: unknown) { setLocalError(e instanceof Error ? e.message : 'Failed to create'); } finally { setSaving(false); }
  };

  const saveEdit = async (item: EquipmentApi) => {
    setSaving(true); setLocalError(null);
    try { await onUpdate(item); setEditingId(null); } catch (e: unknown) { setLocalError(e instanceof Error ? e.message : 'Failed to update'); } finally { setSaving(false); }
  };

  const remove = async (item: EquipmentApi) => {
    if (!confirm(`Delete ${item.name}? This action cannot be undone.`)) return;
    try { await onDelete(item); } catch (e: unknown) { setLocalError(e instanceof Error ? e.message : 'Failed to delete'); }
  };

  if (!isOpen) return null;

  // Compact mode for integrated panel - just show the equipment list
  if (compactMode) {
    return (
      <div className="equipment-config-panel compact">
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
          filter={filter}
          compactMode={compactMode}
        />
      </div>
    );
  }

  return (
    <div className="equipment-config-panel two-column">
      <aside className="panel-left">
        {showDescription && (
          <div className="panel-description compact-side">
            <h3>Equipment</h3>
            <p>Configure machinery, aircraft, and hand crews used by the calculator.</p>
            <div className="panel-stats">
              <div className="equipment-count-large">{equipment.length} total</div>
              <div className="equipment-type-counts">
                <span>Machinery: {equipment.filter(e => e.type === 'Machinery').length}</span>
                <span>Air: {equipment.filter(e => e.type === 'Aircraft').length}</span>
                <span>Crew: {equipment.filter(e => e.type === 'HandCrew').length}</span>
              </div>
            </div>
          </div>
        )}

        {showGuide && (
          <div className="tab-guide side-guide" aria-hidden>
            <div className="guide-line"><strong>Slope:</strong> 0–10° Flat · 10–25° Medium · 25–45° Steep · ≥45° Very Steep</div>
            <div className="guide-line"><strong>Veg examples:</strong> Grassland · Light shrub · Medium scrub · Heavy timber</div>
            <div className="guide-line muted small">Tip: click tags to toggle terrain/vegetation for each item.</div>
          </div>
        )}

        <div className="side-actions">
          <div className="current-tab-name side-tab">{activeTab}</div>
          <button className="add-equipment-btn side-add" onClick={startAdd} disabled={adding}>＋ Add</button>
          <div className="search-box-side">
            <input className="search-box" placeholder="Filter…" aria-label="Filter equipment" />
          </div>
        </div>
      </aside>

      <main className="panel-right">
        {showOwnTabs && (
          <div className="equipment-toolbar top-toolbar">
            <div className="equipment-toolbar-title">
              <span className="current-tab-name">{activeTab}</span>
              <span className="equipment-count">({equipment.filter(e => e.type === activeTab).length} items)</span>
            </div>
            <div className="toolbar-actions">
              <button className="add-equipment-btn" onClick={startAdd} disabled={adding}>＋ Add {activeTab}</button>
            </div>
          </div>
        )}

        <div className="equipment-scroll-area">
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
            filter={filter}
            compactMode={compactMode}
          />
          <p className="equip-hint">Double-click a row to edit. Tags toggle inclusion. Changes save instantly.</p>
        </div>
      </main>
    </div>
  );
};

export default EquipmentConfigPanel;