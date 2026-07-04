import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Download, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/cn';

interface AudioPlayerProps {
  src: string;
  downloadUrl?: string;
  className?: string;
  // Optional external handle to the <audio> element, so callers (e.g. the
  // practice page) can seek/loop/change the playback rate themselves.
  audioRef?: MutableRefObject<HTMLAudioElement | null>;
  // Extra controls rendered between the volume group and the download button.
  extraControls?: ReactNode;
}

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const iconButtonClasses =
  'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-secondary ' +
  'hover:bg-[#f0f0f0] hover:text-text transition-colors duration-150';

// In-app audio player styled after the design system: play/pause, seekable
// progress with times, volume with mute toggle, and an optional download.
export const AudioPlayer = ({
  src,
  downloadUrl,
  className,
  audioRef: externalRef,
  extraControls,
}: AudioPlayerProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  // Reset when the source changes (e.g. the attachment was replaced).
  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  const seek = (time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const changeVolume = (value: number) => {
    const audio = audioRef.current;
    setVolume(value);
    setMuted(value === 0);
    if (audio) {
      audio.volume = value;
      audio.muted = value === 0;
    }
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    const next = !muted;
    setMuted(next);
    if (audio) audio.muted = next;
  };

  return (
    <div
      className={cn(
        'flex w-full max-w-xl items-center gap-2 rounded-md border border-border bg-white px-2 py-1.5',
        className,
      )}
    >
      <audio
        ref={(el) => {
          audioRef.current = el;
          if (externalRef) externalRef.current = el;
        }}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
      />

      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'Pause' : 'Play'}
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-black text-white hover:bg-black-hover transition-colors duration-150"
      >
        {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
      </button>

      <span className="w-10 flex-shrink-0 text-right text-xs tabular-nums text-text-secondary">
        {formatTime(currentTime)}
      </span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(currentTime, duration || 0)}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="Seek"
        className="h-8 min-w-0 flex-1 cursor-pointer accent-black"
      />
      <span className="w-10 flex-shrink-0 text-xs tabular-nums text-text-secondary">
        {formatTime(duration)}
      </span>

      <div className="hidden items-center gap-1.5 sm:flex">
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className={iconButtonClasses}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => changeVolume(Number(e.target.value))}
          aria-label="Volume"
          className="h-8 w-16 cursor-pointer accent-black"
        />
      </div>

      {extraControls}

      {downloadUrl && (
        <a href={downloadUrl} aria-label="Download" title="Download" className={iconButtonClasses}>
          <Download size={16} />
        </a>
      )}
    </div>
  );
};
