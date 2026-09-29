import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Alert, Platform, StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { createActivityCapture } from './src/application/capture/demoSources';
import {
  applyCaptureScenarioStep,
  createCaptureSimulation,
} from './src/application/simulation/CaptureSimulator';
import { AppShell, NavigationTab } from './src/ui/organisms/AppShell';
import {formatPace} from './src/ui/organisms/AdaptiveCaptureSurface';
import {
  ActiveScreen,
  FinalizingScreen,
  ReadyScreen,
  SummaryScreen,
} from './src/ui/screens/RecorderScreens';
import { color } from './src/ui/theme/tokens';
import {ProfileScreen} from './src/ui/screens/ProfileScreen';
import { t } from './src/i18n';
import { PhoneDeviceService } from './src/services/sensors/PhoneDeviceService';
import { RemusBladeSnapshot } from './src/services/blade/RemusBladeAdapter';
import { RemusBladeManager } from './src/services/blade/RemusBladeManager';
import { useWearables } from './src/services/wearables';
import {
  RecordingManifest,
  RecordingService,
} from './src/services/recording/RecordingService';
import { LivePresentationRecorder } from './src/services/presentation/LivePresentationRecorder';
import { BoatMotionDetector } from './src/services/motion/BoatMotionDetector';

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
  const [bladeManager] = useState(() => new RemusBladeManager());
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

  const sourcesRef = useRef(state.sources);
  sourcesRef.current = state.sources;
  const phaseRef = useRef(state.phase);
  phaseRef.current = state.phase;
  const elapsedSecondsRef = useRef(state.metrics.elapsedSeconds);
  elapsedSecondsRef.current = state.metrics.elapsedSeconds;
  const [presentationRecorder] = useState(
    () =>
      new LivePresentationRecorder({
        formatPaceFn: formatPace,
        onPresentation: presentation => {
          if (phaseRef.current === 'recording') {
            recordingService.appendLiveMetricPresentation(presentation).catch(() => {});
          }
        },
      }),
  );
  const [boatMotionDetector] = useState(
    () =>
      new BoatMotionDetector({
        onObservation: observation => {
          if (phaseRef.current === 'recording') {
            recordingService.appendBoatMotionObservation(observation).catch(() => {});
          }
        },
      }),
  );

  useEffect(() => {
    const unsub = bladeManager.onStateChange(sourceState => {
      setBladeSnapshot(bladeManager.getLatestSnapshot());
      const sourceId = sourceState.sourceId;
      const connectionState = sourceState.readiness?.sourceConnectionState;
      if (!sourcesRef.current[sourceId]) {
        if (connectionState === 'detected' || connectionState === 'connected') {
          dispatch({
            type: 'source_discovered',
            source: sourceState,
            readiness: sourceState.readiness,
          });
        }
      } else if (sourceState.readiness) {
        const currentSource = sourcesRef.current[sourceId];
        if (
          phaseRef.current === 'recording' &&
          currentSource.recordingState === 'recording' &&
          connectionState === 'unavailable'
        ) {
          dispatch({
            type: 'interrupt_source',
            sourceId,
            reason: 'telemetry_timeout',
          });
          recordingService.recordSourceLifecycleEvent({
            sourceId,
            event: 'source_interrupted',
            reason: 'telemetry_timeout',
            elapsedSeconds: elapsedSecondsRef.current,
          }).catch(() => {});
        } else if (
          phaseRef.current === 'recording' &&
          currentSource.recordingState === 'interrupted' &&
          currentSource.finalizationReason === 'telemetry_timeout' &&
          connectionState === 'connected' &&
          sourceState.readiness?.liveTelemetryState === 'qualified'
        ) {
          dispatch({type: 'recover_source', sourceId});
          recordingService.recordSourceLifecycleEvent({
            sourceId,
            event: 'source_recovered',
            elapsedSeconds: elapsedSecondsRef.current,
          }).catch(() => {});
        }
        dispatch({
          type: 'update_source_readiness',
          sourceId,
          readiness: sourceState.readiness,
        });
      }
    });

    bladeManager.initialize().catch(() => {});
    return () => {
      unsub();
      bladeManager.destroy();
    };
  }, [bladeManager, recordingService]);

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
    () =>
      recordingService.onUpdate(projection => {
        const pacePres = presentationRecorder.updatePace({
          groundSpeedMetersPerSecond: projection.groundSpeedMetersPerSecond,
          locationSourceTimeEpochMs: projection.locationSourceTimeEpochMs,
          speedAccuracyMetersPerSecond: projection.speedAccuracyMetersPerSecond,
          locationFreshnessMs: projection.locationFreshnessMs,
        });
        boatMotionDetector.update({
          timestampMs: projection.locationSourceTimeEpochMs ?? Date.now(),
          groundSpeedMetersPerSecond: projection.groundSpeedMetersPerSecond,
          speedAccuracyMetersPerSecond: projection.speedAccuracyMetersPerSecond,
          courseDegrees: projection.courseDegrees,
          courseAccuracyDegrees: projection.courseAccuracyDegrees,
          horizontalAccuracyMeters: projection.horizontalAccuracyMeters,
          locationFreshnessMs: projection.locationFreshnessMs,
          sourceId: 'phone:primary',
          nowEpochMs: Date.now(),
        });
        const paceSecondsPer500Meters =
          pacePres.availabilityState === 'available' && pacePres.numericValue !== null
            ? pacePres.numericValue
            : undefined;
        dispatch({
          type: 'update_live_metrics',
          metrics: {
            groundSpeedMetersPerSecond: projection.groundSpeedMetersPerSecond,
            paceSecondsPer500Meters,
            distanceMeters: projection.distanceMeters,
          },
        });
      }),
    [recordingService, presentationRecorder, boatMotionDetector],
  );

  useEffect(() => {
    if (!bladeSnapshot || !bladeSnapshot.sourceId) return;
    const spmPres = presentationRecorder.updateSpm({
      sourceId: bladeSnapshot.sourceId,
      liveSpm: bladeSnapshot.liveSpm,
      availabilityState: bladeSnapshot.liveSpmAvailabilityState,
      availabilityReason: bladeSnapshot.liveSpmAvailabilityReason,
      supportedAtNativeTimestamp: bladeSnapshot.liveSpmSupportedNativeTimestamp,
      clockDomainId: bladeSnapshot.clockDomainId,
    });
    const strokeRateSpm =
      spmPres &&
      (spmPres.availabilityState === 'available' || spmPres.availabilityState === 'held') &&
      spmPres.numericValue !== null
        ? spmPres.numericValue
        : undefined;
    dispatch({type: 'update_live_metrics', metrics: {strokeRateSpm}});
  }, [bladeSnapshot, presentationRecorder]);

  useEffect(() => {
    if (state.phase !== 'recording') return;
    const interval = setInterval(() => {
      presentationRecorder.checkHeartbeat();
      if (!presentationRecorder.isSpmActive()) {
        dispatch({type: 'update_live_metrics', metrics: {strokeRateSpm: undefined}});
      }
    }, 1_000);
    return () => clearInterval(interval);
  }, [state.phase, presentationRecorder]);

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
      const participatingSourceIds = Object.values(state.sources)
        .filter(source =>
          source.required ||
          (source.readiness?.sourceConnectionState === 'connected' &&
            (source.deviceFamily === 'remus_blade' ||
              source.deviceFamily === 'remus_computer' ||
              source.readiness.availableMeasurementIdentifiers.length > 0)),
        )
        .map(source => source.sourceId);
      const started = await recordingService.start(participatingSourceIds);
      presentationRecorder.reset();
      boatMotionDetector.reset();
      dispatch({
        type: 'commit_capture',
        activityId: started.activityId,
        activityCorrelationId: started.activityCorrelationId,
        recordingIdsBySource: started.recordingIdsBySource,
      });
      console.log('[App] Starting bladeManager & wearable capture...');
      const watchRecordingId = started.recordingIdsBySource?.['watch:apple:primary'] ?? 'rec:watch:apple:primary:001';
      const results = await Promise.allSettled([
        bladeManager.startWorkoutCapture(),
        wearable.startRecording({
          activityCorrelationId: started.activityCorrelationId,
          recordingId: watchRecordingId,
          startCommandId: `cmd-start-${started.activityCorrelationId}`,
        }),
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
    const stopCommandId = `cmd-stop-${Date.now()}`;
    await Promise.allSettled([
      bladeManager.stopWorkoutCapture(),
      wearable.stopRecording({ stopCommandId }),
    ]);

    try {
      await recordingService.setTelemetryDiagnostics(bladeManager.getTelemetryDiagnostics());
      const manifest = await recordingService.stop();
      presentationRecorder.reset();
      boatMotionDetector.reset();
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
            bladeManager={bladeManager}
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
              onRequestPermissions={handleRequestPermissions}
              onDisconnectBlade={() => {
                bladeManager.disconnect().catch(() => {});
              }}
              onConnectBlade={sourceId => {
                bladeManager.connect(sourceId).catch(() => {});
              }}
              onSelectPlacement={(sourceId, placement) => {
                bladeManager.setPlacement(sourceId, placement);
                dispatch({
                  type: 'update_source_placement',
                  sourceId,
                  sensorPlacement: placement,
                });
              }}
              onCalibrateBladeAlignment={() => {
                bladeManager.calibrateBladeAlignment().catch(() => {});
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
              onDone={() => {
                setLastManifest(null);
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
