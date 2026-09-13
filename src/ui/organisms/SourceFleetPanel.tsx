import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {CaptureSourceState} from '../../application/capture/ActivityCapture';
import {SourceStatusRow} from '../molecules/SourceStatusRow';
import {color, fontFamily, spacing} from '../theme/tokens';

export function SourceFleetPanel({sources}: {sources: CaptureSourceState[]}): React.JSX.Element {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Fontes da atividade</Text>
      <Text style={styles.helper}>O app funciona sozinho. Fontes adicionais aumentam a cobertura.</Text>
      <View style={styles.list}>
        {sources.map(source => <SourceStatusRow key={source.sourceId} source={source} />)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {gap: spacing.sm},
  title: {color: color.textPrimary, fontFamily, fontSize: 18, fontWeight: '700'},
  helper: {color: color.textSecondary, fontFamily, fontSize: 13, lineHeight: 18},
  list: {gap: spacing.sm, marginTop: spacing.xs},
});
