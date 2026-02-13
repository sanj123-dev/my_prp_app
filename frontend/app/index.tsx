import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { getSavedUserId } from '../lib/auth';

export default function Index() {
  useEffect(() => {
    const bootstrap = async () => {
      const userId = await getSavedUserId();
      if (userId) {
        router.replace('/(tabs)/dashboard');
        return;
      }
      router.replace('/login');
    };

    void bootstrap();
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#4CAF50" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1e',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

