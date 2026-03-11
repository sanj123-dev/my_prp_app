import AsyncStorage from '@react-native-async-storage/async-storage';

const APP_SETTINGS_KEY = 'appSettingsV1';

export type ReminderSettings = {
  dailyReminderEnabled: boolean;
  billReminderEnabled: boolean;
  weeklySummaryEnabled: boolean;
  dailyReminderHour: number;
  billReminderHour: number;
};

export type AppSettings = {
  darkModeEnabled: boolean;
  reminders: ReminderSettings;
};

const DEFAULT_SETTINGS: AppSettings = {
  darkModeEnabled: true,
  reminders: {
    dailyReminderEnabled: true,
    billReminderEnabled: true,
    weeklySummaryEnabled: false,
    dailyReminderHour: 20,
    billReminderHour: 10,
  },
};

const clampHour = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(23, Math.round(value)));
};

const normalizeSettings = (raw: any): AppSettings => {
  const remindersRaw = raw?.reminders || {};
  return {
    darkModeEnabled:
      typeof raw?.darkModeEnabled === 'boolean'
        ? raw.darkModeEnabled
        : DEFAULT_SETTINGS.darkModeEnabled,
    reminders: {
      dailyReminderEnabled:
        typeof remindersRaw?.dailyReminderEnabled === 'boolean'
          ? remindersRaw.dailyReminderEnabled
          : DEFAULT_SETTINGS.reminders.dailyReminderEnabled,
      billReminderEnabled:
        typeof remindersRaw?.billReminderEnabled === 'boolean'
          ? remindersRaw.billReminderEnabled
          : DEFAULT_SETTINGS.reminders.billReminderEnabled,
      weeklySummaryEnabled:
        typeof remindersRaw?.weeklySummaryEnabled === 'boolean'
          ? remindersRaw.weeklySummaryEnabled
          : DEFAULT_SETTINGS.reminders.weeklySummaryEnabled,
      dailyReminderHour: clampHour(
        typeof remindersRaw?.dailyReminderHour === 'number'
          ? remindersRaw.dailyReminderHour
          : DEFAULT_SETTINGS.reminders.dailyReminderHour
      ),
      billReminderHour: clampHour(
        typeof remindersRaw?.billReminderHour === 'number'
          ? remindersRaw.billReminderHour
          : DEFAULT_SETTINGS.reminders.billReminderHour
      ),
    },
  };
};

export const getAppSettings = async (): Promise<AppSettings> => {
  try {
    const raw = await AsyncStorage.getItem(APP_SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return normalizeSettings(JSON.parse(raw));
  } catch (_error) {
    return DEFAULT_SETTINGS;
  }
};

export const saveAppSettings = async (settings: AppSettings): Promise<void> => {
  const normalized = normalizeSettings(settings);
  await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(normalized));
};

export const updateAppSettings = async (
  updater: (settings: AppSettings) => AppSettings
): Promise<AppSettings> => {
  const current = await getAppSettings();
  const next = normalizeSettings(updater(current));
  await saveAppSettings(next);
  return next;
};

