/**
 * SharedWithYou — lifts colleagues have handed this coach, on the library.
 *
 * Coaches have no thread of their own, so a club share (design §9's second
 * target) lands where a coach goes to look at lifts: a strip above the
 * video library, newest first, each row the picture, the lift, the numbers,
 * who sent it and what they said, and a way into the viewer on that rep.
 * Opening one stamps it seen. Nothing here when nothing was shared, and
 * nothing here when the shares table is not yet there — the library is not
 * the place to explain a migration.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Button } from '../../components/ui';
import { formatDateShort, formatDateTimeShort } from '../../lib/dateUtils';
import { kinemosObjectUrl } from '../lib/kinemosStorage';
import { fetchSharesForCoach, markShareSeenByCoach, type SharedWithCoach } from '../lib/shareService';
import { num } from '../lib/viewerFormat';

export function SharedWithYou({
  coachId,
  coachNames,
}: {
  coachId: string | null;
  /** id → name, for "from Anna". */
  coachNames: Map<string, string>;
}) {
  const navigate = useNavigate();
  const [shares, setShares] = useState<SharedWithCoach[]>([]);
  useEffect(() => {
    let alive = true;
    setShares([]);
    if (!coachId) return;
    fetchSharesForCoach(coachId)
      .then(s => {
        if (alive) setShares(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [coachId]);

  if (shares.length === 0) return null;

  const open = (share: SharedWithCoach) => {
    if (share.coach_read_at == null) {
      setShares(current => current.map(s => (s.id === share.id ? { ...s, coach_read_at: new Date().toISOString() } : s)));
      markShareSeenByCoach(share.id).catch(() => undefined);
    }
    if (share.analysis) {
      navigate(`/kinemos/analysis/${share.analysis.source_kind}/${share.analysis.source_id}?rep=${share.analysis.rep_index}`);
    }
  };

  return (
    <section
      style={{
        border: '1px solid var(--color-border-secondary)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-sm) var(--space-md)',
        marginBottom: 'var(--space-md)',
        background: 'var(--color-bg-primary)',
      }}
    >
      <div style={{ fontSize: 'var(--text-micro)', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-xs)' }}>
        SHARED WITH YOU
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-xs)' }}>
        {shares.map(share => {
          const s = share.summary;
          const what = [s.athleteName, s.exerciseName, s.loadKg !== null ? `${num(s.loadKg, Number.isInteger(s.loadKg) ? 0 : 1)} kg` : null, s.date ? formatDateShort(s.date) : null, s.repIndex > 1 ? `rep ${s.repIndex}` : null]
            .filter(Boolean)
            .join(' · ');
          const numbers = [
            s.vmaxMs !== null ? `Vmax ${num(s.vmaxMs, 2)} m/s` : null,
            s.peakHeightCm !== null ? `${num(s.peakHeightCm, 0)} cm` : null,
            s.grade ? `grade ${s.grade}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const from = share.sender_coach_id ? (coachNames.get(share.sender_coach_id) ?? 'a colleague') : 'a colleague';
          return (
            <li
              key={share.id}
              style={{
                display: 'flex',
                gap: 'var(--space-sm)',
                alignItems: 'center',
                fontSize: 'var(--text-caption)',
                fontWeight: share.coach_read_at ? 400 : 600,
              }}
            >
              {share.asset_key && (
                <img
                  src={kinemosObjectUrl(share.asset_key)}
                  alt={what}
                  loading="lazy"
                  style={{ width: 56, height: 40, objectFit: 'cover', borderRadius: 'var(--radius-sm)', background: '#000', flexShrink: 0 }}
                />
              )}
              <span style={{ flexGrow: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--color-text-primary)' }}>{what}</span>
                {numbers && <span style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}>{` — ${numbers}`}</span>}
                <span style={{ display: 'block', color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
                  {`from ${from}, ${formatDateTimeShort(new Date(share.created_at))}`}
                  {share.note ? ` — “${share.note}”` : ''}
                </span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => open(share)} disabled={!share.analysis} title="Open this rep in the viewer">
                <ExternalLink size={12} />
                Open
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
