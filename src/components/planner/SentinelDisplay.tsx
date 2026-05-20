/**
 * SentinelDisplay — unified read-only renderer for sentinel exercise types.
 *
 * Replaces three copy-pasted switch branches in:
 *   - ExerciseLogCard.tsx (dark / athlete)
 *   - SessionPreview.tsx  (dark / athlete preview)
 *   - LogExerciseRow.tsx  (light / coach)
 *
 * The `theme` prop controls which Tailwind palette is used.
 * GPP rows show the athlete version when athleteGpp is provided, otherwise
 * the planned version. Use LogExerciseRow's inline GPP branch for the
 * planned-vs-performed comparison table (coach-only, with strikethrough load).
 */
import { useState } from 'react';
import { Video, ExternalLink, Image as ImageIcon } from 'lucide-react';
import type { GppSection } from '../../lib/database.types';
import { getSentinelType, getYouTubeThumbnail, isDirectVideoFile } from './sentinelUtils';
import { ImageLightbox } from './ImageLightbox';

type SentinelType = 'text' | 'image' | 'video' | 'gpp' | null;

interface SentinelDisplayProps {
  /** exercise_code of the planned exercise — used to detect sentinel type. */
  exerciseCode: string | null | undefined;
  /** Raw content field (notes column on planned_exercises). */
  notes: string | null | undefined;
  /** Structured metadata (video description, gpp rows, etc.). */
  metadata?: Record<string, unknown> | null;
  /** Athlete-modified GPP state (when logged). Overrides planned rows when present. */
  athleteGpp?: GppSection | null;
  /** Visual theme: 'dark' = athlete surfaces, 'light' = coach surfaces. */
  theme?: 'dark' | 'light';
}

