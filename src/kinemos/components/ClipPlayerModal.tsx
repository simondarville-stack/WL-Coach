/**
 * ClipPlayerModal — plain playback for a library row.
 *
 * Deliberately not an analysis surface: P0's job is to prove the library
 * holds the right clips and that they play. Scrubbing, frame stepping and
 * overlays arrive with the P1 viewer, which is where the keyboard model and
 * the calibration tools belong.
 *
 * Stream-hosted clips come back as an iframe embed rather than a media file,
 * so they cannot use a <video>. That split is also why the P0 plan flags them
 * as an open question for analysis (§4): an embed hands us pixels to look at,
 * not frames to measure.
 */
import { Modal } from '../../components/ui';
import type { LibraryVideo } from '../lib/videoLibrary';

interface ClipPlayerModalProps {
  video: LibraryVideo | null;
  onClose: () => void;
}

export function ClipPlayerModal({ video, onClose }: ClipPlayerModalProps) {
  if (!video) return null;

  const title = [video.athleteName, video.exerciseName].filter(Boolean).join(' · ') || 'Clip';

  return (
    <Modal isOpen onClose={onClose} title={title} size="xl">
      <div style={{ background: '#000', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {video.isEmbed ? (
          <iframe
            src={video.playbackUrl}
            title={title}
            allow="accelerometer; encrypted-media; picture-in-picture;"
            allowFullScreen
            style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', border: 0 }}
          />
        ) : (
          <video
            src={video.playbackUrl}
            controls
            autoPlay
            playsInline
            style={{ display: 'block', width: '100%', maxHeight: '70vh' }}
          />
        )}
      </div>
      {video.note && (
        <p
          style={{
            marginTop: 'var(--space-md)',
            marginBottom: 0,
            fontSize: 'var(--text-label)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {video.note}
        </p>
      )}
    </Modal>
  );
}
