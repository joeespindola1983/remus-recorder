import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {ActivityCaptureState} from '../../application/capture/ActivityCapture';
import {ActionButton} from '../atoms/ActionButton';
import {MetricTile} from '../molecules/MetricTile';
import {OperationalEventBanner} from '../molecules/OperationalEventBanner';
import {SourceFleetPanel} from '../organisms/SourceFleetPanel';
import {color, fontFamily, spacing} from '../theme/tokens';

const elapsed = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(value => String(value).padStart(2, '0')).join(':');
};

const Header = (): React.JSX.Element => (
  <View style={styles.header}>
    <Text style={styles.brand}>Remus</Text>
    <View style={styles.settingsMark}><Text style={styles.settingsText}>☼</Text></View>
  </View>
);

export function ReadyScreen({state, onStart}: {state: ActivityCaptureState; onStart: () => void}): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header />
      <Text style={styles.eyebrow}>CONFIGURAÇÃO</Text>
      <Text style={styles.title}>Como vamos capturar?</Text>
      <Text style={styles.body}>Taxas efetivas e recuperação são negociadas por capacidade.</Text>
      <SourceFleetPanel sources={Object.values(state.sources)} />
      <ActionButton label="Iniciar atividade" onPress={onStart} />
      <Text style={styles.evidenceNote}>RBP1 ligado não significa atividade iniciada. O pré-buffer fica fora da atividade.</Text>
    </ScrollView>
  );
}

export function ActiveScreen({
  state,
  onStop,
  onInterruptWatch,
}: {
  state: ActivityCaptureState;
  onStop: () => void;
  onInterruptWatch: () => void;
}): React.JSX.Element {
  const interrupted = Object.values(state.sources).some(source => source.recordingState === 'interrupted');
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Header />
        <Text style={styles.eyebrow}>GRAVANDO · {elapsed(state.metrics.elapsedSeconds)}</Text>
        <Text style={styles.title}>Atividade livre</Text>
        <View style={styles.metrics}>
          <MetricTile label="Voga" value={String(state.metrics.strokeRateSpm ?? '--')} unit="SPM" />
          <MetricTile label="Velocidade" value={(state.metrics.groundSpeedMetersPerSecond ?? 0).toFixed(1).replace('.', ',')} unit="m/s" />
          <MetricTile label="FC" value={String(state.metrics.heartRateBeatsPerMinute ?? '--')} unit="bpm" />
          <MetricTile label="Distância" value={((state.metrics.distanceMeters ?? 0) / 1000).toFixed(1).replace('.', ',')} unit="km" />
        </View>
        <Text style={styles.sourceLine}>Voga · RBP1 · atualizada agora</Text>
        {interrupted ? <OperationalEventBanner /> : null}
        <SourceFleetPanel sources={Object.values(state.sources)} />
        {!interrupted ? <ActionButton label="Simular relógio sem bateria" tone="secondary" onPress={onInterruptWatch} /> : null}
      </ScrollView>
      <View style={styles.finishAction}>
        <ActionButton label="Finalizar atividade" tone="destructive" onPress={onStop} />
      </View>
    </View>
  );
}

export function FinalizingScreen({state}: {state: ActivityCaptureState}): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header />
      <Text style={styles.eyebrow}>CAPTURA ENCERRADA</Text>
      <Text style={styles.title}>Finalizando gravações</Text>
      <Text style={styles.body}>A atividade só fecha depois que cada fonte responde ou entra em recuperação.</Text>
      <SourceFleetPanel sources={Object.values(state.sources)} />
    </ScrollView>
  );
}

export function SummaryScreen({state}: {state: ActivityCaptureState}): React.JSX.Element {
  const interrupted = Object.values(state.sources).filter(source => source.recordingState === 'interrupted').length;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header />
      <Text style={styles.eyebrow}>ATIVIDADE FINALIZADA</Text>
      <Text style={styles.title}>Atividade preservada</Text>
      <Text style={styles.body}>Cada fonte aparece somente onde possui evidência válida.</Text>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryValue}>{elapsed(state.metrics.elapsedSeconds)}</Text>
        <Text style={styles.summaryLabel}>duração capturada</Text>
        <Text style={styles.summaryDetail}>
          {interrupted === 0 ? 'Cobertura completa' : `${interrupted} fonte interrompida · prefixo preservado`}
        </Text>
      </View>
      <SourceFleetPanel sources={Object.values(state.sources)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {backgroundColor: color.backgroundDefault, flex: 1},
  content: {backgroundColor: color.backgroundDefault, gap: spacing.md, padding: spacing.md, paddingBottom: 120},
  header: {alignItems: 'center', borderBottomColor: color.borderDefault, borderBottomWidth: 1, flexDirection: 'row', height: 64, justifyContent: 'space-between'},
  brand: {color: color.textPrimary, fontFamily, fontSize: 20, fontWeight: '700'},
  settingsMark: {alignItems: 'center', borderColor: color.actionPrimary, borderRadius: 25, borderWidth: 2, height: 50, justifyContent: 'center', width: 50},
  settingsText: {color: color.actionPrimary, fontSize: 28},
  eyebrow: {color: color.textSecondary, fontFamily, fontSize: 12, marginTop: spacing.xs},
  title: {color: color.textPrimary, fontFamily, fontSize: 24, fontWeight: '700'},
  body: {color: color.textSecondary, fontFamily, fontSize: 14, lineHeight: 20},
  metrics: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  sourceLine: {color: color.textSecondary, fontFamily, fontSize: 12},
  finishAction: {bottom: spacing.lg, position: 'absolute', right: spacing.md},
  evidenceNote: {color: color.textTertiary, fontFamily, fontSize: 12, lineHeight: 17, textAlign: 'center'},
  summaryCard: {backgroundColor: color.successContainer, borderRadius: 20, gap: 4, padding: spacing.lg},
  summaryValue: {color: color.textPrimary, fontFamily, fontSize: 32, fontWeight: '700'},
  summaryLabel: {color: color.textSecondary, fontFamily, fontSize: 12, textTransform: 'uppercase'},
  summaryDetail: {color: color.success, fontFamily, fontSize: 14, fontWeight: '600', marginTop: spacing.sm},
});
