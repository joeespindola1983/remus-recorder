import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { t } from '../../i18n';
import {
  ActivityCandidate,
  ActivityMatchCard,
} from '../molecules/ActivityMatchCard';
import { RecordingRangeControl } from '../molecules/RecordingRangeControl';
import { color, fontFamily, radius, spacing } from '../theme/tokens';

export function RecordingReconciliationPanel({
  recordingTitle,
  recordingBoundsText,
  rangeLabel,
  rangeIntervalText,
  candidate,
  selectedCandidateId,
  onSelectCandidate,
  onCreateNewActivity,
}: {
  recordingTitle: string;
  recordingBoundsText: string;
  rangeLabel: string;
  rangeIntervalText: string;
  candidate: ActivityCandidate;
  selectedCandidateId?: string;
  onSelectCandidate?: (id: string) => void;
  onCreateNewActivity?: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>{recordingTitle}</Text>
        <Text style={styles.subtitle}>{recordingBoundsText}</Text>
      </View>

      <RecordingRangeControl
        isRecommended={true}
        intervalText={rangeIntervalText}
        label={rangeLabel}
      />

      <ActivityMatchCard
        candidate={candidate}
        onSelect={onSelectCandidate}
        selected={selectedCandidateId === candidate.id}
      />

      {onCreateNewActivity ? (
        <TouchableOpacity
          onPress={onCreateNewActivity}
          style={styles.newActivityAction}
        >
          <Text style={styles.newActivityText}>
            {t('association.createNewActivity')}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: color.surfaceDefault,
    borderColor: color.borderDefault,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  header: {
    gap: 2,
  },
  title: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 13,
  },
  newActivityAction: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  newActivityText: {
    color: color.actionPrimary,
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
});
