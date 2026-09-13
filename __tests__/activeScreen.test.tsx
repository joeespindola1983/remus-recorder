import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { activityCaptureReducer } from '../src/application/capture/ActivityCapture';
import { createDemoActivityCapture } from '../src/application/capture/demoSources';
import { ActiveScreen } from '../src/ui/screens/RecorderScreens';

test('keeps the adaptive capture surface active behind a non-blocking source-loss notice', async () => {
  let state = createDemoActivityCapture();
  state = activityCaptureReducer(state, {
    type: 'capture_committed',
    activityId: 'activity:test',
    activityCorrelationId: 'correlation:test',
    recordingIdsBySource: Object.fromEntries(
      Object.keys(state.sources).map(sourceId => [
        sourceId,
        `recording:${sourceId}`,
      ]),
    ),
  });
  state = activityCaptureReducer(state, {
    type: 'source_interrupted',
    sourceId: 'watch:apple:demo',
    atElapsedSeconds: 42,
    reason: 'power_depleted',
  });

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ActiveScreen state={state} onPause={jest.fn()} onStop={jest.fn()} />,
    );
  });

  expect(
    renderer.root.findByProps({ accessibilityRole: 'alert' }),
  ).toBeTruthy();
  expect(
    renderer.root.findByProps({ testID: 'capture-controls' }),
  ).toBeTruthy();
  expect(
    renderer.root.findAll(
      node => node.type === Text && node.props.children === 'Continuar treino',
    ),
  ).toHaveLength(0);
});
