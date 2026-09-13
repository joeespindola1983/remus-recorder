import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CaptureSourceState } from '../../application/capture/ActivityCapture';
import { DeviceReadinessRow } from '../molecules/DeviceReadinessRow';
import { color, fontFamily, radius, spacing } from '../theme/tokens';

export function DeviceReadinessPanel({
  sources,
}: {
  sources: CaptureSourceState[];
}): React.JSX.Element {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Dispositivos disponíveis</Text>
      {sources.map(source => (
        <DeviceReadinessRow key={source.sourceId} source={source} />
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
