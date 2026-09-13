import React from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import {color, fontFamily, radius, spacing} from '../theme/tokens';

interface ActionButtonProps {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'destructive' | 'secondary';
}

export function ActionButton({label, onPress, tone = 'primary'}: ActionButtonProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [styles.base, styles[tone], pressed && styles.pressed]}>
      <Text style={[styles.label, tone === 'secondary' && styles.secondaryLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {alignItems: 'center', borderRadius: radius.full, justifyContent: 'center', minHeight: 52, paddingHorizontal: spacing.lg},
  primary: {backgroundColor: color.actionPrimary},
  destructive: {backgroundColor: color.actionDestructive},
  secondary: {backgroundColor: color.surfaceDefault, borderColor: color.actionPrimary, borderWidth: 2},
  pressed: {opacity: 0.75},
  label: {color: color.textInverse, fontFamily, fontSize: 16, fontWeight: '700'},
  secondaryLabel: {color: color.actionPrimary},
});
