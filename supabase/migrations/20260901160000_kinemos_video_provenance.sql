-- KinEMOS video provenance for the P2 analysis engine (CV review 01/09/2026,
-- docs/KINEMOS_P0_PLAN.md W2 [retrofit]). Cheap to probe at import — the
-- importer already has the container open in mediabunny — and expensive to
-- backfill once the file is bytes in R2.

-- Variable frame rate. Velocity is dx/dt: a single nominal fps on a VFR clip
-- silently corrupts every velocity/power number, and the Butterworth filter
-- (design §6.3) assumes uniform sampling. The engine works on per-frame
-- timestamps; this flag tells it to, and tells the quality grade to dock the
-- clip. NULL on rows imported before the probe learned to tell.
ALTER TABLE kinemos_videos ADD COLUMN IF NOT EXISTS vfr boolean;

-- Container rotation, degrees clockwise (0/90/180/270). Portrait phone video
-- is stored landscape plus this flag; WebCodecs decodes UNROTATED frames, so
-- mapping a coach's click to a pixel needs it. width/height stay display
-- dimensions (post-rotation), as they always were.
ALTER TABLE kinemos_videos ADD COLUMN IF NOT EXISTS rotation integer;

-- Codec id as mediabunny names it ('avc', 'hevc', 'vp9', 'av1', …). The
-- extension says nothing about what is inside the container, and decode
-- support — <video> and WebCodecs both — varies by browser/OS.
ALTER TABLE kinemos_videos ADD COLUMN IF NOT EXISTS codec text;
