import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '../../i18n';
import { SyncTransferItem } from '../molecules/SyncPartProgress';
import { PendingArtifactTransferQueue } from '../organisms/PendingArtifactTransferQueue';
import { color, fontFamily, radius, spacing } from '../theme/tokens';

export function ArtifactTransferCenterScreen({
  transfers,
  onRetry,
}: {
  transfers: SyncTransferItem[];
  onRetry?: (id: string) => void;
}): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>{t('sync.eyebrow')}</Text>
      <Text style={styles.title}>{t('sync.title')}</Text>
      <Text style={styles.body}>{t('sync.subtitle')}</Text>

      <PendingArtifactTransferQueue transfers={transfers} onRetry={onRetry} />

      <View style={styles.ruleCard}>
        <Text style={styles.ruleTitle}>{t('sync.rbp1RuleTitle')}</Text>
        <Text style={styles.ruleDetail}>{t('sync.rbp1RuleDetail')}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    backgroundColor: color.backgroundDefault,
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: 120,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: color.borderDefault,
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 64,
    justifyContent: 'space-between',
  },
  brand: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 20,
    fontWeight: '700',
  },
  settingsMark: {
    alignItems: 'center',
    borderColor: color.actionPrimary,
    borderRadius: 25,
    borderWidth: 2,
    height: 50,
    justifyContent: 'center',
    width: 50,
  },
  settingsText: { color: color.actionPrimary, fontSize: 28 },
  eyebrow: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  title: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 24,
    fontWeight: '700',
  },
  body: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
  },
  ruleCard: {
    backgroundColor: color.backgroundSecondary,
    borderColor: color.borderDefault,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  ruleTitle: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
  },
  ruleDetail: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
  },
});
