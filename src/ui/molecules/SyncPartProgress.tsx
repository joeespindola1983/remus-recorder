import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { t } from '../../i18n';
import { color, fontFamily, radius, spacing } from '../theme/tokens';

export type SyncStatus = 'transferring' | 'paused' | 'verified';

export interface SyncTransferItem {
  id: string;
  sourceName: string;
  status: SyncStatus;
  progressPercent: number;
  detail: string;
}

export function SyncPartProgress({
  item,
  onRetry,
}: {
  item: SyncTransferItem;
  onRetry?: (id: string) => void;
}): React.JSX.Element {
  const isPaused = item.status === 'paused';
  const statusLabel =
    item.status === 'transferring'
      ? t('sync.transferring')
      : item.status === 'paused'
      ? t('sync.paused')
      : t('sync.verified');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.statusLabel}>{statusLabel}</Text>
        <Text style={styles.percentText}>{`${item.progressPercent}%`}</Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${Math.min(100, Math.max(0, item.progressPercent))}%` },
            isPaused && styles.fillPaused,
          ]}
        />
      </View>
      <View style={styles.footer}>
        <Text style={styles.detailText}>{item.detail}</Text>
        {isPaused && onRetry ? (
          <TouchableOpacity
            onPress={() => onRetry(item.id)}
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>{t('sync.retryAction')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statusLabel: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
  },
  percentText: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 15,
    fontWeight: '700',
  },
  track: {
    backgroundColor: color.backgroundTertiary,
    borderRadius: radius.full,
    height: 8,
    marginVertical: 4,
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    backgroundColor: color.actionPrimary,
    borderRadius: radius.full,
    height: '100%',
  },
  fillPaused: {
    backgroundColor: color.warning,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailText: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 13,
  },
  retryButton: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  retryText: {
    color: color.actionPrimary,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
});
