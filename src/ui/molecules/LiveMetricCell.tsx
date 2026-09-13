import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { color, fontFamily, spacing } from '../theme/tokens';

export function LiveMetricCell({
  identifier,
  label,
  value,
  unit,
  valueFontSize,
  style,
}: {
  identifier: string;
  label: string;
  value: string;
  unit: string;
  valueFontSize: number;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <View style={[styles.cell, style]}>
      <Text style={styles.label}>{label}</Text>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.62}
        numberOfLines={1}
        style={[styles.value, { fontSize: valueFontSize }]}
        testID={`metric-value-${identifier}`}
      >
        {value}
      </Text>
      <Text style={styles.unit}>{unit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    backgroundColor: color.surfaceDefault,
    borderColor: color.borderDefault,
    borderWidth: 0.5,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  label: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  value: {
    color: color.textPrimary,
    fontFamily,
    fontWeight: '800',
    letterSpacing: -1.5,
    lineHeight: 76,
  },
  unit: {
    alignSelf: 'flex-end',
    color: color.textPrimary,
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
  },
});
