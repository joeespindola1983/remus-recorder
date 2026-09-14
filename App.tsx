import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Alert, NativeModules, Platform, StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { createActivityCapture } from './src/application/capture/demoSources';
import {
  applyCaptureScenarioStep,
  createCaptureSimulation,
} from './src/application/simulation/CaptureSimulator';
import { AppShell, NavigationTab } from './src/ui/organisms/AppShell';
import {
  ActiveScreen,
  FinalizingScreen,
  ReadyScreen,
  SummaryScreen,
} from './src/ui/screens/RecorderScreens';
import { color } from './src/ui/theme/tokens';
import { t } from './src/i18n';
import { PhoneDeviceService } from './src/services/sensors/PhoneDeviceService';
import { RemusBladeDeviceService } from './src/services/blade/RemusBladeDeviceService';
import { RemusBladeAdapter, RemusBladeSnapshot } from './src/services/blade/RemusBladeAdapter';
import { useWearables } from './src/services/wearables';
import {
  RecordingManifest,
  RecordingService,
} from './src/services/recording/RecordingService';

export default function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<NavigationTab>('activities');
  const [simulation, dispatch] = useReducer(
    applyCaptureScenarioStep,
    undefined,
    () => createCaptureSimulation(
      createActivityCapture(
        'unavailable',
        Platform.OS === 'android' ? 'wear_os' : 'apple_watch',
      ),
    )
  );
  const state = simulation.capture;
  const [phoneDevice] = useState(() => new PhoneDeviceService());
  const [bladeDevice] = useState(() => {
    const nativeBridge = NativeModules.RemusBladeBridge;
    const adapter = new RemusBladeAdapter(nativeBridge);
    return new RemusBladeDeviceService(adapter);
  });
  const [bladeSnapshot, setBladeSnapshot] = useState<RemusBladeSnapshot | null>(null);
  const [recordingService] = useState(() => new RecordingService());
  const [lastManifest, setLastManifest] = useState<RecordingManifest | null>(null);
  const wearable = useWearables();
  const didShowWearablePermissionAlert = useRef(false);
  const didShowPhonePermissionAlert = useRef(false);
  const wearableSourceId =
    Platform.OS === 'android' ? 'watch:wear-os:primary' : 'watch:apple:primary';

  useEffect(() => {
    phoneDevice
      .checkAndRequestInitialPermissions()
      .then(sourceState => {
        if (sourceState.readiness) {
          dispatch({
            type: 'update_source_readiness',
            sourceId: sourceState.sourceId,
            readiness: sourceState.readiness,
          });
        }
        if (sourceState.hasDenied && !didShowPhonePermissionAlert.current) {
          didShowPhonePermissionAlert.current = true;
          Alert.alert(
            t('permissions.deniedAlertTitle'),
            t('permissions.deniedAlertMessage'),
          );
        }
      })
      .catch(() => {});
  }, [phoneDevice]);

  useEffect(() => {
    const unsub = bladeDevice.onStateChange(sourceState => {
      setBladeSnapshot(bladeDevice.getLatestSnapshot());
      if (sourceState.readiness) {
        dispatch({
          type: 'update_source_readiness',
          sourceId: 'rbp1:primary',
          readiness: sourceState.readiness,
        });
      }
    });
    bladeDevice.initialize().catch(() => {});
    return () => {
      unsub();
      bladeDevice.destroy();
    };
  }, [bladeDevice]);

  useEffect(() => {
    const device = wearable.devices[0];
    if (
      device?.heartRatePermissionState === 'denied' &&
      !didShowWearablePermissionAlert.current
    ) {
      didShowWearablePermissionAlert.current = true;
      Alert.alert(
        'Acesso aos batimentos necessário',
        'Abra o Remus Recorder no relógio e use “Abrir Ajustes” ou “Revisar acesso” para permitir a leitura da frequência cardíaca.',
      );
    } else if (device?.heartRatePermissionState === 'granted') {
      didShowWearablePermissionAlert.current = false;
    }
    dispatch({
      type: 'update_source_readiness',
      sourceId: wearableSourceId,
      readiness: {
        sourceConnectionState: device ? 'connected' : 'unavailable',
        availableMeasurementIdentifiers:
          device?.heartRatePermissionState === 'granted'
            ? ['heartRateBeatsPerMinute']
            : [],
        liveTelemetryState:
          device?.heartRatePermissionState === 'granted'
            ? 'qualified'
            : 'evaluation_pending',
        heartRatePermissionState: device?.heartRatePermissionState ?? 'unknown',
      },
    });
  }, [wearable.devices, wearableSourceId]);

  useEffect(() => {
    const bpm = wearable.currentSample?.heartRateBeatsPerMinute;
    if (bpm === undefined) return;
    dispatch({type: 'update_live_metrics', metrics: {heartRateBeatsPerMinute: bpm}});
    dispatch({
      type: 'update_source_readiness',
      sourceId: wearableSourceId,
      readiness: {
        sourceConnectionState: 'connected',
        availableMeasurementIdentifiers: ['heartRateBeatsPerMinute'],
        liveTelemetryState: 'qualified',
        heartRatePermissionState: 'granted',
      },
    });
  }, [wearable.currentSample, wearableSourceId]);

  useEffect(
    () => recordingService.onUpdate(projection => {
      const speed = projection.groundSpeedMetersPerSecond;
      dispatch({
        type: 'update_live_metrics',
        metrics: {
          groundSpeedMetersPerSecond: speed,
          paceSecondsPer500Meters:
            speed !== undefined && speed > 0 ? 500 / speed : undefined,
          distanceMeters: projection.distanceMeters,
        },
      });
    }),
    [recordingService],
  );

  useEffect(() => {
    const spm = bladeSnapshot?.liveSpm;
    if (spm === undefined) return;
    dispatch({type: 'update_live_metrics', metrics: {strokeRateSpm: spm}});
  }, [bladeSnapshot]);

  useEffect(() => {
    if (state.phase !== 'recording') return;
    const timer = setInterval(() => {
      dispatch({type: 'advance_time', seconds: 1});
    }, 1_000);
    return () => clearInterval(timer);
  }, [state.phase]);

  const handleRequestPermissions = async (): Promise<void> => {
    const updated = await phoneDevice.requestPermissions();
    if (updated.readiness) {
      dispatch({
        type: 'update_source_readiness',
        sourceId: updated.sourceId,
        readiness: updated.readiness,
      });
    }
    const hasDenied =
      updated.missingPermissions.includes('location') ||
      updated.missingPermissions.includes('bluetooth');
    if (hasDenied && !didShowPhonePermissionAlert.current) {
      didShowPhonePermissionAlert.current = true;
      Alert.alert(
        t('permissions.deniedAlertTitle'),
        t('permissions.deniedAlertMessage'),
      );
    }
  };

  const startCapture = async (): Promise<void> => {
    try {
      const started = await recordingService.start(Object.keys(state.sources));
      const participatingRecordingIds = Object.fromEntries(
        Object.entries(started.recordingIdsBySource).filter(([sourceId]) => {
          const source = state.sources[sourceId];
          return source?.required ||
            source?.readiness?.sourceConnectionState === 'connected';
        }),
      );
      dispatch({
        type: 'commit_capture',
        activityId: started.activityId,
        activityCorrelationId: started.activityCorrelationId,
        recordingIdsBySource: participatingRecordingIds,
      });
      await Promise.allSettled([
        bladeDevice.startWorkoutCapture(),
        wearable.startRecording(),
      ]);
    } catch (error) {
      Alert.alert(
        'Não foi possível iniciar a gravação',
        error instanceof Error ? error.message : 'O gravador nativo não está disponível.',
      );
    }
  };

  const stopCapture = async (): Promise<void> => {
    dispatch({ type: 'request_stop' });
    await Promise.allSettled([
      bladeDevice.stopWorkoutCapture(),
      wearable.stopRecording(),
    ]);
    try {
      const manifest = await recordingService.stop();
      setLastManifest(manifest);
      if (manifest.status !== 'finalized') {
        throw new Error(
          manifest.failureMessage ??
            'A gravação foi preservada como interrompida por uma falha de escrita.',
        );
      }
      Object.values(state.sources)
        .filter(
          source => source.recordingId && source.recordingState !== 'interrupted',
        )
        .forEach(source => {
          dispatch({
            type: 'finalize_source',
            sourceId: source.sourceId,
            reason: 'app_stop',
          });
        });
    } catch (error) {
      Alert.alert(
        'Falha ao finalizar a gravação',
        error instanceof Error ? error.message : 'A evidência permanece pendente de recuperação.',
      );
    }
  };

  const handleExport = async (): Promise<void> => {
    try {
      await recordingService.exportRecording(lastManifest?.activityId);
    } catch (error) {
      Alert.alert(
        t('summary.exportFailedTitle'),
        error instanceof Error ? error.message : t('summary.exportFailedMessage'),
      );
    }
  };

  const isFullScreen = state.phase === 'recording';

  const defaultMetrics = {
    frame: { x: 0, y: 0, width: 393, height: 852 },
    insets: { top: 48, left: 0, right: 0, bottom: 34 },
  };

  return (
    <SafeAreaProvider initialMetrics={defaultMetrics} style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      {isFullScreen ? (
        <SafeAreaView style={styles.safeArea}>
          <ActiveScreen
            onPause={() => undefined}
            onStop={stopCapture}
            state={state}
          />
        </SafeAreaView>
      ) : (
        <AppShell activeTab={activeTab} onSelectTab={setActiveTab}>
          {state.phase === 'ready' ? (
            <ReadyScreen
              bladeSnapshot={bladeSnapshot}
              onRequestPermissions={handleRequestPermissions}
              onSendGpsAid={() => {
                bladeDevice.sendGpsAid(-23.55052, -46.633308).catch(() => {});
              }}
              onStart={startCapture}
              state={state}
            />
          ) : null}
          {state.phase === 'finalizing' ? (
            <FinalizingScreen state={state} />
          ) : null}
          {state.phase === 'completed' ? (
            <SummaryScreen
              lastManifest={lastManifest}
              onExport={handleExport}
              state={state}
            />
          ) : null}
        </AppShell>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: color.backgroundDefault,
    flex: 1,
  },
});
