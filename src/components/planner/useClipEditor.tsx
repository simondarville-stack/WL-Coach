/**
 * useClipEditor — the one place a picked video passes through before upload.
 *
 * Three surfaces upload video (the training-log strip, a coach's exercise demo
 * video, and a competition attempt) and each has its own bucket, its own
 * limits and its own picker. What they must not have is three different
 * answers to "should this clip be trimmed first, and what happens when storage
 * refuses it" — so the decision lives here and each surface just awaits
 * `prepare(file)` and renders `editor`.
 *
 * Usage:
 *
 *   const clipEditor = useClipEditor({ maxBytes: LIMIT, maxSeconds: 60 });
 *   const prepared = await clipEditor.prepare(file);
 *   if (!prepared) return;             // athlete backed out
 *   await upload(prepared);
 *   … {clipEditor.editor}
 *
 * On a browser without WebCodecs `prepare` is a pass-through, so every caller
 * behaves exactly as it did before the editor existed.
 */
import { useState, type ReactNode } from 'react';
import { ClipEditor } from './ClipEditor';
import { clipEditingSupported, type ClipResolution } from '../../lib/videoClipEdit';
import { readVideoDurationSeconds } from '../../lib/videoProbe';

export interface ClipEditorLimits {
  /**
   * Client-side byte cap, or null where the real ceiling is the Supabase
   * project's global upload limit and so is not knowable from code (see
   * `videoLimits.ts`). Null means the editor is offered but never forced on
   * size — storage's own refusal is what triggers `prepareAfterRejection`.
   */
  maxBytes: number | null;
  /** Hard cap on clip length, or null where long clips are legitimate. */
  maxSeconds: number | null;
}

export interface ClipEditorGate {
  /** Whether this browser can re-encode at all. */
  supported: boolean;
  /** Resolves to the file to upload, or null if the athlete backed out. */
  prepare: (file: File) => Promise<File | null>;
  /**
   * Re-open the editor after storage refused a clip as too large — the one
   * case where no client-side cap saw it coming. Opens at 720p, which is the
   * setting most likely to clear an unknown limit in one go.
   */
  prepareAfterRejection: (file: File) => Promise<File | null>;
  /** Render this somewhere in the caller's tree. */
  editor: ReactNode;
}

export function useClipEditor(limits: ClipEditorLimits): ClipEditorGate {
  const [editing, setEditing] = useState<{
    file: File;
    reason: string | null;
    mustEdit: boolean;
    defaultMaxEdge: ClipResolution;
    resolve: (file: File | null) => void;
  } | null>(null);

  const supported = clipEditingSupported();

  /** Open the editor and suspend until the athlete commits or backs out. */
  const open = (
    file: File,
    reason: string | null,
    mustEdit: boolean,
    defaultMaxEdge: ClipResolution = null,
  ) =>
    new Promise<File | null>(resolve => {
      setEditing({
        file,
        reason,
        mustEdit,
        defaultMaxEdge,
        resolve: result => {
          setEditing(null);
          resolve(result);
        },
      });
    });

  /**
   * Every video goes through the editor — including a five-clip batch attach,
   * which opens five in turn.
   *
   * That is deliberate, and it is the storage bill talking: an untrimmed clip
   * is mostly an athlete walking up to the bar and walking away from it, and
   * those bytes are paid for on every upload and served on every review. The
   * cost of asking is one tap, and the motion analysis usually has the lift
   * bracketed before the athlete has finished looking at it.
   */
  const prepare = async (file: File) => {
    if (!supported) return file;

    // Over a cap we can see is non-negotiable: the upload would fail, so the
    // editor opens with the reason stated and no way past it.
    if (limits.maxBytes != null && file.size > limits.maxBytes) {
      return open(
        file,
        `Clip is ${Math.round(file.size / 1024 / 1024)} MB — the limit is ` +
          `${Math.round(limits.maxBytes / 1024 / 1024)} MB. Trim it, or drop the size, to send it.`,
        true,
        // 1080p usually clears the limit on its own, so the athlete can just
        // hit send without deciding anything.
        1920,
      );
    }
    if (limits.maxSeconds != null) {
      const duration = await readVideoDurationSeconds(file);
      if (duration != null && duration > limits.maxSeconds + 1) {
        return open(
          file,
          `Clip is ${Math.round(duration)} s long — the limit is ${limits.maxSeconds} s. ` +
            'Drag the handles onto the lift.',
          true,
        );
      }
    }
    return open(file, null, false);
  };

  const prepareAfterRejection = (file: File) =>
    supported
      ? open(
          file,
          'That clip was refused as too large. Trim it to the lift, or drop the size, and send again.',
          true,
          1280,
        )
      : Promise.resolve(null);

  return {
    supported,
    prepare,
    prepareAfterRejection,
    editor: editing ? (
      <ClipEditor
        file={editing.file}
        reason={editing.reason}
        mustEdit={editing.mustEdit}
        defaultMaxEdge={editing.defaultMaxEdge}
        maxSeconds={limits.maxSeconds}
        onCancel={() => editing.resolve(null)}
        onDone={file => editing.resolve(file)}
      />
    ) : null,
  };
}
