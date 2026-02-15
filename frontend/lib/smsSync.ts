import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const IMPORTED_SMS_IDS_KEY = 'importedSmsIds';
const REALTIME_SMS_FINGERPRINTS_KEY = 'realtimeSmsFingerprints';
const LAST_SMS_IMPORT_AT_KEY = 'lastSmsImportAt';
const SMS_AUTH_TRIGGER_KEY = 'smsAuthTrigger';
const DEFAULT_LOOKBACK_DAYS = 90;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

let syncInProgress = false;
let hasReadSmsPermissionCache: boolean | null = null;
let realtimeListenerUsers = 0;
let realtimeSubscription: { remove: () => void } | null = null;
let realtimeActiveUserId = '';
let realtimeOnTransactionsCreated: ((items: any[]) => void) | undefined;

type RealtimeSmsEvent = {
  body?: string;
  timestamp?: number;
  address?: string;
};

export type SmsAuthTrigger = 'signup' | 'login';

type SmsSyncMode = 'signup' | 'login' | 'live' | 'manual';

type SmsSyncOptions = {
  userId: string;
  mode: SmsSyncMode;
  requestPermission?: boolean;
  onTransactionsCreated?: (items: any[]) => void;
  onProgress?: (progress: {
    scannedCount: number;
    importedCount: number;
    page: number;
    maxPages: number;
  }) => void;
};

type RealtimeSmsOptions = {
  userId: string;
  requestPermission?: boolean;
  onTransactionsCreated?: (items: any[]) => void;
};

const getSmsModule = () => {
  const native = (NativeModules as Record<string, any>)?.SpendWiseSmsReceiver;
  if (native && typeof native.list === 'function') {
    return native;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-get-sms-android');
  } catch (_error) {
    return null;
  }
};

const isTransactionSms = (body: string) => {
  const keywords =
    /(debited|credited|spent|withdrawn|purchase|paid|payment|txn|transaction|pos|upi|neft|imps|atm|card)/i;
  const amountRegex = /(?:rs\.?|inr|\$|usd)\s*[\d,]+(?:\.\d{1,2})?/i;
  return keywords.test(body) && amountRegex.test(body);
};

const getRealtimeSmsModule = () => {
  const maybeModule = (NativeModules as Record<string, any>)?.SpendWiseSmsReceiver;
  if (!maybeModule) return null;
  if (typeof maybeModule.start !== 'function' || typeof maybeModule.stop !== 'function') {
    return null;
  }
  return maybeModule;
};

const buildRealtimeFingerprint = (event: RealtimeSmsEvent) => {
  const body = String(event.body ?? '').trim().slice(0, 120);
  const timestamp = Number(event.timestamp ?? Date.now());
  const address = String(event.address ?? '').trim();
  return `${timestamp}|${address}|${body}`;
};

const seenRealtimeFingerprint = async (fingerprint: string) => {
  const raw = await AsyncStorage.getItem(REALTIME_SMS_FINGERPRINTS_KEY);
  const items: string[] = raw ? JSON.parse(raw) : [];
  return items.includes(fingerprint);
};

const rememberRealtimeFingerprint = async (fingerprint: string) => {
  const raw = await AsyncStorage.getItem(REALTIME_SMS_FINGERPRINTS_KEY);
  const items: string[] = raw ? JSON.parse(raw) : [];
  const next = [...items.filter((item) => item !== fingerprint), fingerprint].slice(-400);
  await AsyncStorage.setItem(REALTIME_SMS_FINGERPRINTS_KEY, JSON.stringify(next));
};

const requestReadSmsPermissionIfNeeded = async (allowPrompt: boolean) => {
  if (Platform.OS !== 'android') {
    return false;
  }

  if (hasReadSmsPermissionCache === true) {
    return true;
  }

  try {
    const hasReadPermission = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.READ_SMS
    );
    const hasReceivePermission = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS
    );
    const hasPermission = hasReadPermission && hasReceivePermission;
    if (hasPermission) {
      hasReadSmsPermissionCache = true;
      return true;
    }

    if (!allowPrompt) {
      hasReadSmsPermissionCache = false;
      return false;
    }

    const grantedMap = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    ]);

    const isGranted =
      grantedMap[PermissionsAndroid.PERMISSIONS.READ_SMS] ===
        PermissionsAndroid.RESULTS.GRANTED &&
      grantedMap[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] ===
        PermissionsAndroid.RESULTS.GRANTED;
    hasReadSmsPermissionCache = isGranted;
    return isGranted;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? '');

    // Happens when permission APIs are called while the app is not attached
    // to an Android Activity; treat it as a transient "not available now".
    if (message.includes('not attached to an Activity')) {
      return false;
    }

    return false;
  }
};

const importRealtimeSms = async (event: RealtimeSmsEvent) => {
  const userId = realtimeActiveUserId;
  if (!userId || !EXPO_PUBLIC_BACKEND_URL) return;

  const body = String(event.body ?? '').trim();
  if (!body || !isTransactionSms(body)) return;

  const fingerprint = buildRealtimeFingerprint(event);
  if (await seenRealtimeFingerprint(fingerprint)) return;

  try {
    const timestamp = Number(event.timestamp ?? Date.now());
    const response = await axios.post(`${EXPO_PUBLIC_BACKEND_URL}/api/transactions/sms`, {
      user_id: userId,
      sms_text: body,
      date: new Date(timestamp).toISOString(),
    });
    await rememberRealtimeFingerprint(fingerprint);
    if (realtimeOnTransactionsCreated) {
      realtimeOnTransactionsCreated([response.data]);
    }
  } catch (error) {
    console.error('Realtime SMS import failed:', error);
  }
};

