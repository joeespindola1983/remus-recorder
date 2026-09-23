import React from 'react';
import { StyleSheet, View } from 'react-native';
import {
  BatteryCondition,
  batteryConditionFor,
} from '../presentation/deviceReadiness';
import { color } from '../theme/tokens';

const tone: Record<BatteryCondition, string> = {
  good: color.success,
  low: color.warning,
  critical: color.error,
  unknown: color.textSecondary,
};

const label: Record<Exclude<BatteryCondition, 'unknown'>, string> = {
  good: 'normal',
  low: 'baixo',
  critical: 'crítico',
};

export function BatteryStatusIcon({
  batteryLevelPercent,
}: {
  batteryLevelPercent?: number;
}): React.JSX.Element {
  const condition = batteryConditionFor(batteryLevelPercent);
  const accessibilityLabel =
    batteryLevelPercent === undefined
      ? 'Bateria não informada'
      : `Bateria ${batteryLevelPercent}%, nível ${
          label[condition as Exclude<BatteryCondition, 'unknown'>]
        }`;
  const fillWidth =
    batteryLevelPercent === undefined
      ? 8
      : Math.max(2, Math.round((14 * batteryLevelPercent) / 100));

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      style={styles.icon}
    >
      <View style={[styles.outline, { borderColor: tone[condition] }]}>
        <View
          style={[
            styles.level,
            { backgroundColor: tone[condition], width: fillWidth },
          ]}
        />
      </View>
      <View style={[styles.terminal, { backgroundColor: tone[condition] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { alignItems: 'center', flexDirection: 'row', height: 16, width: 26 },
  outline: {
    borderRadius: 3,
    borderWidth: 1.5,
    height: 14,
    justifyContent: 'center',
    paddingHorizontal: 2,
    width: 21,
  },
  level: { borderRadius: 1.5, height: 8 },
  terminal: { borderRadius: 1, height: 6, marginLeft: 2, width: 3 },
});
