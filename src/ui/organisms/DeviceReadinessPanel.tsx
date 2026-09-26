import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CaptureSourceState } from '../../application/capture/ActivityCapture';
import { SensorPlacement } from '../../contracts/acquisition';
import { t } from '../../i18n';
import { DeviceReadinessRow } from '../molecules/DeviceReadinessRow';
import { RemusBladeSnapshot } from '../../services/blade/RemusBladeAdapter';
import { color, fontFamily, radius, spacing } from '../theme/tokens';

export interface DeviceReadinessPanelProps {
  sources: CaptureSourceState[];
  expandedSourceIds?: string[];
  onToggleExpand?: (sourceId: string) => void;
  onRequestPermissions?: () => void;
  bladeSnapshot?: RemusBladeSnapshot | null;
  onDisconnectBlade?: (sourceId: string) => void;
  onConnectBlade?: (sourceId: string) => void;
  onSelectPlacement?: (sourceId: string, placement: SensorPlacement) => void;
  onCalibrateBladeAlignment?: () => void;
}

export function DeviceReadinessPanel({
  sources,
  expandedSourceIds,
  onToggleExpand,
  onRequestPermissions,
  bladeSnapshot,
  onDisconnectBlade,
  onConnectBlade,
  onSelectPlacement,
  onCalibrateBladeAlignment,
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
          onDisconnectBlade={() => onDisconnectBlade?.(source.sourceId)}
          onConnectBlade={() => onConnectBlade?.(source.sourceId)}
          onSelectPlacement={p => onSelectPlacement?.(source.sourceId, p)}
          onCalibrateBladeAlignment={onCalibrateBladeAlignment}
        />
      ))}
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
});
