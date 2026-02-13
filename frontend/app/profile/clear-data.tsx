import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export default function ClearDataScreen() {
  const onClear = () => {
    Alert.alert('Success', 'Data cleared successfully (feature coming soon)');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Clear All Data</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.warningTitle}>Danger Zone</Text>
        <Text style={styles.warningText}>
          This will delete all your transactions, credit cards, and chat history. This action cannot be undone.
        </Text>
      </View>

      <TouchableOpacity style={styles.deleteButton} onPress={onClear}>
        <Text style={styles.deleteText}>Clear Everything</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1e', paddingHorizontal: 24, paddingTop: 16 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 10 },
  backButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2a2a3e', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  card: { backgroundColor: '#261717', borderRadius: 14, borderWidth: 1, borderColor: '#5e2b2b', padding: 16, marginBottom: 14 },
  warningTitle: { color: '#ff8b8b', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  warningText: { color: '#ffd1d1', fontSize: 14, lineHeight: 20 },
  deleteButton: { backgroundColor: '#FF6B6B', borderRadius: 12, alignItems: 'center', paddingVertical: 14 },
  deleteText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
