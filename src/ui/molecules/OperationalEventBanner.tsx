import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {color, fontFamily, radius, spacing} from '../theme/tokens';

export function OperationalEventBanner(): React.JSX.Element {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={styles.banner}>
      <View style={styles.bar} />
      <View style={styles.copy}>
        <Text style={styles.title}>Conexão com Apple Watch perdida</Text>
        <Text style={styles.detail}>
          Seu treino continua. Estamos tentando reconectar em segundo plano.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: color.warningContainer,
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: spacing.md,
    padding: 14,
  },
  bar: {backgroundColor: color.warning, borderRadius: 2, width: 4},
  copy: {flex: 1},
  title: {color: color.textPrimary, fontFamily, fontSize: 16, fontWeight: '700'},
  detail: {color: color.textSecondary, fontFamily, fontSize: 12, lineHeight: 17, marginTop: 4},
});
