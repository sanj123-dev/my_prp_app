import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export default function HelpSupportScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Help & Support</Text>
      </View>

      <TouchableOpacity style={styles.row} onPress={() => void Linking.openURL('mailto:support@spendwise.app')}>
        <View style={styles.rowLeft}>
          <Ionicons name="mail-outline" size={18} color="#4CAF50" />
          <Text style={styles.rowText}>Email Support</Text>
        </View>
        <Ionicons name="open-outline" size={18} color="#9aa0b4" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.row} onPress={() => void Linking.openURL('https://expo.dev')}>
        <View style={styles.rowLeft}>
          <Ionicons name="document-text-outline" size={18} color="#4CAF50" />
          <Text style={styles.rowText}>Documentation</Text>
        </View>
        <Ionicons name="open-outline" size={18} color="#9aa0b4" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1e', paddingHorizontal: 24, paddingTop: 16 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 10 },
  backButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2a2a3e', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  row: { backgroundColor: '#1a1a2e', borderRadius: 12, borderWidth: 1, borderColor: '#2a2a3e', paddingHorizontal: 14, paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
