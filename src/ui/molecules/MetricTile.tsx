import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {color, fontFamily, radius, spacing} from '../theme/tokens';

export function MetricTile({label, value, unit}: {label: string; value: string; unit: string}): React.JSX.Element {
  return (
    <View style={styles.tile}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueRow}>
        <Text style={styles.value}>{value}</Text>
        <Text style={styles.unit}>{unit}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {backgroundColor: color.backgroundSecondary, borderRadius: radius.md, flexBasis: '47%', flexGrow: 1, height: 84, justifyContent: 'center', padding: 10},
  label: {color: color.textSecondary, fontFamily, fontSize: 10, fontWeight: '600', textTransform: 'uppercase'},
  valueRow: {alignItems: 'baseline', flexDirection: 'row', gap: spacing.xs},
  value: {color: color.textPrimary, fontFamily, fontSize: 28, fontWeight: '700'},
  unit: {color: color.textSecondary, fontFamily, fontSize: 10},
});
