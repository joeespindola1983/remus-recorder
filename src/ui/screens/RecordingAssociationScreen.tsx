import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { t } from '../../i18n';
import { ActionButton } from '../atoms/ActionButton';
import { ActivityCandidate } from '../molecules/ActivityMatchCard';
import { RecordingReconciliationPanel } from '../organisms/RecordingReconciliationPanel';
import { color, fontFamily, radius, spacing } from '../theme/tokens';

export function RecordingAssociationScreen({
  candidate,
  onConfirm,
  onDefer,
  onCreateNew,
}: {
  candidate: ActivityCandidate;
  onConfirm: (candidateId: string) => void;
  onDefer: () => void;
  onCreateNew?: () => void;
}): React.JSX.Element {
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>(
    candidate.id,
  );

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>{t('association.eyebrow')}</Text>
      <Text style={styles.title}>{t('association.title')}</Text>
      <Text style={styles.body}>{t('association.subtitle')}</Text>

      <RecordingReconciliationPanel
        candidate={candidate}
        onCreateNewActivity={onCreateNew}
        onSelectCandidate={setSelectedCandidateId}
        rangeIntervalText="06:18–07:02 · 44 min"
        rangeLabel={t('association.fromPhoneStart')}
        recordingBoundsText={`${t('association.localRecording')} · 05:58–07:02`}
        recordingTitle={t('association.panelTitle')}
        selectedCandidateId={selectedCandidateId}
      />

      <View style={styles.actions}>
        <ActionButton
          label={t('association.confirmAction')}
          onPress={() => onConfirm(selectedCandidateId)}
        />
        <TouchableOpacity onPress={onDefer} style={styles.ghostButton}>
          <Text style={styles.ghostButtonText}>
            {t('association.decideLaterAction')}
          </Text>
        </TouchableOpacity>
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
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  ghostButton: {
    alignItems: 'center',
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: spacing.sm,
  },
  ghostButtonText: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
  },
});
