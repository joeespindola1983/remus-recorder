import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SourceReadinessSnapshot } from '../../application/capture/ActivityCapture';
import { RemusBladeSnapshot } from '../../services/blade/RemusBladeAdapter';
import { t } from '../../i18n';
import { color, fontFamily, radius, spacing } from '../theme/tokens';

export interface RemusBladeBreakdownProps {
  readiness?: SourceReadinessSnapshot;
  snapshot?: RemusBladeSnapshot | null;
  connectionState?: 'disconnected' | 'connecting' | 'connected' | 'error';
  onSendGpsAid?: () => void;
}

export function RemusBladeBreakdown({
  readiness,
  snapshot,
  connectionState = 'disconnected',
  onSendGpsAid,
}: RemusBladeBreakdownProps): React.JSX.Element {
  const isConnected = connectionState === 'connected';
  const hasGpsLock =
    (readiness?.availableMeasurementIdentifiers?.includes('positionWgs84') ?? false) ||
    !!snapshot?.location;
  const accuracy = snapshot?.horizontalAccuracyMeters ?? readiness?.horizontalAccuracyMeters;
  const satsInUse = snapshot?.satsInUse ?? 0;
  const satsInView = snapshot?.satsInView ?? 0;
  const snr = snapshot?.maxSnrDbHz ?? 0;
  const liveSpm = snapshot?.liveSpm;
  const linesWritten = snapshot?.linesWritten ?? 0;

  return (
    <View style={styles.container} testID="remus-blade-breakdown">
      <View style={styles.header}>
        <Text style={styles.title}>{t('blade.title')}</Text>
        <View
          style={[
            styles.badge,
            isConnected ? styles.badgeSuccess : styles.badgeWarning,
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              isConnected ? styles.badgeTextSuccess : styles.badgeTextWarning,
            ]}
          >
            {isConnected ? t('blade.connected') : t('blade.disconnected')}
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        {/* IMU Section */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{t('blade.imuTitle')}</Text>
            <View style={[styles.miniBadge, styles.badgeSuccess]}>
              <Text style={[styles.miniBadgeText, styles.badgeTextSuccess]}>200 Hz</Text>
            </View>
          </View>
          <Text style={styles.cardDetail}>{t('blade.imuDetail')}</Text>
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
            {hasGpsLock ? t('blade.gpsDetailLocked') : t('blade.gpsDetailSearching')}
          </Text>
          {accuracy !== undefined && accuracy > 0 && (
            <Text style={styles.cardMetric}>
              {t('blade.gpsAccuracy').replace('{acc}', accuracy.toFixed(1))}
            </Text>
          )}
          <Text style={styles.cardSub}>
            {t('blade.gpsSatellites')
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
                linesWritten > 0 ? styles.badgeSuccess : styles.badgeNeutral,
              ]}
            >
              <Text
                style={[
                  styles.miniBadgeText,
                  linesWritten > 0 ? styles.badgeTextSuccess : styles.badgeTextNeutral,
                ]}
              >
                SPI
              </Text>
            </View>
          </View>
          <Text style={styles.cardDetail}>
            {linesWritten > 0
              ? t('blade.sdRecording').replace('{lines}', String(linesWritten))
              : t('blade.sdStandby')}
          </Text>
        </View>
      </View>

      {/* Action Footer */}
      <View style={styles.actions}>
        {onSendGpsAid && (
          <TouchableOpacity
            testID="blade-agps-button"
            style={styles.actionButton}
            onPress={onSendGpsAid}
            activeOpacity={0.7}
          >
            <Text style={styles.actionButtonText}>{t('blade.agpsAction')}</Text>
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
});
