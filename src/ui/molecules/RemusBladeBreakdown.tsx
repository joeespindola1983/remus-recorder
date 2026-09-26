import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SourceReadinessSnapshot } from '../../application/capture/ActivityCapture';
import { SensorPlacement } from '../../contracts/acquisition';
import { RemusBladeSnapshot } from '../../services/blade/RemusBladeAdapter';
import { t } from '../../i18n';
import { color, fontFamily, radius, spacing } from '../theme/tokens';

export interface RemusBladeBreakdownProps {
  readiness?: SourceReadinessSnapshot;
  snapshot?: RemusBladeSnapshot | null;
  connectionState?: 'disconnected' | 'detected' | 'connecting' | 'connected' | 'error';
  placement?: SensorPlacement;
  onSelectPlacement?: (placement: SensorPlacement) => void;
  onDisconnect?: () => void;
  onConnect?: () => void;
  onCalibrateAlignment?: () => void;
}

export function RemusBladeBreakdown({
  readiness,
  snapshot,
  connectionState = 'disconnected',
  placement,
  onSelectPlacement,
  onDisconnect,
  onConnect,
  onCalibrateAlignment,
}: RemusBladeBreakdownProps): React.JSX.Element {
  const isConnected = connectionState === 'connected';
  const isDetected = connectionState === 'detected';
  const badgeLabel = isConnected
    ? t('blade.connected')
    : isDetected
      ? t('blade.detected')
      : t('blade.disconnected');
  const hasGpsLock =
    (readiness?.availableMeasurementIdentifiers?.includes('positionWgs84') ?? false) ||
    !!snapshot?.location;
  const accuracy = snapshot?.horizontalAccuracyMeters ?? readiness?.horizontalAccuracyMeters;
  const satsInUse = snapshot?.satsInUse ?? 0;
  const satsInView = snapshot?.satsInView ?? 0;
  const snr = snapshot?.maxSnrDbHz ?? 0;
  const liveSpm = snapshot?.liveSpm;
  const linesWritten = snapshot?.linesWritten ?? 0;
  const sdOk = snapshot?.sdOk ?? true;
  const imuOk = snapshot?.imuOk ?? true;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('blade.title')}</Text>
        <View
          style={[
            styles.badge,
            isConnected ? styles.badgeSuccess : styles.badgeNeutral,
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              isConnected ? styles.badgeTextSuccess : styles.badgeTextNeutral,
            ]}
          >
            {badgeLabel}
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        {/* IMU Section */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{t('blade.imuTitle')}</Text>
            <View style={[styles.miniBadge, imuOk ? styles.badgeSuccess : styles.badgeWarning]}>
              <Text style={[styles.miniBadgeText, imuOk ? styles.badgeTextSuccess : styles.badgeTextWarning]}>
                {imuOk ? '200 Hz' : t('blade.sensorOffline')}
              </Text>
            </View>
          </View>
          <Text style={styles.cardDetail}>
            {imuOk ? t('blade.imuDetail') : t('blade.imuOfflineDetail')}
          </Text>
        </View>

        {/* GPS Section */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{t('blade.gpsTitle')}</Text>
            <View
              style={[
                styles.miniBadge,
                hasGpsLock ? styles.badgeSuccess : styles.badgeWarning,
              ]}
            >
              <Text
                style={[
                  styles.miniBadgeText,
                  hasGpsLock ? styles.badgeTextSuccess : styles.badgeTextWarning,
                ]}
              >
                {hasGpsLock ? 'Fix 3D' : 'Buscando'}
              </Text>
            </View>
          </View>
          <Text style={styles.cardDetail}>
            {hasGpsLock ? t('blade.gpsLocked') : t('blade.gpsSearching')}
          </Text>
          {accuracy !== undefined && accuracy > 0 && (
            <Text style={styles.cardMetric}>
              {t('blade.gpsAccDetail').replace('{acc}', (accuracy ?? 0).toFixed(1))}
            </Text>
          )}
          <Text style={styles.cardSub}>
            {t('blade.gpsSatsDetail')
              .replace('{inUse}', String(satsInUse))
              .replace('{inView}', String(satsInView))
              .replace('{snr}', String(snr))}
          </Text>
        </View>

        {/* Edge SPM Section */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{t('blade.spmTitle')}</Text>
            {liveSpm !== undefined && (
              <View style={[styles.miniBadge, styles.badgeSuccess]}>
                <Text style={[styles.miniBadgeText, styles.badgeTextSuccess]}>Live</Text>
              </View>
            )}
          </View>
          <Text style={styles.cardDetail}>
            {liveSpm !== undefined
              ? t('blade.spmActive').replace('{spm}', liveSpm.toFixed(1))
              : t('blade.spmWaiting')}
          </Text>
        </View>

        {/* MicroSD Storage Section */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{t('blade.sdTitle')}</Text>
            <View
              style={[
                styles.miniBadge,
                !sdOk
                  ? styles.badgeWarning
                  : linesWritten > 0
                  ? styles.badgeSuccess
                  : styles.badgeNeutral,
              ]}
            >
              <Text
                style={[
                  styles.miniBadgeText,
                  !sdOk
                    ? styles.badgeTextWarning
                    : linesWritten > 0
                    ? styles.badgeTextSuccess
                    : styles.badgeTextNeutral,
                ]}
              >
                {!sdOk
                  ? t('blade.sdOffline')
                  : linesWritten > 0
                  ? t('blade.sdRecordingBadge')
                  : t('blade.sdReady')}
              </Text>
            </View>
          </View>
          <Text style={styles.cardDetail}>
            {!sdOk
              ? t('blade.sdOfflineDetail')
              : linesWritten > 0
              ? t('blade.sdRecording').replace('{lines}', String(linesWritten))
              : t('blade.sdStandby')}
          </Text>
        </View>
      </View>

      {/* Placement Selector Section (only for equipment/paddles, not hull-mounted computer) */}
      {placement !== 'hull' && (
        <View style={styles.placementContainer}>
          <Text style={styles.placementTitle}>{t('blade.placementTitle')}</Text>
          <View style={styles.placementButtonGroup}>
            <TouchableOpacity
              testID="blade-placement-left"
              style={[
                styles.placementButton,
                placement === 'left_paddle' && styles.placementButtonActive,
              ]}
              onPress={() => onSelectPlacement?.('left_paddle')}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.placementButtonText,
                  placement === 'left_paddle' && styles.placementButtonTextActive,
                ]}
              >
                {t('blade.sideLeft')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="blade-placement-right"
              style={[
                styles.placementButton,
                placement === 'right_paddle' && styles.placementButtonActive,
              ]}
              onPress={() => onSelectPlacement?.('right_paddle')}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.placementButtonText,
                  placement === 'right_paddle' && styles.placementButtonTextActive,
                ]}
              >
                {t('blade.sideRight')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Action Footer */}
      <View style={styles.actions}>
        {placement === 'hull' && isConnected && onCalibrateAlignment && (
          <TouchableOpacity
            testID="blade-calibrate-alignment-button"
            style={styles.actionButton}
            onPress={onCalibrateAlignment}
            activeOpacity={0.7}
          >
            <Text style={styles.actionButtonText}>{t('blade.calibrateAlignmentAction')}</Text>
          </TouchableOpacity>
        )}
        {isConnected && onDisconnect && (
          <TouchableOpacity
            testID="blade-disconnect-button"
            style={[styles.actionButton, styles.actionButtonSecondary]}
            onPress={onDisconnect}
            activeOpacity={0.7}
          >
            <Text style={[styles.actionButtonText, styles.actionButtonTextSecondary]}>
              {t('blade.disconnectAction')}
            </Text>
          </TouchableOpacity>
        )}
        {!isConnected && onConnect && (
          <TouchableOpacity
            testID="blade-connect-button"
            style={styles.actionButton}
            onPress={onConnect}
            activeOpacity={0.7}
          >
            <Text style={styles.actionButtonText}>{t('blade.connectAction')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: color.backgroundSecondary,
    borderColor: color.borderDefault,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
  },
  badge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeSuccess: {
    backgroundColor: color.successContainer,
  },
  badgeWarning: {
    backgroundColor: color.warningContainer,
  },
  badgeNeutral: {
    backgroundColor: color.borderDefault,
  },
  badgeText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
  badgeTextSuccess: {
    color: color.textPrimary,
  },
  badgeTextWarning: {
    color: color.textPrimary,
  },
  badgeTextNeutral: {
    color: color.textSecondary,
  },
  grid: {
    gap: spacing.sm,
  },
  card: {
    backgroundColor: color.surfaceDefault,
    borderColor: color.borderDefault,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  cardTitle: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
  cardDetail: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 12,
  },
  cardMetric: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  cardSub: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 11,
    marginTop: 2,
  },
  miniBadge: {
    borderRadius: radius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  miniBadgeText: {
    fontFamily,
    fontSize: 10,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: color.surfaceDefault,
    borderColor: color.borderDefault,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  actionButtonText: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
  actionButtonSecondary: {
    backgroundColor: color.backgroundSecondary,
  },
  actionButtonTextSecondary: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
  placementContainer: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  placementTitle: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  placementButtonGroup: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  placementButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderDefault,
    backgroundColor: color.surfaceDefault,
  },
  placementButtonActive: {
    borderColor: color.actionPrimary,
    backgroundColor: color.actionPrimary,
  },
  placementButtonText: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
  placementButtonTextActive: {
    color: '#FFFFFF',
  },
});
