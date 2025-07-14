import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, Send, Activity, Volume2, BarChart } from "lucide-react";
import { VoiceRecorder } from "./components/VoiceRecorder";
import { AudioPlayer } from "./components/AudioPlayer";
import "./App.css";

const WS_BASE_URL = "ws://localhost:8000/ws";

const INITIAL_METRICS = {
  avg_response_time_ms: 0,
  active_sessions: 1,
  p95_response_time_ms: 0,
  total_requests: 0,
};

const WELCOME_MESSAGES = {
  fallback:
    "Good morning! Welcome to the Argument Clinic. How may I help you today?",
  offline:
    "Welcome to the Argument Clinic! I'm ready to argue with you. What would you like to debate?",
};

const ERROR_MESSAGES = {
  sendText:
    "This is not an argument, it's just contradiction! Please try again.",
  sendVoice:
    "The parrot appears to be dead. Please try refreshing and try again.",
};

const SILLY_LOADING_MESSAGES = [
  "Thinking...",
  "Consulting the Dead Parrot...",
  "Fetching the Colonel...",
  "Being terribly British...",
  "Practicing contradiction...",
  "Consulting notes...",
];

const STATE_BADGE_MAP = {
  // Frontend state names (legacy)
  entry: "badge-info",
  simple_contradiction: "badge-error",
  argumentation: "badge-warning",
  resolution: "badge-secondary",
  meta_commentary: "badge-neutral",
  // Backend node names (current)
  EntryNode: "badge-info",
  SimpleContradictionNode: "badge-error", 
  ArgumentationNode: "badge-warning",
  ResolutionNode: "badge-secondary",
  MetaCommentaryNode: "badge-neutral",
  End: "badge-secondary",
  Unknown: "badge-ghost",
  default: "badge-success",
};

const HOW_IT_WORKS_STEPS = [
  "Start by asking if this is the correct room for an argument",
  "The AI arguer will counter-attack",
  "Continue the debate by defending your position",
  "Experience the full Mounty Python argument progression",
];

const FEATURES = [
  {
    icon: Mic,
    title: "Voice Mode",
    description: "Engage in verbal debates",
    badgeClass: "badge-secondary",
  },
  {
    icon: Send,
    title: "Text Mode",
    description: "Precise written arguments",
    badgeClass: "badge-info",
  },
  {
    icon: Activity,
    title: "Debug Mode",
    description: "See performance metrics",
    badgeClass: "badge-success",
  },
];

interface Message {
  type: "user" | "ai" | "error";
  text: string;
  timestamp: Date;
  state?: string;
  responseTime?: number;
  cacheHit?: boolean;
  audioUrl?: string;
  isVoice?: boolean;
}

interface Metrics {
  avg_response_time_ms: number;
  active_sessions: number;
  p95_response_time_ms: number;
  total_requests: number;
}

