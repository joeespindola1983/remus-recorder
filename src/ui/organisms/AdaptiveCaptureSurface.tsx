import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LiveCaptureMetrics } from '../../application/capture/ActivityCapture';
import { t } from '../../i18n';
import { CaptureFab } from '../atoms/CaptureFab';
import { LiveMetricCell } from '../molecules/LiveMetricCell';
import { color, fontFamily, spacing } from '../theme/tokens';

export type CaptureOrientation = 'portrait' | 'landscape';
export const captureOrientationFor = (
  width: number,
  height: number,
): CaptureOrientation => (width > height ? 'landscape' : 'portrait');

const elapsed = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return [hours, minutes, remainingSeconds]
    .map(value => String(value).padStart(2, '0'))
    .join(':');
};

const formatPace = (seconds?: number): string => {
  if (seconds === undefined) return '—';
  const rounded = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(
    rounded % 60,
  ).padStart(2, '0')}`;
};

const formatDecimal = (value?: number): string =>
  value === undefined ? '—' : value.toFixed(1).replace('.', ',');

export function AdaptiveCaptureSurface({
  metrics,
  onFinish,
  onPause,
  orientation,
  viewportWidth = orientation === 'portrait' ? 393 : 852,
}: {
  metrics: LiveCaptureMetrics;
  onFinish: () => void;
  onPause: () => void;
  orientation: CaptureOrientation;
  viewportWidth?: number;
}): React.JSX.Element {
  const isLandscape = orientation === 'landscape';
  const valueFontSize = isLandscape
    ? Math.max(56, Math.min(76, viewportWidth * 0.075))
    : Math.max(52, Math.min(72, viewportWidth * 0.142));
  const cells = [
    {
      identifier: 'strokeRateSpm',
      label: t('active.metric.strokeRate'),
      value:
        metrics.strokeRateSpm === undefined
          ? '—'
          : String(Math.round(metrics.strokeRateSpm)),
      unit: t('active.metric.strokeRateUnit'),
    },
    {
      identifier: 'paceSecondsPer500Meters',
      label: t('active.metric.pace'),
      value: formatPace(metrics.paceSecondsPer500Meters),
      unit: t('active.metric.paceUnit'),
    },
    {
      identifier: 'distanceMeters',
      label: t('active.metric.distance'),
      value:
        metrics.distanceMeters === undefined
          ? '—'
          : formatDecimal(metrics.distanceMeters / 1000),
      unit: t('active.metric.distanceUnit'),
    },
    {
      identifier: 'heartRateBeatsPerMinute',
      label: t('active.metric.heartRate'),
      value:
        metrics.heartRateBeatsPerMinute === undefined
          ? '—'
          : String(Math.round(metrics.heartRateBeatsPerMinute)),
      unit: t('active.metric.heartRateUnit'),
    },
  ];

  return (
    <View style={[styles.surface, isLandscape && styles.surfaceLandscape]}>
      <View style={styles.metricArea}>
        <View style={styles.statusRow}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingLabel}>{t('active.recording')}</Text>
          <Text style={styles.elapsed}>{elapsed(metrics.elapsedSeconds)}</Text>
        </View>
        <View style={styles.grid}>
          {cells.map(cell => (
            <LiveMetricCell
              {...cell}
              key={cell.identifier}
              style={styles.cell}
              valueFontSize={valueFontSize}
            />
          ))}
        </View>
        <Text style={styles.provenance}>{t('active.provenance')}</Text>
      </View>
      <View
        style={[
          styles.controls,
          isLandscape ? styles.controlsLandscape : styles.controlsPortrait,
        ]}
        testID="capture-controls"
      >
        <CaptureFab action="pause" onPress={onPause} />
        <CaptureFab action="finish" onPress={onFinish} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { backgroundColor: color.backgroundDefault, flex: 1 },
  surfaceLandscape: { flexDirection: 'row' },
  metricArea: { flex: 1, paddingHorizontal: 12, paddingTop: spacing.sm },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    height: 46,
  },
  recordingDot: {
    backgroundColor: color.actionDestructive,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  recordingLabel: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
  },
  elapsed: {
    color: color.textPrimary,
    flex: 1,
    fontFamily,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
  },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  cell: { height: '50%', width: '50%' },
  provenance: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 28,
  },
  controls: {
    alignItems: 'center',
    backgroundColor: color.backgroundSecondary,
    borderColor: color.borderDefault,
    gap: spacing.lg,
    justifyContent: 'center',
  },
  controlsPortrait: { borderTopWidth: 1, flexDirection: 'row', height: 104 },
  controlsLandscape: {
    alignSelf: 'stretch',
    borderLeftWidth: 1,
    flexDirection: 'column',
    justifyContent: 'flex-start',
    paddingTop: 20,
    width: 108,
  },
});
