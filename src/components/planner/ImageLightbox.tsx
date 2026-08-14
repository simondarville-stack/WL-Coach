import { X } from 'lucide-react';
import { AdaptiveDialog } from '../ui/AdaptiveDialog';

interface ImageLightboxProps {
  src: string;
  onClose: () => void;
}

/** Fullscreen image overlay used by the training-log image sentinels.
 *  Backdrop click or Esc dismisses; clicks on the image do not, so users can
 *  pinch-zoom on mobile without the overlay collapsing. The `media` variant
 *  swaps the standard dim for the near-opaque wash — here the image *is* the
 *  content, not something layered over the app. */
export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
  return (
    <AdaptiveDialog
      onClose={onClose}
      panel="bare"
      variant="media"
      ariaLabel="Image preview"
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
      <img
        src={src}
        alt=""
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'default' }}
      />
    </AdaptiveDialog>
  );
}
