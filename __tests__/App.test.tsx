/**
 * @format
 */

import { Buffer } from 'buffer';
import React from 'react';
import { Alert, NativeEventEmitter, NativeModules, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import { RemusBladeDeviceService } from '../src/services/blade/RemusBladeDeviceService';
import { RecordingService } from '../src/services/recording/RecordingService';

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
    requestLocationPermission: jest.fn().mockResolvedValue('granted'),
    getLocationPermissionStatus: jest.fn().mockResolvedValue('granted'),
    exportRecording: jest
      .fn()
      .mockResolvedValue('/evidence/activity-test.zip'),
    saveBladeRawBinary: jest.fn().mockResolvedValue({
      success: true,
      binPath: '/evidence/activity-test/samples/blade_200hz.bin',
      csvPath: '/evidence/activity-test/samples/blade_200hz.csv',
    }),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  NativeModules.RemusBladeBridge = {
    isSupported: jest.fn().mockResolvedValue(true),
    startScan: jest.fn().mockResolvedValue(true),
    stopScan: jest.fn().mockResolvedValue(undefined),
    connectPeripheral: jest.fn().mockResolvedValue(true),
    disconnectPeripheral: jest.fn().mockResolvedValue(undefined),
    sendCommand: jest.fn().mockResolvedValue(true),
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
  ).toHaveLength(0);
  expect(
    renderer.root.findAll(
      node => node.type === Text && node.props.children === 'Este iPhone',
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

test('dynamically discovers Remus Blade on BLE event', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  const emitter = new NativeEventEmitter(NativeModules.RemusBladeBridge);
  await ReactTestRenderer.act(async () => {
    (emitter as any).emit("onRemusBladeStateChanged", {
      state: 'detected',
      deviceId: '7E5A',
      deviceName: 'REMUS-BLD-7E5A',
    });
  });

  expect(
    renderer.root.findAll(
      node => node.type === Text && node.props.children === 'Remus Blade · REMUS-BLD-7E5A',
    ),
  ).toHaveLength(1);
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
  expect(NativeModules.RemusRecordingBridge.startRecording).toHaveBeenCalledWith({
    sourceIds: ['phone:primary'],
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

test('handles requesting phone permissions from ready screen without error', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  const readyScreenNode = renderer.root.find(
    node => typeof node.props.onRequestPermissions === 'function',
  );
  expect(readyScreenNode).toBeDefined();

  await ReactTestRenderer.act(async () => {
    await readyScreenNode.props.onRequestPermissions();
  });

  expect(
    renderer.root.findAll(
      node =>
        node.type === Text && node.props.children === 'Tudo pronto para remar?',
    ),
  ).toHaveLength(1);
});

test('automatically requests permissions on launch when undetermined', async () => {
  NativeModules.RemusRecordingBridge.getLocationPermissionStatus = jest
    .fn()
    .mockResolvedValue('undetermined');
  NativeModules.RemusRecordingBridge.requestLocationPermission = jest
    .fn()
    .mockResolvedValue('granted');

  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
  });

  expect(
    NativeModules.RemusRecordingBridge.requestLocationPermission,
  ).toHaveBeenCalled();
});

test('alerts athlete when permissions are denied', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert');
  NativeModules.RemusRecordingBridge.getLocationPermissionStatus = jest
    .fn()
    .mockResolvedValue('denied');

  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
  });

  expect(alertSpy).toHaveBeenCalledWith(
    expect.stringContaining('Permissões necessárias'),
    expect.stringContaining('negado'),
  );
});

test('allows exporting recorded activity evidence zip from summary screen', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: 'Iniciar atividade' })
      .props.onPress();
  });

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: 'Finalizar atividade' })
      .props.onPress();
  });

  const exportBtn = renderer.root.findByProps({
    accessibilityLabel: 'Exportar evidência (.zip)',
  });
  expect(exportBtn).toBeTruthy();

  await ReactTestRenderer.act(async () => {
    exportBtn.props.onPress();
  });

  expect(
    NativeModules.RemusRecordingBridge.exportRecording,
  ).toHaveBeenCalledWith({
    activityId: 'activity:test',
  });
});

