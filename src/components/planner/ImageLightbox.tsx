import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';

interface ImageLightboxProps {
  src: string;
  onClose: () => void;
}

/** Fullscreen image overlay used by the training-log image sentinels.
 *  Backdrop click or Esc dismisses; clicks on the image do not, so users can
 *  pinch-zoom on mobile without the overlay collapsing. (useBackdropDismiss
 *  only fires when the gesture starts and ends on the backdrop itself, which
 *  is why the image no longer needs its own stopPropagation guard.) */
export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
  const backdrop = useBackdropDismiss(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      {...backdrop}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.9)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, cursor: 'zoom-out',
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'absolute', top: 12, right: 12, padding: 8,
          background: 'rgba(255,255,255,0.1)', color: '#fff',
          border: 'none', borderRadius: 999, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <X size={20} />
      </button>
      <img
        src={src}
        alt=""
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'default' }}
      />
    </div>
  );
}
