import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { router } from 'expo-router';

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type FinancialNewsItem = {
  title: string;
  summary: string;
  source: string;
  link: string;
  published_at?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
};

const FALLBACK_FINANCIAL_NEWS: FinancialNewsItem[] = [
  {
    title: 'Markets hold steady as investors assess inflation and rate signals',
    summary:
      'Global equity benchmarks moved in a narrow range as investors reviewed fresh inflation commentary and central bank guidance. Analysts said risk appetite remained constructive, though short term volatility may persist. Portfolio strategy notes continued to favor diversified exposure, quality earnings, and disciplined cash flow management in uncertain macro conditions.',
    source: 'SpendWise Feed',
    link: 'https://www.reuters.com/markets/',
    sentiment: 'positive',
  },
  {
    title: 'Tech and financial sectors lead selective gains in late session trading',
    summary:
      'Large cap technology and financial stocks outperformed in late trading, supported by resilient earnings expectations and improving liquidity cues. Market observers highlighted selective rotation rather than broad risk on momentum. For retail investors, advisors recommended staying focused on asset allocation targets and avoiding concentrated bets during headline driven swings.',
    source: 'SpendWise Feed',
    link: 'https://finance.yahoo.com/',
    sentiment: 'neutral',
  },
];

export default function NewsScreen() {
  const [news, setNews] = useState<FinancialNewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadNews();
  }, []);

  const loadNews = async () => {
    try {
      const response = await axios.get(
        `${EXPO_PUBLIC_BACKEND_URL}/api/news/financial?limit=25`
      );
      setNews(response.data || []);
    } catch (error) {
      console.error('Error loading news:', error);
      setNews(FALLBACK_FINANCIAL_NEWS);
    } finally {
      setLoading(false);
    }
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Financial News</Text>
          <Text style={styles.subtitle}>Latest market headlines and insights</Text>
        </View>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {news.map((item) => (
          <TouchableOpacity
            key={item.link}
            style={styles.newsCard}
            onPress={() => void Linking.openURL(item.link)}
            activeOpacity={0.9}
          >
            <View style={styles.newsMetaRow}>
              <Text style={styles.newsSource}>{item.source}</Text>
              <Text
                style={[
                  styles.sentimentTag,
                  item.sentiment === 'positive'
                    ? styles.sentimentPositive
                    : item.sentiment === 'negative'
                      ? styles.sentimentNegative
                      : styles.sentimentNeutral,
                ]}
              >
                {(item.sentiment || 'neutral').toUpperCase()}
              </Text>
            </View>
            <Text style={styles.newsTitle}>{item.title}</Text>
            <Text style={styles.newsSummary}>{item.summary}</Text>
            <View style={styles.readRow}>
              <Text style={styles.readText}>Open article</Text>
              <Ionicons name="open-outline" size={14} color="#8fa1e0" />
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a3e',
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: '#9ba3c5',
    fontSize: 12,
    marginTop: 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  newsCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    padding: 14,
  },
  newsMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  newsSource: {
    color: '#8fa1e0',
    fontSize: 11,
    fontWeight: '700',
  },
  sentimentTag: {
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  sentimentPositive: {
    color: '#9cf598',
    backgroundColor: '#16351f',
  },
  sentimentNegative: {
    color: '#ff9f9f',
    backgroundColor: '#3a1e1e',
  },
  sentimentNeutral: {
    color: '#d5dcf7',
    backgroundColor: '#283050',
  },
  newsTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    marginBottom: 8,
  },
  newsSummary: {
    color: '#b5bdd8',
    fontSize: 12,
    lineHeight: 19,
  },
  readRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  readText: {
    color: '#8fa1e0',
    fontSize: 11,
    fontWeight: '600',
  },
});
