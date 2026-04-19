import { useState, useRef, useEffect } from 'react';
import { ChevronDown, User, Users } from 'lucide-react';
import { useAthleteStore } from '../store/athleteStore';

export function AthleteSelector() {
  const {
    athletes, selectedAthlete, setSelectedAthlete,
    groups, selectedGroup, setSelectedGroup,
  } = useAthleteStore();

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
  const hasSelection = !!selectedAthlete || !!selectedGroup;

  const displayText = selectedAthlete?.name ?? selectedGroup?.name ?? 'Select athlete / group';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-300 rounded-md hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors min-w-[180px]"
      >
        {selectedGroup ? (
          <Users size={16} className="text-blue-600 flex-shrink-0" />
        ) : selectedAthlete?.photo_url ? (
          <img
            src={selectedAthlete.photo_url}
            alt={selectedAthlete.name}
            className="w-5 h-5 rounded-full object-cover flex-shrink-0"
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <User size={16} className="text-gray-500 flex-shrink-0" />
        )}
        <span className={`flex-1 text-left text-sm font-medium ${hasSelection ? 'text-gray-900' : 'text-gray-500'}`}>
          {displayText}
        </span>
        {selectedGroup && (
          <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium flex-shrink-0">Group</span>
        )}
        <ChevronDown size={14} className={`text-gray-500 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-1 right-0 rounded-lg z-50 w-64 max-h-[480px] overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)' }}>
          {hasSelection && (
            <div className="p-2 border-b border-gray-100">
              <button
                onClick={() => { setSelectedAthlete(null); setSelectedGroup(null); setIsOpen(false); }}
                className="w-full px-3 py-1.5 text-left text-sm text-gray-500 hover:bg-gray-50 rounded-md"
              >
                Clear selection
              </button>
            </div>
          )}

          {groups.length > 0 && (
            <div className="p-2 border-b border-gray-100">
              <p className="px-2 py-1 text-[10px] font-medium text-gray-400 uppercase tracking-wide">Training groups</p>
              {groups.map(group => (
                <button
                  key={group.id}
                  onClick={() => { setSelectedGroup(group); setIsOpen(false); }}
                  className={[
                    'w-full flex items-center gap-2.5 px-2 py-2 rounded-md transition-colors text-left',
                    selectedGroup?.id === group.id
                      ? 'bg-blue-50 border border-blue-200'
                      : 'hover:bg-gray-50 border border-transparent',
                  ].join(' ')}
                >
                  <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Users size={14} className="text-blue-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{group.name}</p>
                    {group.description && (
                      <p className="text-xs text-gray-500 truncate">{group.description}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="p-2">
            <p className="px-2 py-1 text-[10px] font-medium text-gray-400 uppercase tracking-wide">Individual athletes</p>
            {activeAthletes.length === 0 ? (
              <p className="px-2 py-3 text-sm text-gray-400 text-center">No athletes available</p>
            ) : (
              activeAthletes.map(athlete => (
                <button
                  key={athlete.id}
                  onClick={() => { setSelectedAthlete(athlete); setIsOpen(false); }}
                  className={[
                    'w-full flex items-center gap-2.5 px-2 py-2 rounded-md transition-colors text-left',
                    selectedAthlete?.id === athlete.id
                      ? 'bg-blue-50 border border-blue-200'
                      : 'hover:bg-gray-50 border border-transparent',
                  ].join(' ')}
                >
                  {athlete.photo_url ? (
                    <img
                      src={athlete.photo_url}
                      alt={athlete.name}
                      className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                      onError={e => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                      <User size={14} className="text-gray-500" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{athlete.name}</p>
                    {(athlete.weight_class || athlete.club) && (
                      <p className="text-xs text-gray-500 truncate">
                        {[athlete.weight_class, athlete.club].filter(Boolean).join(' · ')}
                      </p>
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
