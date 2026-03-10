import axios, { AxiosError } from 'axios';

export type AssistantHistoryMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  message: string;
  timestamp: string;
  source: 'text' | 'voice';
};

export type AssistantSessionResult = {
  sessionId: string;
  carryoverInsights: string;
};

export type AssistantChatResult = {
  sessionId?: string;
  response: string;
};

type SessionPayload = {
  userId: string;
  language: string;
  existingSessionId?: string;
};

type MessagePayload = {
  userId: string;
  language: string;
  message: string;
  sessionId?: string;
  source?: 'text' | 'voice';
};

const tryParseAxiosStatus = (error: unknown) =>
  axios.isAxiosError(error) ? (error as AxiosError).response?.status ?? null : null;

const sanitizeHistoryMessage = (raw: any): AssistantHistoryMessage | null => {
  const roleRaw = String(raw?.role || '').toLowerCase();
  const role = roleRaw === 'assistant' || roleRaw === 'system' ? roleRaw : 'user';
  const timestamp = String(raw?.timestamp || raw?.created_at || '');
  const content = String(raw?.message ?? raw?.content ?? '');
  if (!content.trim()) return null;

  const sourceRaw = String(raw?.source || raw?.metadata?.source || 'text').toLowerCase();
  const source = sourceRaw === 'voice' ? 'voice' : 'text';
  return {
    id: String(raw?.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    role,
    message: content,
    timestamp: timestamp || new Date().toISOString(),
    source,
  };
};

export class AssistantClient {
  constructor(private readonly baseUrl: string) {}

  async startSession(payload: SessionPayload): Promise<AssistantSessionResult> {
    const body = {
      user_id: payload.userId,
      language: payload.language,
      existing_session_id: payload.existingSessionId,
    };

    try {
      const response = await axios.post(`${this.baseUrl}/api/assistant/session/start`, body);
      return {
        sessionId: String(response.data?.session_id || ''),
        carryoverInsights: String(response.data?.carryover_insights || ''),
      };
    } catch (error) {
      const status = tryParseAxiosStatus(error);
      if (status && ![404, 405, 422].includes(status)) {
        throw error;
      }
      const fallback = await axios.post(`${this.baseUrl}/api/chat/session/start`, body);
      return {
        sessionId: String(fallback.data?.session_id || ''),
        carryoverInsights: String(fallback.data?.carryover_insights || ''),
      };
    }
  }

  async sendMessage(payload: MessagePayload): Promise<AssistantChatResult> {
    const body = {
      user_id: payload.userId,
      message: payload.message,
      language: payload.language,
      session_id: payload.sessionId,
      source: payload.source || 'text',
    };

    try {
      const response = await axios.post(`${this.baseUrl}/api/assistant/chat`, body);
      return {
        sessionId: String(response.data?.session_id || payload.sessionId || ''),
        response: String(response.data?.response || ''),
      };
    } catch (error) {
      const status = tryParseAxiosStatus(error);
      if (status && ![404, 405, 422].includes(status)) {
        throw error;
      }
      const fallback = await axios.post(`${this.baseUrl}/api/chat`, body);
      return {
        sessionId: String(fallback.data?.session_id || payload.sessionId || ''),
        response: String(fallback.data?.response || ''),
      };
    }
  }

  async getHistory(userId: string, limit = 120): Promise<AssistantHistoryMessage[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/assistant/chat/${userId}`, {
        params: { limit },
      });
      const rows = Array.isArray(response.data) ? response.data : [];
      return rows.map(sanitizeHistoryMessage).filter(Boolean) as AssistantHistoryMessage[];
    } catch (error) {
      const status = tryParseAxiosStatus(error);
      if (status && ![404, 405, 422].includes(status)) {
        throw error;
      }
      const fallback = await axios.get(`${this.baseUrl}/api/chat/${userId}`, {
        params: { limit },
      });
      const rows = Array.isArray(fallback.data) ? fallback.data : [];
      return rows.map(sanitizeHistoryMessage).filter(Boolean) as AssistantHistoryMessage[];
    }
  }
}

export const createAssistantClient = () => {
  const baseUrl = (process.env.EXPO_PUBLIC_BACKEND_URL || '').trim();
  if (!baseUrl) {
    throw new Error('EXPO_PUBLIC_BACKEND_URL is not configured');
  }
  return new AssistantClient(baseUrl);
};
