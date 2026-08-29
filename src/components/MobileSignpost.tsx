/**
 * MobileSignpost — tells a coach on a phone that /coach exists.
 *
 * The desktop coach app is deliberately not responsive: the planner and the
 * macro table are wide, dense, expert surfaces, and /coach is the mobile
 * surface built for the gym. The gap was never layout — it was signposting.
 * A coach who opened their EMOS bookmark on a phone got the 1400px desktop
 * app and no hint that a phone version existed.
 *
 * So this is one dismissible line, not a redirect: the coach may genuinely
 * want the desktop app on a tablet, and deciding that for them would be worse
 * than the problem it solves.
 */
import { useEffect, useState } from 'react';
import { Smartphone, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const DISMISSED_KEY = 'emos_mobile_signpost_dismissed';
const NARROW = '(max-width: 700px)';

export function MobileSignpost() {
  const navigate = useNavigate();
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === '1',
  );

  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  if (!narrow || dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  };

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
      style={{
        backgroundColor: 'var(--color-accent-muted)',
        borderBottom: '0.5px solid var(--color-accent-border)',
        fontSize: 'var(--text-label)',
        color: 'var(--color-text-primary)',
      }}
    >
      <Smartphone size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} aria-hidden />
      <span className="flex-1 min-w-0">
        There&rsquo;s a version of EMOS built for your phone.{' '}
        <button
          type="button"
          onClick={() => navigate('/coach')}
          className="underline underline-offset-2 tap-y"
          style={{ color: 'var(--color-accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
        >
          Open it
        </button>
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="tap flex items-center justify-center"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', flexShrink: 0 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
