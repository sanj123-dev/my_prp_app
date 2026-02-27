import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { format } from 'date-fns';
import { BarChart, LineChart, PieChart } from 'react-native-gifted-charts';

type SpeechRecognitionModuleShape = {
  requestPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain?: boolean }>;
  start: (options: Record<string, unknown>) => Promise<void>;
  stop: () => Promise<void>;
};

type SpeechRecognitionEventHook = (eventName: string, callback: (event: any) => void) => void;

const speechRecognitionPkg:
  | {
      ExpoSpeechRecognitionModule?: SpeechRecognitionModuleShape;
      useSpeechRecognitionEvent?: SpeechRecognitionEventHook;
    }
  | undefined = (() => {
  try {
    // Lazy require prevents app crash when native module is unavailable (Expo Go / missing prebuild).
    return require('expo-speech-recognition');
  } catch (_error) {
    return undefined;
  }
})();

const speechRecognitionAvailable = !!speechRecognitionPkg?.ExpoSpeechRecognitionModule;

const ExpoSpeechRecognitionModule: SpeechRecognitionModuleShape =
  speechRecognitionPkg?.ExpoSpeechRecognitionModule ?? {
    requestPermissionsAsync: async () => ({ granted: false, canAskAgain: false }),
    start: async () => {
      throw new Error('expo-speech-recognition native module unavailable');
    },
    stop: async () => {},
  };

const useSpeechRecognitionEvent: SpeechRecognitionEventHook =
  speechRecognitionPkg?.useSpeechRecognitionEvent ??
  ((_eventName: string, _callback: (event: any) => void) => {});

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const EXPO_PUBLIC_VOICE_WS_URL = process.env.EXPO_PUBLIC_VOICE_WS_URL;
const CHAT_SESSION_ID_KEY = 'chatSessionId';
const VOICE_SILENCE_DEBOUNCE_MS = 2000;
const VOICE_WS_PING_MS = 15000;

interface Message {
  id: string;
  role: string;
  message: string;
  timestamp: string;
  source?: 'text' | 'voice';
  visualization?: {
    type: 'pie' | 'bar' | 'line' | 'table';
    title: string;
    subtitle?: string;
    slices?: { value: number; text: string; color: string }[];
    bars?: { value: number; label: string; frontColor: string }[];
    trend?: { value: number; label: string }[];
    rows?: { c1: string; c2: string; c3: string; c4?: string }[];
  };
}

type AssistantLanguage = {
  id: string;
  label: string;
  locale: string;
  promptName: string;
};

const ASSISTANT_LANGUAGES: AssistantLanguage[] = [
  { id: 'english', label: 'English', locale: 'en-US', promptName: 'English' },
  { id: 'hindi', label: 'Hindi', locale: 'hi-IN', promptName: 'Hindi' },
];

