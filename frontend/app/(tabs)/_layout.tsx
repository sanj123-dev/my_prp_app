import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { Tabs, router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getSavedUserId } from '../../lib/auth';
import { theme } from '../../theme/tokens';

export default function TabLayout() {
  const [checkingSession, setCheckingSession] = useState(true);

  const ensureSession = async () => {
    const userId = await getSavedUserId();
    if (!userId) {
      router.replace('/login');
      return false;
    }
    setCheckingSession(false);
    return true;
  };

  useEffect(() => {
    void ensureSession();
  }, []);

  useFocusEffect(
    useCallback(() => {
      void ensureSession();
    }, [])
  );

  if (checkingSession) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.backgroundBase,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.tabInactive,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: theme.colors.tabBackground,
          borderTopColor: theme.colors.borderSoft,
          borderTopWidth: 1,
          paddingBottom: Platform.OS === 'android' ? 14 : 10,
          paddingTop: 8,
          height: Platform.OS === 'android' ? 72 : 68,
          marginBottom: Platform.OS === 'android' ? 6 : 0,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '700',
          fontFamily: theme.typography.display,
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Transactions',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chatbot',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="investments"
        options={{
          title: 'Invest',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trending-up-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: 'Goals',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trophy-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="credit"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="AnalyticsPanel"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}

