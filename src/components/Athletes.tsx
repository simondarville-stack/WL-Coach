import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Athlete } from '../lib/database.types';
import { User, Edit2, Trash2, Award } from 'lucide-react';
import { AthletePRs } from './AthletePRs';
import { formatDateToDDMMYYYY, parseDDMMYYYYToISO } from '../lib/dateUtils';

function calculateAge(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const today = new Date();
  const birth = new Date(birthdate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export function Athletes() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadAthletes();
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
    } else {
      resetForm();
    }
  }, [editingAthlete]);

  const loadAthletes = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('athletes')
        .select('*')
        .order('is_active', { ascending: false })
        .order('name');

      if (error) throw error;
      setAthletes(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load athletes');
    } finally {
      setLoading(false);
    }
  };

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
      };

      if (editingAthlete) {
        const { error } = await supabase
          .from('athletes')
          .update(athleteData)
          .eq('id', editingAthlete.id);

        if (error) throw error;
        setEditingAthlete(null);
      } else {
        const { error } = await supabase
          .from('athletes')
          .insert([athleteData]);

        if (error) throw error;
      }

      resetForm();
      await loadAthletes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save athlete');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (athlete: Athlete) => {
    setEditingAthlete(athlete);
  };

  const handleDelete = async (athlete: Athlete) => {
    if (!window.confirm(`Are you sure you want to delete ${athlete.name}? This will also delete all their PRs and week plans.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('athletes')
        .delete()
        .eq('id', athlete.id);

      if (error) throw error;
      await loadAthletes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete athlete');
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">
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
                    if (isoDate) {
                      setBirthdate(isoDate);
                    }
                  } else if (input === '') {
                    setBirthdate('');
                  }
                }}
                onBlur={(e) => {
                  const input = e.target.value;
                  if (input.length === 10) {
                    const isoDate = parseDDMMYYYYToISO(input);
                    if (isoDate) {
                      setBirthdate(isoDate);
                    }
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
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
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

        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">Athletes</h2>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-gray-500">Loading athletes...</div>
            </div>
          ) : athletes.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 text-lg">No athletes yet. Add your first athlete to get started.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {athletes.map((athlete) => (
                <div
                  key={athlete.id}
                  className={`border rounded-lg p-4 hover:shadow-md transition-shadow ${
                    athlete.is_active ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <User className="text-blue-600" size={20} />
                        <h3 className="text-lg font-semibold text-gray-900">{athlete.name}</h3>
                        {!athlete.is_active && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-gray-200 text-gray-600 rounded">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                        {athlete.birthdate && (
                          <div>
                            <span className="font-medium">Age:</span> {calculateAge(athlete.birthdate)}
                          </div>
                        )}
                        {athlete.bodyweight && (
                          <div>
                            <span className="font-medium">BW:</span> {athlete.bodyweight}kg
                          </div>
                        )}
                        {athlete.weight_class && (
                          <div>
                            <span className="font-medium">WC:</span> {athlete.weight_class}
                          </div>
                        )}
                        {athlete.club && (
                          <div>
                            <span className="font-medium">Club:</span> {athlete.club}
                          </div>
                        )}
                      </div>
                      {athlete.notes && (
                        <p className="mt-2 text-sm text-gray-600 italic">{athlete.notes}</p>
                      )}
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => setSelectedAthleteForPRs(athlete)}
                        className="p-2 text-green-600 hover:bg-green-50 rounded-md transition-colors"
                        title="Manage PRs"
                      >
                        <Award size={18} />
                      </button>
                      <button
                        onClick={() => handleEdit(athlete)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                        title="Edit athlete"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(athlete)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                        title="Delete athlete"
                      >
                        <Trash2 size={18} />
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
