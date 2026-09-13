import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Alert, NativeModules, Platform, StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { createDemoActivityCapture } from './src/application/capture/demoSources';
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
import { PhoneDeviceService } from './src/services/sensors/PhoneDeviceService';
import { RemusBladeDeviceService } from './src/services/blade/RemusBladeDeviceService';
import { RemusBladeAdapter, RemusBladeSnapshot } from './src/services/blade/RemusBladeAdapter';
import { useWearables } from './src/services/wearables';

export default function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<NavigationTab>('activities');
  const [simulation, dispatch] = useReducer(
    applyCaptureScenarioStep,
    undefined,
    () => createCaptureSimulation(
      createDemoActivityCapture(
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
  const wearable = useWearables();
  const didShowWearablePermissionAlert = useRef(false);
  const wearableSourceId =
    Platform.OS === 'android' ? 'watch:wear-os:demo' : 'watch:apple:demo';

  useEffect(() => {
    const unsub = bladeDevice.onStateChange(sourceState => {
      setBladeSnapshot(bladeDevice.getLatestSnapshot());
      if (sourceState.readiness) {
        dispatch({
          type: 'update_source_readiness',
          sourceId: 'rbp1:demo',
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

  const handleRequestPermissions = async (): Promise<void> => {
    const updated = await phoneDevice.requestPermissions();
    if (updated.readiness) {
      dispatch({
        type: 'update_source_readiness',
        sourceId: updated.sourceId,
        readiness: updated.readiness,
      });
    }
  };

  const startCapture = (): void => {
    bladeDevice.startWorkoutCapture().catch(() => {});
    wearable.startRecording().catch(() => {});
    dispatch({
      type: 'commit_capture',
      activityId: 'activity:demo',
      activityCorrelationId: 'correlation:demo',
      recordingIdsBySource: Object.fromEntries(
        Object.keys(state.sources).map(sourceId => [
          sourceId,
          `recording:${sourceId}:demo`,
        ]),
      ),
    });
    dispatch({
      type: 'advance_time',
      seconds: 2538,
      metrics: {
        strokeRateSpm: 28,
        paceSecondsPer500Meters: 119,
        groundSpeedMetersPerSecond: 4.2,
        distanceMeters: 8400,
      },
    });
  };

  const stopCapture = (): void => {
    bladeDevice.stopWorkoutCapture().catch(() => {});
    wearable.stopRecording().catch(() => {});
    dispatch({ type: 'request_stop' });
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
            <SummaryScreen state={state} />
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
