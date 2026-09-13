import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { ActivityCaptureState } from '../../application/capture/ActivityCapture';
import { ActionButton } from '../atoms/ActionButton';
import { OperationalEventBanner } from '../molecules/OperationalEventBanner';
import {
  AdaptiveCaptureSurface,
  captureOrientationFor,
} from '../organisms/AdaptiveCaptureSurface';
import { DeviceReadinessPanel } from '../organisms/DeviceReadinessPanel';
import { SourceFleetPanel } from '../organisms/SourceFleetPanel';
import { color, fontFamily, radius, spacing } from '../theme/tokens';

const elapsed = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(value => String(value).padStart(2, '0')).join(':');
};

const Header = (): React.JSX.Element => (
  <View style={styles.header}>
    <Text style={styles.brand}>Remus</Text>
    <View style={styles.settingsMark}>
      <Text style={styles.settingsText}>☼</Text>
    </View>
  </View>
);

export function ReadyScreen({
  state,
  onStart,
}: {
  state: ActivityCaptureState;
  onStart: () => void;
}): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header />
      <Text style={styles.eyebrow}>ANTES DE COMEÇAR</Text>
      <Text style={styles.title}>Tudo pronto para remar?</Text>
      <Text style={styles.body}>
        Confira rapidamente o que vai acompanhar seu treino.
      </Text>
      <View style={styles.readinessCard}>
        <Text style={styles.readinessTitle}>Pronto para começar</Text>
        <Text style={styles.readinessSummary}>
          GPS pronto · Movimento disponível
        </Text>
      </View>
      <DeviceReadinessPanel sources={Object.values(state.sources)} />
      <Text style={styles.detailsAction}>Ver detalhes dos dispositivos</Text>
      <ActionButton label="Iniciar atividade" onPress={onStart} />
    </ScrollView>
  );
}

export function ActiveScreen({
  state,
  onStop,
  onPause,
}: {
  state: ActivityCaptureState;
  onStop: () => void;
  onPause: () => void;
}): React.JSX.Element {
  const { width, height } = useWindowDimensions();
  const orientation = captureOrientationFor(width, height);
  const interrupted = Object.values(state.sources).some(
    source => source.recordingState === 'interrupted',
  );
  return (
    <View style={styles.screen}>
      <AdaptiveCaptureSurface
        metrics={state.metrics}
        onFinish={onStop}
        onPause={onPause}
        orientation={orientation}
        viewportWidth={width}
      />
      {interrupted ? (
        <View
          style={[
            styles.connectionNotice,
            orientation === 'landscape' && styles.connectionNoticeLandscape,
          ]}
        >
          <OperationalEventBanner />
        </View>
      ) : null}
    </View>
  );
}

export function FinalizingScreen({
  state,
}: {
  state: ActivityCaptureState;
}): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header />
      <Text style={styles.eyebrow}>CAPTURA ENCERRADA</Text>
      <Text style={styles.title}>Finalizando gravações</Text>
      <Text style={styles.body}>
        A atividade só fecha depois que cada fonte responde ou entra em
        recuperação.
      </Text>
      <SourceFleetPanel sources={Object.values(state.sources)} />
    </ScrollView>
  );
}

export function SummaryScreen({
  state,
}: {
  state: ActivityCaptureState;
}): React.JSX.Element {
  const interrupted = Object.values(state.sources).filter(
    source => source.recordingState === 'interrupted',
  ).length;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header />
      <Text style={styles.eyebrow}>ATIVIDADE FINALIZADA</Text>
      <Text style={styles.title}>Atividade preservada</Text>
      <Text style={styles.body}>
        Cada fonte aparece somente onde possui evidência válida.
      </Text>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryValue}>
          {elapsed(state.metrics.elapsedSeconds)}
        </Text>
        <Text style={styles.summaryLabel}>duração capturada</Text>
        <Text style={styles.summaryDetail}>
          {interrupted === 0
            ? 'Cobertura completa'
            : `${interrupted} fonte interrompida · prefixo preservado`}
        </Text>
      </View>
      <SourceFleetPanel sources={Object.values(state.sources)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.backgroundDefault, flex: 1 },
  content: {
    backgroundColor: color.backgroundDefault,
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: 120,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: color.borderDefault,
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 64,
    justifyContent: 'space-between',
  },
  brand: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 20,
    fontWeight: '700',
  },
  settingsMark: {
    alignItems: 'center',
    borderColor: color.actionPrimary,
    borderRadius: 25,
    borderWidth: 2,
    height: 50,
    justifyContent: 'center',
    width: 50,
  },
  settingsText: { color: color.actionPrimary, fontSize: 28 },
  eyebrow: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  title: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 24,
    fontWeight: '700',
  },
  body: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
  },
  connectionNotice: {
    bottom: 120,
    left: spacing.md,
    position: 'absolute',
    right: spacing.md,
  },
  connectionNoticeLandscape: { bottom: spacing.md, right: 124 },
  readinessCard: {
    backgroundColor: color.successContainer,
    borderRadius: radius.xl,
    gap: spacing.xs,
    padding: spacing.md,
  },
  readinessTitle: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
  },
  readinessSummary: { color: color.textSecondary, fontFamily, fontSize: 12 },
  detailsAction: {
    color: color.actionPrimary,
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
  summaryCard: {
    backgroundColor: color.successContainer,
    borderRadius: 20,
    gap: 4,
    padding: spacing.lg,
  },
  summaryValue: {
    color: color.textPrimary,
    fontFamily,
    fontSize: 32,
    fontWeight: '700',
  },
  summaryLabel: {
    color: color.textSecondary,
    fontFamily,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  summaryDetail: {
    color: color.success,
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
});
