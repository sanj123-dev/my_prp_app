import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export default function RemindersScreen() {
  const [dailyReminder, setDailyReminder] = useState(true);
  const [billReminder, setBillReminder] = useState(true);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Reminders</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Daily spending reminder</Text>
        <Switch value={dailyReminder} onValueChange={setDailyReminder} trackColor={{ true: '#4CAF50' }} />
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Bill due reminders</Text>
        <Switch value={billReminder} onValueChange={setBillReminder} trackColor={{ true: '#4CAF50' }} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1e', paddingHorizontal: 24, paddingTop: 16 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 10 },
  backButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2a2a3e', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  row: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