test('downloads and saves blade session binary when blade is connected on stop', async () => {
  const connSpy = jest
    .spyOn(RemusBladeDeviceService.prototype, 'getConnectionState')
    .mockReturnValue('connected');
  const downloadSpy = jest
    .spyOn(RemusBladeDeviceService.prototype, 'downloadSessionFile')
    .mockImplementation(async onProgress => {
      if (typeof onProgress === "function") { (onProgress as any)(100, 32, 32); }
      // Minimal valid RBP1B buffer: 32 bytes header
      const buf = Buffer.alloc(32);
      buf.write('RBP1B', 0, 'ascii');
      buf.writeUInt8(1, 5);
      return {
        filename: 'remus_sensor_123.bin',
        data: buf,
      };
    });

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: 'Iniciar atividade' })
      .props.onPress();
  });

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: 'Finalizar atividade' })
      .props.onPress();
  });

  expect(downloadSpy).toHaveBeenCalled();
  expect(
    NativeModules.RemusRecordingBridge.saveBladeRawBinary,
  ).toHaveBeenCalledWith(
    'activity:test',
    expect.any(String),
    expect.any(String),
  );

  connSpy.mockRestore();
  downloadSpy.mockRestore();
});

test('suppresses pace when speed is below 0.8 m/s and formats pace above threshold', async () => {
  let updateListener: ((projection: any) => void) | undefined;
  const onUpdateSpy = jest
    .spyOn(RecordingService.prototype, 'onUpdate')
    .mockImplementation(listener => {
      updateListener = listener;
      return () => undefined;
    });

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: 'Iniciar atividade' })
      .props.onPress();
  });

  // Emitting low speed (< 0.8 m/s)
  await ReactTestRenderer.act(async () => {
    if (updateListener) {
      updateListener({
        elapsedSeconds: 10,
        groundSpeedMetersPerSecond: 0.5,
        distanceMeters: 50,
      });
    }
  });

  expect(
    renderer.root.findByProps({ testID: 'metric-value-paceSecondsPer500Meters' })
      .props.children,
  ).toBe('—');

  // Emitting moving speed (>= 0.8 m/s, e.g. 2.5 m/s -> 200s = 03:20)
  await ReactTestRenderer.act(async () => {
    if (updateListener) {
      updateListener({
        elapsedSeconds: 15,
        groundSpeedMetersPerSecond: 2.5,
        distanceMeters: 62,
      });
    }
  });

  expect(
    renderer.root.findByProps({ testID: 'metric-value-paceSecondsPer500Meters' })
      .props.children,
  ).toBe('03:20');

  await ReactTestRenderer.act(async () => {
    renderer.unmount();
  });

  onUpdateSpy.mockRestore();
});

test('updates stroke rate from blade snapshot and resets when SPM is 0', async () => {
  let stateChangeListener: ((state: any) => void) | undefined;
  let currentSnapshot: any = null;

  const onStateSpy = jest
    .spyOn(RemusBladeDeviceService.prototype, 'onStateChange')
    .mockImplementation(listener => {
      stateChangeListener = listener;
      return () => undefined;
    });

  const getSnapshotSpy = jest
    .spyOn(RemusBladeDeviceService.prototype, 'getLatestSnapshot')
    .mockImplementation(() => currentSnapshot);

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: 'Iniciar atividade' })
      .props.onPress();
  });

  // Emitting positive SPM (e.g. 28 SPM)
  currentSnapshot = { liveSpm: 28 };
  await ReactTestRenderer.act(async () => {
    if (stateChangeListener) {
      stateChangeListener({});
    }
  });

  expect(
    renderer.root.findByProps({ testID: 'metric-value-strokeRateSpm' })
      .props.children,
  ).toBe('28');

  // Emitting zero SPM (stopped)
  currentSnapshot = { liveSpm: 0 };
  await ReactTestRenderer.act(async () => {
    if (stateChangeListener) {
      stateChangeListener({});
    }
  });

  expect(
    renderer.root.findByProps({ testID: 'metric-value-strokeRateSpm' })
      .props.children,
  ).toBe('—');

  await ReactTestRenderer.act(async () => {
    renderer.unmount();
  });

  onStateSpy.mockRestore();
  getSnapshotSpy.mockRestore();
});

