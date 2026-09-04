/**
 * ImportControl — bring outside footage into the library.
 *
 * The picked file goes through `useClipEditor`, the same gate every other
 * upload path in EMOS uses, so trimming, cropping, resolution and the
 * motion-suggested lift window all come for free and behave identically to
 * the athlete's phone.
 *
 * Two settings differ from the log-video path, and both are about what this
 * footage is FOR:
 *
 *   - **No duration cap.** A log clip is one lift and capped at 60 s; a direct
 *     import is a whole competition session or a full training set, which is
 *     exactly the footage that has nowhere else to live.
 *   - **`allowSplit`.** One recording of six attempts becomes six rows, which
 *     is what per-lift analysis needs and what a coach would otherwise do by
 *     hand.
 *
 * Resolution deliberately defaults to Original. Shrinking is the right call
 * for a review clip and the wrong one here: spatial resolution IS analysis
 * accuracy — at a 45 cm plate across ~200 px one pixel is ~2 mm, and dropping
 * a 4K clip to 720p throws away the precision the ±0.02 m/s tier is spending
 * (docs/KINEMOS_DESIGN.md §6.4). The editor still offers it; nothing pushes
 * the coach there.
 */
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button, Select } from '../../components/ui';
import { useClipEditor } from '../../components/planner/useClipEditor';
import { readVideoDurationSeconds } from '../../lib/videoProbe';
import { importDirectVideo, unreadableContainer } from '../lib/directImport';
import { KINEMOS_IMPORT_MAX_BYTES } from '../lib/kinemosStorage';
import {
  analyseOnImportEnabled,
  runArrivalQueue,
  setAnalyseOnImport,
  type ArrivalTarget,
} from '../lib/arrivals';
import { getOwnerId } from '../../lib/ownerContext';
import type { Athlete } from '../../lib/database.types';

interface ImportControlProps {
  athletes: Athlete[];
  exercises: { id: string; name: string }[];
  onImported: () => void;
  /** Say what the automatic analysis is doing, on the page that owns the
   *  library. The control does the work; the page shows the sentence. */
  onArrivalNote?: (note: string | null) => void;
}

