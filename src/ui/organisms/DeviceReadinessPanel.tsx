import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CaptureSourceState } from '../../application/capture/ActivityCapture';
import { t } from '../../i18n';
import { DeviceReadinessRow } from '../molecules/DeviceReadinessRow';
import { RemusBladeSnapshot } from '../../services/blade/RemusBladeAdapter';
import { color, fontFamily, radius, spacing } from '../theme/tokens';
import { WearableDevice } from '../../types/wearables';

export interface DeviceReadinessPanelProps {
  sources: CaptureSourceState[];
  expandedSourceIds?: string[];
  onToggleExpand?: (sourceId: string) => void;
  onRequestPermissions?: () => void;
  bladeSnapshot?: RemusBladeSnapshot | null;
  onDisconnectBlade?: () => void;
  onConnectBlade?: () => void;
  remusDevices?: WearableDevice[];
}

export function DeviceReadinessPanel({
  sources,
  expandedSourceIds,
  onToggleExpand,
  onRequestPermissions,
  bladeSnapshot,
  onDisconnectBlade,
  onConnectBlade,
  remusDevices = [],
}: DeviceReadinessPanelProps): React.JSX.Element {
  const [internalExpanded, setInternalExpanded] = React.useState<string[]>([]);

  const isControlled = expandedSourceIds !== undefined;
  const currentExpanded = isControlled ? expandedSourceIds : internalExpanded;

  const handleToggle = (sourceId: string) => {
    if (onToggleExpand) {
      onToggleExpand(sourceId);
    }
    if (!isControlled) {
      setInternalExpanded(prev =>
        prev.includes(sourceId) ? [] : [sourceId]
      );
    }
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{t('ready.availableDevices')}</Text>
      {sources.map(source => (
        <DeviceReadinessRow
          key={source.sourceId}
          isExpanded={currentExpanded.includes(source.sourceId)}
          onRequestPermissions={onRequestPermissions}
          onToggleExpand={() => handleToggle(source.sourceId)}
          source={source}
          bladeSnapshot={bladeSnapshot}
          onDisconnectBlade={onDisconnectBlade}
          onConnectBlade={onConnectBlade}
        />
      ))}
      {remusDevices.length > 0 ? (
        <View style={styles.remusFleet}>
          <Text style={styles.fleetTitle}>Dispositivos REMUS encontrados</Text>
          {remusDevices.map(device => (
            <View key={device.id} style={styles.deviceRow}>
              <View style={[
                styles.deviceStatus,
                device.state === 'connected' && styles.deviceStatusConnected,
              ]} />
              <View style={styles.deviceCopy}>
                <Text style={styles.deviceName}>{device.name}</Text>
                <Text style={styles.deviceDetail}>
                  {device.remusProductKind === 'blade' ? 'Remus Blade' : 'Remus Computer'}
                  {' · '}
                  {device.state === 'connected'
                    ? 'Conectado'
                    : device.state === 'connecting'
                      ? 'Conectando automaticamente'
                      : device.state === 'detected'
                        ? 'Detectado · conexão automática pendente'
                        : 'Indisponível'}
                </Text>
              </View>
            </View>
          ))}
        </View>
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
    padding: spacing.md,
  },
  title: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  remusFleet: {
    borderTopColor: color.borderDefault,
    borderTopWidth: 1,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  fleetTitle: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  deviceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
  },
  deviceStatus: {
    backgroundColor: color.textTertiary,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  deviceStatusConnected: { backgroundColor: color.success },
  deviceCopy: { flex: 1 },
  deviceName: { color: color.textPrimary, fontFamily, fontSize: 14, fontWeight: '600' },
  deviceDetail: { color: color.textSecondary, fontFamily, fontSize: 12 },
});
