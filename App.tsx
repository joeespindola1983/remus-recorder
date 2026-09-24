import { Buffer } from 'buffer';
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
  BladeDownloadStatus,
  FinalizingScreen,
  ReadyScreen,
  SummaryScreen,
} from './src/ui/screens/RecorderScreens';
import { convertRemusBladeBinaryToCsv } from './src/services/blade/RemusBladeBinaryDecoder';
import { color } from './src/ui/theme/tokens';
import {ProfileScreen} from './src/ui/screens/ProfileScreen';
import { t } from './src/i18n';
import { PhoneDeviceService } from './src/services/sensors/PhoneDeviceService';
import { RemusBladeDeviceService } from './src/services/blade/RemusBladeDeviceService';
import { RemusBladeAdapter, RemusBladeSnapshot } from './src/services/blade/RemusBladeAdapter';
import { useWearables } from './src/services/wearables';
import { WearableDevice } from './src/types/wearables';
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
  const [remusDevices, setRemusDevices] = useState<WearableDevice[]>([]);
  const [bladeDownloadStatus, setBladeDownloadStatus] = useState<BladeDownloadStatus | undefined>(undefined);
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
    const unsubDevices = bladeDevice.onDevicesChange(setRemusDevices);
    bladeDevice.initialize().catch(() => {});
    return () => {
      unsub();
      unsubDevices();
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

  const MOVING_SPEED_THRESHOLD_METERS_PER_SECOND = 0.8;
  const lastBladeTelemetryAt = useRef<number>(0);

  useEffect(
    () => recordingService.onUpdate(projection => {
      const speed = projection.groundSpeedMetersPerSecond;
      const isMoving =
        speed !== undefined && speed >= MOVING_SPEED_THRESHOLD_METERS_PER_SECOND;
      dispatch({
        type: 'update_live_metrics',
        metrics: {
          groundSpeedMetersPerSecond: speed,
          paceSecondsPer500Meters:
            isMoving ? 500 / speed : undefined,
          distanceMeters: projection.distanceMeters,
        },
      });
    }),
    [recordingService],
  );

  useEffect(() => {
    if (!bladeSnapshot) return;
    lastBladeTelemetryAt.current = Date.now();
    const spm = bladeSnapshot.liveSpm;
    if (spm !== undefined && spm > 0) {
      dispatch({type: 'update_live_metrics', metrics: {strokeRateSpm: spm}});
    } else {
      dispatch({type: 'update_live_metrics', metrics: {strokeRateSpm: undefined}});
    }
  }, [bladeSnapshot]);

  useEffect(() => {
    if (state.phase !== 'recording') return;
    const interval = setInterval(() => {
      if (
        lastBladeTelemetryAt.current > 0 &&
        Date.now() - lastBladeTelemetryAt.current > 3_500
      ) {
        dispatch({type: 'update_live_metrics', metrics: {strokeRateSpm: undefined}});
      }
    }, 1_000);
    return () => clearInterval(interval);
  }, [state.phase]);

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
      await bladeDevice.prepareAvailableDevices();
      const participatingSourceIds = Object.values(state.sources)
        .filter(source =>
          source.required ||
          (source.readiness?.sourceConnectionState === 'connected' &&
            source.readiness.availableMeasurementIdentifiers.length > 0),
        )
        .map(source => source.sourceId);
      const started = await recordingService.start(participatingSourceIds);
      dispatch({
        type: 'commit_capture',
        activityId: started.activityId,
        activityCorrelationId: started.activityCorrelationId,
        recordingIdsBySource: started.recordingIdsBySource,
      });
      console.log('[App] Starting bladeDevice & wearable capture...');
      const results = await Promise.allSettled([
        bladeDevice.startWorkoutCapture(),
        wearable.startRecording(),
      ]);
      console.log('[App] blade & wearable start results:', JSON.stringify(results));
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

    if (bladeDevice.getConnectionState() === 'connected' && state.activityId) {
      setBladeDownloadStatus({
        isDownloading: true,
        bytesTransferred: 0,
        totalBytes: 0,
        progress: 0,
      });
      try {
        const fileResult = await bladeDevice.downloadSessionFile(
          (progress, received, total) => {
            setBladeDownloadStatus({
              isDownloading: true,
              bytesTransferred: received,
              totalBytes: total,
              progress,
            });
          },
        );

        if (fileResult && fileResult.data && fileResult.data.length > 0) {
          const csv = convertRemusBladeBinaryToCsv(fileResult.data);
          const base64Data = Buffer.from(fileResult.data as any).toString('base64');
          await recordingService.saveBladeRaw(state.activityId, base64Data, csv);
          setBladeDownloadStatus({
            isDownloading: false,
            bytesTransferred: fileResult.data.length,
            totalBytes: fileResult.data.length,
            progress: 100,
          });
        } else {
          setBladeDownloadStatus(undefined);
        }
      } catch (dlError) {
        console.warn('[App] Failed to download blade session binary:', dlError);
        setBladeDownloadStatus(undefined);
      }
    }

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
            bladeSnapshot={bladeSnapshot}
            onPause={() => undefined}
            onStop={stopCapture}
            state={state}
          />
        </SafeAreaView>
      ) : (
        <AppShell activeTab={activeTab} onSelectTab={setActiveTab}>
          {activeTab === 'profile' ? (
            <ProfileScreen service={recordingService} />
          ) : state.phase === 'ready' ? (
            <ReadyScreen
              bladeSnapshot={bladeSnapshot}
              remusDevices={remusDevices}
              onRequestPermissions={handleRequestPermissions}
              onDisconnectBlade={() => {
                bladeDevice.disconnect().catch(() => {});
              }}
              onConnectBlade={() => {
                bladeDevice.connect().catch(() => {});
              }}
              onStart={startCapture}
              state={state}
            />
          ) : null}
          {state.phase === 'finalizing' ? (
            <FinalizingScreen
              state={state}
              bladeDownloadStatus={bladeDownloadStatus}
            />
          ) : null}
          {state.phase === 'completed' ? (
            <SummaryScreen
              lastManifest={lastManifest}
              onExport={handleExport}
              onDone={() => {
                setLastManifest(null);
                setBladeDownloadStatus(undefined);
                dispatch({type: 'reset_to_ready'});
                setActiveTab('activities');
              }}
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
