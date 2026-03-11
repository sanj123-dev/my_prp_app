import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, Switch, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { AppSettings, getAppSettings, updateAppSettings } from '../../lib/profileSettings';

export default function RemindersScreen() {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      const loaded = await getAppSettings();
      setSettings(loaded);
    };
    void bootstrap();
  }, []);

  const updateSettings = async (updater: (current: AppSettings) => AppSettings) => {
    const next = await updateAppSettings(updater);
    setSettings(next);
  };

  const formatHour = (hour: number) => {
    const safeHour = Math.max(0, Math.min(23, hour));
    const suffix = safeHour >= 12 ? 'PM' : 'AM';
    const normalized = safeHour % 12 || 12;
    return `${normalized}:00 ${suffix}`;
  };

  const hourOptions = useMemo(() => [8, 10, 14, 18, 20, 22], []);

  if (!settings) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Reminders</Text>
        </View>
        <Text style={styles.helper}>Loading reminder settings...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Reminders</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.row}>
          <View style={styles.rowTextWrap}>
            <Text style={styles.label}>Daily spending reminder</Text>
            <Text style={styles.meta}>Send summary every day at {formatHour(settings.reminders.dailyReminderHour)}</Text>
          </View>
          <Switch
            value={settings.reminders.dailyReminderEnabled}
            onValueChange={(value) => {
              void updateSettings((current) => ({
                ...current,
                reminders: { ...current.reminders, dailyReminderEnabled: value },
              }));
            }}
            trackColor={{ true: '#4CAF50' }}
          />
        </View>

        <View style={styles.chipsRow}>
          {hourOptions.map((hour) => (
            <TouchableOpacity
              key={`daily-${hour}`}
              style={[
                styles.hourChip,
                settings.reminders.dailyReminderHour === hour && styles.hourChipActive,
              ]}
              onPress={() => {
                void updateSettings((current) => ({
                  ...current,
                  reminders: { ...current.reminders, dailyReminderHour: hour },
                }));
              }}
            >
              <Text
                style={[
                  styles.hourChipText,
                  settings.reminders.dailyReminderHour === hour && styles.hourChipTextActive,
                ]}
              >
                {formatHour(hour)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.row}>
          <View style={styles.rowTextWrap}>
            <Text style={styles.label}>Bill due reminders</Text>
            <Text style={styles.meta}>Send a reminder at {formatHour(settings.reminders.billReminderHour)}</Text>
          </View>
          <Switch
            value={settings.reminders.billReminderEnabled}
            onValueChange={(value) => {
              void updateSettings((current) => ({
                ...current,
                reminders: { ...current.reminders, billReminderEnabled: value },
              }));
            }}
            trackColor={{ true: '#4CAF50' }}
          />
        </View>

        <View style={styles.chipsRow}>
          {hourOptions.map((hour) => (
            <TouchableOpacity
              key={`bill-${hour}`}
              style={[
                styles.hourChip,
                settings.reminders.billReminderHour === hour && styles.hourChipActive,
              ]}
              onPress={() => {
                void updateSettings((current) => ({
                  ...current,
                  reminders: { ...current.reminders, billReminderHour: hour },
                }));
              }}
            >
              <Text
                style={[
                  styles.hourChipText,
                  settings.reminders.billReminderHour === hour && styles.hourChipTextActive,
                ]}
              >
                {formatHour(hour)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.row}>
          <View style={styles.rowTextWrap}>
            <Text style={styles.label}>Weekly summary</Text>
            <Text style={styles.meta}>Receive one weekly spending health summary</Text>
          </View>
          <Switch
            value={settings.reminders.weeklySummaryEnabled}
            onValueChange={(value) => {
              void updateSettings((current) => ({
                ...current,
                reminders: { ...current.reminders, weeklySummaryEnabled: value },
              }));
            }}
            trackColor={{ true: '#4CAF50' }}
          />
        </View>

        <Text style={styles.helper}>
          Reminder preferences are saved on this device and used by the app reminder workflow.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1e', paddingHorizontal: 24, paddingTop: 16 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 10 },
  backButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2a2a3e', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  content: { paddingBottom: 28 },
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
  rowTextWrap: { flex: 1, paddingRight: 10 },
  label: { color: '#fff', fontSize: 14, fontWeight: '700' },
  meta: { color: '#9aa0b4', fontSize: 12, marginTop: 4 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  hourChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    backgroundColor: '#161626',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  hourChipActive: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  hourChipText: { color: '#8f96af', fontSize: 12, fontWeight: '700' },
  hourChipTextActive: { color: '#fff' },
  helper: { color: '#8f95aa', fontSize: 12, marginTop: 10, lineHeight: 18 },
});
