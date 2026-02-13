import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getGlossaryTerms, type GlossaryTerm } from '../../lib/learnApi';

export default function GlossaryScreen() {
  const [query, setQuery] = useState('');
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        try {
          const response = await getGlossaryTerms(query);
          setTerms(response);
        } catch (loadError) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load glossary');
        } finally {
          setLoading(false);
        }
      })();
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#D8FFF7" />
          <Text style={styles.backText}>Back to Learn</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Glossary</Text>
        <Text style={styles.subtitle}>Find terms in seconds with simple explanations.</Text>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color="#7FA59E" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search a term"
            placeholderTextColor="#7FA59E"
            value={query}
            onChangeText={setQuery}
          />
        </View>

        {loading ? (
          <View style={styles.stateRow}>
            <ActivityIndicator color="#27E2BF" />
            <Text style={styles.stateText}>Searching terms...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {terms.map((item) => (
          <View key={item.id} style={styles.termCard}>
            <Text style={styles.term}>{item.term}</Text>
            <Text style={styles.meaning}>{item.meaning}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#081F24' },
  content: { padding: 20, gap: 12 },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  backText: { color: '#D8FFF7', fontSize: 13, fontWeight: '600' },
  title: { color: '#F3FFFC', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#A5CEC7', fontSize: 14, marginBottom: 8 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0F3138', borderRadius: 12, borderWidth: 1, borderColor: '#1E4E57', paddingHorizontal: 12 },
  searchInput: { flex: 1, color: '#F3FFFC', paddingVertical: 10, fontSize: 14 },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  stateText: { color: '#DDFBF4', fontSize: 12, fontWeight: '600' },
  errorCard: { backgroundColor: '#4C1F25', borderRadius: 12, borderWidth: 1, borderColor: '#9D4652', padding: 12 },
  errorText: { color: '#FFDADF', fontSize: 12, fontWeight: '600' },
  termCard: { backgroundColor: '#113940', borderRadius: 14, borderWidth: 1, borderColor: '#23515A', padding: 14 },
  term: { color: '#27E2BF', fontSize: 15, fontWeight: '700', marginBottom: 6 },
  meaning: { color: '#DDFBF4', fontSize: 14, lineHeight: 20 },
});
