import { useNavigate } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import type { MacroCompetition } from '../../lib/database.types';
import { formatDateShort } from '../../lib/dateUtils';

interface MacroCompetitionBadgeProps {
  competition: MacroCompetition;
}

export function MacroCompetitionBadge({ competition }: MacroCompetitionBadgeProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (competition.event_id) {
      navigate('/events');
    }
  };

  const base = competition.is_primary
    ? 'bg-red-100 border-red-300 text-red-800'
    : 'bg-orange-50 border-orange-200 text-orange-700';

  return (
    <span
      onClick={handleClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium border rounded-full ${base} ${
        competition.event_id ? 'cursor-pointer hover:opacity-80' : ''
      }`}
      title={competition.is_primary ? 'Primary competition' : 'Competition'}
    >
      <Trophy size={10} />
      {competition.competition_name} — {formatDateShort(competition.competition_date)}
    </span>
  );
}
