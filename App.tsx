import React, {useReducer} from 'react';
import {StatusBar, StyleSheet} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {activityCaptureReducer} from './src/application/capture/ActivityCapture';
import {createDemoActivityCapture} from './src/application/capture/demoSources';
import {ActiveScreen, FinalizingScreen, ReadyScreen, SummaryScreen} from './src/ui/screens/RecorderScreens';
import {color} from './src/ui/theme/tokens';

export default function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(
    activityCaptureReducer,
    undefined,
    createDemoActivityCapture,
  );

  const startCapture = (): void => {
    dispatch({
      type: 'capture_committed',
      activityId: 'activity:demo',
      activityCorrelationId: 'correlation:demo',
      recordingIdsBySource: Object.fromEntries(
        Object.keys(state.sources).map(sourceId => [sourceId, `recording:${sourceId}:demo`]),
      ),
    });
    dispatch({
      type: 'metrics_updated',
      metrics: {
        elapsedSeconds: 2538,
        strokeRateSpm: 28,
        groundSpeedMetersPerSecond: 4.2,
        heartRateBeatsPerMinute: 154,
        distanceMeters: 8400,
      },
    });
  };

  const interruptWatch = (): void => {
    dispatch({
      type: 'source_interrupted',
      sourceId: 'watch:apple:demo',
      atElapsedSeconds: state.metrics.elapsedSeconds,
      reason: 'power_depleted',
    });
  };

  const stopCapture = (): void => {
    dispatch({type: 'stop_requested'});
    Object.values(state.sources)
      .filter(source => source.recordingId && source.recordingState !== 'interrupted')
      .forEach(source => {
        dispatch({
          type: 'source_finalized',
          sourceId: source.sourceId,
          atElapsedSeconds: state.metrics.elapsedSeconds,
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
