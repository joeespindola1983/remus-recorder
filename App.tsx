import React, {useReducer} from 'react';
import {StatusBar, StyleSheet} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {createDemoActivityCapture} from './src/application/capture/demoSources';
import {
  applyCaptureScenarioStep,
  createCaptureSimulation,
} from './src/application/simulation/CaptureSimulator';
import {ActiveScreen, FinalizingScreen, ReadyScreen, SummaryScreen} from './src/ui/screens/RecorderScreens';
import {color} from './src/ui/theme/tokens';

export default function App(): React.JSX.Element {
  const [simulation, dispatch] = useReducer(
    applyCaptureScenarioStep,
    undefined,
    () => createCaptureSimulation(createDemoActivityCapture()),
  );
  const state = simulation.capture;

  const startCapture = (): void => {
    dispatch({
      type: 'commit_capture',
      activityId: 'activity:demo',
      activityCorrelationId: 'correlation:demo',
      recordingIdsBySource: Object.fromEntries(
        Object.keys(state.sources).map(sourceId => [sourceId, `recording:${sourceId}:demo`]),
      ),
    });
    dispatch({
      type: 'advance_time',
      seconds: 2538,
      metrics: {
        strokeRateSpm: 28,
        groundSpeedMetersPerSecond: 4.2,
        heartRateBeatsPerMinute: 154,
        distanceMeters: 8400,
      },
    });
  };

  const interruptWatch = (): void => {
    dispatch({
      type: 'interrupt_source',
      sourceId: 'watch:apple:demo',
      reason: 'power_depleted',
    });
  };

  const stopCapture = (): void => {
    dispatch({type: 'request_stop'});
    Object.values(state.sources)
      .filter(source => source.recordingId && source.recordingState !== 'interrupted')
      .forEach(source => {
        dispatch({
          type: 'finalize_source',
          sourceId: source.sourceId,
          reason: 'app_stop',
        });
      });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      {state.phase === 'ready' ? <ReadyScreen state={state} onStart={startCapture} /> : null}
      {state.phase === 'recording' ? (
        <ActiveScreen state={state} onStop={stopCapture} onInterruptWatch={interruptWatch} />
      ) : null}
      {state.phase === 'finalizing' ? <FinalizingScreen state={state} /> : null}
      {state.phase === 'completed' ? <SummaryScreen state={state} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: color.backgroundDefault,
    flex: 1,
  },
});
