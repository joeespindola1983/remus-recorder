import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../../i18n';
import { color, fontFamily, radius, spacing } from '../theme/tokens';

export function RecordingRangeControl({
  label,
  intervalText,
  isRecommended = false,
}: {
  label: string;
  intervalText: string;
  isRecommended?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        {isRecommended ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{t('association.recommended')}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.track}>
        <View style={styles.trackUnselected} />
        <View style={styles.trackSelected} />
      </View>
      <Text style={styles.intervalText}>{intervalText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: color.surfaceDefault,
    borderColor: color.borderDefault,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
  },
  badge: {
    backgroundColor: color.successContainer,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    color: color.success,
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
  track: {
    backgroundColor: color.backgroundTertiary,
    borderRadius: radius.full,
    flexDirection: 'row',
    height: 10,
    marginVertical: 4,
    overflow: 'hidden',
    width: '100%',
  },
  trackUnselected: {
    backgroundColor: color.borderDefault,
    width: '25%',
  },
  trackSelected: {
    backgroundColor: color.actionPrimary,
    width: '75%',
  },
  intervalText: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
  },
});
