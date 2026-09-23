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
  const lengthScale =
    value.length >= 5 ? 0.72 : value.length >= 3 ? 0.85 : 1.0;
  const adaptiveFontSize = Math.round(valueFontSize * lengthScale);

  return (
    <View style={[styles.cell, style]}>
      <Text style={styles.label}>{label}</Text>

      <View style={styles.valueContainer}>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.35}
          numberOfLines={1}
          style={[
            styles.value,
            {
              fontSize: adaptiveFontSize,
            },
          ]}
          testID={`metric-value-${identifier}`}
        >
          {value}
        </Text>
      </View>

      <Text style={styles.unit}>{unit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    backgroundColor: color.surfaceDefault,
    borderColor: color.borderDefault,
    borderWidth: 0.5,
    padding: spacing.md,
  },

  label: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  valueContainer: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  value: {
    color: color.textPrimary,
    fontFamily,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },

  unit: {
    alignSelf: 'flex-end',
    color: color.textPrimary,
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
  },
});
