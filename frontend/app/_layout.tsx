import { Stack } from 'expo-router';
import { LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

if (__DEV__) {
  LogBox.ignoreLogs(['Unable to activate keep awake']);
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="analytics" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="news/index" />
      </Stack>
    </SafeAreaProvider>
  );
}