const getMinDateForMode = async (mode: SmsSyncMode) => {
  const now = Date.now();
  const lastImportRaw = await AsyncStorage.getItem(LAST_SMS_IMPORT_AT_KEY);
  const lastImportAt = lastImportRaw ? Number(lastImportRaw) : 0;

  if (mode === 'signup') {
    return now - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  }

  if (mode === 'login') {
    // For login we intentionally keep it to only current/new messages.
    return now;
  }

  if (mode === 'manual') {
    return now - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  }

  return lastImportAt || now - 30 * 60 * 1000;
};

export const setSmsAuthTrigger = async (trigger: SmsAuthTrigger) => {
  await AsyncStorage.setItem(SMS_AUTH_TRIGGER_KEY, trigger);
};

export const getSmsAuthTrigger = async () => {
  return AsyncStorage.getItem(SMS_AUTH_TRIGGER_KEY);
};

export const clearSmsAuthTrigger = async () => {
  await AsyncStorage.removeItem(SMS_AUTH_TRIGGER_KEY);
};

export const requestSmsPermission = async () => {
  return requestReadSmsPermissionIfNeeded(true);
};

export const startRealtimeSmsSync = async ({
  userId,
  requestPermission = false,
  onTransactionsCreated,
}: RealtimeSmsOptions) => {
  if (Platform.OS !== 'android') {
    return () => {};
  }

  const module = getRealtimeSmsModule();
  if (!module) {
    return () => {};
  }

  const hasPermission = await requestReadSmsPermissionIfNeeded(requestPermission);
  if (!hasPermission) {
    return () => {};
  }

  realtimeListenerUsers += 1;
  realtimeActiveUserId = userId;
  realtimeOnTransactionsCreated = onTransactionsCreated;

  if (!realtimeSubscription) {
    const emitter = new NativeEventEmitter(module);
    realtimeSubscription = emitter.addListener(
      'SpendWiseSmsReceived',
      (event: RealtimeSmsEvent) => {
        void importRealtimeSms(event);
      }
    );
    module.start();
  }

  return () => {
    realtimeListenerUsers = Math.max(0, realtimeListenerUsers - 1);
    if (realtimeListenerUsers === 0) {
      realtimeSubscription?.remove();
      realtimeSubscription = null;
      module.stop();
      realtimeActiveUserId = '';
      realtimeOnTransactionsCreated = undefined;
    }
  };
};

export const syncSmsTransactions = async ({
  userId,
  mode,
  requestPermission = false,
  onTransactionsCreated,
  onProgress,
}: SmsSyncOptions) => {
  if (!EXPO_PUBLIC_BACKEND_URL || Platform.OS !== 'android' || syncInProgress) {
    return 0;
  }

  const SmsAndroid = getSmsModule();
  if (!SmsAndroid) {
    return 0;
  }

  const hasPermission = await requestReadSmsPermissionIfNeeded(requestPermission);
  if (!hasPermission) {
    return 0;
  }

  syncInProgress = true;
  try {
    const minDate = await getMinDateForMode(mode);

    const importedIdsRaw = await AsyncStorage.getItem(IMPORTED_SMS_IDS_KEY);
    const importedIds: string[] = importedIdsRaw ? JSON.parse(importedIdsRaw) : [];
    const importedSet = new Set(importedIds);

    const created: any[] = [];
    let latestSeenDate = minDate;
    let scannedCount = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const filter = {
        box: 'inbox',
        minDate,
        indexFrom: page * PAGE_SIZE,
        maxCount: PAGE_SIZE,
      };

      const smsList: any[] = await new Promise((resolve, reject) => {
        SmsAndroid.list(
          JSON.stringify(filter),
          (fail: string) => reject(new Error(fail)),
          (_count: number, smsListJson: string) => {
            try {
              resolve(JSON.parse(smsListJson));
            } catch (error) {
              reject(error);
            }
          }
        );
      });

      if (!smsList || smsList.length === 0) {
        break;
      }
      scannedCount += smsList.length;
      if (onProgress) {
        onProgress({
          scannedCount,
          importedCount: created.length,
          page,
          maxPages: MAX_PAGES,
        });
      }

      for (const sms of smsList) {
        const smsId = String(sms._id ?? sms.id ?? '');
        if (!smsId || importedSet.has(smsId)) {
          continue;
        }

        const body = String(sms.body ?? '').trim();
        if (!body || !isTransactionSms(body)) {
          continue;
        }

        const timestamp = Number(sms.date ?? Date.now());
        latestSeenDate = Math.max(latestSeenDate, timestamp);

        const response = await axios.post(
          `${EXPO_PUBLIC_BACKEND_URL}/api/transactions/sms`,
          {
            user_id: userId,
            sms_text: body,
            date: new Date(timestamp).toISOString(),
          }
        );
        created.push(response.data);
        importedSet.add(smsId);
        if (onProgress) {
          onProgress({
            scannedCount,
            importedCount: created.length,
            page,
            maxPages: MAX_PAGES,
          });
        }
      }

      if (smsList.length < PAGE_SIZE) {
        break;
      }
    }

    const updatedIds = Array.from(importedSet).slice(-600);
    await AsyncStorage.setItem(IMPORTED_SMS_IDS_KEY, JSON.stringify(updatedIds));
    await AsyncStorage.setItem(
      LAST_SMS_IMPORT_AT_KEY,
      String(Math.max(latestSeenDate, Date.now()))
    );

    if (created.length > 0 && onTransactionsCreated) {
      onTransactionsCreated(created);
    }
    if (onProgress) {
      onProgress({
        scannedCount,
        importedCount: created.length,
        page: MAX_PAGES - 1,
        maxPages: MAX_PAGES,
      });
    }
    return created.length;
  } catch (error) {
    console.error('SMS sync failed:', error);
    return 0;
  } finally {
    syncInProgress = false;
  }
};
