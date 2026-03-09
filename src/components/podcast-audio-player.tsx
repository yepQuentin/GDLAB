"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface PodcastAudioPlayerProps {
  src: string;
  label?: string;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--:--";
  }

  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainSeconds = wholeSeconds % 60;

  return `${minutes}:${String(remainSeconds).padStart(2, "0")}`;
}

function normalizePlayerLabel(label: string): string {
  const trimmed = label.trim().replace(/^[^A-Za-z0-9\u4e00-\u9fff]+/u, "");
  const collapsed = trimmed.replace(/\s+/g, "");

  if (
    !collapsed ||
    /^(今日|当天|本期)?(播客)?音频(?:链接)?$/u.test(collapsed) ||
    /(替换.*音频|音频url)/iu.test(collapsed)
  ) {
    return "本期音频";
  }

  return trimmed;
}

export function PodcastAudioPlayer({ src, label = "今日播客音频" }: PodcastAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const handleLoaded = () => {
      setDuration(audio.duration || 0);
      setIsLoading(false);
    };
    const handleTimeUpdate = () => {
      if (!isSeeking) {
        setCurrentTime(audio.currentTime || 0);
      }
    };
    const handlePlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
    };
    const handlePause = () => {
      setIsPlaying(false);
    };
    const handleWaiting = () => setIsLoading(true);
    const handleCanPlay = () => setIsLoading(false);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener("loadedmetadata", handleLoaded);
    audio.addEventListener("durationchange", handleLoaded);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("waiting", handleWaiting);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoaded);
      audio.removeEventListener("durationchange", handleLoaded);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("waiting", handleWaiting);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [isSeeking]);

  const progress = useMemo(() => {
    if (!duration || !Number.isFinite(duration)) {
      return 0;
    }

    return Math.max(0, Math.min((currentTime / duration) * 100, 100));
  }, [currentTime, duration]);

  const knobLeft = `calc(${(progress / 100).toFixed(4)} * (100% - var(--podcast-thumb-size)) + (var(--podcast-thumb-size) / 2))`;
  const displayLabel = normalizePlayerLabel(label);

  const handleTogglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (audio.paused) {
      setIsLoading(true);
      try {
        await audio.play();
      } catch {
        setIsLoading(false);
      }
      return;
    }

    audio.pause();
  };

  const handleSeekStart = () => setIsSeeking(true);

  const handleSeekEnd = () => {
    const audio = audioRef.current;
    if (!audio) {
      setIsSeeking(false);
      return;
    }

    setCurrentTime(audio.currentTime || 0);
    setIsSeeking(false);
  };

  const handleSeekChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) {
      return;
    }

    const nextProgress = Number(event.target.value);
    const nextTime = (nextProgress / 100) * duration;
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  return (
    <div className="podcast-player" data-loading={isLoading ? "true" : "false"}>
      <audio ref={audioRef} preload="metadata" src={src} playsInline />

      <div className="podcast-player-header">
        <p className="podcast-player-title">{displayLabel}</p>
        <div className="podcast-player-right">
          <span className="podcast-player-time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <button
            type="button"
            className="podcast-play-btn"
            data-state={isPlaying ? "pause" : "play"}
            onClick={handleTogglePlay}
            aria-label={isPlaying ? "暂停播客音频" : "播放播客音频"}
          >
            <span aria-hidden="true" className="podcast-play-icon" />
          </button>
        </div>
      </div>

      <div className="podcast-track-shell">
        <input
          type="range"
          className="podcast-track-input"
          min={0}
          max={100}
          step={0.1}
          value={progress}
          onChange={handleSeekChange}
          onMouseDown={handleSeekStart}
          onMouseUp={handleSeekEnd}
          onTouchStart={handleSeekStart}
          onTouchEnd={handleSeekEnd}
          aria-label="播客播放进度"
        />
        <div className="podcast-track-visual" aria-hidden="true">
          <span className="podcast-track-knob" style={{ left: knobLeft }} />
        </div>
      </div>
    </div>
  );
}
