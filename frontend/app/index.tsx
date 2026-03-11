import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { clearUserId, getSavedUserId, getUserById } from '../lib/auth';
import { GradientSurface } from '../components/layout/GradientSurface';
import { theme } from '../theme/tokens';

export default function Index() {
  useEffect(() => {
    const bootstrap = async () => {
      const userId = await getSavedUserId();
      if (userId) {
        try {
          await getUserById(userId);
          router.replace('/(tabs)/dashboard');
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error ?? '');
          if (message.toLowerCase().includes('user not found')) {
            await clearUserId();
          }
        }
        router.replace('/login');
        return;
      }
      router.replace('/login');
    };

    void bootstrap();
  }, []);

  return (
    <GradientSurface>
      <View style={styles.container}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    </GradientSurface>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