export default function Chat() {
  const [userId, setUserId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [carryoverInsights, setCarryoverInsights] = useState('');

  const [assistantVisible, setAssistantVisible] = useState(false);
  const [assistantListening, setAssistantListening] = useState(false);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState(
    'Hands-free mode active. Speak anytime.'
  );
  const [assistantMicPrimed, setAssistantMicPrimed] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<AssistantLanguage>(
    ASSISTANT_LANGUAGES[0]
  );

  const scrollViewRef = useRef<ScrollView>(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const transcriptRef = useRef('');
  const isVoiceSubmittingRef = useRef(false);
  const voiceSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preferredMaleVoiceRef = useRef<
    Record<string, { id?: string; language?: string }>
  >({});
  const voiceSocketRef = useRef<WebSocket | null>(null);
  const voiceSocketReadyRef = useRef(false);
  const voicePingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingVoiceTextResolveRef = useRef<((text: string) => void) | null>(null);
  const streamingAssistantIdRef = useRef<string>('');
  const assistantVisibleRef = useRef(false);
  const voiceWsDisabledRef = useRef(false);
  const listeningWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startInFlightRef = useRef(false);
  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousSpeakingRef = useRef(false);

  const getTranscriptFromEvent = (event: any): string => {
    const firstResult = event?.results?.[0];
    if (typeof firstResult === 'string') return firstResult;
    if (firstResult?.transcript) return String(firstResult.transcript);
    if (Array.isArray(firstResult)) {
      const alt = firstResult[0];
      if (typeof alt === 'string') return alt;
      if (alt?.transcript) return String(alt.transcript);
    }
    if (typeof event?.transcript === 'string') return event.transcript;
    if (Array.isArray(event?.value) && typeof event.value[0] === 'string') {
      return event.value[0];
    }
    if (Array.isArray(event?.results)) {
      const flattened: string[] = [];
      for (const result of event.results) {
        if (typeof result === 'string') {
          flattened.push(result);
          continue;
        }
        if (result?.transcript && typeof result.transcript === 'string') {
          flattened.push(result.transcript);
          continue;
        }
        if (Array.isArray(result)) {
          for (const alt of result) {
            if (typeof alt === 'string') flattened.push(alt);
            else if (typeof alt?.transcript === 'string') flattened.push(alt.transcript);
          }
        }
      }
      const merged = flattened.join(' ').trim();
      if (merged) return merged;
    }
    return '';
  };

  const toWsUrl = (httpUrl: string) => {
    if (httpUrl.startsWith('https://')) return `wss://${httpUrl.slice('https://'.length)}`;
    if (httpUrl.startsWith('http://')) return `ws://${httpUrl.slice('http://'.length)}`;
    return httpUrl;
  };

  const resolveVoiceWsUrl = () => {
    const explicit = (EXPO_PUBLIC_VOICE_WS_URL || '').trim();
    if (explicit) return explicit;
    if (!EXPO_PUBLIC_BACKEND_URL) return '';
    return `${toWsUrl(EXPO_PUBLIC_BACKEND_URL)}/api/voice/ws`;
  };

  const closeVoiceSocket = () => {
    if (voicePingTimerRef.current) {
      clearInterval(voicePingTimerRef.current);
      voicePingTimerRef.current = null;
    }
    if (voiceSocketRef.current) {
      try {
        voiceSocketRef.current.close();
      } catch (_error) {
        // no-op
      }
    }
    voiceSocketRef.current = null;
    voiceSocketReadyRef.current = false;
  };

  const appendOrUpdateStreamingAssistant = (delta: string, isFinal: boolean = false) => {
    setMessages((prev) => {
      const streamId = streamingAssistantIdRef.current;
      if (!streamId) {
        const id = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        streamingAssistantIdRef.current = id;
        return [
          ...prev,
          {
            id,
            role: 'assistant',
            message: delta,
            timestamp: new Date().toISOString(),
          },
        ];
      }
      return prev.map((m) => {
        if (m.id !== streamId) return m;
        return {
          ...m,
          message: isFinal ? delta : `${m.message}${delta}`,
          timestamp: new Date().toISOString(),
        };
      });
    });
  };

  const connectVoiceSocket = async () => {
    if (voiceWsDisabledRef.current) return false;
    if (!EXPO_PUBLIC_BACKEND_URL || !userId) return false;
    if (
      !EXPO_PUBLIC_VOICE_WS_URL &&
      /vercel\.app/i.test(EXPO_PUBLIC_BACKEND_URL)
    ) {
      voiceWsDisabledRef.current = true;
      setAssistantStatus('Realtime voice unavailable on current backend; using fallback mode.');
      return false;
    }
    if (voiceSocketRef.current && voiceSocketReadyRef.current) {
      try {
        voiceSocketRef.current.send(
          JSON.stringify({
            type: 'session.start',
            user_id: userId,
            session_id: sessionId || undefined,
            language: selectedLanguage.promptName,
          })
        );
      } catch (_error) {
        // no-op
      }
      return true;
    }

    try {
      closeVoiceSocket();
      const wsUrl = resolveVoiceWsUrl();
      if (!wsUrl) return false;
      const ws = new WebSocket(wsUrl);
      voiceSocketRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('voice_ws_timeout')), 7000);
        ws.onopen = () => {
          clearTimeout(timeout);
          voiceSocketReadyRef.current = true;
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('voice_ws_error'));
        };
      });

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || '{}'));
          const type = String(payload.type || '');
          if (type === 'session.started') {
            const nextSession = String(payload.session_id || '');
            if (nextSession) {
              setSessionId(nextSession);
              void AsyncStorage.setItem(CHAT_SESSION_ID_KEY, nextSession);
            }
            return;
          }
          if (type === 'assistant.response.start') {
            setAssistantStatus('Assistant thinking...');
            streamingAssistantIdRef.current = '';
            return;
          }
          if (type === 'assistant.text.delta') {
            const delta = String(payload.delta || '');
            if (delta) appendOrUpdateStreamingAssistant(delta, false);
            return;
          }
          if (type === 'assistant.text.final') {
            const text = String(payload.text || '');
            if (text) {
              if (streamingAssistantIdRef.current) {
                appendOrUpdateStreamingAssistant(text, true);
              } else {
                appendLocalMessage('assistant', text);
              }
            }
            const resolve = pendingVoiceTextResolveRef.current;
            pendingVoiceTextResolveRef.current = null;
            if (resolve) resolve(text);
            return;
          }
          if (type === 'assistant.response.cancelled') {
            setAssistantStatus('Listening...');
            const resolve = pendingVoiceTextResolveRef.current;
            pendingVoiceTextResolveRef.current = null;
            if (resolve) resolve('');
            return;
          }
          if (type === 'error') {
            setAssistantStatus('Voice service error. Retrying...');
          }
        } catch (_error) {
          // no-op
        }
      };

      ws.onclose = () => {
        voiceSocketReadyRef.current = false;
        if (assistantVisibleRef.current && !voiceWsDisabledRef.current) {
          setAssistantStatus('Reconnecting voice...');
          setTimeout(() => {
            void connectVoiceSocket();
          }, 800);
        }
      };

      ws.send(
        JSON.stringify({
          type: 'session.start',
          user_id: userId,
          session_id: sessionId || undefined,
          language: selectedLanguage.promptName,
        })
      );

      voicePingTimerRef.current = setInterval(() => {
        if (!voiceSocketRef.current || !voiceSocketReadyRef.current) return;
        try {
          voiceSocketRef.current.send(JSON.stringify({ type: 'ping' }));
        } catch (_error) {
          // no-op
        }
      }, VOICE_WS_PING_MS);

      return true;
    } catch (error) {
      console.error('Voice socket connect failed:', error);
      voiceSocketReadyRef.current = false;
      voiceWsDisabledRef.current = true;
      setAssistantStatus('Realtime voice unavailable; using fallback mode.');
      return false;
    }
  };

  const sendVoiceWs = async (payload: Record<string, unknown>) => {
    const ok = await connectVoiceSocket();
    if (!ok || !voiceSocketRef.current || !voiceSocketReadyRef.current) return false;
    try {
      voiceSocketRef.current.send(JSON.stringify(payload));
      return true;
    } catch (_error) {
      return false;
    }
  };

  const speakText = async (text: string, locale?: string) => {
    const cleaned = (text || '').trim();
    if (!cleaned) return;

    const resolveMaleVoice = async () => {
      const key = locale || 'default';
      if (preferredMaleVoiceRef.current[key] !== undefined) {
        return preferredMaleVoiceRef.current[key];
      }

      try {
        const voices = await Speech.getAvailableVoicesAsync();
        const localeLower = (locale || '').toLowerCase();
        const family = localeLower.slice(0, 2);
        const filtered = voices.filter((voice) => {
          if (!localeLower) return true;
          const voiceLang = String(voice.language || '').toLowerCase();
          return voiceLang.startsWith(family);
        });

        const ranked = filtered
          .map((voice) => {
            const name = String(voice.name || '');
            const identifier = String(voice.identifier || '');
            const bundle = `${name} ${identifier}`.toLowerCase();
            const voiceLang = String(voice.language || '').toLowerCase();
            let score = 0;
            if (/female|woman|girl|female_|\bf[0-9]\b/.test(bundle)) score -= 120;
            if (/male|man|david|daniel|alex|aaron|guy|male_|\bm[0-9]\b/.test(bundle)) score += 36;
            if (/enhanced|premium|neural|natural/.test(bundle)) score += 6;
            if (localeLower && voiceLang === localeLower) score += 8;
            if (family && voiceLang.startsWith(family)) score += 3;
            if (family === 'en' && /en-us|en-gb/.test(voiceLang)) score += 5;
            if (String((voice as any).quality || '').toLowerCase() === 'enhanced') score += 4;
            return { id: voice.identifier, language: voice.language, score };
          })
          .sort((a, b) => b.score - a.score);

        const best = ranked[0];
        const chosen =
          best && best.score > -40
            ? { id: best.id, language: best.language }
            : { id: undefined, language: undefined };
        preferredMaleVoiceRef.current[key] = chosen;
        return chosen;
      } catch (_error) {
        const chosen = { id: undefined, language: undefined };
        preferredMaleVoiceRef.current[key] = chosen;
        return chosen;
      }
    };

    const maleVoice = await resolveMaleVoice();

    const attemptSpeak = (language?: string, voiceId?: string) =>
      new Promise<boolean>((resolve) => {
        Speech.speak(cleaned, {
          language,
          voice: voiceId,
          rate: 0.97,
          pitch: 0.82,
          volume: 1.0,
          onDone: () => resolve(true),
          onStopped: () => resolve(true),
          onError: () => resolve(false),
        });
      });

    setAssistantSpeaking(true);
    setAssistantStatus('Speaking...');
    await Speech.stop();

    let ok = await attemptSpeak(maleVoice.language || locale, maleVoice.id);
    if (!ok) {
      ok = await attemptSpeak(locale, undefined);
    }
    if (!ok) {
      ok = await attemptSpeak(undefined, undefined);
    }

    setAssistantSpeaking(false);
    setAssistantStatus(ok ? 'Hands-free mode active. Speak anytime.' : 'Audio unavailable on this device.');
    if (assistantVisibleRef.current && !sending && !isVoiceSubmittingRef.current) {
      setTimeout(() => {
        void startListening();
      }, 220);
    }
  };

  useEffect(() => {
    void loadChat();
  }, []);

  useEffect(() => {
    assistantVisibleRef.current = assistantVisible;
  }, [assistantVisible]);

  useEffect(() => {
    if (assistantVisible) {
      voiceWsDisabledRef.current = false;
      setAssistantMicPrimed(false);
      void connectVoiceSocket();
      return;
    }
    closeVoiceSocket();
  }, [assistantVisible, userId, selectedLanguage.id]);

  useSpeechRecognitionEvent('start', () => {
    startInFlightRef.current = false;
    if (startTimeoutRef.current) {
      clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
    if (assistantSpeaking) {
      void Speech.stop();
      setAssistantSpeaking(false);
      void sendVoiceWs({ type: 'control.interrupt' });
    }
    setAssistantListening(true);
    setAssistantStatus('Listening...');
    transcriptRef.current = '';
  });

  useSpeechRecognitionEvent('result', (event: any) => {
    const transcript = getTranscriptFromEvent(event);
    if (transcript) {
      transcriptRef.current = transcript;
      void sendVoiceWs({ type: 'user.text.partial', text: transcript });
      if (assistantSpeaking) {
        void Speech.stop();
        setAssistantSpeaking(false);
        void sendVoiceWs({ type: 'control.interrupt' });
      }
      if (voiceSilenceTimerRef.current) {
        clearTimeout(voiceSilenceTimerRef.current);
      }
      voiceSilenceTimerRef.current = setTimeout(() => {
        setAssistantStatus('2s pause detected. Responding...');
        void submitVoiceTurn();
      }, VOICE_SILENCE_DEBOUNCE_MS);
    }
  });

  useSpeechRecognitionEvent('end', () => {
    startInFlightRef.current = false;
    setAssistantListening(false);
    const hasPendingSpeech = transcriptRef.current.trim().length > 0;
    if (hasPendingSpeech && !isVoiceSubmittingRef.current && !sending) {
      void submitVoiceTurn();
      return;
    }
    if (!assistantVisible || !assistantMicPrimed || sending || assistantSpeaking || isVoiceSubmittingRef.current) return;
    setTimeout(() => {
      void startListening();
    }, 250);
  });

  useSpeechRecognitionEvent('error', (event: any) => {
    startInFlightRef.current = false;
    if (startTimeoutRef.current) {
      clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
    setAssistantListening(false);
    const errText =
      String(
        event?.error ||
          event?.message ||
          event?.code ||
          'Speech recognition error'
      ).trim();
    setAssistantStatus(`Mic error: ${errText}`);
    if (!assistantVisible || !assistantMicPrimed || sending || assistantSpeaking || isVoiceSubmittingRef.current) return;
    setTimeout(() => {
      void startListening();
    }, 900);
  });

  useEffect(() => {
    return () => {
      void Speech.stop();
      if (voiceSilenceTimerRef.current) {
        clearTimeout(voiceSilenceTimerRef.current);
      }
      if (listeningWatchdogRef.current) {
        clearInterval(listeningWatchdogRef.current);
        listeningWatchdogRef.current = null;
      }
      if (startTimeoutRef.current) {
        clearTimeout(startTimeoutRef.current);
        startTimeoutRef.current = null;
      }
      closeVoiceSocket();
    };
  }, []);

  useEffect(() => {
    if (!assistantVisible) {
      pulse.stopAnimation();
      pulse.setValue(1);
      if (voiceSilenceTimerRef.current) {
        clearTimeout(voiceSilenceTimerRef.current);
      }
      if (listeningWatchdogRef.current) {
        clearInterval(listeningWatchdogRef.current);
        listeningWatchdogRef.current = null;
      }
      if (startTimeoutRef.current) {
        clearTimeout(startTimeoutRef.current);
        startTimeoutRef.current = null;
      }
      startInFlightRef.current = false;
      void ExpoSpeechRecognitionModule.stop();
      return;
    }

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.08,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    ).start();

    if (assistantMicPrimed && !sending && !assistantSpeaking) {
      setTimeout(() => {
        void startListening();
      }, 150);
    }

    if (listeningWatchdogRef.current) {
      clearInterval(listeningWatchdogRef.current);
    }
    listeningWatchdogRef.current = setInterval(() => {
      if (!assistantVisibleRef.current) return;
      if (!assistantMicPrimed) return;
      if (assistantListening || assistantSpeaking || sending || isVoiceSubmittingRef.current) return;
      void startListening();
    }, 1800);
  }, [assistantVisible, pulse]);

  useEffect(() => {
    if (!assistantVisible || !assistantMicPrimed) return;
    if (sending || assistantSpeaking) return;
    setTimeout(() => {
      void startListening();
    }, 120);
  }, [selectedLanguage.id, assistantMicPrimed]);

  useEffect(() => {
    const justStoppedSpeaking = previousSpeakingRef.current && !assistantSpeaking;
    previousSpeakingRef.current = assistantSpeaking;
    if (!justStoppedSpeaking) return;
    if (!assistantVisibleRef.current || !assistantMicPrimed) return;
    if (sending || isVoiceSubmittingRef.current || assistantListening) return;
    setAssistantStatus('Listening...');
    setTimeout(() => {
      void startListening();
    }, 180);
  }, [assistantSpeaking, assistantMicPrimed, sending, assistantListening]);

  const loadChat = async () => {
    try {
      const savedUserId = await AsyncStorage.getItem('userId');
      if (savedUserId) {
        setUserId(savedUserId);
        await ensureSession(savedUserId);
        const response = await axios.get(
          `${EXPO_PUBLIC_BACKEND_URL}/api/chat/${savedUserId}`
        );
        const visibleMessages = (response.data || []).filter(
          (msg: Message) => (msg.source || 'text') !== 'voice'
        );
        setMessages(visibleMessages);
      }
    } catch (error) {
      console.error('Error loading chat:', error);
    } finally {
      setLoading(false);
    }
  };

  const ensureSession = async (savedUserId: string) => {
    const existingSessionId = await AsyncStorage.getItem(CHAT_SESSION_ID_KEY);
    const response = await axios.post(`${EXPO_PUBLIC_BACKEND_URL}/api/chat/session/start`, {
      user_id: savedUserId,
      language: selectedLanguage.promptName,
      existing_session_id: existingSessionId,
    });

    const nextSessionId = String(response.data?.session_id || '');
    if (nextSessionId) {
      setSessionId(nextSessionId);
      await AsyncStorage.setItem(CHAT_SESSION_ID_KEY, nextSessionId);
    }

    setCarryoverInsights(String(response.data?.carryover_insights || ''));
  };

  const postChatMessage = async (
    message: string,
    language: AssistantLanguage,
    source: 'text' | 'voice' = 'text'
  ) => {
    let activeSessionId = sessionId;
    if (!activeSessionId && userId) {
      await ensureSession(userId);
      activeSessionId = await AsyncStorage.getItem(CHAT_SESSION_ID_KEY) || '';
    }

    const response = await axios.post(`${EXPO_PUBLIC_BACKEND_URL}/api/chat`, {
      user_id: userId,
      message,
      language: language.promptName,
      session_id: activeSessionId || undefined,
      source,
    });

    if (response.data?.session_id && String(response.data.session_id) !== sessionId) {
      const newSessionId = String(response.data.session_id);
      setSessionId(newSessionId);
      await AsyncStorage.setItem(CHAT_SESSION_ID_KEY, newSessionId);
    }

    return String(response.data?.response ?? '');
  };

  const appendLocalMessage = (
    role: 'user' | 'assistant',
    message: string,
    extra?: Partial<Pick<Message, 'visualization'>>
  ) => {
    const localMessage: Message = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      message,
      timestamp: new Date().toISOString(),
      ...extra,
    };
    setMessages((prev) => [...prev, localMessage]);
  };

  const classifyVisualizationRequest = (text: string): 'pie' | 'bar' | 'line' | 'table' | null => {
    const q = (text || '').toLowerCase();
    const wantsTable = q.includes('table') || q.includes('tabular');
    if (wantsTable) return 'table';
    const wantsLine = q.includes('line chart') || q.includes('trend') || q.includes('daily');
    if (wantsLine) return 'line';
    const wantsBar = q.includes('bar chart') || q.includes('compare category') || q.includes('comparison');
    if (wantsBar) return 'bar';
    const wantsPie = q.includes('pie chart') || q.includes('pie chat') || q.includes('pie');
    if (wantsPie) return 'pie';
    const hasChart = q.includes('chart') || q.includes('graph') || q.includes('visualize');
    const hasCategory = q.includes('category') || q.includes('categorywise') || q.includes('category-wise');
    const hasSpend = q.includes('spend') || q.includes('expense');
    if (hasChart && hasCategory) return 'bar';
    if (hasChart && hasSpend) return 'line';
    return null;
  };

  const detectRange = (text: string): 'this_week' | 'this_month' => {
    const q = (text || '').toLowerCase();
    if (q.includes('this week') || q.includes('weekly') || q.includes('last 7 day') || q.includes('7 days')) {
      return 'this_week';
    }
    return 'this_month';
  };

  const loadDebitRows = async (range: 'this_week' | 'this_month') => {
    if (!EXPO_PUBLIC_BACKEND_URL || !userId) return null;
    const response = await axios.get(`${EXPO_PUBLIC_BACKEND_URL}/api/transactions/${userId}`, {
      params: { limit: 1000 },
    });
    const rows = Array.isArray(response.data) ? response.data : [];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const totals: Record<string, number> = {};
    const filteredRows: { date: string; category: string; description: string; amount: number }[] = [];
    for (const row of rows) {
      const txDate = new Date(row?.date || row?.created_at || Date.now());
      if (Number.isNaN(txDate.getTime())) continue;
      if (range === 'this_month' && txDate < monthStart) continue;
      if (range === 'this_week' && txDate < weekStart) continue;
      const txType = String(row?.transaction_type || 'debit').toLowerCase();
      if (txType !== 'debit') continue;
      const amount = Number(row?.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const cat = String(row?.category || 'Other').trim() || 'Other';
      totals[cat] = (totals[cat] || 0) + amount;
      filteredRows.push({
        date: format(txDate, 'dd MMM'),
        category: cat,
        description: String(row?.description || '').trim().slice(0, 28),
        amount: Number(amount.toFixed(2)),
      });
    }

    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    return { sorted, filteredRows, range };
  };

  const buildVisualization = async (
    mode: 'pie' | 'bar' | 'line' | 'table',
    range: 'this_week' | 'this_month'
  ) => {
    const payload = await loadDebitRows(range);
    if (!payload) return null;
    const { sorted, filteredRows } = payload;
    if (!sorted.length) return null;
    const rangeLabel = range === 'this_week' ? 'This Week' : 'This Month';

    const palette = ['#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0', '#607D8B'];
    const top = sorted.slice(0, 5);
    const total = sorted.reduce((sum, [, amt]) => sum + amt, 0);

    if (mode === 'bar') {
      const bars = top.map(([cat, amt], i) => ({
        value: Number(amt.toFixed(2)),
        label: cat.slice(0, 8),
        frontColor: palette[i % palette.length],
      }));
      return {
        type: 'bar' as const,
        title: `Category Comparison (${rangeLabel})`,
        subtitle: `Total debit: \u20B9${total.toFixed(2)}`,
        bars,
      };
    }

    if (mode === 'line') {
      const byDay: Record<string, number> = {};
      for (const row of filteredRows) {
        byDay[row.date] = (byDay[row.date] || 0) + row.amount;
      }
      const trend = Object.entries(byDay)
        .slice(-10)
        .map(([label, value]) => ({ label, value: Number(value.toFixed(2)) }));
      return {
        type: 'line' as const,
        title: `Daily Spending Trend (${rangeLabel})`,
        subtitle: `Total debit: \u20B9${total.toFixed(2)}`,
        trend,
      };
    }

    if (mode === 'table') {
      const rows = filteredRows.slice(0, 8).map((r) => ({
        c1: r.date,
        c2: r.category,
        c3: `\u20B9${r.amount.toFixed(0)}`,
        c4: r.description,
      }));
      return {
        type: 'table' as const,
        title: `Recent Transactions (${rangeLabel})`,
        subtitle: `Total debit: \u20B9${total.toFixed(2)}`,
        rows,
      };
    }

    const restTotal = sorted.slice(5).reduce((sum, [, amt]) => sum + amt, 0);
    const slices = top.map(([cat, amt], i) => ({
      value: Number(amt.toFixed(2)),
      text: cat,
      color: palette[i % palette.length],
    }));
    if (restTotal > 0) {
      slices.push({
        value: Number(restTotal.toFixed(2)),
        text: 'Other',
        color: '#8BC34A',
      });
    }
    return {
      type: 'pie' as const,
      title: `${rangeLabel} Category-wise Spend`,
      subtitle: `Total debit: \u20B9${total.toFixed(2)}`,
      slices,
    };
  };

  const sendMessage = async () => {
    if (!inputText.trim() || sending || !userId) return;

    const userMessage = inputText.trim();
    setInputText('');
    setSending(true);
    appendLocalMessage('user', userMessage);

    try {
      const vizMode = classifyVisualizationRequest(userMessage);
      const range = detectRange(userMessage);
      const [answer, chart] = await Promise.all([
        postChatMessage(userMessage, selectedLanguage, 'text'),
        vizMode ? buildVisualization(vizMode, range) : Promise.resolve(null),
      ]);
      if (answer || chart) {
        const fallbackText = chart
          ? 'I prepared a visual view of your spending data.'
          : '';
        appendLocalMessage('assistant', answer || fallbackText, chart ? { visualization: chart } : undefined);
      }
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 120);
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setSending(false);
    }
  };

  const startListening = async () => {
    if (!assistantVisible || !assistantMicPrimed || sending || isVoiceSubmittingRef.current) return;
    if (assistantListening) return;
    if (startInFlightRef.current) return;
    if (!speechRecognitionAvailable) {
      setAssistantStatus('Voice recognition module not available in this build.');
      Alert.alert(
        'Voice Unavailable',
        'This build does not include speech recognition native module. You can still use text chat.'
      );
      return;
    }
    startInFlightRef.current = true;
    if (assistantSpeaking) {
      await Speech.stop();
      setAssistantSpeaking(false);
    }

    const permissionResult = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permissionResult.granted) {
      if (!permissionResult.canAskAgain) {
        setAssistantStatus('Microphone permission blocked. Open app settings.');
        Alert.alert(
          'Microphone Permission Needed',
          'Please enable microphone permission in Settings to use voice assistant.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ]
        );
      } else {
        setAssistantStatus('Microphone permission denied. Please allow it and try again.');
      }
      startInFlightRef.current = false;
      return;
    }

    try {
      setAssistantStatus('Listening...');
      try {
        await ExpoSpeechRecognitionModule.start({
          lang: selectedLanguage.locale,
          interimResults: true,
          maxAlternatives: 1,
          continuous: true,
        });
      } catch (_firstError) {
        // Some Android devices fail with continuous mode; fallback to single-shot.
        await ExpoSpeechRecognitionModule.start({
          lang: selectedLanguage.locale,
          interimResults: true,
          maxAlternatives: 1,
          continuous: false,
        });
      }
      if (startTimeoutRef.current) {
        clearTimeout(startTimeoutRef.current);
      }
      startTimeoutRef.current = setTimeout(() => {
        if (!assistantListening && assistantVisibleRef.current) {
          startInFlightRef.current = false;
          setAssistantStatus('Retrying microphone...');
          setTimeout(() => {
            void startListening();
          }, 200);
        }
      }, 3000);
    } catch (error) {
      console.error('Error starting voice recognition:', error);
      setAssistantStatus('Mic not starting. Check permission and try again.');
      startInFlightRef.current = false;
    }
  };

  const submitVoiceTurn = async () => {
    if (isVoiceSubmittingRef.current) return;
    if (voiceSilenceTimerRef.current) {
      clearTimeout(voiceSilenceTimerRef.current);
      voiceSilenceTimerRef.current = null;
    }

    const question = transcriptRef.current.trim();
    if (!question || !userId) {
      setAssistantStatus('Listening...');
      return;
    }

    appendLocalMessage('user', question);
    isVoiceSubmittingRef.current = true;
    transcriptRef.current = '';
    try {
      await ExpoSpeechRecognitionModule.stop();
    } catch (_error) {
      // no-op
    }
    setAssistantListening(false);
    setSending(true);
    setAssistantStatus('Got it. Thinking...');
    try {
      let usedHttpFallback = false;
      const answer = await new Promise<string>(async (resolve) => {
        const timeout = setTimeout(() => {
          pendingVoiceTextResolveRef.current = null;
          resolve('');
        }, 20000);
        const wrappedResolve = (text: string) => {
          clearTimeout(timeout);
          pendingVoiceTextResolveRef.current = null;
          resolve(text);
        };
        pendingVoiceTextResolveRef.current = wrappedResolve;
        const sent = await sendVoiceWs({
          type: 'user.text.final',
          text: question,
          source: 'voice',
        });
        if (!sent) {
          usedHttpFallback = true;
          const fallback = await postChatMessage(question, selectedLanguage, 'voice');
          wrappedResolve(fallback);
          return;
        }
      });
      if (answer) {
        if (usedHttpFallback) {
          appendLocalMessage('assistant', answer);
        }
        await speakText(answer, selectedLanguage.locale);
      } else {
        setAssistantStatus('I did not catch a full response. Please try again.');
      }
    } catch (error) {
      console.error('Error processing assistant request:', error);
      setAssistantStatus('Assistant could not respond. Try again.');
    } finally {
      setSending(false);
      isVoiceSubmittingRef.current = false;
    if (assistantVisible) {
      setTimeout(() => {
        void startListening();
      }, 250);
    }
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 120);
    }
  };

  const closeAssistant = async () => {
    void sendVoiceWs({ type: 'control.interrupt' });
    try {
      await ExpoSpeechRecognitionModule.stop();
    } catch (_error) {
      // no-op
    }
    await Speech.stop();
    setAssistantListening(false);
    setAssistantSpeaking(false);
    if (voiceSilenceTimerRef.current) {
      clearTimeout(voiceSilenceTimerRef.current);
      voiceSilenceTimerRef.current = null;
    }
    setAssistantStatus('Hands-free mode active. Speak anytime.');
    setAssistantMicPrimed(false);
    setAssistantVisible(false);
  };

  const primeAssistantMic = async () => {
    if (!speechRecognitionAvailable) {
      setAssistantStatus('Voice recognition module not available in this build.');
      Alert.alert(
        'Voice Unavailable',
        'Speech recognition is unavailable in this app build. Use text chat or a custom dev build with native modules.'
      );
      return;
    }
    setAssistantMicPrimed(true);
    setAssistantStatus('Starting microphone...');
    setTimeout(() => {
      void startListening();
    }, 100);
  };

  const renderAssistantMessage = (content: string) => {
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return <Text style={styles.messageText}>{content}</Text>;
    }

    return (
      <View style={styles.assistantContent}>
        {lines.map((line, index) => {
          const isBullet = /^[-*]\s+/.test(line);
          const bulletText = line.replace(/^[-*]\s+/, '');
          const isHeading = !isBullet && line.endsWith(':') && line.length <= 48;
          const isKeyValue = !isBullet && line.includes(':') && !isHeading;

          if (isHeading) {
            return (
              <Text key={`${line}-${index}`} style={styles.assistantHeading}>
                {line}
              </Text>
            );
          }

          if (isBullet) {
            return (
              <View key={`${line}-${index}`} style={styles.bulletRow}>
                <View style={styles.bulletDot} />
                <Text style={styles.assistantParagraph}>{bulletText}</Text>
              </View>
            );
          }

          if (isKeyValue) {
            const parts = line.split(':');
            const label = parts[0]?.trim();
            const value = parts.slice(1).join(':').trim();
            return (
              <View key={`${line}-${index}`} style={styles.kvRow}>
                <Text style={styles.kvLabel}>{label}</Text>
                <Text style={styles.kvValue}>{value}</Text>
              </View>
            );
          }

          return (
            <Text key={`${line}-${index}`} style={styles.assistantParagraph}>
              {line}
            </Text>
          );
        })}
      </View>
    );
  };

  const renderVisualization = (viz: NonNullable<Message['visualization']>) => {
    if (viz.type === 'pie') {
      return (
        <View style={styles.chartWrap}>
          <Text style={styles.chartTitle}>{viz.title}</Text>
          {viz.subtitle ? <Text style={styles.chartSubtitle}>{viz.subtitle}</Text> : null}
          <View style={styles.chartRow}>
            <PieChart
              data={viz.slices || []}
              donut
              radius={72}
              innerRadius={44}
              showText
              textColor="#fff"
              textSize={11}
              focusOnPress
            />
          </View>
          <View style={styles.legendWrap}>
            {(viz.slices || []).map((slice) => (
              <View key={`${slice.text}-${slice.value}`} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: slice.color }]} />
                <Text style={styles.legendText}>{slice.text}</Text>
              </View>
            ))}
          </View>
        </View>
      );
    }

    if (viz.type === 'bar') {
      return (
        <View style={styles.chartWrap}>
          <Text style={styles.chartTitle}>{viz.title}</Text>
          {viz.subtitle ? <Text style={styles.chartSubtitle}>{viz.subtitle}</Text> : null}
          <BarChart
            data={viz.bars || []}
            barWidth={20}
            spacing={18}
            roundedTop
            yAxisTextStyle={{ color: '#aab7d8', fontSize: 10 }}
            xAxisLabelTextStyle={{ color: '#d5e1ff', fontSize: 10 }}
            noOfSections={4}
            hideRules={false}
            rulesColor="#27304a"
          />
        </View>
      );
    }

    if (viz.type === 'line') {
      return (
        <View style={styles.chartWrap}>
          <Text style={styles.chartTitle}>{viz.title}</Text>
          {viz.subtitle ? <Text style={styles.chartSubtitle}>{viz.subtitle}</Text> : null}
          <LineChart
            data={viz.trend || []}
            color="#4CAF50"
            thickness={2}
            dataPointsColor="#4CAF50"
            yAxisTextStyle={{ color: '#aab7d8', fontSize: 10 }}
            xAxisLabelTextStyle={{ color: '#d5e1ff', fontSize: 10 }}
            rulesColor="#27304a"
            hideRules={false}
            adjustToWidth
          />
        </View>
      );
    }

    if (viz.type === 'table') {
      return (
        <View style={styles.chartWrap}>
          <Text style={styles.chartTitle}>{viz.title}</Text>
          {viz.subtitle ? <Text style={styles.chartSubtitle}>{viz.subtitle}</Text> : null}
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCell, { flex: 1.1 }]}>Date</Text>
            <Text style={[styles.tableCell, { flex: 1.4 }]}>Category</Text>
            <Text style={[styles.tableCell, { flex: 1.1, textAlign: 'right' }]}>Amount</Text>
          </View>
          {(viz.rows || []).map((row, idx) => (
            <View key={`${row.c1}-${idx}`} style={styles.tableRow}>
              <Text style={[styles.tableCell, { flex: 1.1 }]}>{row.c1}</Text>
              <Text style={[styles.tableCell, { flex: 1.4 }]}>{row.c2}</Text>
              <Text style={[styles.tableCell, { flex: 1.1, textAlign: 'right' }]}>{row.c3}</Text>
            </View>
          ))}
        </View>
      );
    }

    return (
      null
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.aiHeader}>
          <View style={styles.aiAvatar}>
            <Ionicons name="sparkles" size={20} color="#fff" />
          </View>
          <View>
            <Text style={styles.headerTitle}>AI Financial Advisor</Text>
            <Text style={styles.headerSubtext}>Chat + Voice Assistant</Text>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesContainer}
          contentContainerStyle={styles.messagesContent}
          onContentSizeChange={() =>
            scrollViewRef.current?.scrollToEnd({ animated: true })
          }
        >
          {messages.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="chatbubbles-outline" size={64} color="#666" />
              <Text style={styles.emptyText}>Start a conversation</Text>
              <Text style={styles.emptySubtext}>
                Ask by text, or open Virtual Assistant for voice Q and A.
              </Text>
            </View>
          ) : (
            messages.map((msg) => (
              <View
                key={msg.id}
                style={[
                  styles.messageContainer,
                  msg.role === 'user' ? styles.userMessage : styles.assistantMessage,
                ]}
              >
                {msg.role === 'assistant' && (
                  <View style={styles.messageAvatar}>
                    <Ionicons name="sparkles" size={16} color="#4CAF50" />
                  </View>
                )}
                <View
                  style={[
                    styles.messageBubble,
                    msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
                  ]}
                >
                  {msg.role === 'assistant' ? (
                    <>
                      {msg.visualization ? renderVisualization(msg.visualization) : null}
                      {renderAssistantMessage(msg.message)}
                    </>
                  ) : (
                    <Text style={styles.messageText}>{msg.message}</Text>
                  )}
                  <View style={styles.messageMetaRow}>
                    <Text style={styles.messageTime}>
                      {format(new Date(msg.timestamp), 'h:mm a')}
                    </Text>
                    {msg.role === 'assistant' && (
                      <TouchableOpacity
                        style={styles.inlineSpeakerButton}
                        onPress={() => {
                          void speakText(msg.message, selectedLanguage.locale);
                        }}
                      >
                        <Ionicons name="volume-high-outline" size={13} color="#b8ffcb" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            ))
          )}
          {sending && (
            <View style={[styles.messageContainer, styles.assistantMessage]}>
              <View style={styles.messageAvatar}>
                <Ionicons name="sparkles" size={16} color="#4CAF50" />
              </View>
              <View style={[styles.messageBubble, styles.assistantBubble]}>
                <ActivityIndicator size="small" color="#4CAF50" />
              </View>
            </View>
          )}
        </ScrollView>

        <View style={styles.inputContainer}>
          <TouchableOpacity
            style={styles.assistantLaunchButton}
            onPress={() => setAssistantVisible(true)}
            disabled={sending}
          >
            <Ionicons name="person-circle-outline" size={20} color="#fff" />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Ask me anything..."
            placeholderTextColor="#666"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={!inputText.trim() || sending}
          >
            <Ionicons name="send" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={assistantVisible} animationType="slide" onRequestClose={closeAssistant}>
        <SafeAreaView style={styles.assistantModal}>
          <View style={styles.assistantTopBar}>
            <Text style={styles.assistantTitle}>Virtual Human Assistant</Text>
            <TouchableOpacity onPress={closeAssistant} style={styles.closeButton}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.languageRow}>
            {ASSISTANT_LANGUAGES.map((language) => (
              <TouchableOpacity
                key={language.id}
                onPress={() => setSelectedLanguage(language)}
                style={[
                  styles.languageChip,
                  selectedLanguage.id === language.id && styles.languageChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.languageChipText,
                    selectedLanguage.id === language.id && styles.languageChipTextActive,
                  ]}
                >
                  {language.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.avatarStage}>
            <Animated.View
              style={[
                styles.avatarOuter,
                assistantListening && styles.avatarListening,
                assistantSpeaking && styles.avatarSpeaking,
                { transform: [{ scale: pulse }] },
              ]}
            >
              <View style={styles.avatarFace}>
                <View style={styles.avatarEyesRow}>
                  <View style={styles.avatarEye} />
                  <View style={styles.avatarEye} />
                </View>
                <View style={styles.avatarMouth} />
              </View>
            </Animated.View>
          </View>

          <Text style={styles.assistantStatus}>{assistantStatus}</Text>
          {!!carryoverInsights && (
            <Text style={styles.carryoverText} numberOfLines={3}>
              Memory: {carryoverInsights}
            </Text>
          )}

          <View style={styles.assistantButtonsRow}>
            {!assistantMicPrimed && (
              <TouchableOpacity
                style={styles.enableMicButton}
                onPress={() => {
                  void primeAssistantMic();
                }}
              >
                <Ionicons name="mic" size={18} color="#fff" />
                <Text style={styles.enableMicText}>Enable Voice</Text>
              </TouchableOpacity>
            )}
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.handsFreeHint}>
                {assistantMicPrimed
                  ? 'Live voice conversation active'
                  : 'Tap Enable Voice once to start listening'}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1e',
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a3e',
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  aiAvatar: {
    width: 40,
    height: 40,
    backgroundColor: '#4CAF50',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtext: {
    fontSize: 12,
    color: '#999',
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 20,
  },
  messageContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  userMessage: {
    justifyContent: 'flex-end',
  },
  assistantMessage: {
    justifyContent: 'flex-start',
  },
  messageAvatar: {
    width: 32,
    height: 32,
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageBubble: {
    maxWidth: '86%',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
  },
  userBubble: {
    backgroundColor: '#4CAF50',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: '#1a1a2e',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  chartWrap: {
    backgroundColor: '#141a2b',
    borderWidth: 1,
    borderColor: '#2b3b60',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  chartTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  chartSubtitle: {
    color: '#b7c4e5',
    fontSize: 12,
    marginTop: 2,
    marginBottom: 8,
  },
  chartRow: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  legendWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginRight: 8,
    marginBottom: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: '#dbe4ff',
    fontSize: 11,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#2d3956',
    paddingBottom: 6,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2a46',
    paddingVertical: 6,
  },
  tableCell: {
    color: '#e2eaff',
    fontSize: 11,
  },
  messageText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  assistantContent: {
    gap: 8,
  },
  assistantHeading: {
    color: '#b8ffcb',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  assistantParagraph: {
    color: '#e4e8f5',
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#131526',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  kvLabel: {
    color: '#9aa0b4',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  kvValue: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
    flex: 1,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4CAF50',
    marginTop: 7,
  },
  messageTime: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    marginTop: 8,
  },
  messageMetaRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  inlineSpeakerButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a3f31',
    backgroundColor: '#132217',
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1a1a2e',
    borderTopWidth: 1,
    borderTopColor: '#2a2a3e',
    gap: 10,
    alignItems: 'flex-end',
  },
  assistantLaunchButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#2563eb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#2a2a3e',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    backgroundColor: '#4CAF50',
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#2a2a3e',
  },
  assistantModal: {
    flex: 1,
    backgroundColor: '#060b18',
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  assistantTopBar: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  assistantTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1b2843',
    justifyContent: 'center',
    alignItems: 'center',
  },
  languageRow: {
    marginTop: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  languageChip: {
    borderWidth: 1,
    borderColor: '#1f3a6d',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#0b1428',
  },
  languageChipActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  languageChipText: {
    color: '#a8c2ff',
    fontSize: 13,
    fontWeight: '600',
  },
  languageChipTextActive: {
    color: '#fff',
  },
  avatarStage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarOuter: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#0f1d39',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#244a8f',
  },
  avatarListening: {
    borderColor: '#22c55e',
    shadowColor: '#22c55e',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  avatarSpeaking: {
    borderColor: '#f97316',
    shadowColor: '#f97316',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  avatarFace: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: '#1b2d52',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarEyesRow: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 18,
  },
  avatarEye: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#9fc1ff',
  },
  avatarMouth: {
    width: 38,
    height: 10,
    borderRadius: 8,
    backgroundColor: '#9fc1ff',
  },
  assistantStatus: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
  },
  carryoverText: {
    marginTop: 8,
    color: '#9fb9ef',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  assistantButtonsRow: {
    marginTop: 18,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  enableMicButton: {
    height: 42,
    borderRadius: 21,
    backgroundColor: '#2563eb',
    borderWidth: 1,
    borderColor: '#2f6cf2',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  enableMicText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  livePill: {
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0f223f',
    borderWidth: 1,
    borderColor: '#2b4e87',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  handsFreeHint: {
    color: '#c7e7ff',
    fontSize: 12,
    fontWeight: '700',
  },
});
