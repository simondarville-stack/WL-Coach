/**
 * losslessTrim — keyframe-aligned packet-copy trimming, no re-encode.
 *
 * Why this exists: mediabunny's `Conversion` takes its lossless fast path only
 * when the trim starts at or before the track's first timestamp — cutting the
 * head off a clip (the whole point of trimming the chalk ritual away) forces a
 * full decode/re-encode (`firstTimestamp < startTimestamp` ⇒ transcode in
 * conversion.js). For a review clip that is fine; for footage headed into
 * KinEMOS analysis it is not — the engine needs the camera's original pixels,
 * fps and timestamps (docs/KINEMOS_DESIGN.md §6.3, P0 plan decision 3).
 *
 * So this module does what the design actually asked for: snap the cut to the
 * keyframe at or before the requested start, then copy encoded packets
 * verbatim into a fresh MP4. Cut precision is the GOP (~0,5–2 s on phone
 * footage), which is fine for removing setup; the video inside the cut is
 * bit-identical to the source. Callers get the *actual* start back so
 * provenance never lies about what was kept.
 *
 * Built on mediabunny's demux/mux primitives (EncodedPacketSink →
 * EncodedVideoPacketSource), dynamically imported like the rest of the clip
 * pipeline so none of it lands in the main bundle.
 */

export interface LosslessTrimResult {
  /** The trimmed bytes, ready to wrap in a File. Always an MP4. */
  buffer: ArrayBuffer;
  /** Where the cut actually starts in the source — the snapped keyframe,
   *  ≤ the requested start. */
  actualStartS: number;
}

/**
 * Largest keyframe time at or before `startS` — where a packet-copy cut will
 * actually land. Falls back to the first keyframe when the request precedes
 * all of them. Pure, for the editor's handle snapping and for tests.
 */
export function snapToKeyframe(keyframeTimes: number[], startS: number): number {
  if (keyframeTimes.length === 0) return startS;
  let best: number | null = null;
  for (const t of keyframeTimes) {
    // Half-frame tolerance so a handle parked visually "on" a keyframe does
    // not slip back a whole GOP over float noise.
    if (t <= startS + 0.008) best = t;
    else break;
  }
  // A start before the first keyframe decodes from that keyframe regardless.
  return best ?? keyframeTimes[0];
}

/**
 * Keyframe timestamps of the primary video track, sorted ascending.
 * Metadata-only demux — no frame data is read, so this is cheap even on a
 * multi-minute clip. Null when the container cannot be read.
 */
export async function readKeyframeTimes(file: File): Promise<number[] | null> {
  try {
    const { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;

    const sink = new EncodedPacketSink(track);
    const times: number[] = [];
    for await (const packet of sink.packets(undefined, undefined, {
      metadataOnly: true,
      verifyKeyPackets: true,
    })) {
      if (packet.type === 'key') times.push(packet.timestamp);
    }
    times.sort((a, b) => a - b);
    return times;
  } catch {
    return null;
  }
}

/**
 * Copy `[keyframe ≤ startS, endS)` of `file` into a new MP4 without touching a
 * single pixel. Returns null when the copy path is impossible — a codec MP4
 * cannot carry, no video track, an unreadable container — and the caller
 * falls back to the re-encoding path.
 */
export async function losslessTrimClip(
  file: File,
  startS: number,
  endS: number,
): Promise<LosslessTrimResult | null> {
  try {
    const {
      ALL_FORMATS,
      BlobSource,
      BufferTarget,
      EncodedAudioPacketSource,
      EncodedPacketSink,
      EncodedVideoPacketSource,
      Input,
      Mp4OutputFormat,
      Output,
    } = await import('mediabunny');

    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const videoTrack = await input.getPrimaryVideoTrack();
    const videoCodec = videoTrack?.codec ?? null;
    if (!videoTrack || !videoCodec) return null;

    const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
    if (!format.getSupportedVideoCodecs().includes(videoCodec)) return null;

    // Audio is copied too — a coach hears bar contact and cues on it. If the
    // audio codec cannot ride along losslessly, give up entirely rather than
    // silently returning a mute clip; the re-encode fallback keeps the sound.
    const audioTrack = await input.getPrimaryAudioTrack();
    const audioCodec = audioTrack?.codec ?? null;
    if (audioTrack && (!audioCodec || !format.getSupportedAudioCodecs().includes(audioCodec))) {
      return null;
    }

    const videoSink = new EncodedPacketSink(videoTrack);
    const startPacket =
      (await videoSink.getKeyPacket(startS, { verifyKeyPackets: true })) ??
      (await videoSink.getFirstPacket({ verifyKeyPackets: true }));
    if (!startPacket) return null;
    const actualStartS = Math.min(startPacket.timestamp, startS);

    const output = new Output({ format, target: new BufferTarget() });
    const videoSource = new EncodedVideoPacketSource(videoCodec);
    output.addVideoTrack(videoSource, { rotation: videoTrack.rotation });

    let audioSource: InstanceType<typeof EncodedAudioPacketSource> | null = null;
    if (audioTrack && audioCodec) {
      audioSource = new EncodedAudioPacketSource(audioCodec);
      output.addAudioTrack(audioSource);
    }

    await output.start();

    const videoConfig = await videoTrack.getDecoderConfig();
    const videoMeta = { decoderConfig: videoConfig ?? undefined };
    for await (const packet of videoSink.packets(startPacket, undefined, {
      verifyKeyPackets: true,
    })) {
      // Same tail rule as mediabunny's own copy path: stop at the first
      // packet presenting past the end. The last GOP may lose forward refs,
      // which decoders tolerate.
      if (packet.timestamp >= endS) break;
      const shifted = packet.timestamp - actualStartS;
      // Open-GOP leading pictures can present before their keyframe; they are
      // undisplayable from this cut, so they are dropped rather than given
      // negative timestamps.
      if (shifted < 0) continue;
      await videoSource.add(packet.clone({ timestamp: shifted }), videoMeta);
    }
    videoSource.close();

    if (audioTrack && audioSource) {
      const audioSink = new EncodedPacketSink(audioTrack);
      const audioConfig = await audioTrack.getDecoderConfig();
      const audioMeta = { decoderConfig: audioConfig ?? undefined };
      const firstAudio =
        (await audioSink.getPacket(actualStartS)) ?? (await audioSink.getFirstPacket());
      if (firstAudio) {
        for await (const packet of audioSink.packets(firstAudio)) {
          if (packet.timestamp >= endS) break;
          const shifted = packet.timestamp - actualStartS;
          // Audio packets are independent; the one straddling the cut would go
          // negative — skipping it costs at most ~20 ms of lead-in sound.
          if (shifted < 0) continue;
          await audioSource.add(packet.clone({ timestamp: shifted }), audioMeta);
        }
      }
      audioSource.close();
    }

    await output.finalize();
    const buffer = output.target.buffer;
    if (!buffer) return null;
    return { buffer, actualStartS };
  } catch {
    // Any container/mux surprise lands on the re-encode fallback instead of
    // failing the edit.
    return null;
  }
}
