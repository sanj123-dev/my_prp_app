import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export default function PrivacySecurityScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Privacy & Security</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Data Protection</Text>
        <Text style={styles.cardText}>Your account uses secure authentication and user-isolated records.</Text>
      </View>

      <TouchableOpacity style={styles.row} onPress={() => void Linking.openURL('https://expo.dev/privacy')}>
        <Text style={styles.rowText}>Read Privacy Policy</Text>
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
  card: { backgroundColor: '#1a1a2e', borderRadius: 14, borderWidth: 1, borderColor: '#2a2a3e', padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 8 },
  cardText: { fontSize: 14, color: '#9aa0b4', lineHeight: 20 },
  row: { backgroundColor: '#1a1a2e', borderRadius: 12, borderWidth: 1, borderColor: '#2a2a3e', paddingHorizontal: 14, paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
