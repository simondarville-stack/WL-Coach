import { useState, useEffect } from 'react';
import type { Athlete } from '../lib/database.types';
import { User, Edit2, Trash2, Award } from 'lucide-react';
import { AthletePRs } from './AthletePRs';
import { formatDateToDDMMYYYY, parseDDMMYYYYToISO } from '../lib/dateUtils';
import { calculateAge } from '../lib/calculations';
import { useAthletes } from '../hooks/useAthletes';
import { supabase } from '../lib/supabase';

export function Athletes() {
  const { athletes, loading, error, setError, fetchAthletes, createAthlete, updateAthlete, deleteAthlete } = useAthletes();

  const [editingAthlete, setEditingAthlete] = useState<Athlete | null>(null);
  const [selectedAthleteForPRs, setSelectedAthleteForPRs] = useState<Athlete | null>(null);

  const [name, setName] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [birthdateDisplay, setBirthdateDisplay] = useState('');
  const [bodyweight, setBodyweight] = useState('');
  const [weightClass, setWeightClass] = useState('');
  const [club, setClub] = useState('');
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [trackBodyweight, setTrackBodyweight] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchAthletes();
  }, []);

  useEffect(() => {
    if (editingAthlete) {
      setName(editingAthlete.name);
      setBirthdate(editingAthlete.birthdate || '');
      setBirthdateDisplay(formatDateToDDMMYYYY(editingAthlete.birthdate || ''));
      setBodyweight(editingAthlete.bodyweight?.toString() || '');
      setWeightClass(editingAthlete.weight_class || '');
      setClub(editingAthlete.club || '');
      setNotes(editingAthlete.notes || '');
      setPhotoUrl(editingAthlete.photo_url || '');
      setIsActive(editingAthlete.is_active);
      setTrackBodyweight(editingAthlete.track_bodyweight ?? true);
    } else {
      resetForm();
    }
  }, [editingAthlete]);

  const resetForm = () => {
    setName('');
    setBirthdate('');
    setBirthdateDisplay('');
    setBodyweight('');
    setWeightClass('');
    setClub('');
    setNotes('');
    setPhotoUrl('');
    setIsActive(true);
    setTrackBodyweight(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      const athleteData = {
        name: name.trim(),
        birthdate: birthdate || null,
        bodyweight: bodyweight ? parseFloat(bodyweight) : null,
        weight_class: weightClass.trim() || null,
        club: club.trim() || null,
        notes: notes.trim() || null,
        photo_url: photoUrl.trim() || null,
        is_active: isActive,
        track_bodyweight: trackBodyweight,
      };

      if (editingAthlete) {
        await updateAthlete(editingAthlete.id, athleteData);
        setEditingAthlete(null);
      } else {
        const newAthlete = await createAthlete(athleteData);
        if (newAthlete && bodyweight) {
          await supabase.from('bodyweight_entries').upsert({
            athlete_id: newAthlete.id,
            date: new Date().toISOString().split('T')[0],
            weight_kg: parseFloat(bodyweight),
          }, { onConflict: 'athlete_id,date' });
        }
      }

      resetForm();
      await fetchAthletes();
    } catch {
      // error already set in hook
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (athlete: Athlete) => {
    if (!window.confirm(`Are you sure you want to delete ${athlete.name}? This will also delete all their PRs and week plans.`)) {
      return;
    }
    try {
      await deleteAthlete(athlete.id);
      await fetchAthletes();
    } catch {
      // error already set in hook
    }
  };

  const handleCancelEdit = () => {
    setEditingAthlete(null);
    resetForm();
  };

  if (selectedAthleteForPRs) {
    return (
      <AthletePRs
        athlete={selectedAthleteForPRs}
        onClose={() => setSelectedAthleteForPRs(null)}
      />
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-4">
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-medium text-gray-900 mb-5">
            {editingAthlete ? 'Edit Athlete' : 'Add New Athlete'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Name *
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Full name"
                required
              />
            </div>

            <div>
              <label htmlFor="birthdate" className="block text-sm font-medium text-gray-700 mb-1">
                Birthdate (dd/mm/yyyy)
              </label>
              <input
                type="text"
                id="birthdate"
                value={birthdateDisplay}
                onChange={(e) => {
                  const input = e.target.value;
                  setBirthdateDisplay(input);
                  if (input.length === 10) {
                    const isoDate = parseDDMMYYYYToISO(input);
                    if (isoDate) setBirthdate(isoDate);
                  } else if (input === '') {
                    setBirthdate('');
                  }
                }}
                onBlur={(e) => {
                  const input = e.target.value;
                  if (input.length === 10) {
                    const isoDate = parseDDMMYYYYToISO(input);
                    if (isoDate) setBirthdate(isoDate);
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="dd/mm/yyyy"
                maxLength={10}
              />
              {birthdate && (
                <p className="mt-1 text-sm text-gray-600">
                  Age: {calculateAge(birthdate)} years
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="bodyweight" className="block text-sm font-medium text-gray-700 mb-1">
                  Bodyweight (kg)
                </label>
                <input
                  type="number"
                  id="bodyweight"
                  value={bodyweight}
                  onChange={(e) => setBodyweight(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., 73.5"
                  step="0.1"
                />
              </div>

              <div>
                <label htmlFor="weightClass" className="block text-sm font-medium text-gray-700 mb-1">
                  Weight Class
                </label>
                <input
                  type="text"
                  id="weightClass"
                  value={weightClass}
                  onChange={(e) => setWeightClass(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., 73kg"
                />
              </div>
            </div>

            <div>
              <label htmlFor="club" className="block text-sm font-medium text-gray-700 mb-1">
                Club/Team
              </label>
              <input
                type="text"
                id="club"
                value={club}
                onChange={(e) => setClub(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., City Weightlifting Club"
              />
            </div>

            <div>
              <label htmlFor="photoUrl" className="block text-sm font-medium text-gray-700 mb-1">
                Photo URL
              </label>
              <input
                type="url"
                id="photoUrl"
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://example.com/photo.jpg"
              />
              {photoUrl && (
                <div className="mt-2">
                  <img
                    src={photoUrl}
                    alt="Athlete preview"
                    className="w-20 h-20 rounded-full object-cover border-2 border-gray-300"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                </div>
              )}
            </div>

            <div>
              <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="Additional notes..."
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="isActive" className="text-sm font-medium text-gray-700">
                Active athlete
              </label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="trackBodyweight"
                checked={trackBodyweight}
                onChange={(e) => setTrackBodyweight(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="trackBodyweight" className="text-sm font-medium text-gray-700">
                Track bodyweight
              </label>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="submit"
                disabled={isSubmitting || !name.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {editingAthlete ? 'Update Athlete' : 'Create Athlete'}
              </button>

              {editingAthlete && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-medium text-gray-900 mb-5">Athletes</h2>

          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-gray-400">
              <div className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
              Loading...
            </div>
          ) : athletes.length === 0 ? (
            <div className="text-center py-12">
              <User size={32} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No athletes yet. Fill in the form to add your first.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {athletes.map((athlete) => (
                <div
                  key={athlete.id}
                  className={`border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors ${
                    !athlete.is_active ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-700 flex-shrink-0 mt-0.5">
                        {athlete.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-medium text-gray-900">{athlete.name}</h3>
                        {!athlete.is_active && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-gray-200 text-gray-600 rounded">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                        {athlete.birthdate && (
                          <span>Age {calculateAge(athlete.birthdate)}</span>
                        )}
                        {athlete.bodyweight && (
                          <span>BW {athlete.bodyweight}kg</span>
                        )}
                        {athlete.weight_class && (
                          <span>WC {athlete.weight_class}</span>
                        )}
                        {athlete.club && (
                          <span>{athlete.club}</span>
                        )}
                      </div>
                      {athlete.notes && (
                        <p className="mt-1 text-xs text-gray-400 italic">{athlete.notes}</p>
                      )}
                      </div>
                    </div>
                    <div className="flex gap-1 ml-2">
                      <button
                        onClick={() => setSelectedAthleteForPRs(athlete)}
                        className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                        title="Manage PRs"
                      >
                        <Award size={15} />
                      </button>
                      <button
                        onClick={() => setEditingAthlete(athlete)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="Edit athlete"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(athlete)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                        title="Delete athlete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
