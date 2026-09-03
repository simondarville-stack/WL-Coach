/**
 * KinemosLibrary — the KinEMOS entry point and P0's whole deliverable.
 *
 * One dense table containing every lift video in EMOS, wherever it actually
 * lives: athlete/coach log clips, competition attempts, and footage imported
 * straight into KinEMOS. See `lib/videoLibrary.ts` for why this is a union
 * rather than a fourth copy of the other two.
 *
 * P0 ends here on purpose. The viewer, calibration and tracking arrive in P1
 * and P2 (docs/KINEMOS_DESIGN.md §12) — but an organised, trimmed, filterable
 * library is worth having on its own, and it is the thing every later phase
 * reads from.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Ruler, Trash2, Wand2, X } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  Spinner,
  StandardPage,
  confirmDialog,
  type DataTableColumn,
} from '../components/ui';
import { useAthletes } from '../hooks/useAthletes';
import { useExercises } from '../hooks/useExercises';
import { formatDateShort } from '../lib/dateUtils';
import { ClipPlayerModal } from './components/ClipPlayerModal';
import { ImportControl } from './components/ImportControl';
import { deleteDirectVideo } from './lib/directImport';
import { loadLibrary, type LibraryFilters, type LibrarySource, type LibraryVideo } from './lib/videoLibrary';
import { SharedWithYou } from './components/SharedWithYou';
import { TrainingDataPanel } from './components/TrainingDataPanel';
import { useCoachStore } from '../store/coachStore';
import { getOwnerId } from '../lib/ownerContext';
import { openFrameServer } from './engine/frameServer';
import { autoAnalyse, describeAutoAnalysis } from './lib/autoAnalyse';

const SOURCE_LABEL: Record<LibrarySource, string> = {
  log: 'Log',
  event: 'Competition',
  direct: 'Import',
};

/** Loads are logged in kg and shown with comma decimals (German locale
 *  convention, CLAUDE.md "Stack"). Whole numbers keep no decimal at all —
 *  "100" reads better than "100,0" down a dense column. */
function formatLoad(kg: number): string {
  return (Number.isInteger(kg) ? String(kg) : kg.toFixed(1)).replace('.', ',');
}

