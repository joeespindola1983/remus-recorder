import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { t } from '../../i18n';
import { color, fontFamily, radius, spacing } from '../theme/tokens';

export interface ActivityCandidate {
  id: string;
  title: string;
  matchDetail: string;
  isSuggested?: boolean;
}

export function ActivityMatchCard({
  candidate,
  selected = false,
  onSelect,
}: {
  candidate: ActivityCandidate;
  selected?: boolean;
  onSelect?: (id: string) => void;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => onSelect?.(candidate.id)}
      style={[styles.container, selected && styles.containerSelected]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{candidate.title}</Text>
        {candidate.isSuggested ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{t('association.suggested')}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.detail}>{candidate.matchDetail}</Text>
      <Text style={styles.caveat}>{t('association.suggestionCaveat')}</Text>
    </TouchableOpacity>
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
  containerSelected: {
    borderColor: color.actionPrimary,
    borderWidth: 2,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    color: color.textPrimary,
    flex: 1,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
  },
  badge: {
    backgroundColor: color.backgroundTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
  detail: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 13,
  },
  caveat: {
    color: color.textTertiary,
    fontFamily,
    fontSize: 12,
    marginTop: 2,
  },
});