export function SentinelDisplay({
  exerciseCode,
  notes,
  metadata,
  athleteGpp,
  theme = 'dark',
}: SentinelDisplayProps) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const sentinelType: SentinelType = getSentinelType(exerciseCode ?? null);

  const isDark = theme === 'dark';

  if (sentinelType === 'text') {
    return (
      <div className={`rounded-xl px-3 py-3 ${isDark ? 'bg-gray-900 border border-gray-800' : ''}`}>
        <p className={`text-sm italic whitespace-pre-wrap leading-relaxed ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
          {notes || '(empty note)'}
        </p>
      </div>
    );
  }

  if (sentinelType === 'image') {
    const url = notes?.trim();
    const description = (metadata?.description as string | undefined)?.trim();
    const border = isDark ? 'border-gray-800' : 'border-gray-200';
    return (
      <>
        <div className={`rounded-xl px-3 py-2 flex flex-col gap-1.5 ${isDark ? 'bg-gray-900 border border-gray-800' : 'border ' + border}`}>
          <div className="flex items-center gap-2">
            <ImageIcon size={14} className="text-pink-400 flex-shrink-0" />
            {url ? (
              <button
                type="button"
                onClick={() => setLightboxSrc(url)}
                className="flex items-center gap-2 min-w-0 group"
                title="Tap to enlarge"
              >
                <img
                  src={url}
                  alt=""
                  className={`h-9 w-14 object-cover rounded border flex-shrink-0 ${
                    isDark
                      ? 'border-gray-700 group-hover:border-pink-400'
                      : 'border-gray-300 group-hover:border-pink-400'
                  }`}
                  onError={e => { e.currentTarget.style.display = 'none'; }}
                />
                <span className={`text-xs truncate ${isDark ? 'text-gray-400 group-hover:text-pink-300' : 'text-gray-600 group-hover:text-pink-600'}`}>
                  Tap to enlarge
                </span>
              </button>
            ) : (
              <span className={`text-xs italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>(no image)</span>
            )}
          </div>
          {description && (
            <p className={`text-xs italic whitespace-pre-wrap leading-snug ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {description}
            </p>
          )}
        </div>
        {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      </>
    );
  }

  if (sentinelType === 'video') {
    const url = notes?.trim();
    const description = (metadata?.description as string | undefined)?.trim();
    const thumb = url && !isDirectVideoFile(url) ? getYouTubeThumbnail(url) : null;
    if (!url) {
      return (
        <div className={`rounded-xl px-3 py-2 flex flex-col gap-1.5 ${isDark ? 'bg-gray-900 border border-gray-800' : ''}`}>
          <div className="flex items-center gap-2">
            <Video size={14} className="text-indigo-400 flex-shrink-0" />
            <span className={`text-xs italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>(no video link)</span>
          </div>
          {description && (
            <p className={`text-xs italic whitespace-pre-wrap leading-snug ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {description}
            </p>
          )}
        </div>
      );
    }
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`rounded-xl px-3 py-2 flex flex-col gap-1.5 transition-colors ${
          isDark
            ? 'bg-gray-900 border border-gray-800 hover:border-indigo-700/50'
            : 'border border-gray-200 hover:border-indigo-300'
        }`}
        title="Tap to open video"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Video size={14} className="text-indigo-400 flex-shrink-0" />
          {thumb ? (
            <img src={thumb} alt="" className={`h-9 w-14 object-cover rounded border flex-shrink-0 ${isDark ? 'border-gray-700' : 'border-gray-300'}`} />
          ) : (
            <span className={`h-9 w-14 rounded border flex items-center justify-center flex-shrink-0 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`}>
              <Video size={16} className="text-indigo-400" />
            </span>
          )}
          <span className={`flex items-center gap-1 text-xs min-w-0 ${isDark ? 'text-indigo-300' : 'text-indigo-600'}`}>
            <ExternalLink size={11} className="flex-shrink-0" />
            <span className="truncate">Tap to open</span>
          </span>
        </div>
        {description && (
          <p className={`text-xs italic whitespace-pre-wrap leading-snug ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            {description}
          </p>
        )}
      </a>
    );
  }

  if (sentinelType === 'gpp') {
    const plannedGpp = metadata?.gpp as GppSection | null | undefined;
    const displayGpp = athleteGpp ?? plannedGpp ?? null;
    const rows = displayGpp?.rows ?? [];
    const doneCount = rows.filter(r => r.done).length;
    return (
      <div className={`rounded-xl overflow-hidden ${isDark ? 'bg-gray-900 border border-gray-800' : 'border border-gray-200'}`}>
        <div className={`px-3 py-2 flex items-center gap-2 ${isDark ? 'border-b border-gray-800' : 'border-b border-gray-100'}`}>
          <span className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
            {displayGpp?.title || 'GPP'}
          </span>
          {rows.length > 0 && (
            <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {doneCount}/{rows.length} done
            </span>
          )}
        </div>
        {displayGpp?.description && (
          <p className={`px-3 pt-2 text-xs italic whitespace-pre-wrap leading-snug ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            {displayGpp.description}
          </p>
        )}
        {rows.length === 0 ? (
          <p className={`px-3 py-3 text-xs italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No rows yet</p>
        ) : (
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className={`text-[9px] uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                <th className="text-left px-3 py-1">Exercise</th>
                <th className="text-center px-1 py-1 w-12">Reps</th>
                <th className="text-center px-1 py-1 w-10">Sets</th>
                <th className="text-center px-1 py-1 w-14">Load</th>
                <th className="text-center px-1 py-1 w-8">✓</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className={`border-t ${
                    isDark
                      ? `border-gray-800 ${row.done ? 'bg-emerald-950/30' : ''}`
                      : `border-gray-100 ${row.done ? 'bg-emerald-50' : ''}`
                  }`}
                >
                  <td className={`px-3 py-1 ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>{row.exercise}</td>
                  <td className={`px-1 py-1 text-center tabular-nums ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{row.reps || '—'}</td>
                  <td className={`px-1 py-1 text-center tabular-nums ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{row.sets}</td>
                  <td className={`px-1 py-1 text-center tabular-nums ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{row.load || '—'}</td>
                  <td className={`px-1 py-1 text-center ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{row.done ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return null;
}