function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function KinemosLibrary() {
  // `?clip=<key>` arrives from the Review feed's "KinEMOS" action — one clip
  // pulled out of the reel for a closer look. P1 will send it to the analysis
  // viewer instead; until that exists, focusing the library row is the honest
  // version of the same gesture.
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const focusedKey = searchParams.get('clip');

  const { athletes, fetchAthletes } = useAthletes();
  const { exercises, fetchExercises } = useExercises();
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? null);
  const coaches = useCoachStore(s => s.coaches);
  const coachNames = useMemo(() => new Map(coaches.map(c => [c.id, c.name])), [coaches]);

  const [rows, setRows] = useState<LibraryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<LibraryVideo | null>(null);

  const [autoBusy, setAutoBusy] = useState<string | null>(null);
  const [autoNote, setAutoNote] = useState<string | null>(null);

  const [athleteId, setAthleteId] = useState('');
  const [source, setSource] = useState<'' | LibrarySource>('');
  const [exerciseName, setExerciseName] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Read everything once and filter in memory: the filter set is small,
      // the data is a season of footage, and re-querying three sources on
      // every dropdown change would be slower than it looks.
      setRows(await loadLibrary());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the video library.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Mount-only: the store fetchers are re-created every render, so listing
  // them as dependencies would re-fetch forever. Same pattern as Athletes.tsx.
  useEffect(() => {
    void refresh();
    void fetchAthletes();
    void fetchExercises();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filters = useMemo<LibraryFilters>(
    () => ({
      athleteId: athleteId === 'none' ? null : athleteId || null,
      unattachedOnly: athleteId === 'none',
      source: source || null,
      exerciseName: exerciseName || null,
    }),
    [athleteId, source, exerciseName],
  );

  const visible = useMemo(() => {
    // A focused clip overrides the filter bar rather than intersecting with
    // it: arriving from the Review feed and landing on an empty table because
    // a filter was still set would read as a broken link.
    if (focusedKey) return rows.filter(item => item.key === focusedKey);
    return rows.filter(item => {
      if (filters.source && item.source !== filters.source) return false;
      if (filters.unattachedOnly && item.athleteId) return false;
      if (filters.athleteId && item.athleteId !== filters.athleteId) return false;
      if (filters.exerciseName && item.exerciseName !== filters.exerciseName) return false;
      return true;
    });
  }, [rows, filters, focusedKey]);

  /** Exercise names actually present in the library, so the filter can never
   *  offer a name that would empty the table. */
  const exerciseNames = useMemo(
    () => [...new Set(rows.map(r => r.exerciseName).filter((n): n is string => !!n))].sort(),
    [rows],
  );

  /**
   * Analyse a clip with no clicks at all. The whole pipeline runs in the
   * browser, so this opens the clip's frame server, does the work and closes
   * it again — the coach stays on the library and gets a sentence saying
   * what happened.
   */
  const runAuto = useCallback(async (row: LibraryVideo) => {
    setAutoBusy(row.key);
    setAutoNote(`Opening ${row.athleteName ?? 'the clip'}…`);
    let server: Awaited<ReturnType<typeof openFrameServer>> | null = null;
    try {
      server = await openFrameServer(row.playbackUrl);
      const result = await autoAnalyse(server, {
        source: row.source,
        sourceId: row.sourceId,
        ownerId: getOwnerId(),
        massKg: row.loadKg,
        massSource: row.loadKg == null ? null : 'logged',
        onProgress: (stage, done, total) =>
          setAutoNote(total > 1 ? `${stage} — ${done} of ${total}` : `${stage}…`),
      });
      setAutoNote(describeAutoAnalysis(result, [row.athleteName, row.exerciseName].filter(Boolean).join(' · ') || 'Clip'));
    } catch (e) {
      setAutoNote(e instanceof Error ? e.message : 'That clip could not be analysed.');
    } finally {
      server?.close();
      setAutoBusy(null);
    }
  }, []);

  const handleDelete = async (video: LibraryVideo) => {
    const ok = await confirmDialog({
      title: 'Delete this import?',
      message: 'The video file and its row are removed. This cannot be undone.',
      confirmLabel: 'Delete import',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDirectVideo(video.sourceId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  const columns: DataTableColumn<LibraryVideo>[] = [
    {
      key: 'thumb',
      header: '',
      width: '64px',
      render: row =>
        row.thumbnailUrl ? (
          <img
            src={row.thumbnailUrl}
            alt=""
            loading="lazy"
            style={{
              width: 56,
              height: 32,
              objectFit: 'cover',
              borderRadius: 'var(--radius-sm)',
              display: 'block',
              background: 'var(--color-bg-secondary)',
            }}
          />
        ) : (
          <div
            style={{
              width: 56,
              height: 32,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg-secondary)',
            }}
          />
        ),
    },
    {
      key: 'athlete',
      header: 'Athlete',
      mono: false,
      render: row =>
        row.athleteName ?? (
          <span style={{ color: 'var(--color-text-tertiary)' }}>Unattached</span>
        ),
    },
    {
      key: 'exercise',
      header: 'Exercise',
      mono: false,
      render: row => row.exerciseName ?? <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>,
    },
    {
      key: 'date',
      header: 'Date',
      width: '72px',
      render: row => (row.date ? formatDateShort(row.date) : '—'),
    },
    {
      key: 'load',
      header: 'Load',
      width: '84px',
      align: 'right',
      render: row =>
        row.loadKg == null ? (
          '—'
        ) : (
          // The clip named no set, so this is the exercise's top set standing
          // in — marked rather than passed off as the load in the clip.
          <span title={row.loadIsTopSet ? 'Top completed set of the exercise' : undefined}>
            {formatLoad(row.loadKg)}
            {row.loadIsTopSet && <span style={{ color: 'var(--color-text-tertiary)' }}>*</span>}
          </span>
        ),
    },
    {
      key: 'clip',
      header: 'Clip',
      width: '110px',
      render: row => {
        const bits: string[] = [];
        if (row.durationS != null) bits.push(formatDuration(row.durationS));
        // fps is the ceiling on what a later analysis can resolve, so it is
        // worth a glance even before anything measures it.
        if (row.fps != null) bits.push(`${Math.round(row.fps)}fps`);
        return bits.length > 0 ? (
          bits.join(' · ')
        ) : (
          <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
        );
      },
    },
    {
      key: 'source',
      header: 'Source',
      width: '96px',
      mono: false,
      render: row => (
        <span style={{ color: 'var(--color-text-secondary)' }}>{SOURCE_LABEL[row.source]}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '108px',
      align: 'right',
      render: row => (
        <span style={{ display: 'inline-flex', gap: 2 }}>
          {/* Zero-click: find the plate, follow the bar through the set, cut
              it into reps and store them all, with nothing asked of the coach
              (P4c). The grade on each rep is the same one a hand-anchored
              analysis gets, which is what makes it safe to offer here. */}
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<Wand2 size={14} />}
            disabled={row.isEmbed || autoBusy !== null}
            title={
              row.isEmbed
                ? 'Streaming clips cannot be analysed'
                : autoBusy === row.key
                  ? 'Analysing…'
                  : 'Analyse it now, with no clicks: find the plate, follow the bar, split the reps and store them. Loads OpenCV the first time, about 13 MB.'
            }
            aria-label="Analyse automatically"
            onClick={e => {
              e.stopPropagation();
              if (!row.isEmbed) void runAuto(row);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<Ruler size={14} />}
            // A Stream-hosted clip is an iframe embed: pixels to look at, not
            // frames to measure. The viewer says so plainly, but there is no
            // point sending a coach there to be told.
            disabled={row.isEmbed}
            title={row.isEmbed ? 'Streaming clips cannot be analysed' : 'Analyse in KinEMOS'}
            aria-label="Analyse in KinEMOS"
            onClick={e => {
              e.stopPropagation();
              if (row.isEmbed) return;
              navigate(`/kinemos/analysis/${row.source}/${row.sourceId}`);
            }}
          />
          {/* Only direct imports are deletable here: a log or competition clip
              is deleted where it lives, so the library can never orphan a row
              another surface still lists. */}
          {row.source === 'direct' && (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Trash2 size={14} />}
              title="Delete import"
              aria-label="Delete import"
              onClick={e => {
                e.stopPropagation();
                void handleDelete(row);
              }}
            />
          )}
        </span>
      ),
    },
  ];

  return (
    <StandardPage>
      <div style={{ padding: 'var(--space-xl)', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <PageHeader
          eyebrow="KinEMOS"
          title="Video library"
          subtitle="Every lift video in EMOS — log clips, competition footage, and direct imports."
          metadata={`${visible.length} of ${rows.length} clips`}
        />

        <SharedWithYou coachId={activeCoachId} coachNames={coachNames} />
        <TrainingDataPanel athletes={athletes.map(a => ({ id: a.id, name: a.name }))} />
        {autoNote && (
          <p
            style={{
              margin: '0 0 var(--space-md)',
              fontSize: 'var(--text-caption)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {autoNote}
          </p>
        )}

        <div
          style={{
            display: 'flex',
            gap: 'var(--space-md)',
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 'var(--space-lg)',
            justifyContent: 'space-between',
          }}
        >
          {focusedKey ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
              <span style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>
                Showing one clip from the Review feed.
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon={<X size={14} />}
                onClick={() => setSearchParams({}, { replace: true })}
              >
                Show all
              </Button>
            </div>
          ) : (
          /* Select hard-codes width:100%, so each filter needs its own sized
             box or they stack one per row. */
          <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <div style={{ width: 170 }}>
              <Select value={athleteId} onChange={e => setAthleteId(e.target.value)} aria-label="Filter by athlete">
                <option value="">All athletes</option>
                <option value="none">Unattached only</option>
                {athletes.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>

            <div style={{ width: 190 }}>
              <Select
                value={exerciseName}
                onChange={e => setExerciseName(e.target.value)}
                aria-label="Filter by exercise"
              >
                <option value="">All exercises</option>
                {exerciseNames.map(name => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>

            <div style={{ width: 150 }}>
              <Select
                value={source}
                onChange={e => setSource(e.target.value as '' | LibrarySource)}
                aria-label="Filter by source"
              >
                <option value="">All sources</option>
                <option value="log">Log</option>
                <option value="event">Competition</option>
                <option value="direct">Import</option>
              </Select>
            </div>
          </div>
          )}

          <ImportControl athletes={athletes} exercises={exercises} onImported={refresh} />
        </div>

        {loading ? (
          <div style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
            <Spinner />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? 'No videos yet' : 'Nothing matches these filters'}
            message={
              rows.length === 0
                ? 'Clips uploaded by athletes appear here automatically. Import outside footage with the button above.'
                : 'Clear a filter to see more of the library.'
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            getRowKey={row => row.key}
            onRowClick={row => setPlaying(row)}
          />
        )}
      </div>

      <ClipPlayerModal video={playing} onClose={() => setPlaying(null)} />
    </StandardPage>
  );
}
