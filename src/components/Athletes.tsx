import { useState, useEffect } from 'react';
import type { Athlete } from '../lib/database.types';
import {
  User, Edit2, Trash2, Award, Plus, Search, X as XIcon,
  MapPin, Trophy,
} from 'lucide-react';
import { AthletePRs } from './AthletePRs';
import { formatDateToDDMMYYYY, parseDDMMYYYYToISO } from '../lib/dateUtils';
import { calculateAge } from '../lib/calculations';
import { useAthletes } from '../hooks/useAthletes';
import { supabase } from '../lib/supabase';

// ── AthleteFormModal ────────────────────────────────────────────────

interface AthleteFormModalProps {
  editingAthlete: Athlete | null;
  onSave: (data: Partial<Athlete>) => Promise<void>;
  onClose: () => void;
  isSubmitting: boolean;
}

function AthleteFormModal({ editingAthlete, onSave, onClose, isSubmitting }: AthleteFormModalProps) {
  const [name, setName] = useState(editingAthlete?.name ?? '');
  const [birthdateDisplay, setBirthdateDisplay] = useState(formatDateToDDMMYYYY(editingAthlete?.birthdate ?? ''));
  const [birthdate, setBirthdate] = useState(editingAthlete?.birthdate ?? '');
  const [bodyweight, setBodyweight] = useState(editingAthlete?.bodyweight?.toString() ?? '');
  const [weightClass, setWeightClass] = useState(editingAthlete?.weight_class ?? '');
  const [club, setClub] = useState(editingAthlete?.club ?? '');
  const [notes, setNotes] = useState(editingAthlete?.notes ?? '');
  const [photoUrl, setPhotoUrl] = useState(editingAthlete?.photo_url ?? '');
  const [isActive, setIsActive] = useState(editingAthlete?.is_active ?? true);
  const [trackBodyweight, setTrackBodyweight] = useState(editingAthlete?.track_bodyweight ?? true);
  const [competitionTotal, setCompetitionTotal] = useState(editingAthlete?.competition_total?.toString() ?? '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onSave({
      name: name.trim(),
      birthdate: birthdate || null,
      bodyweight: bodyweight ? parseFloat(bodyweight) : null,
      weight_class: weightClass.trim() || null,
      club: club.trim() || null,
      notes: notes.trim() || null,
      photo_url: photoUrl.trim() || null,
      is_active: isActive,
      track_bodyweight: trackBodyweight,
      competition_total: competitionTotal ? parseFloat(competitionTotal) : null,
    });
  };

  const inputCls = 'w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400';
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1';

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <span className="text-sm font-semibold text-gray-900">
            {editingAthlete ? 'Edit athlete' : 'Add athlete'}
          </span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded">
            <XIcon size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          <form id="athlete-form" onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className={labelCls}>Name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className={inputCls}
                placeholder="Full name"
                required
                autoFocus
              />
            </div>

            <div>
              <label className={labelCls}>Birthdate (dd/mm/yyyy)</label>
              <input
                type="text"
                value={birthdateDisplay}
                onChange={e => {
                  const input = e.target.value;
                  setBirthdateDisplay(input);
                  if (input.length === 10) {
                    const iso = parseDDMMYYYYToISO(input);
                    if (iso) setBirthdate(iso);
                  } else if (input === '') {
                    setBirthdate('');
                  }
                }}
                onBlur={e => {
                  if (e.target.value.length === 10) {
                    const iso = parseDDMMYYYYToISO(e.target.value);
                    if (iso) setBirthdate(iso);
                  }
                }}
                className={inputCls}
                placeholder="dd/mm/yyyy"
                maxLength={10}
              />
              {birthdate && (
                <p className="mt-1 text-xs text-gray-500">Age: {calculateAge(birthdate)} years</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Bodyweight (kg)</label>
                <input
                  type="number"
                  value={bodyweight}
                  onChange={e => setBodyweight(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. 73.5"
                  step="0.1"
                />
              </div>
              <div>
                <label className={labelCls}>Weight class</label>
                <input
                  type="text"
                  value={weightClass}
                  onChange={e => setWeightClass(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. 73kg"
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Club / Team</label>
              <input
                type="text"
                value={club}
                onChange={e => setClub(e.target.value)}
                className={inputCls}
                placeholder="e.g. City Weightlifting Club"
              />
            </div>

            <div>
              <label className={labelCls}>Competition total (kg)</label>
              <input
                type="number"
                value={competitionTotal}
                onChange={e => setCompetitionTotal(e.target.value)}
                className={inputCls}
                placeholder="e.g. 280 (Sn + C&J)"
                step="0.5"
                min="0"
              />
              <p className="mt-1 text-[11px] text-gray-400">
                Manual override for K-value. Leave blank to auto-derive from Snatch + C&J PRs.
              </p>
            </div>

            <div>
              <label className={labelCls}>Photo URL</label>
              <input
                type="url"
                value={photoUrl}
                onChange={e => setPhotoUrl(e.target.value)}
                className={inputCls}
                placeholder="https://…"
              />
              {photoUrl && (
                <img
                  src={photoUrl}
                  alt="Preview"
                  className="mt-2 w-14 h-14 rounded-full object-cover border border-gray-200"
                  onError={e => { e.currentTarget.style.display = 'none'; }}
                />
              )}
            </div>

            <div>
              <label className={labelCls}>Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className={inputCls}
                rows={3}
                placeholder="Additional notes…"
              />
            </div>

            <div className="flex gap-6 pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={e => setIsActive(e.target.checked)}
                  className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-400"
                />
                <span className="text-xs text-gray-700">Active</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={trackBodyweight}
                  onChange={e => setTrackBodyweight(e.target.checked)}
                  className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-400"
                />
                <span className="text-xs text-gray-700">Track bodyweight</span>
              </label>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-gray-200 flex-shrink-0">
          <button
            form="athlete-form"
            type="submit"
            disabled={isSubmitting || !name.trim()}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
          >
            {editingAthlete ? 'Update' : 'Create'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AthleteListHeader ───────────────────────────────────────────────

function AthleteListHeader() {
  return (
    <div className="flex items-center px-3 py-1.5 bg-gray-100 border-b border-gray-200 sticky top-0 z-10">
      <span className="w-8 flex-shrink-0" />
      <span className="flex-1 min-w-0 text-[9px] font-bold text-gray-400 uppercase tracking-wide pr-3">Name</span>
      <span className="w-10 flex-shrink-0 text-[9px] font-bold text-gray-400 uppercase tracking-wide text-center">Age</span>
      <span className="w-16 flex-shrink-0 text-[9px] font-bold text-gray-400 uppercase tracking-wide text-center">BW (kg)</span>
      <span className="w-16 flex-shrink-0 text-[9px] font-bold text-gray-400 uppercase tracking-wide text-center">Class</span>
      <span className="w-24 flex-shrink-0 text-[9px] font-bold text-gray-400 uppercase tracking-wide">Club</span>
      <span className="w-16 flex-shrink-0 text-[9px] font-bold text-gray-400 uppercase tracking-wide text-right">Total</span>
      <span className="w-20 flex-shrink-0" />
    </div>
  );
}

// ── AthleteRow ──────────────────────────────────────────────────────

interface AthleteRowProps {
  athlete: Athlete;
  isSelected: boolean;
  rowIndex: number;
  onClick: () => void;
  onEdit: () => void;
  onPRs: () => void;
  onDelete: () => void;
}

function AthleteRow({ athlete, isSelected, rowIndex, onClick, onEdit, onPRs, onDelete }: AthleteRowProps) {
  const isEven = rowIndex % 2 === 0;
  const bg = isSelected
    ? 'bg-blue-50 border-l-2 border-l-blue-400'
    : isEven ? 'bg-white' : 'bg-gray-50/70';

  const initials = athlete.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div
      onClick={onClick}
      className={`flex items-center px-3 py-2 cursor-pointer transition-colors hover:bg-blue-50/40 group ${bg} ${
        !athlete.is_active ? 'opacity-60' : ''
      }`}
    >
      {/* Avatar */}
      <div className="w-8 flex-shrink-0 flex items-center">
        {athlete.photo_url ? (
          <img
            src={athlete.photo_url}
            alt=""
            className="w-6 h-6 rounded-full object-cover"
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-[9px] font-bold text-blue-700 flex-shrink-0">
            {initials}
          </div>
        )}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0 pr-3 flex items-center gap-1.5">
        <span className="text-[12px] text-gray-800 font-medium truncate">{athlete.name}</span>
        {!athlete.is_active && (
          <span className="text-[9px] font-medium bg-gray-200 text-gray-500 px-1.5 py-px rounded flex-shrink-0">
            Inactive
          </span>
        )}
      </div>

      {/* Age */}
      <span className="w-10 flex-shrink-0 text-[11px] text-gray-500 text-center font-mono">
        {athlete.birthdate ? calculateAge(athlete.birthdate) : '—'}
      </span>

      {/* Bodyweight */}
      <span className="w-16 flex-shrink-0 text-[11px] text-gray-500 text-center font-mono">
        {athlete.bodyweight ?? '—'}
      </span>

      {/* Weight class */}
      <span className="w-16 flex-shrink-0 text-[11px] text-gray-500 text-center truncate">
        {athlete.weight_class ?? '—'}
      </span>

      {/* Club */}
      <span className="w-24 flex-shrink-0 text-[10px] text-gray-400 truncate">
        {athlete.club ?? '—'}
      </span>

      {/* Competition total */}
      <span className="w-16 flex-shrink-0 text-right font-mono text-[11px] font-semibold text-blue-600">
        {athlete.competition_total ? `${athlete.competition_total}` : ''}
      </span>

      {/* Actions */}
      <div className="w-20 flex-shrink-0 flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={e => { e.stopPropagation(); onPRs(); }}
          className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors"
          title="Manage PRs"
        >
          <Award size={13} />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onEdit(); }}
          className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
          title="Edit"
        >
          <Edit2 size={13} />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors"
          title="Delete"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── AthleteDetailPanel ──────────────────────────────────────────────

interface AthleteDetailPanelProps {
  athlete: Athlete;
  onClose: () => void;
  onEdit: () => void;
  onPRs: () => void;
  onDelete: () => void;
}

function AthleteDetailPanel({ athlete, onClose, onEdit, onPRs, onDelete }: AthleteDetailPanelProps) {
  const initials = athlete.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          {athlete.photo_url ? (
            <img
              src={athlete.photo_url}
              alt=""
              className="w-8 h-8 rounded-full object-cover"
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">
              {initials}
            </div>
          )}
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-gray-900">{athlete.name}</span>
              {!athlete.is_active && (
                <span className="text-[9px] font-medium bg-gray-200 text-gray-500 px-1.5 py-px rounded">
                  Inactive
                </span>
              )}
            </div>
            {athlete.weight_class && (
              <span className="text-[10px] text-gray-400">{athlete.weight_class}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onEdit}
            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title="Edit"
          >
            <Edit2 size={13} />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded transition-colors ml-1"
          >
            <XIcon size={14} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="grid grid-cols-2 gap-y-2.5 gap-x-4">
          <StatRow label="Age" value={athlete.birthdate ? `${calculateAge(athlete.birthdate)} yrs` : '—'} />
          <StatRow label="Bodyweight" value={athlete.bodyweight ? `${athlete.bodyweight} kg` : '—'} />
          <StatRow label="Weight class" value={athlete.weight_class ?? '—'} />
          <StatRow label="Comp total" value={athlete.competition_total ? `${athlete.competition_total} kg` : '—'} />
          {athlete.club && (
            <div className="col-span-2">
              <StatRow label="Club" value={athlete.club} icon={<MapPin size={10} className="text-gray-400" />} />
            </div>
          )}
          <StatRow label="Track BW" value={athlete.track_bodyweight ? 'Yes' : 'No'} />
        </div>
      </div>

      {/* Notes */}
      {athlete.notes && (
        <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Notes</div>
          <p className="text-xs text-gray-600 leading-relaxed">{athlete.notes}</p>
        </div>
      )}

      {/* PRs button */}
      <div className="px-4 py-3 flex-shrink-0">
        <button
          onClick={onPRs}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-green-700 border border-green-200 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
        >
          <Trophy size={13} />
          Manage Personal Records
        </button>
      </div>
    </div>
  );
}

function StatRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="flex items-center gap-1 text-xs text-gray-700 font-medium mt-0.5">
        {icon}
        {value}
      </div>
    </div>
  );
}

// ── Athletes ────────────────────────────────────────────────────────

export function Athletes() {
  const { athletes, loading, error, fetchAthletes, createAthlete, updateAthlete, deleteAthlete } = useAthletes();

  const [searchQuery, setSearchQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingAthlete, setEditingAthlete] = useState<Athlete | null>(null);
  const [showPRsFor, setShowPRsFor] = useState<Athlete | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => { fetchAthletes(); }, []);

  const handleSave = async (data: Partial<Athlete>) => {
    setIsSubmitting(true);
    try {
      if (editingAthlete) {
        await updateAthlete(editingAthlete.id, data);
      } else {
        const newAthlete = await createAthlete(data);
        if (newAthlete && data.bodyweight) {
          await supabase.from('bodyweight_entries').upsert({
            athlete_id: newAthlete.id,
            date: new Date().toISOString().split('T')[0],
            weight_kg: data.bodyweight,
          }, { onConflict: 'athlete_id,date' });
        }
      }
      setShowModal(false);
      setEditingAthlete(null);
      await fetchAthletes();
    } catch {
      // error already set in hook
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (athlete: Athlete) => {
    if (!window.confirm(`Delete ${athlete.name}? This will also remove all their PRs and week plans.`)) return;
    try {
      await deleteAthlete(athlete.id);
      if (selectedAthleteId === athlete.id) setSelectedAthleteId(null);
      await fetchAthletes();
    } catch {
      // error already set in hook
    }
  };

  const openEdit = (athlete: Athlete) => {
    setEditingAthlete(athlete);
    setShowModal(true);
  };

  const openCreate = () => {
    setEditingAthlete(null);
    setShowModal(true);
  };

  // Filtered + sorted
  const filtered = athletes
    .filter(a => showInactive || a.is_active)
    .filter(a => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        a.name.toLowerCase().includes(q) ||
        (a.club?.toLowerCase() ?? '').includes(q) ||
        (a.weight_class?.toLowerCase() ?? '').includes(q)
      );
    });

  const selectedAthlete = athletes.find(a => a.id === selectedAthleteId) ?? null;

  // PRs full view
  if (showPRsFor) {
    return (
      <AthletePRs
        athlete={showPRsFor}
        onClose={() => setShowPRsFor(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search athletes…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <XIcon size={12} />
            </button>
          )}
        </div>

        <button
          onClick={() => setShowInactive(v => !v)}
          className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
            showInactive
              ? 'bg-gray-800 text-white border-gray-800'
              : 'text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
        >
          {showInactive ? 'All' : 'Active'}
        </button>

        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={14} /> Add athlete
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex-shrink-0">
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Athlete list */}
        <div className="flex-1 overflow-y-auto">
          <AthleteListHeader />

          {loading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-gray-400 text-sm">
              <div className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <User size={28} className="text-gray-300" />
              <p className="text-sm text-gray-400">
                {searchQuery ? `No athletes match "${searchQuery}"` : 'No athletes yet. Click "Add athlete" to get started.'}
              </p>
            </div>
          ) : (
            filtered.map((athlete, idx) => (
              <AthleteRow
                key={athlete.id}
                athlete={athlete}
                isSelected={selectedAthleteId === athlete.id}
                rowIndex={idx}
                onClick={() => setSelectedAthleteId(athlete.id === selectedAthleteId ? null : athlete.id)}
                onEdit={() => openEdit(athlete)}
                onPRs={() => setShowPRsFor(athlete)}
                onDelete={() => handleDelete(athlete)}
              />
            ))
          )}
        </div>

        {/* Detail panel */}
        {selectedAthlete && (
          <div className="w-[320px] flex-shrink-0 border-l border-gray-200 overflow-y-auto bg-white">
            <AthleteDetailPanel
              athlete={selectedAthlete}
              onClose={() => setSelectedAthleteId(null)}
              onEdit={() => openEdit(selectedAthlete)}
              onPRs={() => setShowPRsFor(selectedAthlete)}
              onDelete={() => handleDelete(selectedAthlete)}
            />
          </div>
        )}
      </div>

      {/* Create / edit modal */}
      {showModal && (
        <AthleteFormModal
          editingAthlete={editingAthlete}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingAthlete(null); }}
          isSubmitting={isSubmitting}
        />
      )}
    </div>
  );
}
