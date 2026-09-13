import React from 'react';
import {StyleSheet, View} from 'react-native';
import {color} from '../theme/tokens';

export type StatusTone = 'healthy' | 'warning' | 'critical' | 'neutral';
export function StatusMark({tone}: {tone: StatusTone}): React.JSX.Element {
  return <View accessibilityElementsHidden style={[styles.mark, styles[tone]]} />;
}

const styles = StyleSheet.create({
  mark: {borderRadius: 5, height: 10, width: 10},
  healthy: {backgroundColor: color.success},
  warning: {backgroundColor: color.warning},
  critical: {backgroundColor: color.error},
  neutral: {backgroundColor: color.textTertiary},
});
