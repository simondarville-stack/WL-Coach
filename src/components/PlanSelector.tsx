import { useState, useRef, useEffect } from 'react';
import type { Athlete, TrainingGroup } from '../lib/database.types';
import { ChevronDown, User, Users } from 'lucide-react';

export type PlanType = 'individual' | 'group';

export interface PlanSelection {
  type: PlanType;
  athlete: Athlete | null;
  group: TrainingGroup | null;
}

interface PlanSelectorProps {
  athletes: Athlete[];
  groups: TrainingGroup[];
  selection: PlanSelection;
  onSelect: (selection: PlanSelection) => void;
}

export function PlanSelector({ athletes, groups, selection, onSelect }: PlanSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeAthletes = athletes.filter(a => a.is_active);

  const getDisplayText = () => {
    if (selection.type === 'individual' && selection.athlete) {
      return selection.athlete.name;
    }
    if (selection.type === 'group' && selection.group) {
      return selection.group.name;
    }
    return 'Select Plan';
  };

  const getDisplayIcon = () => {
    if (selection.type === 'individual' && selection.athlete) {
      if (selection.athlete.photo_url) {
        return (
          <img
            src={selection.athlete.photo_url}
            alt={selection.athlete.name}
            className="w-6 h-6 rounded-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        );
      }
      return <User size={20} className="text-gray-600" />;
    }
    if (selection.type === 'group' && selection.group) {
      return <Users size={20} className="text-blue-600" />;
    }
    return <User size={20} className="text-gray-600" />;
  };

  const handleSelectAthlete = (athlete: Athlete) => {
    onSelect({ type: 'individual', athlete, group: null });
    setIsOpen(false);
  };

  const handleSelectGroup = (group: TrainingGroup) => {
    onSelect({ type: 'group', athlete: null, group });
    setIsOpen(false);
  };

  const handleClear = () => {
    onSelect({ type: 'individual', athlete: null, group: null });
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-md hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors min-w-[200px]"
      >
        {getDisplayIcon()}
        <span className={`flex-1 text-left font-medium ${selection.athlete || selection.group ? 'text-gray-900' : 'text-gray-600'}`}>
          {getDisplayText()}
        </span>
        {selection.type === 'group' && selection.group && (
          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded">
            Group
          </span>
        )}
        <ChevronDown size={18} className={`text-gray-600 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 left-0 right-0 bg-white border border-gray-300 rounded-md shadow-lg z-50 max-h-[500px] overflow-y-auto">
          {(selection.athlete || selection.group) && (
            <div className="p-2 border-b border-gray-200">
              <button
                onClick={handleClear}
                className="w-full px-3 py-2 text-left text-gray-600 hover:bg-gray-100 rounded-md"
              >
                Clear Selection
              </button>
            </div>
          )}

          {groups.length > 0 && (
            <div className="p-2 border-b border-gray-200">
              <div className="px-2 py-1 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Group Plans
              </div>
              {groups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => handleSelectGroup(group)}
                  className={`w-full flex items-center gap-3 p-3 rounded-md transition-colors ${
                    selection.type === 'group' && selection.group?.id === group.id
                      ? 'bg-blue-50 border border-blue-200'
                      : 'hover:bg-gray-50 border border-transparent'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Users size={20} className="text-blue-600" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium text-gray-900">{group.name}</div>
                    {group.description && (
                      <div className="text-xs text-gray-600 truncate">{group.description}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="p-2">
            <div className="px-2 py-1 text-xs font-medium text-gray-500 uppercase tracking-wide">
              Individual Plans
            </div>
            {activeAthletes.length === 0 ? (
              <div className="p-4 text-center text-gray-500">No athletes available</div>
            ) : (
              activeAthletes.map((athlete) => (
                <button
                  key={athlete.id}
                  onClick={() => handleSelectAthlete(athlete)}
                  className={`w-full flex items-center gap-3 p-3 rounded-md transition-colors ${
                    selection.type === 'individual' && selection.athlete?.id === athlete.id
                      ? 'bg-blue-50 border border-blue-200'
                      : 'hover:bg-gray-50 border border-transparent'
                  }`}
                >
                  {athlete.photo_url ? (
                    <img
                      src={athlete.photo_url}
                      alt={athlete.name}
                      className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                      <User size={20} className="text-gray-500" />
                    </div>
                  )}
                  <div className="flex-1 text-left">
                    <div className="font-medium text-gray-900">{athlete.name}</div>
                    {(athlete.weight_class || athlete.club) && (
                      <div className="text-xs text-gray-600">
                        {[athlete.weight_class, athlete.club].filter(Boolean).join(' • ')}
                      </div>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
