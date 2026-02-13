import '@expo/metro-runtime';

if (__DEV__) {
  try {
    // Patch dev-time keep-awake activation to avoid uncaught rejection on
    // environments where activation is temporarily unavailable.
    const KeepAwake = require('expo-keep-awake');
    const originalActivate = KeepAwake?.activateKeepAwakeAsync;

    if (typeof originalActivate === 'function') {
      KeepAwake.activateKeepAwakeAsync = async (...args) => {
        try {
          return await originalActivate(...args);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error ?? '');
          if (message.includes('Unable to activate keep awake')) {
            return;
          }
          throw error;
        }
      };
    }
  } catch (_error) {
    // No-op: expo-keep-awake may be unavailable in some environments.
  }
}

import 'expo-router/entry';
