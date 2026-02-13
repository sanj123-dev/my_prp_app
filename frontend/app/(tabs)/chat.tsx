import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
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
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import * as Speech from 'expo-speech';
import { format } from 'date-fns';

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const CHAT_SESSION_ID_KEY = 'chatSessionId';

interface Message {
  id: string;
  role: string;
  message: string;
  timestamp: string;
  source?: 'text' | 'voice';
}

type AssistantLanguage = {
  id: string;
  label: string;
  locale: string;
  promptName: string;
};

const ASSISTANT_LANGUAGES: AssistantLanguage[] = [
  { id: 'english', label: 'English', locale: 'en-IN', promptName: 'English' },
  { id: 'hindi', label: 'Hindi', locale: 'hi-IN', promptName: 'Hindi' },
  { id: 'spanish', label: 'Spanish', locale: 'es-ES', promptName: 'Spanish' },
  { id: 'french', label: 'French', locale: 'fr-FR', promptName: 'French' },
];

export default function Chat() {
  const [userId, setUserId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [conversationMode] = useState(true);
  const [carryoverInsights, setCarryoverInsights] = useState('');

  const [assistantVisible, setAssistantVisible] = useState(false);
  const [assistantListening, setAssistantListening] = useState(false);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [assistantTranscript, setAssistantTranscript] = useState('');
  const [assistantStatus, setAssistantStatus] = useState(
    'Listening...'
  );
  const [selectedLanguage, setSelectedLanguage] = useState<AssistantLanguage>(
    ASSISTANT_LANGUAGES[0]
  );

  const scrollViewRef = useRef<ScrollView>(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const transcriptRef = useRef('');
  const isVoiceSubmittingRef = useRef(false);
  const preferredMaleVoiceRef = useRef<Record<string, string | undefined>>({});
  const resumeOnFocusRef = useRef(false);

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
    return '';
  };

  const speakText = async (text: string, locale?: string) => {
    const cleaned = (text || '').trim();
    if (!cleaned) return;

    const resolveMaleVoiceId = async () => {
      const key = locale || 'default';
      if (preferredMaleVoiceRef.current[key] !== undefined) {
        return preferredMaleVoiceRef.current[key];
      }

      try {
        const voices = await Speech.getAvailableVoicesAsync();
        const filtered = voices.filter((voice) =>
          locale ? (voice.language || '').toLowerCase().startsWith(locale.toLowerCase().slice(0, 2)) : true
        );
        const maleVoice =
          filtered.find((voice) => /male|man|david|daniel|alex/i.test(voice.name || '')) ||
          filtered.find((voice) => /male|man|david|daniel|alex/i.test(voice.identifier || ''));

        preferredMaleVoiceRef.current[key] = maleVoice?.identifier;
        return maleVoice?.identifier;
      } catch (_error) {
        preferredMaleVoiceRef.current[key] = undefined;
        return undefined;
      }
    };

    const maleVoiceId = await resolveMaleVoiceId();

    const attemptSpeak = (language?: string) =>
      new Promise<boolean>((resolve) => {
        Speech.speak(cleaned, {
          language,
          voice: maleVoiceId,
          rate: 0.9,
          pitch: 0.85,
          volume: 1.0,
          onDone: () => resolve(true),
          onStopped: () => resolve(true),
          onError: () => resolve(false),
        });
      });

    setAssistantSpeaking(true);
    setAssistantStatus('Speaking...');
    await Speech.stop();

    let ok = await attemptSpeak(locale);
    if (!ok) {
      ok = await attemptSpeak(undefined);
    }

    setAssistantSpeaking(false);
    setAssistantStatus(
      ok ? 'Listening...' : 'Audio unavailable on this device.'
    );

    if (conversationMode && assistantVisible && !assistantListening && !sending) {
      setTimeout(() => {
        void startListening();
      }, 250);
    }
  };

  useEffect(() => {
    void loadChat();
  }, []);

  useSpeechRecognitionEvent('start', () => {
    setAssistantListening(true);
    setAssistantStatus('Listening...');
    transcriptRef.current = '';
  });

  useSpeechRecognitionEvent('result', (event: any) => {
    const transcript = getTranscriptFromEvent(event);
    if (transcript) {
      transcriptRef.current = transcript;
      setAssistantTranscript(transcript);
    }
  });

  useSpeechRecognitionEvent('end', () => {
    setAssistantListening(false);
    setAssistantStatus('Processing...');
    void stopListeningAndAsk(false);
  });

  useSpeechRecognitionEvent('error', () => {
    setAssistantListening(false);
    setAssistantStatus('Could not understand. Try again.');
  });

  useEffect(() => {
    return () => {
      void Speech.stop();
    };
  }, []);

  useEffect(() => {
    if (!assistantVisible) {
      pulse.stopAnimation();
      pulse.setValue(1);
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
  }, [assistantVisible, pulse]);

  useEffect(() => {
    if (assistantVisible && conversationMode && !assistantListening && !assistantSpeaking && !sending) {
      setTimeout(() => {
        void startListening();
      }, 150);
    }
  }, [assistantListening, assistantSpeaking, assistantVisible, conversationMode, sending]);

  useFocusEffect(
    React.useCallback(() => {
      if (resumeOnFocusRef.current && conversationMode && assistantVisible && !assistantListening) {
        setTimeout(() => {
          void startListening();
        }, 200);
      }
      resumeOnFocusRef.current = false;

      return () => {
        if (conversationMode && assistantVisible && assistantListening) {
          resumeOnFocusRef.current = true;
          void ExpoSpeechRecognitionModule.stop();
        }
      };
    }, [assistantListening, assistantVisible, conversationMode])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && conversationMode && assistantListening) {
        resumeOnFocusRef.current = true;
        void ExpoSpeechRecognitionModule.stop();
      }
      if (state === 'active' && resumeOnFocusRef.current && conversationMode && assistantVisible) {
        setTimeout(() => {
          void startListening();
        }, 250);
        resumeOnFocusRef.current = false;
      }
    });

    return () => {
      sub.remove();
    };
  }, [assistantListening, assistantVisible, conversationMode]);

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

  const appendLocalMessage = (role: 'user' | 'assistant', message: string) => {
    const localMessage: Message = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      message,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, localMessage]);
  };

  const sendMessage = async () => {
    if (!inputText.trim() || sending || !userId) return;

    const userMessage = inputText.trim();
    setInputText('');
    setSending(true);
    appendLocalMessage('user', userMessage);

    try {
      const answer = await postChatMessage(userMessage, selectedLanguage, 'text');
      if (answer) appendLocalMessage('assistant', answer);
      void loadChat();
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
    if (sending) return;

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
      return;
    }

    try {
      setAssistantTranscript('');
      transcriptRef.current = '';
      await ExpoSpeechRecognitionModule.start({
        lang: selectedLanguage.locale,
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
      });
    } catch (error) {
      console.error('Error starting voice recognition:', error);
      setAssistantStatus('Voice recognition unavailable on this device.');
    }
  };

  const stopListeningAndAsk = async (forceStop: boolean = true) => {
    if (isVoiceSubmittingRef.current) return;
    if (forceStop) {
      try {
        await ExpoSpeechRecognitionModule.stop();
      } catch (_error) {
        // no-op
      }
    }

    const question = transcriptRef.current.trim() || assistantTranscript.trim();
    if (!question || !userId) {
      if (conversationMode && assistantVisible && !sending) {
        setAssistantStatus('Listening...');
        setTimeout(() => {
          void startListening();
        }, 120);
      } else {
        setAssistantStatus('Listening...');
      }
      return;
    }

    isVoiceSubmittingRef.current = true;
    setSending(true);
    setAssistantStatus('Processing your voice...');
    try {
      const answer = await postChatMessage(question, selectedLanguage, 'voice');
      if (answer) {
        await speakText(answer, selectedLanguage.locale);
      }
      setAssistantTranscript('');
      transcriptRef.current = '';
    } catch (error) {
      console.error('Error processing assistant request:', error);
      setAssistantStatus('Assistant could not respond. Try again.');
    } finally {
      setSending(false);
      isVoiceSubmittingRef.current = false;
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 120);
    }
  };

  const closeAssistant = async () => {
    try {
      await ExpoSpeechRecognitionModule.stop();
    } catch (_error) {
      // no-op
    }
    await Speech.stop();
    setAssistantListening(false);
    setAssistantSpeaking(false);
    setAssistantTranscript('');
    setAssistantStatus('Listening...');
    setAssistantVisible(false);
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
                    renderAssistantMessage(msg.message)
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
          <Text style={styles.assistantTranscript}>
            {assistantTranscript || 'Your voice transcript will appear here.'}
          </Text>
          {!!carryoverInsights && (
            <Text style={styles.carryoverText} numberOfLines={3}>
              Memory: {carryoverInsights}
            </Text>
          )}

          <View style={styles.assistantButtonsRow}>
            <View style={styles.autoModePill}>
              <Ionicons name="sync-circle" size={18} color="#9fd4ff" />
              <Text style={styles.autoModeText}>Auto 2-Way Mode Active</Text>
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
  assistantTranscript: {
    marginTop: 10,
    minHeight: 52,
    color: '#c5d5ff',
    textAlign: 'center',
    fontSize: 14,
    paddingHorizontal: 8,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoModePill: {
    height: 42,
    borderRadius: 21,
    backgroundColor: '#0f223f',
    borderWidth: 1,
    borderColor: '#2b4e87',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  autoModeText: {
    color: '#c7e7ff',
    fontSize: 13,
    fontWeight: '700',
  },
});
