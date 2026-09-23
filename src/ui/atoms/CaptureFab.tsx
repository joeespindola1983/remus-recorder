import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { color, radius } from '../theme/tokens';

export type CaptureFabAction = 'pause' | 'finish';

export function CaptureFab({
  action,
  onPress,
}: {
  action: CaptureFabAction;
  onPress: () => void;
}): React.JSX.Element {
  const isPause = action === 'pause';
  return (
    <Pressable
      accessibilityLabel={isPause ? 'Pausar atividade' : 'Finalizar atividade'}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        isPause ? styles.pause : styles.finish,
        pressed && styles.pressed,
      ]}
    >
      {isPause ? (
        <View style={styles.pauseIcon}>
          <View style={styles.pauseBar} />
          <View style={styles.pauseBar} />
        </View>
      ) : (
        <View style={styles.stopIcon} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  pause: {
    backgroundColor: color.surfaceDefault,
    borderColor: color.actionPrimary,
    borderWidth: 2,
  },
  finish: { backgroundColor: color.actionDestructive },
  pressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  pauseIcon: { flexDirection: 'row', gap: 6 },
  pauseBar: {
    backgroundColor: color.actionPrimary,
    borderRadius: 2,
    height: 24,
    width: 6,
  },
  stopIcon: {
    backgroundColor: color.surfaceDefault,
    borderRadius: 5,
    height: 22,
    width: 22,
  },
});
