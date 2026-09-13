import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CaptureSourceState } from '../../application/capture/ActivityCapture';
import { t } from '../../i18n';
import { describePhoneSensorStreams } from '../presentation/deviceReadiness';
import { color, fontFamily, radius, spacing } from '../theme/tokens';

export interface PhoneSensorBreakdownProps {
  source: CaptureSourceState;
  onRequestPermissions?: () => void;
}

export function PhoneSensorBreakdown({
  source,
  onRequestPermissions,
}: PhoneSensorBreakdownProps): React.JSX.Element {
  const streams = describePhoneSensorStreams(source);
  const isAndroid = source.deviceFamily === 'android_phone';
  const hasMissingPermission =
    streams.gps === 'Permissão necessária' ||
    streams.accelerometer === 'Permissão necessária';

  const renderBadge = (status: string) => {
    const isReady = status.startsWith('Pronto') || status === 'Disponível';
    const isWarn = status === 'Permissão necessária';
    const isMissing = status === 'Não suportado' || status === 'Ausente';

    return (
      <View
        style={[
          styles.badge,
          isReady && styles.badgeReady,
          isWarn && styles.badgeWarn,
          isMissing && styles.badgeMissing,
        ]}
      >
        <Text
          style={[
            styles.badgeText,
            isReady && styles.badgeTextReady,
            isWarn && styles.badgeTextWarn,
            isMissing && styles.badgeTextMissing,
          ]}
        >
          {status}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('phone.details.title')}</Text>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.sensorName}>{t('phone.sensor.gps')}</Text>
          {renderBadge(streams.gps)}
        </View>
        <Text style={styles.sensorDescription}>
          Latitude · Longitude · Velocidade · Altitude
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.sensorName}>{t('phone.sensor.accelerometer')}</Text>
          {renderBadge(streams.accelerometer)}
        </View>
        <Text style={styles.sensorDescription}>
          100 Hz · Dinâmica e cadência de remada (SPM)
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.sensorName}>{t('phone.sensor.gyroscope')}</Text>
          {renderBadge(streams.gyroscope)}
        </View>
        <Text style={styles.sensorDescription}>
          Velocidade angular nos 3 eixos (yaw/roll/pitch)
        </Text>
      </View>

      {streams.gyroscope === 'Não suportado' ? (
        <View style={styles.disclaimerContainer}>
          <Text style={styles.disclaimer}>
            {isAndroid
              ? 'Giroscópio não suportado no dispositivo — ausência preservada (não preenchido com zero).'
              : 'Giroscópio não disponível.'}
          </Text>
        </View>
      ) : null}

      {hasMissingPermission && onRequestPermissions ? (
        <TouchableOpacity
          accessibilityLabel="Conceder permissões"
          accessibilityRole="button"
          onPress={onRequestPermissions}
          style={styles.permissionButton}
        >
          <Text style={styles.permissionButtonText}>
            {t('phone.permission.requestAction')}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: color.backgroundSecondary,
    borderColor: color.borderDefault,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.xs,
    padding: spacing.md,
  },
  title: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: color.surfaceDefault,
    borderColor: color.borderDefault,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sensorName: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
  sensorDescription: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 11,
    marginTop: 2,
  },
  badge: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeReady: {
    backgroundColor: color.successContainer,
  },
  badgeWarn: {
    backgroundColor: color.warningContainer,
  },
  badgeMissing: {
    backgroundColor: color.backgroundTertiary,
  },
  badgeText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
  badgeTextReady: {
    color: color.textPrimary,
  },
  badgeTextWarn: {
    color: color.textPrimary,
  },
  badgeTextMissing: {
    color: color.textTertiary,
  },
  disclaimerContainer: {
    backgroundColor: color.warningContainer,
    borderColor: color.borderDefault,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
  },
  disclaimer: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 11,
    fontStyle: 'italic',
  },
  permissionButton: {
    alignItems: 'center',
    backgroundColor: color.actionPrimary,
    borderRadius: radius.md,
    justifyContent: 'center',
    marginTop: spacing.xs,
    paddingVertical: spacing.sm,
  },
  permissionButtonText: {
    color: color.textInverse,
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
  },
});
