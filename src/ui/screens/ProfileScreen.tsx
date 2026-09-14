import React, {useCallback, useEffect, useState} from 'react';
import {Alert, ScrollView, StyleSheet, Text, View} from 'react-native';
import {
  RecordedWorkoutSummary,
  RecordingService,
} from '../../services/recording/RecordingService';
import {t} from '../../i18n';
import {ActionButton} from '../atoms/ActionButton';
import {color, fontFamily, radius, spacing} from '../theme/tokens';

const duration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? [h, m, s].map(value => String(value).padStart(2, '0')).join(':')
    : [m, s].map(value => String(value).padStart(2, '0')).join(':');
};

const sourceLabel = (sourceId: string): string => {
  if (sourceId.startsWith('phone:')) return 'iPhone / Android';
  if (sourceId.startsWith('rbp1:')) return 'Remus Blade';
  if (sourceId.startsWith('watch:')) return 'Watch';
  return sourceId;
};

export function ProfileScreen({service}: {service: RecordingService}): React.JSX.Element {
  const [workouts, setWorkouts] = useState<RecordedWorkoutSummary[]>([]);

  const reload = useCallback(() => {
    service.listRecordings().then(setWorkouts).catch(() => setWorkouts([]));
  }, [service]);

  useEffect(reload, [reload]);

  const confirmDelete = (workout: RecordedWorkoutSummary) => {
    Alert.alert(t('profile.deleteConfirmTitle'), t('profile.deleteConfirmMessage'), [
      {text: t('profile.cancel'), style: 'cancel'},
      {
        text: t('profile.delete'),
        style: 'destructive',
        onPress: () => service.deleteRecording(workout.activityId).then(reload),
      },
    ]);
  };

  const exportWorkout = (workout: RecordedWorkoutSummary) => {
    service.exportRecording(workout.activityId).catch(() => {
      Alert.alert(
        t('summary.exportFailedTitle'),
        t('summary.exportFailedMessage'),
      );
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>{t('profile.title')}</Text>
      <Text style={styles.title}>{t('profile.workouts')}</Text>
      <Text style={styles.counter}>
        {t('profile.totalWorkouts').replace('{count}', String(workouts.length))}
      </Text>
      {workouts.length === 0 ? (
        <Text style={styles.empty}>{t('profile.empty')}</Text>
      ) : workouts.map(workout => (
        <View key={workout.activityId} style={styles.card} testID={`workout-${workout.activityId}`}>
          <Text style={styles.date}>
            {new Date(workout.startedAtEpochMilliseconds).toLocaleString()}
          </Text>
          <Text style={styles.duration}>{duration(workout.durationSeconds)}</Text>
          <View style={styles.badges}>
            {workout.sourceIds.map(sourceId => (
              <View key={sourceId} style={styles.badge}>
                <Text style={styles.badgeText}>{sourceLabel(sourceId)}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.samples}>
            {Object.values(workout.sampleCounts).reduce((total, count) => total + count, 0)} {t('profile.samples')}
          </Text>
          <ActionButton
            label={t('profile.export')}
            onPress={() => exportWorkout(workout)}
            tone="secondary"
          />
          <ActionButton
            label={t('profile.delete')}
            onPress={() => confirmDelete(workout)}
            tone="destructive"
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {backgroundColor: color.backgroundDefault, gap: spacing.md, padding: spacing.md, paddingBottom: 120},
  eyebrow: {color: color.actionPrimary, fontFamily, fontSize: 13, fontWeight: '700'},
  title: {color: color.textPrimary, fontFamily, fontSize: 28, fontWeight: '700'},
  counter: {color: color.textSecondary, fontFamily, fontSize: 14},
  empty: {color: color.textSecondary, fontFamily, fontSize: 16, paddingVertical: spacing.xl, textAlign: 'center'},
  card: {backgroundColor: color.surfaceDefault, borderColor: color.borderDefault, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.md},
  date: {color: color.textPrimary, fontFamily, fontSize: 16, fontWeight: '700'},
  duration: {color: color.textPrimary, fontFamily, fontSize: 26, fontWeight: '700'},
  badges: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs},
  badge: {backgroundColor: color.successContainer, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs},
  badgeText: {color: color.textPrimary, fontFamily, fontSize: 12, fontWeight: '600'},
  samples: {color: color.textSecondary, fontFamily, fontSize: 13},
});
