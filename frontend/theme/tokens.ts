export const theme = {
  colors: {
    backgroundBase: '#070E1B',
    backgroundElevated: '#121D33',
    backgroundCard: '#15233B',
    borderSoft: 'rgba(155, 189, 255, 0.20)',
    borderStrong: 'rgba(125, 173, 255, 0.45)',
    textPrimary: '#F4F8FF',
    textSecondary: '#AFC2E6',
    textMuted: '#7E91B6',
    accent: '#2ED3A6',
    accentStrong: '#1AAE86',
    accentContrast: '#042F28',
    info: '#57A9FF',
    danger: '#FF7F96',
    tabInactive: '#7E8BA8',
    tabBackground: '#0D172C',
    gradientStart: '#050C1A',
    gradientMid: '#0D1D3A',
    gradientEnd: '#1B3056',
  },
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24,
    xl: 32,
  },
  radii: {
    sm: 10,
    md: 16,
    lg: 22,
    pill: 999,
  },
  typography: {
    display: 'SpaceMono-Regular',
    body: 'System',
  },
  shadows: {
    glow: {
      shadowColor: '#1A67FF',
      shadowOpacity: 0.22,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 12 },
      elevation: 8,
    },
  },
} as const;

export type AppTheme = typeof theme;
