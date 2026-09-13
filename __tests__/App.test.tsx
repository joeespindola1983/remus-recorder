/**
 * @format
 */

import React from 'react';
import { NativeModules, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

beforeEach(() => {
  NativeModules.RemusRecordingBridge = {
    startRecording: jest.fn().mockResolvedValue({
      activityId: 'activity:test',
      activityCorrelationId: 'correlation:test',
      recordingIdsBySource: {
        'phone:primary': 'recording:phone:test',
        'watch:apple:primary': 'recording:watch:test',
        'rbp1:primary': 'recording:blade:test',
      },
      artifactDirectory: '/evidence/activity-test',
    }),
    stopRecording: jest.fn().mockResolvedValue({
      activityId: 'activity:test',
      activityCorrelationId: 'correlation:test',
      recordingIdsBySource: {'phone:primary': 'recording:phone:test'},
      artifactDirectory: '/evidence/activity-test',
      status: 'finalized',
      startedAtEpochMilliseconds: 1,
      endedAtEpochMilliseconds: 2,
      sampleCounts: {},
    }),
    getRecordingState: jest.fn().mockResolvedValue({isRecording: false}),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
});

test('renders a source-agnostic ready state', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  expect(
    renderer.root.findByProps({ accessibilityLabel: 'Iniciar atividade' }),
  ).toBeTruthy();
  expect(
    renderer.root.findAll(
      node =>
        node.type === Text && node.props.children === 'Tudo pronto para remar?',
    ),
  ).toHaveLength(1);
  expect(
    renderer.root.findAll(
      node =>
        node.type === Text &&
        node.props.children === 'Dispositivos disponíveis',
    ),
  ).toHaveLength(1);
  expect(
    renderer.root.findAll(
      node => node.type === Text && node.props.children === 'Remus Blade P1',
    ),
  ).toHaveLength(1);
  expect(
    renderer.root.findAll(
      node => node.type === Text && node.props.children === 'Buscando automaticamente...',
    ),
  ).toHaveLength(1);
  expect(
    renderer.root.findAll(
      node =>
        node.type === Text &&
        typeof node.props.children === 'string' &&
        node.props.children.includes('+1 h'),
    ),
  ).toHaveLength(0);
});

test('moves from ready through recording to a preserved summary', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: 'Iniciar atividade' })
      .props.onPress();
  });
  expect(
    renderer.root.findAll(
      node => node.type === Text && node.props.children === 'PARCIAL',
    ),
  ).toHaveLength(1);
  expect(renderer.root.findByProps({testID: 'metric-value-paceSecondsPer500Meters'}).props.children).toBe('—');

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: 'Finalizar atividade' })
      .props.onPress();
  });
  expect(
    renderer.root.findAll(
      node =>
        node.type === Text && node.props.children === 'Atividade preservada',
    ),
  ).toHaveLength(1);
});
