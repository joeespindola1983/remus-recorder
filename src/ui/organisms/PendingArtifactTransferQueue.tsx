import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../../i18n';
import {
  SyncPartProgress,
  SyncTransferItem,
} from '../molecules/SyncPartProgress';
import { color, fontFamily, radius, spacing } from '../theme/tokens';

export function PendingArtifactTransferQueue({
  transfers,
  onRetry,
}: {
  transfers: SyncTransferItem[];
  onRetry?: (id: string) => void;
}): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('sync.queueTitle')}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {`${transfers.length} ${t('sync.pendingCount')}`}
          </Text>
        </View>
      </View>
      <View style={styles.list}>
        {transfers.map(item => (
          <SyncPartProgress key={item.id} item={item} onRetry={onRetry} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  title: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
  },
  badge: {
    backgroundColor: color.backgroundTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeText: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
  list: {
    gap: spacing.sm,
  },
});
