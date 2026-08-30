/**
 * VideoThumb — poster for one training clip, loaded as cheaply as possible.
 *
 * Preference order:
 *   1. thumbnail_url — the small JPEG captured at upload (or the Stream
 *      server thumbnail). A plain lazy <img>, ~20-40 KB.
 *   2. Stream server thumbnail derived from the playback URL (older Stream
 *      rows without thumbnail_url).
 *   3. Lazy <video preload="metadata"> with the #t=0.1 poster trick — the
 *      only option for pre-thumbnail storage clips. This is the expensive
 *      path (phone MP4s keep their index at the end of the file, so painting
 *      one poster pulls large byte ranges), so it mounts only once the tile
 *      is near the viewport instead of firing N downloads per strip/thread.
 *
 * Fills its parent (the caller provides the sized, rounded container).
 */
import { useEffect, useRef, useState } from 'react';
import { Video } from 'lucide-react';
import type { TrainingLogVideo } from '../../lib/database.types';
import { isStreamPlaybackUrl, streamThumbnailUrl } from '../../lib/streamUploads';

export function VideoThumb({ video }: { video: TrainingLogVideo }) {
  const imageUrl =
    video.thumbnail_url ??
    (isStreamPlaybackUrl(video.video_url) ? streamThumbnailUrl(video.video_url) : null);

  const ref = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (imageUrl) return; // the <img> path lazy-loads natively
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      // Start loading a little before the tile scrolls in, so it usually has
      // a frame by the time it is visible.
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [imageUrl]);

  return (
    <div ref={ref} className="w-full h-full bg-black">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover pointer-events-none"
        />
      ) : near ? (
        <video
          src={`${video.video_url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          className="w-full h-full object-cover pointer-events-none"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-gray-600">
          <Video size={16} />
        </div>
      )}
    </div>
  );
}