export function ImportControl({ athletes, exercises, onImported, onArrivalNote }: ImportControlProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [athleteId, setAthleteId] = useState('');
  const [exerciseId, setExerciseId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoAnalyse, setAutoAnalyse] = useState(analyseOnImportEnabled);

  const clipEditor = useClipEditor({
    maxBytes: KINEMOS_IMPORT_MAX_BYTES,
    maxSeconds: null,
    allowSplit: true,
    // Analysis needs the camera's original pixels: trim-only edits become a
    // keyframe-aligned packet copy instead of a re-encode, the start handle
    // snaps to where that copy can actually cut, and the editor shows the
    // kept-size estimate against the 300 MB cap (design §6.3, plan §2.3).
    preferLossless: true,
  });

  const handlePick = async (file: File) => {
    setError(null);
    // Containers no browser can read at all. Left to the pipeline, a WMV gets
    // as far as the clip editor and fails there with a message about trimming,
    // which is not what went wrong. Named here so the coach hears the actual
    // problem — and the fix — before anything else runs.
    const unreadable = unreadableContainer(file);
    if (unreadable) {
      setError(
        `${unreadable} files cannot be read in a browser, so KinEMOS cannot analyse them. ` +
          'Convert the clip to H.264 MP4 (HandBrake or ffmpeg) and import it again.',
      );
      return;
    }

    // Measured before the editor runs, so a trimmed import can record what it
    // was cut from rather than only what survived.
    const originalDurationS = await readVideoDurationSeconds(file);

    let prepared: File[] | null;
    try {
      prepared = await clipEditor.prepare(file);
    } catch (e) {
      // The editor's own failures (a container mediabunny cannot open, a
      // decoder that refuses the clip) used to escape as an unhandled
      // rejection and leave the control silent.
      setError(e instanceof Error ? e.message : 'This clip could not be opened.');
      return;
    }
    if (!prepared) return; // backed out of the editor

    const arrivals: ArrivalTarget[] = [];
    try {
      for (let i = 0; i < prepared.length; i++) {
        setBusy(prepared.length > 1 ? `Importing ${i + 1} of ${prepared.length}…` : 'Importing…');
        const imported = await importDirectVideo(prepared[i], {
          athleteId: athleteId || null,
          exerciseId: exerciseId || null,
          originalDurationS,
          // A split recording is trimmed by construction; a single clip only
          // if the editor actually returned a different file.
          trimmed: prepared.length > 1 || prepared[i] !== file,
        });
        // The prepared file, not the uploaded copy: the frames are already in
        // this browser, so analysing them costs no download at all (P5d).
        arrivals.push({
          source: 'direct',
          sourceId: imported.id,
          label: prepared.length > 1 ? `${file.name} — clip ${i + 1}` : file.name,
          file: prepared[i],
        });
      }
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
      return;
    } finally {
      setBusy(null);
    }

    // After the refresh, never before it: the coach sees their clips in the
    // library immediately, and the analysis fills them in behind that.
    if (!autoAnalyse || arrivals.length === 0) return;
    setBusy('Analysing…');
    try {
      await runArrivalQueue(arrivals, {
        ownerId: getOwnerId(),
        onProgress: p =>
          onArrivalNote?.(
            p.total > 1
              ? `Analysing ${p.index} of ${p.total} — ${p.stage.toLowerCase()}`
              : `Analysing ${p.label} — ${p.stage.toLowerCase()}`,
          ),
        onDone: outcome => {
          onArrivalNote?.(outcome.message);
          onImported();
        },
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
      {/* Attach-on-import: both optional, because unattached footage (a
          seminar clip, another club's lifter) is first-class in KinEMOS.
          Sized boxes because Select hard-codes width:100%. */}
      <div style={{ width: 150 }}>
        <Select
          value={athleteId}
          onChange={e => setAthleteId(e.target.value)}
          aria-label="Attach to athlete"
          title="Attach the import to an athlete (optional)"
        >
          <option value="">No athlete</option>
          {athletes.map(a => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </div>

      <div style={{ width: 160 }}>
        <Select
          value={exerciseId}
          onChange={e => setExerciseId(e.target.value)}
          aria-label="Attach to exercise"
          title="Attach the import to an exercise (optional)"
        >
          <option value="">No exercise</option>
          {exercises.map(ex => (
            <option key={ex.id} value={ex.id}>
              {ex.name}
            </option>
          ))}
        </Select>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0];
          // Reset first: picking the same file twice in a row fires no change
          // event otherwise, which reads as a dead button.
          e.target.value = '';
          if (file) void handlePick(file);
        }}
      />

      <Button
        variant="primary"
        icon={<Upload size={14} />}
        disabled={busy != null}
        onClick={() => fileRef.current?.click()}
      >
        {busy ?? 'Import video'}
      </Button>

      {/* COACH-CONFIG candidate: belongs in a KinEMOS settings row once there
          is one. Here for now because this is where its cost is paid — a
          minute of this laptop's CPU per clip, right after the upload. */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-xs)',
          fontSize: 'var(--text-label)',
          color: 'var(--color-text-secondary)',
          cursor: 'pointer',
        }}
        title="Find the plate, follow the bar and store every rep as soon as the clip lands. Runs in this browser."
      >
        <input
          type="checkbox"
          checked={autoAnalyse}
          onChange={e => {
            setAutoAnalyse(e.target.checked);
            setAnalyseOnImport(e.target.checked);
          }}
        />
        Analyse on import
      </label>

      {error && (
        <span style={{ fontSize: 'var(--text-label)', color: 'var(--color-danger-text)' }}>
          {error}
        </span>
      )}

      {clipEditor.editor}
    </div>
  );
}
