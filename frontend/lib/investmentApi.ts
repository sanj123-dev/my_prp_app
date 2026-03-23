import axios from 'axios';

const EXPO_PUBLIC_BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || '').trim();

const requireBackendUrl = () => {
  if (!EXPO_PUBLIC_BACKEND_URL) {
    throw new Error('EXPO_PUBLIC_BACKEND_URL is not configured');
  }
};

export type InvestmentSearchResult = {
  symbol: string;
  name: string;
  exchange?: string | null;
  asset_type: string;
  score: number;
};

export type HistoricalPoint = {
  date: string;
  close: number;
  volume: number;
  ma50?: number | null;
  ma200?: number | null;
};

export type InvestmentOverview = {
  snapshot: {
    ticker: string;
    short_name: string;
    currency: string;
    exchange: string;
    asset_type: string;
    price: number;
    previous_close?: number | null;
    market_cap?: number | null;
    pe_ratio?: number | null;
    day_change_pct?: number | null;
    volume?: number | null;
    fetched_at: string;
  };
  analytics: {
    cagr_pct?: number | null;
    volatility_pct?: number | null;
    trend: string;
    index_symbol: string;
    performance_vs_index_pct?: number | null;
  };
  history: HistoricalPoint[];
  ai_insight: string;
  news: Array<{
    title: string;
    link: string;
    source: string;
    published_at?: string | null;
    sentiment: 'positive' | 'neutral' | 'negative';
    summary: string;
  }>;
  suggestion: {
    risk_profile: string;
    suggestions: string[];
  };
  disclaimer: string;
};

export type InvestmentQaResponse = {
  answer: string;
  session_id: string;
  used_context_keys: string[];
  disclaimer: string;
};

export const searchInvestments = async (
  userId: string,
  query: string,
  limit = 8
): Promise<InvestmentSearchResult[]> => {
  requireBackendUrl();
  const response = await axios.get<InvestmentSearchResult[]>(
    `${EXPO_PUBLIC_BACKEND_URL}/api/investments/search`,
    {
      params: {
        user_id: userId,
        q: query,
        limit,
      },
    }
  );
  return Array.isArray(response.data) ? response.data : [];
};

export const getInvestmentOverview = async (
  userId: string,
  tickerOrQuery: string,
  period = 'max'
): Promise<InvestmentOverview> => {
  requireBackendUrl();
  const response = await axios.get<InvestmentOverview>(
    `${EXPO_PUBLIC_BACKEND_URL}/api/investments/overview`,
    {
      params: {
        user_id: userId,
        ticker_or_query: tickerOrQuery,
        period,
      },
    }
  );
  return response.data;
};

export const askInvestmentQuestion = async (payload: {
  userId: string;
  ticker: string;
  question: string;
  sessionId?: string;
}): Promise<InvestmentQaResponse> => {
  requireBackendUrl();
  const response = await axios.post<InvestmentQaResponse>(
    `${EXPO_PUBLIC_BACKEND_URL}/api/investments/qa`,
    {
      user_id: payload.userId,
      ticker: payload.ticker,
      question: payload.question,
      session_id: payload.sessionId,
    }
  );
  return response.data;
};
