import React, { useState, useEffect, useCallback, useRef } from "react";
import { Mic, MicOff, Square } from "lucide-react";
import { useVoiceRecorder } from "../hooks/useVoiceRecorder.tsx";

/**
 * Voice recorder component with real-time audio level monitoring
 */
interface VoiceRecorderProps {
  onRecordingComplete?: (blob: Blob) => void;
  onRecordingStart?: () => void;
  onRecordingStop?: (blob: Blob) => void;
  onAudioLevel?: (level: number) => void;
  disabled?: boolean;
  maxDuration?: number;
  className?: string;
  pushToTalk?: boolean;
  continuousMode?: boolean;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  onRecordingComplete,
  onRecordingStart,
  onRecordingStop,
  onAudioLevel,
  disabled = false,
  maxDuration = 60,
  className = "",
  pushToTalk = false,
  continuousMode = false,
}) => {
  const {
    isRecording,
    isListening: hookIsListening,
    audioLevel,
    hasPermission,
    error,
    duration,
    isSupported,
    startRecording,
    stopRecording,
    startListening,
    stopListening,
    initializeRecording,
    formatDuration,
  } = useVoiceRecorder();

  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isToggling, setIsToggling] = useState(false); // Prevent rapid clicks
  const [isListening, setIsListening] = useState(false); // For continuous mode
  const [silenceTimer, setSilenceTimer] = useState<NodeJS.Timeout | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Request permissions on mount
  useEffect(() => {
    if (isSupported && hasPermission === null) {
      initializeRecording();
    }
  }, [isSupported, hasPermission, initializeRecording]);

  // Handle start recording
  const handleStartRecording = useCallback(async () => {
    console.log("handleStartRecording called", {
      disabled,
      isRecording,
      hasPermission,
      isSupported,
    });

    if (disabled) {
      console.log("Recording blocked - disabled");
      return;
    }

    console.log("Calling startRecording...");
    const success = await startRecording();
    console.log("startRecording result:", success);

    if (success) {
      setRecordedBlob(null);
      onRecordingStart?.();
      console.log("Recording started successfully");
    } else {
      console.log("Recording failed to start");
    }
  }, [disabled, startRecording, onRecordingStart]);

  // Handle stop recording
  const handleStopRecording = useCallback(async () => {
    if (!isRecording) return;

    try {
      const blob = await stopRecording();

      if (blob instanceof Blob) {
        setRecordedBlob(blob);
        onRecordingStop?.(blob);

        // Auto-send recording immediately
        if (onRecordingComplete) {
          await onRecordingComplete(blob);
          setRecordedBlob(null);
        }
      }
    } catch (error) {
      console.error("Error during recording stop/processing:", error);
    }
  }, [
    isRecording,
    stopRecording,
    onRecordingStop,
    pushToTalk,
    onRecordingComplete,
  ]);

  // Auto-stop recording at max duration
  useEffect(() => {
    if (isRecording && duration >= maxDuration) {
      handleStopRecording();
    }
  }, [isRecording, duration, maxDuration, handleStopRecording]);

  // Call onAudioLevel callback when audio level changes
  useEffect(() => {
    if (onAudioLevel) {
      onAudioLevel(audioLevel);
    }
  }, [audioLevel, onAudioLevel]);

  // Add debug logging for disabled prop changes
  useEffect(() => {
    console.log('VoiceRecorder disabled prop changed:', disabled);
  }, [disabled]);

  // Voice Activity Detection for continuous mode
  useEffect(() => {
    if (!continuousMode || !hasPermission) return;

    const VOICE_THRESHOLD = 0.07; // Threshold above background noise level (~0.05)
    const SILENCE_TIMEOUT = 500; // 0.75 seconds of silence before stopping

    // Debug: log audio levels periodically (commented out to reduce console spam)
    // if (audioLevel > 0) {
    //   console.log(`Audio level: ${audioLevel.toFixed(4)}, threshold: ${VOICE_THRESHOLD}, above threshold: ${audioLevel > VOICE_THRESHOLD}`);
    // }

    if (audioLevel > VOICE_THRESHOLD) {
      // Voice detected
      if (!isRecording && !disabled) {
        console.log("Starting recording - audioLevel:", audioLevel.toFixed(4));
        handleStartRecording();
      } else if (!isRecording && disabled) {
        console.log(
          "Voice detected but disabled - skipping recording start"
        );
      }

      // Clear any existing silence timer
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
        setSilenceTimer(null);
      }
    } else if (isRecording && audioLevel <= VOICE_THRESHOLD) {
      // Silence detected while recording
      if (!silenceTimerRef.current) {
        const timer = setTimeout(() => {
          silenceTimerRef.current = null;
          setSilenceTimer(null);
          // Only stop recording if we've been recording for at least 500ms to avoid tiny clips
          if (duration >= 0.5) {
            handleStopRecording();
          } else {
            console.log(`Recording too short (${duration}s), continuing...`);
          }
        }, SILENCE_TIMEOUT);
        silenceTimerRef.current = timer;
        setSilenceTimer(timer);
      }
    }

    // Don't return cleanup function - let the timer run
  }, [
    audioLevel,
    isRecording,
    disabled,
    continuousMode,
    hasPermission,
    handleStartRecording,
    handleStopRecording,
  ]);

  // Cleanup silence timer when component unmounts or continuous mode is disabled
  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
        setSilenceTimer(null);
      }
    };
  }, [continuousMode]); // Only run when continuous mode changes

  // Initialize continuous mode - start listening for audio levels
  useEffect(() => {
    if (continuousMode && hasPermission === true && !hookIsListening) {
      console.log("Continuous mode activated - starting listening mode");
      startListening().then(success => {
        if (success) {
          setIsListening(true);
          console.log("Component listening state set to true");
        }
      });
    } else if (!continuousMode && hookIsListening) {
      console.log("Continuous mode deactivated - stopping listening mode");
      stopListening();
      setIsListening(false);
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
        setSilenceTimer(null);
      }
      if (isRecording) {
        handleStopRecording();
      }
    }
  }, [
    continuousMode,
    hasPermission,
    hookIsListening,
    startListening,
    stopListening,
    isRecording,
    handleStopRecording,
  ]);

  // Sync component listening state with hook listening state
  useEffect(() => {
    setIsListening(hookIsListening);
  }, [hookIsListening]);

  // Push-to-talk handlers
  const handleMouseDown = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pushToTalk || isRecording || disabled) return;
    await handleStartRecording();
  };

  const handleMouseUp = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pushToTalk || !isRecording) return;
    await handleStopRecording();
  };

  const handleMouseLeave = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pushToTalk || !isRecording) return;
    await handleStopRecording();
  };

  const handleTouchStart = async (e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pushToTalk || isRecording || disabled) return;
    await handleStartRecording();
  };

  const handleTouchEnd = async (e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pushToTalk || !isRecording) return;
    await handleStopRecording();
  };

  // Get microphone button state
  const getMicButtonProps = () => {
    if (!isSupported) {
      return {
        disabled: true,
        variant: "outline",
        title: "Voice recording not supported in this browser",
      };
    }

    if (hasPermission === false) {
      return {
        disabled: true,
        variant: "destructive",
        title: "Microphone permission denied",
      };
    }

    if (disabled) {
      return {
        disabled: true,
        variant: "outline",
        title: "Recording disabled",
      };
    }

    if (isRecording) {
      return {
        variant: "destructive",
        title: "Stop recording",
      };
    }

    return {
      variant: hasPermission ? "default" : "outline",
      title: hasPermission
        ? "Start recording"
        : "Request microphone permission",
    };
  };

  const micButtonProps = getMicButtonProps();

  // Show error state
  if (error) {
    return (
      <div className={`alert alert-error ${className}`}>
        <span>Microphone error: {error}</span>
      </div>
    );
  }

  // Show unsupported state
  if (!isSupported) {
    return (
      <div className={`alert alert-warning ${className}`}>
        <span>
          Voice recording is not supported in this browser. Please use a modern
          browser like Chrome, Firefox, or Safari.
        </span>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Recording Controls */}
      <div className="flex flex-col items-center space-y-4">
        {/* Continuous Mode Status */}
        {continuousMode && (
          <div className="text-center space-y-3">
            <div
              className={`flex items-center justify-center space-x-2 ${
                isListening ? "text-primary" : "text-base-content/60"
              }`}
            >
              <div
                className={`w-3 h-3 rounded-full ${
                  isListening
                    ? "bg-primary animate-pulse"
                    : "bg-base-content/30"
                }`}
              ></div>
              <span className="text-sm font-medium">
                {isListening
                  ? "Listening for voice..."
                  : "Continuous mode inactive"}
              </span>
            </div>

            {/* Audio Level Indicator for Continuous Mode */}
            {isListening && (
              <div className="space-y-2">
                <div className="flex items-center justify-center space-x-1">
                  {Array.from({ length: 10 }).map((_, i) => {
                    const barHeight = Math.max(4, audioLevel * 40);
                    const isActive = audioLevel > 0.07 && i < audioLevel * 10;
                    return (
                      <div
                        key={i}
                        className={`rounded-full transition-all duration-100 ${
                          isActive ? "bg-primary" : "bg-base-content/20"
                        }`}
                        style={{
                          width: "2px",
                          height: `${isActive ? Math.min(barHeight, 16) : 4}px`,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {isListening && !isRecording && audioLevel <= 0.04 && (
              <p className="text-xs text-base-content/60">
                Start speaking to begin recording
              </p>
            )}
          </div>
        )}
        {/* Main Record Button - Hidden in continuous mode */}
        {!continuousMode && (
          <div className="relative">
            <div
              onClick={async e => {
                e.stopPropagation();
                e.preventDefault();
                console.log("MIC BUTTON CLICKED!");
                console.log("State:", {
                  isRecording,
                  hasPermission,
                  disabled,
                  isSupported,
                });
                console.log("Action will be:", isRecording ? "STOP" : "START");

                // Don't allow clicks while toggling or disabled
                if (isToggling || disabled) {
                  console.log("Ignoring click - still toggling or disabled");
                  return;
                }

                setIsToggling(true);

                // Request permission first if needed
                if (hasPermission === null) {
                  console.log("Requesting microphone permission...");
                  const success = await initializeRecording();
                  if (!success) {
                    console.log("Failed to initialize recording");
                    setIsToggling(false);
                    return;
                  }
                  console.log("Permission granted, starting recording...");
                  // Continue to start recording after getting permission
                }

                if (hasPermission === false) {
                  console.log("Microphone permission denied");
                  alert(
                    "Microphone permission denied. Please allow microphone access in your browser settings."
                  );
                  setIsToggling(false);
                  return;
                }

                try {
                  if (isRecording) {
                    console.log("STOPPING recording...");
                    await handleStopRecording();
                    console.log("Recording stopped");
                  } else {
                    console.log("STARTING recording...");
                    await handleStartRecording();
                    console.log("Recording started");
                  }
                } catch (error) {
                  console.error("Error toggling recording:", error);
                } finally {
                  setIsToggling(false);
                }
              }}
              onMouseDown={pushToTalk ? handleMouseDown : undefined}
              onMouseUp={pushToTalk ? handleMouseUp : undefined}
              onMouseLeave={pushToTalk ? handleMouseLeave : undefined}
              onTouchStart={pushToTalk ? handleTouchStart : undefined}
              onTouchEnd={pushToTalk ? handleTouchEnd : undefined}
              style={{ zIndex: 10 }}
              className={`btn btn-circle w-16 h-16 transition-all duration-200 transform hover:scale-105 ${
                isRecording
                  ? "btn-error animate-pulse"
                  : hasPermission === false
                    ? "btn-disabled"
                    : "btn-primary"
              }`}
            >
              {disabled && !isRecording ? (
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
              ) : isRecording ? (
                <Square className="w-6 h-6 mx-auto" fill="currentColor" />
              ) : hasPermission === false ? (
                <MicOff className="w-6 h-6 mx-auto" />
              ) : (
                <Mic className="w-6 h-6 mx-auto" />
              )}
            </div>

            {/* Recording ring animation */}
            {isRecording && (
              <div className="absolute inset-0 rounded-full border-4 border-error animate-ping pointer-events-none"></div>
            )}
          </div>
        )}{" "}
        {/* Close continuous mode button conditional */}
        {/* Recording Status */}
        {isRecording && (
          <div className="w-full max-w-sm space-y-3">
            {/* Recording indicator */}
            <div className="flex items-center justify-center space-x-2 text-error">
              <div className="w-3 h-3 bg-error rounded-full animate-pulse"></div>
              <span className="text-sm font-medium">Recording...</span>
              <span className="text-sm font-mono badge badge-error badge-outline">
                {formatDuration(duration)}
              </span>
            </div>

            {/* Audio Level Visualizer */}
            <div className="flex items-center justify-center space-x-1">
              {Array.from({ length: 20 }).map((_, i) => {
                const barHeight = Math.max(
                  20,
                  audioLevel * 100 * (1 + Math.sin(i * 0.5))
                );
                return (
                  <div
                    key={i}
                    className="bg-gradient-to-t from-error to-error rounded-full transition-all duration-75"
                    style={{
                      width: "3px",
                      height: `${Math.min(barHeight, 40)}px`,
                      opacity: audioLevel > 0.1 ? 0.8 : 0.3,
                    }}
                  />
                );
              })}
            </div>

            {/* Duration Warning */}
            {duration > maxDuration * 0.8 && (
              <div className="alert alert-warning text-xs py-1">
                Auto-stop at {formatDuration(maxDuration)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status Messages */}
      <div className="text-center max-w-sm mx-auto">
        {hasPermission === null && (
          <p className="text-sm text-base-content/70">
            Click the microphone to enable voice recording
          </p>
        )}

        {hasPermission === false && (
          <div className="alert alert-error">
            <span className="text-sm">
              Microphone permission required. Please allow access and refresh
              the page.
            </span>
          </div>
        )}

        {hasPermission === true && !isRecording && !recordedBlob && (
          <p className="text-sm text-base-content/70">
            {pushToTalk
              ? "Hold to record your argument"
              : "Click to start recording"}
          </p>
        )}
      </div>
    </div>
  );
};
