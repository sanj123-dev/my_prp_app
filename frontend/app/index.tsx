import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { getSavedUserId } from '../lib/auth';
import { GradientSurface } from '../components/layout/GradientSurface';
import { theme } from '../theme/tokens';

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
