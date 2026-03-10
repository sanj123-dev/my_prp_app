import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GradientSurface } from '../layout/GradientSurface';
import { theme } from '../../theme/tokens';

type AuthShellProps = PropsWithChildren<{
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
}>;

export function AuthShell({ icon, title, subtitle, children }: AuthShellProps) {
  return (
    <GradientSurface padded>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={30} color={theme.colors.accent} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <View style={styles.body}>{children}</View>
      </View>
    </GradientSurface>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 'auto',
    marginBottom: 'auto',
    borderRadius: theme.radii.lg,
    padding: theme.spacing.lg,
    backgroundColor: 'rgba(14, 26, 47, 0.88)',
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
    ...theme.shadows.glow,
  },
  iconWrap: {
    width: 58,
    height: 58,
    borderRadius: theme.radii.pill,
    backgroundColor: 'rgba(37, 92, 199, 0.25)',
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: {
    marginTop: theme.spacing.md,
    textAlign: 'center',
    fontSize: 29,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.display,
  },
  subtitle: {
    marginTop: theme.spacing.sm,
    textAlign: 'center',
    fontSize: 14,
    color: theme.colors.textSecondary,
    lineHeight: 20,
  },
  body: {
    marginTop: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
});
