import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CaptureSourceState } from '../../application/capture/ActivityCapture';
import { SensorPlacement } from '../../contracts/acquisition';
import { BatteryStatusIcon } from '../atoms/BatteryStatusIcon';
import {
  describeSourceReadiness,
  sourceDisplayName,
} from '../presentation/deviceReadiness';
import { PhoneSensorBreakdown } from './PhoneSensorBreakdown';
import { RemusBladeBreakdown } from './RemusBladeBreakdown';
import { RemusBladeSnapshot } from '../../services/blade/RemusBladeAdapter';
import { color, fontFamily, spacing } from '../theme/tokens';

export interface DeviceReadinessRowProps {
  source: CaptureSourceState;
  isExpanded?: boolean;
  onRequestPermissions?: () => void;
  onToggleExpand?: () => void;
  bladeSnapshot?: RemusBladeSnapshot | null;
  onDisconnectBlade?: () => void;
  onConnectBlade?: () => void;
  onSelectPlacement?: (placement: SensorPlacement) => void;
}

export function DeviceReadinessRow({
  source,
  isExpanded = false,
  onRequestPermissions,
  onToggleExpand,
  bladeSnapshot,
  onDisconnectBlade,
  onConnectBlade,
  onSelectPlacement,
}: DeviceReadinessRowProps): React.JSX.Element {
  const batteryLevelPercent = source.readiness?.batteryLevelPercent;
  const connected =
    source.readiness?.sourceConnectionState === 'connected' &&
    source.operationalState !== 'unavailable';
  const isPhone =
    source.deviceFamily === 'iphone' || source.deviceFamily === 'android_phone';
  const isBlade = source.deviceFamily === 'remus_blade';
  const isExpandable = isPhone || isBlade;

  const rowContent = (
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
        {isExpandable ? (
          <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.wrapper}>
      {isExpandable && onToggleExpand ? (
        <TouchableOpacity
          accessibilityLabel={sourceDisplayName(source)}
          accessibilityRole="button"
          onPress={onToggleExpand}
        >
          {rowContent}
        </TouchableOpacity>
      ) : (
        rowContent
      )}
      {isPhone && isExpanded ? (
        <PhoneSensorBreakdown
          onRequestPermissions={onRequestPermissions}
          source={source}
        />
      ) : null}
      {isBlade && isExpanded ? (
        <RemusBladeBreakdown
          readiness={source.readiness}
          snapshot={bladeSnapshot}
          connectionState={
            source.readiness?.sourceConnectionState === 'detected'
              ? 'detected'
              : connected
                ? 'connected'
                : 'disconnected'
          }
          placement={source.sensorPlacement}
          onSelectPlacement={onSelectPlacement}
          onDisconnect={onDisconnectBlade}
          onConnect={onConnectBlade}
        />
      ) : null}
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
  chevron: {
    color: color.textTertiary,
    fontSize: 10,
    marginLeft: 4,
  },
  wrapper: {
    borderBottomColor: color.borderDefault,
    borderBottomWidth: 1,
    paddingVertical: spacing.xs,
  },
});
