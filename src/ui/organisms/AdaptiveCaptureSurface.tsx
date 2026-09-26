import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LiveCaptureMetrics } from '../../application/capture/ActivityCapture';
import { getLocale, t } from '../../i18n';
import { CaptureFab } from '../atoms/CaptureFab';
import { LiveMetricCell } from '../molecules/LiveMetricCell';
import { LiveBladeParityCell } from '../molecules/LiveBladeParityCell';
import { RemusBladeManager } from '../../services/blade/RemusBladeManager';
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

export interface BladeGpsStatus {
  hasGpsLock: boolean;
  satsInUse: number;
  satsInView: number;
  maxSnrDbHz?: number;
  accuracyMeters?: number;
}

const formatPace = (seconds?: number): string => {
  if (seconds === undefined || seconds > 625) return '—';
  const rounded = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(
    rounded % 60,
  ).padStart(2, '0')}`;
};

const formatDecimal = (value?: number): string =>
  value === undefined ? '—' : value.toFixed(1).replace('.', ',');

const formatAccuracy = (accuracyMeters?: number): string => {
  if (accuracyMeters === undefined || accuracyMeters <= 0) return '';
  const numStr =
    accuracyMeters < 10
      ? accuracyMeters.toFixed(1)
      : String(Math.round(accuracyMeters));
  return getLocale() === 'en-US' ? numStr : numStr.replace('.', ',');
};

const getGpsBadgeInfo = (gps: BladeGpsStatus) => {
  if (gps.hasGpsLock) {
    const acc = formatAccuracy(gps.accuracyMeters);
    const text = acc
      ? t('active.bladeGps.locked').replace('{accuracy}', acc)
      : t('active.bladeGps.lockedNoAcc');
    return {
      text,
      badgeStyle: styles.badgeSuccess,
      textStyle: styles.textSuccess,
    };
  }
  if (gps.satsInView > 0 || (gps.maxSnrDbHz !== undefined && gps.maxSnrDbHz > 0)) {
    return {
      text: t('active.bladeGps.searching'),
      badgeStyle: styles.badgeWarning,
      textStyle: styles.textWarning,
    };
  }
  return {
    text: t('active.bladeGps.noSignal'),
    badgeStyle: styles.badgeDanger,
    textStyle: styles.textDanger,
  };
};

export function AdaptiveCaptureSurface({
  metrics,
  onFinish,
  onPause,
  orientation,
  viewportWidth = orientation === 'portrait' ? 393 : 852,
  bladeGpsStatus,
  bladeManager,
}: {
  metrics: LiveCaptureMetrics;
  onFinish: () => void;
  onPause: () => void;
  orientation: CaptureOrientation;
  viewportWidth?: number;
  bladeGpsStatus?: BladeGpsStatus | null;
  bladeManager?: RemusBladeManager | null;
}): React.JSX.Element {
  const isLandscape = orientation === 'landscape';
  const valueFontSize = isLandscape
    ? Math.max(40, Math.min(54, viewportWidth * 0.06))
    : Math.max(48, Math.min(64, viewportWidth * 0.13));
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
  ];

  return (
    <View style={[styles.surface, isLandscape && styles.surfaceLandscape]}>
      <View style={styles.metricArea}>
        <View style={styles.statusRow}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingLabel}>{t('active.recording')}</Text>
          {bladeGpsStatus ? (() => {
            const info = getGpsBadgeInfo(bladeGpsStatus);
            return (
              <View style={[styles.gpsBadge, info.badgeStyle]} testID="blade-gps-badge">
                <Text style={[styles.gpsBadgeText, info.textStyle]}>{info.text}</Text>
              </View>
            );
          })() : null}
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
          <LiveBladeParityCell
            bladeManager={bladeManager}
            style={styles.cell}
            valueFontSize={valueFontSize}
          />
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
  gpsBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10b981',
  },
  badgeWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: '#f59e0b',
  },
  badgeDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: '#ef4444',
  },
  gpsBadgeText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
  },
  textSuccess: {
    color: '#10b981',
  },
  textWarning: {
    color: '#f59e0b',
  },
  textDanger: {
    color: '#ef4444',
  },
});
