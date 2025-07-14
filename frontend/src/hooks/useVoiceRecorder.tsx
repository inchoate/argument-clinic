import { useState, useRef, useCallback, useEffect } from "react";

export interface UseVoiceRecorderResult {
  isRecording: boolean;
  isListening: boolean;
  audioLevel: number;
  hasPermission: boolean | null;
  error: string | null;
  duration: number;
  isSupported: boolean;
  startRecording: () => Promise<boolean>;
  stopRecording: () => Promise<Blob | null>;
  startListening: () => Promise<boolean>;
  stopListening: () => void;
  initializeRecording: () => Promise<boolean>;
  cleanup: () => void;
  formatDuration: (seconds: number) => string;
}

/**
 * Custom hook for handling voice recording functionality
 * Provides recording controls, audio level monitoring, and blob generation
 */
export const useVoiceRecorder = (): UseVoiceRecorderResult => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false); // New: for continuous mode

  // Debug logging for state changes
  useEffect(() => {
    console.log("useVoiceRecorder isRecording state changed to:", isRecording);
  }, [isRecording]);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isListeningRef = useRef<boolean>(false); // Track listening state with ref

  // Initialize audio context and request permissions
  const initializeRecording = useCallback(async (): Promise<boolean> => {
    console.log("initializeRecording called");
    try {
      console.log("Requesting getUserMedia...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      console.log("Got media stream:", stream);
      streamRef.current = stream;

      // Force permission state update immediately
      console.log("Setting hasPermission to true");
      setHasPermission(true);
      setError(null);

      // Set up audio context for level monitoring
      console.log("Setting up audio context...");
      audioContextRef.current = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);

      analyserRef.current.fftSize = 256;

      console.log("Audio context initialized");
      return true;
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setHasPermission(false);
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  // Monitor audio levels during recording or listening
  const monitorAudioLevel = useCallback((): void => {
    if (!analyserRef.current || (!isRecording && !isListeningRef.current)) {
      console.log("monitorAudioLevel: No analyser or not recording/listening", {
        hasAnalyser: !!analyserRef.current,
        isRecording,
        isListening,
        isListeningRef: isListeningRef.current,
      });
      return;
    }

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Calculate average audio level
    const average =
      dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
    const normalizedLevel = average / 255; // Normalize to 0-1

    // Debug every 30 frames (roughly every second at 60fps) - commented out to reduce console spam
    // if (Math.random() < 0.033) {
    //   console.log('Audio monitoring:', {
    //     average,
    //     normalizedLevel,
    //     dataArrayLength: dataArray.length,
    //     firstFewValues: Array.from(dataArray.slice(0, 5))
    //   });
    // }

    setAudioLevel(normalizedLevel);

    if (isRecording || isListeningRef.current) {
      requestAnimationFrame(monitorAudioLevel);
    }
  }, []); // Empty dependency array - function should be stable

  // Start recording
  const startRecording = useCallback(async (): Promise<boolean> => {
    console.log("startRecording called");
    console.log("streamRef.current:", streamRef.current);

    if (!streamRef.current) {
      console.log("No stream, initializing...");
      const initialized = await initializeRecording();
      console.log("Initialization result:", initialized);
      if (!initialized) return false;
    }

    try {
      console.log("Creating MediaRecorder...");
      chunksRef.current = [];

      mediaRecorderRef.current = new MediaRecorder(
        streamRef.current as MediaStream,
        {
          mimeType: "audio/webm;codecs=opus",
        }
      );

      mediaRecorderRef.current.ondataavailable = (event: BlobEvent) => {
        console.log("Data available:", event.data.size);
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      console.log("Starting MediaRecorder...");
      mediaRecorderRef.current.start();
      console.log("Setting isRecording to true...");
      setIsRecording(true);
      setDuration(0);
      setError(null);

      // Start duration timer
      durationIntervalRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

      // Start audio level monitoring
      requestAnimationFrame(monitorAudioLevel);

      console.log("Recording started successfully");
      return true;
    } catch (err) {
      console.error("Error starting recording:", err);
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [initializeRecording, monitorAudioLevel]);

  // Stop recording and return audio blob
  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise(resolve => {
      if (!mediaRecorderRef.current || !isRecording) {
        resolve(null);
        return;
      }

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        setIsRecording(false);
        setAudioLevel(0);

        // Clear duration timer
        if (durationIntervalRef.current) {
          clearInterval(durationIntervalRef.current);
          durationIntervalRef.current = null;
        }

        resolve(audioBlob);
      };

      mediaRecorderRef.current.stop();
    });
  }, [isRecording]);

  // Cleanup function - only for component unmount
  const cleanup = useCallback((): void => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current
        .getTracks()
        .forEach((track: MediaStreamTrack) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    setIsRecording(false);
    setAudioLevel(0);
    setDuration(0);
  }, []); // No dependencies - only create once

  // Cleanup on unmount only
  useEffect(() => {
    return cleanup;
  }, []); // Empty dependency array - only run on mount/unmount

  // Check if browser supports recording
  const isSupported: boolean = !!(
    navigator.mediaDevices && navigator.mediaDevices.getUserMedia
  );

  // Start listening mode (for continuous voice detection)
  const startListening = useCallback(async (): Promise<boolean> => {
    console.log("startListening called");

    if (!streamRef.current || !analyserRef.current) {
      console.log(
        "Need to initialize audio - stream exists:",
        !!streamRef.current,
        "analyser exists:",
        !!analyserRef.current
      );
      const initialized = await initializeRecording();
      if (!initialized) return false;
    }

    console.log("Setting isListening to true in hook");
    setIsListening(true);
    isListeningRef.current = true; // Update ref immediately
    setError(null);
    console.log("Listening mode started");
    console.log("Audio context state:", audioContextRef.current?.state);
    console.log("Analyser exists:", !!analyserRef.current);

    // Small delay to ensure state is updated before starting monitoring
    setTimeout(() => {
      if (analyserRef.current) {
        console.log("Starting audio level monitoring for listening mode");
        monitorAudioLevel();
      } else {
        console.error("No analyser available for audio level monitoring");
      }
    }, 100);

    return true;
  }, [initializeRecording, monitorAudioLevel]);

  // Stop listening mode
  const stopListening = useCallback((): void => {
    console.log("stopListening called");
    setIsListening(false);
    isListeningRef.current = false; // Update ref immediately
    setAudioLevel(0);
  }, []);

  // Format duration as MM:SS
  const formatDuration = useCallback((seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  }, []);

  return {
    // State
    isRecording,
    isListening,
    audioLevel,
    hasPermission,
    error,
    duration,
    isSupported,

    // Actions
    startRecording,
    stopRecording,
    startListening,
    stopListening,
    initializeRecording,
    cleanup,

    // Utilities
    formatDuration,
  };
};
