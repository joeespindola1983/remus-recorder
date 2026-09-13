import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CaptureSourceState } from '../../application/capture/ActivityCapture';
import { BatteryStatusIcon } from '../atoms/BatteryStatusIcon';
import {
  describeSourceReadiness,
  sourceDisplayName,
} from '../presentation/deviceReadiness';
import { color, fontFamily, spacing } from '../theme/tokens';

export function DeviceReadinessRow({
  source,
}: {
  source: CaptureSourceState;
}): React.JSX.Element {
  const batteryLevelPercent = source.readiness?.batteryLevelPercent;
  const connected = source.readiness?.sourceConnectionState !== 'unavailable';
  return (
    <View style={styles.row}>
      <View
        accessibilityLabel={connected ? 'Disponível' : 'Indisponível'}
        style={[styles.status, !connected && styles.statusUnavailable]}
      />
      <View style={styles.copy}>
        <Text style={styles.name}>{sourceDisplayName(source)}</Text>
        <Text style={styles.detail}>{describeSourceReadiness(source)}</Text>
      </View>
      <View style={styles.battery}>
        <BatteryStatusIcon batteryLevelPercent={batteryLevelPercent} />
        <Text style={styles.percentage}>
          {batteryLevelPercent === undefined ? '—' : `${batteryLevelPercent}%`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 58,
  },
  status: {
    backgroundColor: color.success,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  statusUnavailable: { backgroundColor: color.textTertiary },
  copy: { flex: 1 },
  name: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
  },
  detail: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 12,
    marginTop: 2,
  },
  battery: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  percentage: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 12,
    minWidth: 28,
  },
});