function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentState, setCurrentState] = useState("entry");
  const [conversation, setConversation] = useState<Message[]>([]);
  // Centralized state management
  type RecordingState = "idle" | "listening" | "recording" | "processing" | "error";
  
  // Unified error handling
  type AppError = {
    type: "permission" | "websocket" | "recording" | "processing";
    message: string;
    timestamp: Date;
  };
  
  const [inputText, setInputText] = useState("");
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [isInitializing, setIsInitializing] = useState(true);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [metrics, setMetrics] = useState<Metrics>(INITIAL_METRICS);
  const [_isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isContinuousVoice, setIsContinuousVoice] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [appError, setAppError] = useState<AppError | null>(null);
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Audio management state
  const [currentlyPlayingAudio, setCurrentlyPlayingAudio] = useState<string | null>(null);
  const audioRefs = useRef<{[key: string]: HTMLAudioElement | null}>({});
  
  // WebSocket reconnection
  const MAX_RETRIES = 5;
  const BASE_DELAY = 1000; // 1s
  const wsRetryCount = useRef(0);
  const wsReconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  
  // Derived states for backward compatibility
  const isLoading = recordingState === "processing";
  const isProcessingRequest = recordingState === "processing";
  
  // Debug: Log when recordingState changes
  useEffect(() => {
    console.log(`🔄 Recording state changed to: ${recordingState}`);
  }, [recordingState]);

  // Refs
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsErrorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize WebSocket connection on component mount
  useEffect(() => {
    connectWebSocket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Auto-scroll to bottom when conversation updates
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [conversation]);

  const resetConversation = () => {
    setConversation([]);
    setCurrentState("entry");
    if (wsConnected) {
      // Reconnect WebSocket to reset session
      disconnectWebSocket();
      setTimeout(() => connectWebSocket(), 100);
    } else {
      // Fallback welcome message
      addMessageToConversation(
        createMessage("ai", "Welcome to the Argument Clinic! Please start by saying something.")
      );
    }
  };

  const sendMessage = (text: string) => {
    if (!text.trim() || isLoading || !wsConnected || isProcessingRequest) return;

    // Add user message to conversation
    addMessageToConversation(createMessage("user", text));
    setInputText("");
    setRecordingState("processing");

    // Send via WebSocket
    const success = sendWebSocketMessage(text);
    if (!success) {
      handleError("websocket", "Failed to send message. Please check your connection.");
    }
  };

  const sendVoiceMessage = async (audioBlob: Blob) => {
    if (!audioBlob || !wsConnected || isLoading || isProcessingRequest) return;

    // Validate audio blob size - don't send tiny/empty recordings
    const MIN_AUDIO_SIZE = 2000; // 2KB minimum to avoid noise/silence
    if (audioBlob.size < MIN_AUDIO_SIZE) {
      console.log(`Skipping tiny audio blob: ${audioBlob.size} bytes (minimum: ${MIN_AUDIO_SIZE} bytes)`);
      return;
    }

    try {
      console.log('🎤 Setting recordingState=processing for voice message');
      setRecordingState("processing");
      
      // Set a backup timeout to reset processing state if it gets stuck
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
      processingTimeoutRef.current = setTimeout(() => {
        console.warn('⚠️ Voice processing timeout - force resetting to idle');
        setRecordingState("idle");
        processingTimeoutRef.current = null;
      }, 10000); // 10 second backup timeout

      // Convert audio blob to base64 for WebSocket transmission (optimized)
      const base64Audio = await convertBlobToBase64(audioBlob);

      // Send via WebSocket
      const message = {
        type: 'voice_input',
        audio_data: base64Audio,
        session_id: sessionId
      };

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(message));
      } else {
        handleError("websocket", "WebSocket not connected. Cannot send voice message.");
      }
    } catch (error) {
      console.error("Failed to send voice message:", error);
      addErrorMessage(ERROR_MESSAGES.sendVoice);
      setRecordingState("error");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputText);
    }
  };

  const resetSession = async () => {
    setConversation([]);
    setCurrentState("entry");
    if (wsConnected) {
      // Reconnect WebSocket to reset session
      disconnectWebSocket();
      setTimeout(() => connectWebSocket(), 100);
    }
  };

  const updateMetrics = useCallback(
    (responseTime: number) => {
      setMetrics(prev => {
        const newTotal = prev.total_requests + 1;
        const newAvg =
          (prev.avg_response_time_ms * prev.total_requests + responseTime) /
          newTotal;

        // Calculate P95 from conversation response times
        const allResponseTimes = conversation
          .filter(m => m.responseTime)
          .map(m => m.responseTime!)
          .concat([responseTime])
          .sort((a, b) => a - b);

        const p95Index = Math.floor(allResponseTimes.length * 0.95);
        const p95 = allResponseTimes[p95Index] || responseTime;

        return {
          avg_response_time_ms: newAvg,
          active_sessions: 1,
          p95_response_time_ms: p95,
          total_requests: newTotal,
        };
      });
    },
    [conversation]
  );


  const toggleDebug = useCallback(() => {
    setShowDebug(prev => !prev);
  }, []);

  // Helper functions
  const createMessage = useCallback(
    (
      type: Message["type"],
      text: string,
      options?: Partial<Message>
    ): Message => ({
      type,
      text,
      timestamp: new Date(),
      ...options,
    }),
    []
  );

  const addMessageToConversation = useCallback((message: Message) => {
    setConversation(prev => [...prev, message]);
  }, []);

  // Unified error handler
  const handleError = useCallback((type: AppError["type"], message: string) => {
    console.error(`[${type}] ${message}`);
    const error = { type, message, timestamp: new Date() };
    setAppError(error);
    setRecordingState("error");
    
    // Add to conversation for user visibility
    addMessageToConversation(createMessage("error", message));

    // Automatic error clearing
    setTimeout(() => {
      setAppError(null);
      setRecordingState("idle");
    }, 5000);
  }, [addMessageToConversation, createMessage]);
  
  const addErrorMessage = useCallback(
    (errorText: string) => {
      handleError("processing", errorText);
    },
    [handleError]
  );
  
  // Optimized audio processing pipeline
  const convertBlobToBase64 = useCallback((blob: Blob): Promise<string> => {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(",")[1];
        resolve(base64String);
      };
      reader.readAsDataURL(blob);
    });
  }, []);


  // WebSocket functions with exponential backoff
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return; // Already connected
    }
    
    const delay = Math.min(BASE_DELAY * Math.pow(2, wsRetryCount.current), 30000);
    
    if (wsRetryCount.current > 0) {
      console.log(`Attempting WebSocket reconnect in ${delay}ms (attempt ${wsRetryCount.current + 1}/${MAX_RETRIES})...`);
    }
    
    // Clear any existing reconnect timeout
    if (wsReconnectTimeout.current) {
      clearTimeout(wsReconnectTimeout.current);
      wsReconnectTimeout.current = null;
    }
    
    const connectAttempt = () => {
      const ws = new WebSocket(`${WS_BASE_URL}/argument`);
    
      ws.onopen = () => {
        console.log('WebSocket connected successfully');
        setWsConnected(true);
        setCurrentState("entry");
        wsRetryCount.current = 0; // Reset retry count on successful connection
        
        // Clear any pending error timeout
        if (wsErrorTimeoutRef.current) {
          clearTimeout(wsErrorTimeoutRef.current);
          wsErrorTimeoutRef.current = null;
        }
        
        // Reset error state if we had connection issues
        if (appError?.type === "websocket") {
          setAppError(null);
          setRecordingState("idle");
        }
      };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`🔄 WebSocket message received: ${data.type}`, data);
        
        if (data.type === 'session_start') {
          setSessionId(data.session_id);
          addMessageToConversation(createMessage("ai", data.content));
        } else if (data.type === 'transcription') {
          console.log('📝 Transcription received, keeping isProcessingRequest=true');
          // Add transcribed user message to conversation
          addMessageToConversation(
            createMessage("user", data.content, { isVoice: true })
          );
          // Don't reset isProcessingRequest here - wait for ai_response
        } else if (data.type === 'ai_response') {
          console.log('🤖 AI response received, resetting to idle state');
          
          // Clear the backup timeout since we got a proper response
          if (processingTimeoutRef.current) {
            clearTimeout(processingTimeoutRef.current);
            processingTimeoutRef.current = null;
          }
          
          // For WebSocket, calculate response time from message sending to receiving
          const responseTime = data.response_time_ms || 0;
          addMessageToConversation(
            createMessage("ai", data.content, {
              state: data.current_node || "Unknown",
              responseTime,
              cacheHit: false,
              isVoice: data.is_voice || false,
              audioUrl: data.audio_url || undefined,
            })
          );
          if (responseTime > 0) {
            updateMetrics(responseTime);
          }
          setCurrentState(data.current_node || "Unknown");
          setRecordingState("idle");
          console.log('✅ Recording state reset to idle after AI response');
        } else if (data.type === 'error') {
          console.log('❌ Error received, setting state to error');
          addErrorMessage(data.content);
          setRecordingState("error");
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
        setRecordingState("error");
      }
    };
    
      ws.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        setWsConnected(false);
        
        // Attempt reconnection if we haven't exceeded max retries
        if (wsRetryCount.current < MAX_RETRIES && !event.wasClean) {
          wsRetryCount.current++;
          wsReconnectTimeout.current = setTimeout(connectWebSocket, delay);
        } else if (wsRetryCount.current >= MAX_RETRIES) {
          handleError("websocket", `Failed to reconnect after ${MAX_RETRIES} attempts. Please refresh the page.`);
        }
      };
    
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setWsConnected(false);
        
        // Only show error message after a delay if connection doesn't succeed
        wsErrorTimeoutRef.current = setTimeout(() => {
          if (wsRetryCount.current < MAX_RETRIES) {
            console.log('WebSocket error - will attempt reconnection');
          } else {
            handleError("websocket", "WebSocket connection failed. Please refresh to reconnect.");
          }
        }, 2000);
      };
      
      wsRef.current = ws;
    };
    
    if (delay > 0 && wsRetryCount.current > 0) {
      wsReconnectTimeout.current = setTimeout(connectAttempt, delay);
    } else {
      connectAttempt();
    }
  }, [addMessageToConversation, createMessage, handleError, updateMetrics, appError]);

  const disconnectWebSocket = useCallback(() => {
    // Clear reconnection attempts
    if (wsReconnectTimeout.current) {
      clearTimeout(wsReconnectTimeout.current);
      wsReconnectTimeout.current = null;
    }
    wsRetryCount.current = 0;
    
    if (wsRef.current) {
      wsRef.current.close(1000, 'Manual disconnect'); // Clean close
      wsRef.current = null;
      setWsConnected(false);
    }
    
    // Clear any pending error timeout
    if (wsErrorTimeoutRef.current) {
      clearTimeout(wsErrorTimeoutRef.current);
      wsErrorTimeoutRef.current = null;
    }
  }, []);

  const sendWebSocketMessage = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return false;
    }

    const message = {
      type: 'user_input',
      content: text,
      session_id: sessionId
    };

    wsRef.current.send(JSON.stringify(message));
    return true;
  }, [sessionId]);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      disconnectWebSocket();
    };
  }, [disconnectWebSocket]);

  // UI Helper Components
  const MessageAvatar = ({ type }: { type: Message["type"] }) => (
    <div className="chat-image avatar">
      <div className="w-10 rounded-full">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${
            type === "user"
              ? "bg-primary text-primary-content"
              : type === "error"
                ? "bg-error text-error-content"
                : "bg-secondary text-secondary-content"
          }`}
        >
          {type === "user" ? "You" : type === "error" ? "!" : "MB"}
        </div>
      </div>
    </div>
  );

  const MessageHeader = ({
    type,
    timestamp,
  }: {
    type: Message["type"];
    timestamp: Date;
  }) => (
    <div className="chat-header">
      {type === "user" ? "You" : "Mr. Barnard"}
      <time className="text-xs opacity-50 ml-1">
        {timestamp.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </time>
    </div>
  );

  const MessageFooter = ({
    type,
    responseTime,
    cacheHit,
  }: {
    type: Message["type"];
    responseTime?: number;
    cacheHit?: boolean;
  }) => (
    <div className="chat-footer opacity-50 text-xs">
      {type === "user" ? "Sent" : "Delivered"}
      {responseTime && (
        <span className="ml-2">• {responseTime.toFixed(0)}ms</span>
      )}
      {cacheHit && <span className="ml-1">• Cached</span>}
    </div>
  );

  const LoadingMessage = () => {
    const [loadingMessage, setLoadingMessage] = useState("Thinking...");

    // Rotate through silly loading messages
    useEffect(() => {
      const interval = setInterval(() => {
        setLoadingMessage(prev => {
          const currentIndex = SILLY_LOADING_MESSAGES.indexOf(prev);
          const nextIndex = (currentIndex + 1) % SILLY_LOADING_MESSAGES.length;
          return SILLY_LOADING_MESSAGES[nextIndex];
        });
      }, 1500);

      return () => clearInterval(interval);
    }, []);

    return (
      <div className="chat chat-start">
        <MessageAvatar type="ai" />
        <MessageHeader type="ai" timestamp={new Date()} />
        <div className="chat-bubble chat-bubble-secondary">
          <div className="flex items-center space-x-2">
            <span className="loading loading-dots loading-sm"></span>
            <span className="text-sm">{loadingMessage}</span>
          </div>
        </div>
      </div>
    );
  };

  const StepItem = ({ step, index }: { step: string; index: number }) => (
    <div className="flex items-start space-x-2">
      <div className="badge badge-info w-5 h-5 text-[10px] flex items-center justify-center">
        {index + 1}
      </div>
      <p className="text-xs text-base-content/70 leading-tight">{step}</p>
    </div>
  );

  const FeatureItem = ({
    icon: Icon,
    title,
    description,
    badgeClass,
  }: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description: string;
    badgeClass: string;
  }) => (
    <div className="flex items-center space-x-2">
      <div className={`badge ${badgeClass} gap-1 p-2 text-xs`}>
        <Icon className="w-3 h-3" />
      </div>
      <div>
        <p className="text-xs font-medium text-base-content leading-tight">
          {title}
        </p>
        <p className="text-[11px] text-base-content/60 leading-tight">
          {description}
        </p>
      </div>
    </div>
  );

  const InfoCard = ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <div className="card bg-base-100 shadow-xl text-sm">
      <div className="card-body p-4">
        <h3 className="card-title text-base-content mb-3 text-base font-semibold">
          {title}
        </h3>
        <div className="space-y-2">{children}</div>
      </div>
    </div>
  );

  // Audio management functions
  const handleAudioPlayRequest = useCallback((audioUrl: string) => {
    // Pause any currently playing audio
    if (currentlyPlayingAudio && currentlyPlayingAudio !== audioUrl) {
      const audio = audioRefs.current[currentlyPlayingAudio];
      if (audio) {
        audio.pause();
      }
    }
    
    // Set new audio as currently playing
    setCurrentlyPlayingAudio(audioUrl);
  }, [currentlyPlayingAudio]);

  const registerAudioPlayer = useCallback((url: string, audio: HTMLAudioElement) => {
    audioRefs.current[url] = audio;
  }, []);

  const unregisterAudioPlayer = useCallback((url: string) => {
    delete audioRefs.current[url];
    if (currentlyPlayingAudio === url) {
      setCurrentlyPlayingAudio(null);
    }
  }, [currentlyPlayingAudio]);

  // Stable callback functions for AudioPlayer
  const handleAudioPlay = useCallback(() => setIsAudioPlaying(true), []);
  const handleAudioPause = useCallback(() => setIsAudioPlaying(false), []);
  const handleAudioEnded = useCallback(() => setIsAudioPlaying(false), []);

  return (
    <div className="min-h-screen bg-base-200">
      {/* Modern Header */}
      <header className="bg-base-100/80 backdrop-blur-sm border-b border-base-300 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-content text-xl font-bold hover:rotate-12 transition-transform duration-300 cursor-pointer silly-wobble">
                A
              </div>
              <h1 className="text-xl font-semibold text-base-content">
                The Argument Clinic
              </h1>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={resetSession}
                className="btn btn-secondary hover:btn-accent transition-all duration-300 hover:scale-105 active:scale-95"
                disabled={isLoading}
              >
                {isLoading ? "Hold on..." : "New Session"}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12 animate-fade-in">
          <div className="mb-8">
            <h1 className="text-4xl sm:text-5xl font-bold text-base-content mb-6 hover:text-primary transition-colors duration-500">
              Welcome to the{" "}
              <span className="text-primary hover:text-accent transition-colors duration-300 cursor-default">
                Argument Clinic
              </span>
            </h1>
            <div className="max-w-md mx-auto mb-4">
              <img
                src="/mounty-python.png"
                alt="The Argument Clinic - Mounty Python"
                className="w-full h-auto rounded-lg shadow-xl border-4 border-primary/20 hover:rotate-1 transition-transform duration-300 hover:scale-105 cursor-pointer parrot-bounce british-hover"
                style={{
                  filter: "sepia(10%) hue-rotate(5deg) brightness(1.02)",
                }}
              />
            </div>
            <p className="text-xl text-base-content/70 mb-4">
              &ldquo;An argument isn&apos;t just contradiction... it&apos;s a
              connected series of statements intended to establish a
              proposition!&rdquo;
            </p>
            <p className="text-sm text-base-content/60 italic mb-8">
              — Michael Palin, Monty Python&apos;s Flying Circus
            </p>
          </div>
        </div>

        {/* How it Works - now above Conversation */}
        <div className="grid md:grid-cols-2 gap-8 mt-8 mb-8">
          <InfoCard title="How it Works">
            {HOW_IT_WORKS_STEPS.map((step, index) => (
              <StepItem key={index} step={step} index={index} />
            ))}
          </InfoCard>

          <InfoCard title="Features">
            {FEATURES.map((feature, index) => (
              <FeatureItem key={index} {...feature} />
            ))}
          </InfoCard>
        </div>

        {/* Chat Interface */}
        <div className="card bg-base-100 shadow-xl overflow-hidden">
          <div className="bg-primary p-6 text-primary-content flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold mb-2">Conversation</h2>
              <p className="text-primary-content/80">
                Argue with Mr. Barnard, our malcontented AI arguer
              </p>
            </div>
            <div className="flex bg-primary-content/20 p-1 rounded-lg backdrop-blur-sm">
              <button
                onClick={() => setIsVoiceMode(false)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-all duration-200 ${
                  !isVoiceMode
                    ? "bg-primary-content text-primary shadow-md scale-105"
                    : "text-primary-content/80 hover:text-primary-content hover:bg-primary-content/10"
                }`}
              >
                <Send className="w-4 h-4" />
                Text
              </button>
              <button
                onClick={() => setIsVoiceMode(true)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-all duration-200 ${
                  isVoiceMode
                    ? "bg-primary-content text-primary shadow-md scale-105"
                    : "text-primary-content/80 hover:text-primary-content hover:bg-primary-content/10"
                }`}
              >
                <Mic className="w-4 h-4" />
                Voice
              </button>
            </div>
          </div>

          <div className="card-body">
            <div
              ref={chatContainerRef}
              className="space-y-4 max-h-96 overflow-y-auto mb-6"
            >
              {conversation.map((message, index) => {
                const isLastAudioMessage = (() => {
                  const lastAudioIndex = conversation
                    .map((m, i) => ({ message: m, index: i }))
                    .filter(({ message: m }) => m.type === "ai" && m.audioUrl)
                    .pop()?.index;
                  return index === lastAudioIndex;
                })();

                return (
                  <div
                    key={index}
                    className={`chat ${
                      message.type === "user" ? "chat-end" : "chat-start"
                    }`}
                  >
                    <MessageAvatar type={message.type} />
                    <MessageHeader
                      type={message.type}
                      timestamp={message.timestamp}
                    />
                    <div
                      className={`chat-bubble ${
                        message.type === "user"
                          ? "chat-bubble-primary"
                          : message.type === "error"
                            ? "chat-bubble-error"
                            : "chat-bubble-secondary"
                      }`}
                    >
                      {message.isVoice && message.type === "user" && (
                        <div className="flex items-center text-xs mb-1 opacity-75">
                          <Mic className="w-3 h-3 mr-1" />
                          Voice message
                        </div>
                      )}
                      <div>{message.text}</div>
                      {message.audioUrl && message.type === "ai" && (
                        <div className="mt-2">
                          <AudioPlayer
                            key={`audio-${index}-${message.timestamp.getTime()}`}
                            audioUrl={message.audioUrl}
                            autoPlay={isLastAudioMessage}
                            onPlay={handleAudioPlay}
                            onPause={handleAudioPause}
                            onEnded={handleAudioEnded}
                            className="bg-white/20"
                            registerAudioPlayer={registerAudioPlayer}
                            unregisterAudioPlayer={unregisterAudioPlayer}
                            isCurrentlyPlaying={currentlyPlayingAudio === message.audioUrl}
                            onPlayRequested={() => message.audioUrl && handleAudioPlayRequest(message.audioUrl)}
                          />
                        </div>
                      )}
                      {message.isVoice &&
                        message.type === "ai" &&
                        !message.audioUrl && (
                          <div className="flex items-center text-xs mt-1 opacity-75">
                            <Volume2 className="w-3 h-3 mr-1" />
                            Voice response
                          </div>
                        )}
                    </div>
                    <MessageFooter
                      type={message.type}
                      responseTime={message.responseTime}
                      cacheHit={message.cacheHit}
                    />
                  </div>
                );
              })}
              {isLoading && !isInitializing && <LoadingMessage />}
            </div>

            {isVoiceMode ? (
              <div className="card bg-base-200 border border-primary/20">
                <div className="card-body">
                  <div className="text-center mb-4">
                    <h3 className="text-lg font-semibold text-base-content mb-2">
                      <Mic className="inline w-5 h-5 mr-2" /> Voice Argument
                      Mode
                    </h3>
                    <p className="text-sm text-base-content/70">
                      {isContinuousVoice
                        ? "Just start speaking - the microphone listens continuously"
                        : "Click the microphone to record your argument"}
                    </p>

                    {/* Voice Mode Toggle */}
                    <div className="flex justify-center mt-3">
                      <div className="tabs tabs-boxed tabs-sm">
                        <button
                          onClick={() => setIsContinuousVoice(true)}
                          className={`tab ${
                            isContinuousVoice ? "tab-active" : ""
                          }`}
                        >
                          Continuous
                        </button>
                        <button
                          onClick={() => setIsContinuousVoice(false)}
                          className={`tab ${
                            !isContinuousVoice ? "tab-active" : ""
                          }`}
                        >
                          Click-to-Talk
                        </button>
                      </div>
                    </div>
                  </div>
                  <VoiceRecorder
                    onRecordingComplete={sendVoiceMessage}
                    onAudioLevel={setAudioLevel}
                    disabled={isProcessingRequest}
                    pushToTalk={false}
                    continuousMode={isContinuousVoice}
                    maxDuration={isContinuousVoice ? 300 : 30}
                    className="mt-2"
                  />

                  {isLoading && !isInitializing && (
                    <div className="mt-4 flex items-center justify-center space-x-3 text-primary">
                      <span className="loading loading-dots loading-sm"></span>
                      <span className="text-sm font-medium">
                        AI is thinking...
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex space-x-3">
                <input
                  type="text"
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Enter your argument..."
                  disabled={!sessionId}
                  className="input input-bordered flex-1"
                />
                <button
                  onClick={() => sendMessage(inputText)}
                  disabled={isLoading || !inputText.trim() || !sessionId}
                  className="btn btn-primary hover:btn-accent transition-all duration-200 hover:scale-105 active:scale-95"
                  title="Right! Off you go then!"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Debug Toggle */}
        <div className="flex justify-center gap-4 mt-6 mb-8">
          <button
            onClick={toggleDebug}
            className={`btn btn-sm ${showDebug ? "btn-primary" : "btn-ghost"}`}
          >
            <Activity className="w-4 h-4" />
            <span>
              {showDebug ? "Hide Debug Information" : "Show Debug Information"}
            </span>
          </button>
        </div>
        {showDebug && (
          <div className="card bg-base-100 shadow-xl border border-base-300 mb-8">
            <div className="card-body">
              <h3 className="card-title text-base-content mb-4">
                <BarChart className="inline w-5 h-5 mr-2" /> Debugging Data
              </h3>
              {/* Current State */}
              <div className="mb-6 p-4 bg-base-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-base-content/70">
                    Current State:
                  </span>
                  <span
                    className={`badge ${
                      STATE_BADGE_MAP[
                        currentState as keyof typeof STATE_BADGE_MAP
                      ] || STATE_BADGE_MAP.default
                    }`}
                  >
                    {currentState && currentState !== ""
                      ? currentState.replace(/_/g, " ").toUpperCase()
                      : "LOADING"}
                  </span>
                </div>
                {sessionId && (
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-base-content/70">
                      Session ID:
                    </span>
                    <span className="text-sm text-base-content/50 font-mono">
                      {sessionId.slice(0, 8)}...
                    </span>
                  </div>
                )}
                {/* WebSocket Status */}
                <div className="mt-4">
                  <div className="font-semibold text-xs text-base-content/80 mb-1">
                    WebSocket Connection
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-base-content/70">
                    <div>
                      Status: <span className={`font-mono ${wsConnected ? 'text-success' : 'text-error'}`}>
                        {wsConnected ? "Connected" : "Disconnected"}
                      </span>
                    </div>
                    <div>
                      Ready State: <span className="font-mono">
                        {wsRef.current?.readyState || "N/A"}
                      </span>
                    </div>
                  </div>
                </div>
                {/* Voice Recording Debug Values */}
                <div className="mt-4">
                  <div className="font-semibold text-xs text-base-content/80 mb-1">
                    Voice Recording Debug Values
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-base-content/70">
                    <div>
                      hasPermission: <span className="font-mono">true</span>
                    </div>
                    <div>
                      isSupported: <span className="font-mono">true</span>
                    </div>
                    <div>
                      isRecording: <span className="font-mono">false</span>
                    </div>
                    <div>
                      recordingState: <span className="font-mono">{recordingState}</span>
                    </div>
                    <div>
                      disabled: <span className="font-mono">{isProcessingRequest ? 'true' : 'false'}</span>
                    </div>
                    <div>
                      error: <span className="font-mono">none</span>
                    </div>
                    <div>
                      pushToTalk: <span className="font-mono">false</span>
                    </div>
                    <div>
                      Audio Level:{" "}
                      <span className="font-mono">{audioLevel.toFixed(4)}</span>{" "}
                      {audioLevel > 0.04 ? "🎤" : "🔇"}
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-success">
                    {metrics.avg_response_time_ms?.toFixed(0)}ms
                  </div>
                  <div className="text-sm text-base-content/60">
                    Avg Response Time
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-info">
                    {metrics.total_requests}
                  </div>
                  <div className="text-sm text-base-content/60">
                    Total Requests
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-secondary">
                    {metrics.active_sessions}
                  </div>
                  <div className="text-sm text-base-content/60">
                    Active Sessions
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-warning">
                    {metrics.p95_response_time_ms?.toFixed(0)}ms
                  </div>
                  <div className="text-sm text-base-content/60">
                    P95 Response Time
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="footer footer-center p-8 text-base-content/60">
        <div className="text-center">
          <p className="mb-2">
            &ldquo;I came here for a good argument!&rdquo; — Monty Python
          </p>
          <p className="text-xs opacity-60 hover:opacity-80 transition-opacity cursor-default">
            🦜 No parrots were harmed in the making of this application
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
