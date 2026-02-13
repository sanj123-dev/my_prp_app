import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export default function AboutScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>About SpendWise</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>SpendWise</Text>
        <Text style={styles.cardText}>
          SpendWise helps you track spending, sync SMS transactions, and generate AI-based financial insights.
        </Text>
        <Text style={styles.version}>Version 1.0.0</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1e', paddingHorizontal: 24, paddingTop: 16 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 10 },
  backButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2a2a3e', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  card: { backgroundColor: '#1a1a2e', borderRadius: 14, borderWidth: 1, borderColor: '#2a2a3e', padding: 16 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 8 },
  cardText: { fontSize: 14, color: '#9aa0b4', lineHeight: 20 },
  version: { marginTop: 12, color: '#4CAF50', fontSize: 13, fontWeight: '700' },
});
