import {Platform} from 'react-native';

export const color = {
  backgroundDefault: '#FFFFFF',
  backgroundSecondary: '#F9FAFB',
  backgroundTertiary: '#F3F4F6',
  surfaceDefault: '#FFFFFF',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  textInverse: '#FFFFFF',
  borderDefault: '#E5E7EB',
  actionPrimary: '#0EA5E9',
  actionDestructive: '#EF4444',
  success: '#10B981',
  successContainer: '#D1FAE5',
  warning: '#F59E0B',
  warningContainer: '#FEF3C7',
  error: '#EF4444',
  errorContainer: '#FEE2E2',
} as const;
export const spacing = {xs: 4, sm: 8, md: 16, lg: 24, xl: 32} as const;
export const radius = {md: 8, lg: 12, xl: 20, full: 999} as const;
export const fontFamily = Platform.select({ios: 'System', android: 'Roboto'});
