import React, { useState, useRef, useEffect } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";

interface AudioPlayerProps {
  audioUrl: string;
  autoPlay?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  className?: string;
  registerAudioPlayer?: (url: string, audio: HTMLAudioElement) => void;
  unregisterAudioPlayer?: (url: string) => void;
  isCurrentlyPlaying?: boolean;
  onPlayRequested?: () => void;
}

/**
 * Audio player component for playing AI voice responses
 */
export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  audioUrl,
  autoPlay = false,
  onPlay,
  onPause,
  onEnded,
  className = "",
  registerAudioPlayer,
  unregisterAudioPlayer,
  isCurrentlyPlaying,
  onPlayRequested,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAutoPlayed, setHasAutoPlayed] = useState<boolean>(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize audio element
  useEffect(() => {
    if (!audioUrl) return;

    setIsLoading(true);
    setError(null);
    setHasAutoPlayed(false); // Reset auto-play flag for new audio

    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    // Audio event listeners
    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      setIsLoading(false);
    };

    const handleTimeUpdate = () => {
      const current = audio.currentTime;
      const total = audio.duration;
      setCurrentTime(current);
      setProgress(total ? (current / total) * 100 : 0);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      onPlay?.();
    };

    const handlePause = () => {
      setIsPlaying(false);
      onPause?.();
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      setCurrentTime(0);
      onEnded?.();
    };

    const handleError = () => {
      setError("Failed to load audio");
      setIsLoading(false);
      setIsPlaying(false);
    };

    const handleLoadStart = () => {
      setIsLoading(true);
    };

    const handleCanPlay = () => {
      setIsLoading(false);
    };

    // Add event listeners
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    audio.addEventListener("loadstart", handleLoadStart);
    audio.addEventListener("canplay", handleCanPlay);

    // Register this audio player with the parent
    if (registerAudioPlayer) {
      registerAudioPlayer(audioUrl, audio);
    }

    // Cleanup
    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("loadstart", handleLoadStart);
      audio.removeEventListener("canplay", handleCanPlay);

      audio.pause();
      audio.src = "";
      
      // Unregister this audio player when unmounted
      if (unregisterAudioPlayer) {
        unregisterAudioPlayer(audioUrl);
      }
    };
  }, [audioUrl]); // Only recreate when audioUrl changes

  // Handle autoPlay separately to avoid audio recreation
  useEffect(() => {
    if (autoPlay && !hasAutoPlayed && audioRef.current && !isLoading) {
      setHasAutoPlayed(true);
      setError(null); // Clear any previous errors

      // Try to play when audio is ready
      const attemptPlay = () => {
        if (audioRef.current) {
          audioRef.current
            .play()
            .then(() => {
              // Successfully started playing
            })
            .catch(error => {
              // Only log actual errors, not browser policy restrictions
              if (
                error.name !== "NotAllowedError" &&
                error.name !== "AbortError"
              ) {
                console.error("Error auto-playing audio:", error);
              }
            });
        }
      };

      // If duration is already set, play immediately
      if (duration > 0) {
        attemptPlay();
      } else {
        // Otherwise wait for loadedmetadata event
        const handleCanPlay = () => {
          attemptPlay();
          audioRef.current?.removeEventListener("canplay", handleCanPlay);
        };
        audioRef.current?.addEventListener("canplay", handleCanPlay);
      }
    }
  }, [autoPlay, hasAutoPlayed, isLoading, duration]);

  // Play/pause toggle
  const togglePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      // Notify parent first
      if (onPlayRequested) {
        onPlayRequested();
      }
      
      audioRef.current.play().catch(error => {
        console.error("Error playing audio:", error);
        setError("Failed to play audio");
      });
    }
  };

  // Seek to specific position
  const handleSeek = (newProgress: number) => {
    if (!audioRef.current || !duration) return;

    const newTime = (newProgress / 100) * duration;
    audioRef.current.currentTime = newTime;
    setProgress(newProgress);
  };

  // Toggle mute
  const toggleMute = () => {
    if (!audioRef.current) return;

    audioRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  // Format time as MM:SS
  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";

    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  // Don't render if no audio URL
  if (!audioUrl) return null;

  return (
    <div
      className={`flex items-center space-x-3 p-3 bg-gray-50 rounded-lg ${className}`}
    >
      {/* Play/Pause Button */}
      <button
        type="button"
        onClick={togglePlayPause}
        disabled={!!(isLoading || error)}
        className="btn btn-outline btn-sm w-10 h-10 rounded-full p-0 flex items-center justify-center"
      >
        {isLoading ? (
          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
        ) : isPlaying ? (
          <Pause className="w-4 h-4" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" />
        )}
      </button>

      {/* Progress Section */}
      <div className="flex-1 space-y-1">
        {/* Progress Bar */}
        <div className="relative">
          <progress
            value={progress}
            max={100}
            className="progress w-full h-2 cursor-pointer"
            onClick={(e: React.MouseEvent<HTMLProgressElement>) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const percentage = (x / rect.width) * 100;
              handleSeek(Math.max(0, Math.min(100, percentage)));
            }}
          />
        </div>

        {/* Time Display */}
        <div className="flex justify-between text-xs text-gray-500">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Mute Button */}
      <button
        type="button"
        onClick={toggleMute}
        disabled={!!(isLoading || error)}
        className="btn btn-ghost btn-sm w-8 h-8 p-0 flex items-center justify-center"
      >
        {isMuted ? (
          <VolumeX className="w-4 h-4" />
        ) : (
          <Volume2 className="w-4 h-4" />
        )}
      </button>

      {/* Error Display */}
      {error && <div className="text-xs text-red-500 ml-2">{error}</div>}
    </div>
  );
};
