import { useState, useRef, useEffect } from 'react';
import { ChevronDown, User } from 'lucide-react';
import { useAthleteStore } from '../store/athleteStore';

export function AthleteSelector() {
  const { athletes, selectedAthlete, setSelectedAthlete } = useAthleteStore();
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

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-md hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors min-w-[200px]"
      >
        {selectedAthlete ? (
          <>
            {selectedAthlete.photo_url ? (
              <img
                src={selectedAthlete.photo_url}
                alt={selectedAthlete.name}
                className="w-6 h-6 rounded-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              <User size={20} className="text-gray-600" />
            )}
            <span className="flex-1 text-left font-medium text-gray-900">{selectedAthlete.name}</span>
          </>
        ) : (
          <>
            <User size={20} className="text-gray-600" />
            <span className="flex-1 text-left text-gray-600">Select Athlete</span>
          </>
        )}
        <ChevronDown size={18} className={`text-gray-600 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 left-0 right-0 bg-white border border-gray-300 rounded-md shadow-lg z-50 max-h-[400px] overflow-y-auto">
          {activeAthletes.length === 0 ? (
            <div className="p-4 text-center text-gray-500">No athletes available</div>
          ) : (
            <div className="p-2">
              {selectedAthlete && (
                <button
                  onClick={() => {
                    setSelectedAthlete(null);
                    setIsOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-gray-600 hover:bg-gray-100 rounded-md mb-2 border border-gray-200"
                >
                  Clear Selection
                </button>
              )}
              {activeAthletes.map((athlete) => (
                <button
                  key={athlete.id}
                  onClick={() => {
                    setSelectedAthlete(athlete);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 p-3 rounded-md transition-colors ${
                    selectedAthlete?.id === athlete.id
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
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
