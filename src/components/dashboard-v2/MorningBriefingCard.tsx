// Dashboard "Morning briefing" card. Builds the squad briefing from the live
// analysis engine (gatherBriefing → composeBriefing) and renders a deterministic
// spoken script (no LLM/API), with a play-aloud control via the browser's
// SpeechSynthesis (Web Speech API) and a voice picker. Everything is on-device.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Volume2, RefreshCw } from 'lucide-react';
import { gatherBriefing, briefingScript, type MorningBriefing } from '../../lib/analysis';
import { toLocalISO } from '../../lib/dateUtils';

const VOICE_KEY = 'emos_briefing_voice';
const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

export function MorningBriefingCard({ athleteIds }: { athleteIds: string[] }) {
  const idsKey = athleteIds.join(',');
  const [briefing, setBriefing] = useState<MorningBriefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>(() => localStorage.getItem(VOICE_KEY) ?? '');
  const [playing, setPlaying] = useState(false);

  // Fetch + compose the briefing for the coach's squad.
  useEffect(() => {
    if (!idsKey) {
      setBriefing(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    gatherBriefing(idsKey.split(','), toLocalISO(new Date()))
      .then((b) => { if (active) { setBriefing(b); setLoading(false); } })
      .catch((e) => { if (active) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    return () => { active = false; };
  }, [idsKey]);

  // Load TTS voices (they populate asynchronously) and pick a sensible default.
  useEffect(() => {
    if (!ttsSupported) return;
    const load = () => {
      const all = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
      setVoices(all);
      setVoiceURI((cur) => {
        if (cur && all.some((v) => v.voiceURI === cur)) return cur;
        const pick = all.find((v) => v.name === 'Google UK English Male')
          ?? all.find((v) => v.lang === 'en-GB')
          ?? all[0];
        return pick?.voiceURI ?? '';
      });
    };
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  // Stop any speech when the card unmounts.
  const unmount = useRef(() => {});
  unmount.current = () => { if (ttsSupported) speechSynthesis.cancel(); };
  useEffect(() => () => unmount.current(), []);

  const script = useMemo(() => (briefing ? briefingScript(briefing) : ''), [briefing]);

  const play = () => {
    if (!ttsSupported || !script) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(script);
    const voice = voices.find((v) => v.voiceURI === voiceURI);
    if (voice) u.voice = voice;
    u.rate = 1.0;
    u.onend = () => setPlaying(false);
    u.onerror = () => setPlaying(false);
    speechSynthesis.speak(u);
    setPlaying(true);
  };
  const stop = () => { if (ttsSupported) speechSynthesis.cancel(); setPlaying(false); };

  const onPickVoice = (uri: string) => {
    setVoiceURI(uri);
    localStorage.setItem(VOICE_KEY, uri);
    if (playing) stop();
  };

  if (!idsKey) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <Volume2 size={15} className="text-blue-600" />
          <h2 className="text-sm font-medium text-gray-900">Morning briefing</h2>
          <span className="text-[11px] text-gray-400">spoken · last completed week</span>
        </div>
        <div className="flex items-center gap-2">
          {ttsSupported ? (
            <button
              onClick={playing ? stop : play}
              disabled={!script}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                playing ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {playing ? <Square size={13} /> : <Play size={13} />}
              {playing ? 'Stop' : 'Play'}
            </button>
          ) : (
            <span className="text-[11px] text-gray-400">Audio not supported in this browser</span>
          )}
          {ttsSupported && voices.length > 0 && (
            <select
              value={voiceURI}
              onChange={(e) => onPickVoice(e.target.value)}
              title="Choose the briefing voice"
              className="text-xs border border-gray-200 rounded-md px-2 py-1.5 text-gray-600 bg-white max-w-[180px]"
            >
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
          <RefreshCw size={13} className="animate-spin" /> Preparing your briefing…
        </div>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : (
        <p className="text-sm text-gray-700 leading-relaxed">{script}</p>
      )}
    </div>
  );
}
