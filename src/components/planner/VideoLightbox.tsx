import { X } from 'lucide-react';
import { AdaptiveDialog } from '../ui/AdaptiveDialog';

interface VideoLightboxProps {
  src: string;
  /** Shown above the player — typically "Set 3 · 28/08". */
  caption?: string | null;
  onClose: () => void;
}

/** Fullscreen player for a training-log clip. Sibling of ImageLightbox: same
 *  bare/media dialog treatment, since the clip *is* the content rather than
 *  something layered over the app.
 *
 *  `controls` and no autoplay is deliberate — a coach reviewing technique
 *  scrubs frame by frame, and an autoplaying clip has already passed the
 *  moment they wanted by the time the overlay settles. */
export function VideoLightbox({ src, caption, onClose }: VideoLightboxProps) {
  return (
    <AdaptiveDialog
      onClose={onClose}
      panel="bare"
      variant="media"
      ariaLabel={caption ? `Video: ${caption}` : 'Video preview'}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'absolute', top: 12, right: 12, padding: 8,
          background: 'rgba(255,255,255,0.1)', color: '#fff',
          border: 'none', borderRadius: 999, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1,
        }}
      >
        <X size={20} />
      </button>
      {caption && (
        <div
          style={{
            position: 'absolute', top: 16, left: 16, zIndex: 1,
            color: 'rgba(255,255,255,0.85)', fontSize: 12,
            fontWeight: 600, letterSpacing: '0.03em',
          }}
        >
          {caption}
        </div>
      )}
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'default' }}
      />
    </AdaptiveDialog>
  );
}
