/**
 * Equipment Configuration Panel component for managing fire break calculator resources.
 * Allows administrators to configure machinery, aircraft, and hand crew specifications
 * including clearing rates, costs, and terrain/vegetation constraints.
 */

import React, { useState } from 'react';
import { EquipmentApi, EquipmentCoreType, CreateEquipmentInput } from '../types/equipmentApi';

interface EquipmentConfigPanelProps {
  equipment: EquipmentApi[];
  loading: boolean;
  error: string | null;
  onCreate: (item: CreateEquipmentInput) => Promise<void> | void;
  onUpdate: (item: EquipmentApi) => Promise<void> | void;
  onDelete: (item: EquipmentApi) => Promise<void> | void;
  isOpen?: boolean;
  onToggle?: () => void;
}

type EquipmentTab = EquipmentCoreType;

export const EquipmentConfigPanel: React.FC<EquipmentConfigPanelProps> = ({
  equipment, loading, error, onCreate, onUpdate, onDelete, isOpen, onToggle
}) => {
  const [activeTab, setActiveTab] = useState<EquipmentTab>('Machinery');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<CreateEquipmentInput>({ type: 'Machinery', name: '', allowedTerrain: ['easy'], allowedVegetation: ['grassland'], active: true } as CreateEquipmentInput);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const terrainOptions: EquipmentApi['allowedTerrain'] = ['easy','moderate','difficult','extreme'];
  const vegetationOptions: EquipmentApi['allowedVegetation'] = ['grassland','lightshrub','mediumscrub','heavyforest'];

  const filtered = equipment.filter(e => e.type === activeTab);

  const resetDraft = (type: EquipmentCoreType = activeTab) => setDraft({ type, name: '', allowedTerrain: ['easy'], allowedVegetation: ['grassland'], active: true } as CreateEquipmentInput);

  const startAdd = () => { resetDraft(activeTab); setAdding(true); setEditingId(null); };

  const saveNew = async () => {
    if (!draft.name?.trim()) { setLocalError('Name required'); return; }
    setSaving(true); setLocalError(null);
    try { await onCreate(draft); setAdding(false); resetDraft(activeTab); }
    catch (e: any) { setLocalError(e.message); }
    finally { setSaving(false); }
  };

  const saveEdit = async (item: EquipmentApi) => {
    setSaving(true); setLocalError(null);
    try { await onUpdate(item); setEditingId(null); }
    catch (e: any) { setLocalError(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (item: EquipmentApi) => {
    if (!confirm(`Delete ${item.name}?`)) return;
    try { await onDelete(item); } catch (e: any) { setLocalError(e.message); }
  };

  const InlineEdit: React.FC<{ item: EquipmentApi }> = ({ item }) => {
    const [form, setForm] = useState<EquipmentApi>(item);
    return (
      <div className="equip-row editing">
  <input aria-label="Name" className="eq-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value } as EquipmentApi)} />
        {item.type === 'Machinery' && (
          <input aria-label="Clearing rate" type="number" className="eq-small" placeholder="Rate" value={(form as any).clearingRate ?? ''} onChange={e => setForm({ ...(form as any), clearingRate: Number(e.target.value) } as EquipmentApi)} />
        )}
        {item.type === 'Aircraft' && (
          <input aria-label="Drop length" type="number" className="eq-small" placeholder="Drop m" value={(form as any).dropLength ?? ''} onChange={e => setForm({ ...(form as any), dropLength: Number(e.target.value) } as EquipmentApi)} />
        )}
        {item.type === 'HandCrew' && (
          <>
            <input aria-label="Crew size" type="number" className="eq-xsmall" title="Crew Size" placeholder="Crew" value={(form as any).crewSize ?? ''} onChange={e => setForm({ ...(form as any), crewSize: Number(e.target.value) } as EquipmentApi)} />
            <input aria-label="Clearing rate per person" type="number" className="eq-xsmall" title="Rate / person" placeholder="/person" value={(form as any).clearingRatePerPerson ?? ''} onChange={e => setForm({ ...(form as any), clearingRatePerPerson: Number(e.target.value) } as EquipmentApi)} />
          </>
        )}
  <input aria-label="Cost per hour" type="number" className="eq-small" placeholder="$/h" value={form.costPerHour ?? ''} onChange={e => setForm({ ...form, costPerHour: Number(e.target.value) } as EquipmentApi)} />
        <div className="eq-tags">
          {terrainOptions.map(t => (
            <button aria-label={`Terrain ${t}`} key={t} type="button" className={form.allowedTerrain.includes(t) ? 'tag on' : 'tag'} onClick={() => setForm({ ...form, allowedTerrain: form.allowedTerrain.includes(t) ? form.allowedTerrain.filter(x => x !== t) : [...form.allowedTerrain, t] } as EquipmentApi)}>{t[0].toUpperCase()}</button>
          ))}
        </div>
        <div className="eq-tags">
          {vegetationOptions.map(v => (
            <button aria-label={`Vegetation ${v}`} key={v} type="button" className={form.allowedVegetation.includes(v) ? 'tag on' : 'tag'} onClick={() => setForm({ ...form, allowedVegetation: form.allowedVegetation.includes(v) ? form.allowedVegetation.filter(x => x !== v) : [...form.allowedVegetation, v] } as EquipmentApi)}>{v[0].toUpperCase()}</button>
          ))}
        </div>
        <div className="eq-actions">
          <button className="btn save" disabled={saving} onClick={() => saveEdit(form)}>{saving ? '...' : 'Save'}</button>
          <button className="btn cancel" onClick={() => setEditingId(null)}>Cancel</button>
        </div>
      </div>
    );
  };

  const EquipmentList: React.FC = () => (
    <div className="equip-list">
  {adding && (
        <div className="equip-row adding">
          <input className="eq-name" placeholder={`${activeTab} name`} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          {activeTab === 'Machinery' && (
            <input type="number" className="eq-small" placeholder="Rate" value={draft.clearingRate ?? ''} onChange={e => setDraft({ ...draft, clearingRate: Number(e.target.value) })} />
          )}
          {activeTab === 'Aircraft' && (
            <input type="number" className="eq-small" placeholder="Drop m" value={draft.dropLength ?? ''} onChange={e => setDraft({ ...draft, dropLength: Number(e.target.value) })} />
          )}
          {activeTab === 'HandCrew' && (
            <>
              <input type="number" className="eq-xsmall" placeholder="Crew" value={draft.crewSize ?? ''} onChange={e => setDraft({ ...draft, crewSize: Number(e.target.value) })} />
              <input type="number" className="eq-xsmall" placeholder="/person" value={draft.clearingRatePerPerson ?? ''} onChange={e => setDraft({ ...draft, clearingRatePerPerson: Number(e.target.value) })} />
            </>
          )}
            <input type="number" className="eq-small" placeholder="$/h" value={draft.costPerHour ?? ''} onChange={e => setDraft({ ...draft, costPerHour: Number(e.target.value) })} />
          <div className="eq-tags">
            {terrainOptions.map(t => (
            <button key={t} type="button" className={(draft.allowedTerrain ?? []).includes(t) ? 'tag on' : 'tag'} onClick={() => setDraft({ ...draft, allowedTerrain: (draft.allowedTerrain ?? []).includes(t) ? (draft.allowedTerrain ?? []).filter((x: string) => x !== t) : [...(draft.allowedTerrain ?? []), t] })}>{t[0].toUpperCase()}</button>
            ))}
          </div>
            <div className="eq-tags">
            {vegetationOptions.map(v => (
              <button key={v} type="button" className={(draft.allowedVegetation ?? []).includes(v) ? 'tag on' : 'tag'} onClick={() => setDraft({ ...draft, allowedVegetation: (draft.allowedVegetation ?? []).includes(v) ? (draft.allowedVegetation ?? []).filter((x: string) => x !== v) : [...(draft.allowedVegetation ?? []), v] })}>{v[0].toUpperCase()}</button>
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
          <InlineEdit key={item.id} item={item} />
        ) : (
          <div key={item.id} className="equip-row" onDoubleClick={() => setEditingId(item.id)}>
            <div className="eq-name text" title={item.name}>{item.name}</div>
            {item.type === 'Machinery' && <div className="eq-small text">{(item as any).clearingRate || '-'} m/h</div>}
            {item.type === 'Aircraft' && <div className="eq-small text">{(item as any).dropLength || '-'} m</div>}
            {item.type === 'HandCrew' && <div className="eq-small text">{(item as any).crewSize || '-'} / {(item as any).clearingRatePerPerson || '-'} </div>}
            <div className="eq-small text">{item.costPerHour ? `$${item.costPerHour}` : '-'}</div>
            <div className="eq-tags readonly">
              {item.allowedTerrain.map(t => <span key={t} className="tag on mini" title={t}>{t[0].toUpperCase()}</span>)}
            </div>
            <div className="eq-tags readonly">
              {item.allowedVegetation.map(v => <span key={v} className="tag on mini" title={v}>{v[0].toUpperCase()}</span>)}
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

      <div className="config-content equip-content">
        {error && <div className="equip-error">{error}</div>}
        {localError && <div className="equip-error">{localError}</div>}
        {loading && <div className="equip-loading">Loading...</div>}
        <EquipmentList />
        <p className="equip-hint">Double-click a row to edit. Tags toggle inclusion. Changes save instantly.</p>
      </div>
    </div>
  );
};