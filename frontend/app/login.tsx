import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { AuthShell } from '../components/auth/AuthShell';
import { login, saveUserId } from '../lib/auth';
import { theme } from '../theme/tokens';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }

    try {
      setSubmitting(true);
      const user = await login({
        email: email.trim(),
        password,
      });
      await saveUserId(user.id);
      router.replace('/(tabs)/dashboard');
    } catch (error) {
      Alert.alert('Login Failed', error instanceof Error ? error.message : 'Unable to login');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      icon="wallet-outline"
      title="SpendWise"
      subtitle="Your AI money coach. Secure sign in to continue."
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardContainer}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.inputContainer}>
            <Ionicons name="mail-outline" size={20} color={theme.colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={theme.colors.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={20} color={theme.colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={theme.colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          <TouchableOpacity style={styles.primaryButton} onPress={handleLogin} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color={theme.colors.accentContrast} />
            ) : (
              <Text style={styles.primaryButtonText}>Login</Text>
            )}
          </TouchableOpacity>

          <View style={styles.footerRow}>
            <Text style={styles.footerText}>Don&apos;t have an account?</Text>
            <Link href="/signup" style={styles.footerLink}>
              Sign up
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  keyboardContainer: {
    width: '100%',
  },
  scrollContent: {
    gap: theme.spacing.sm,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
    backgroundColor: 'rgba(5, 16, 34, 0.65)',
    borderRadius: theme.radii.md,
    paddingHorizontal: 14,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 16,
    paddingVertical: 14,
  },
  primaryButton: {
    width: '100%',
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: theme.spacing.sm,
  },
  primaryButtonText: {
    color: theme.colors.accentContrast,
    fontSize: 16,
    fontWeight: '800',
  },
  footerRow: {
    marginTop: theme.spacing.md,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  footerText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
  },
  footerLink: {
    color: theme.colors.info,
    fontSize: 14,
    fontWeight: '700',
  },
});
