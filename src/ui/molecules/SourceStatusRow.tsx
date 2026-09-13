import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {CaptureSourceState} from '../../application/capture/ActivityCapture';
import {StatusMark, StatusTone} from '../atoms/StatusMark';
import {color, fontFamily, radius, spacing} from '../theme/tokens';

const sourceNames: Record<string, string> = {
  iphone: 'iPhone',
  android_phone: 'Android',
  remus_blade: 'Remus Blade P1',
  apple_watch: 'Apple Watch',
  wear_os: 'Wear OS',
};

const presentation = (source: CaptureSourceState): {label: string; tone: StatusTone} => {
  if (source.recordingState === 'interrupted') return {label: 'Interrompido · prefixo preservado', tone: 'critical'};
  if (source.recordingState === 'stopping') return {label: 'Finalizando', tone: 'warning'};
  if (source.recordingState === 'recording') return {label: 'Gravando', tone: 'healthy'};
  if (source.operationalState === 'available_idle') return {label: 'Pronto', tone: 'healthy'};
  return {label: 'Indisponível', tone: 'neutral'};
};

export function SourceStatusRow({source}: {source: CaptureSourceState}): React.JSX.Element {
  const state = presentation(source);
  return (
    <View style={styles.row}>
      <StatusMark tone={state.tone} />
      <View style={styles.copy}>
        <Text style={styles.name}>{sourceNames[source.deviceFamily] ?? source.deviceFamily}</Text>
        <Text style={styles.detail}>{state.label}</Text>
      </View>
      <Text style={styles.role}>{source.required ? 'Necessário' : 'Opcional'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {alignItems: 'center', backgroundColor: color.surfaceDefault, borderColor: color.borderDefault, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 64, paddingHorizontal: 14, paddingVertical: 10},
  copy: {flex: 1},
  name: {color: color.textPrimary, fontFamily, fontSize: 16, fontWeight: '600'},
  detail: {color: color.textSecondary, fontFamily, fontSize: 12, marginTop: 2},
  role: {color: color.textTertiary, fontFamily, fontSize: 10, textTransform: 'uppercase'},
});
