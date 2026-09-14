import { NativeEventEmitter } from 'react-native';

jest.mock('react-native', () => {
  const listeners: Record<string, Function> = {};
  return {
    NativeEventEmitter: jest.fn().mockImplementation(() => ({
      addListener: jest.fn((event: string, callback: Function) => {
        listeners[event] = callback;
        return { remove: jest.fn() };
      }),
      emit: (event: string, ...args: any[]) => {
        if (listeners[event]) listeners[event](...args);
      },
    })),
  };
});

import { RemusBladeDeviceService } from '../src/services/blade/RemusBladeDeviceService';
import { RemusBladeAdapter, NativeBladeBridge } from '../src/services/blade/RemusBladeAdapter';

describe('RemusBladeDeviceService (TDD)', () => {
  let mockBridge: jest.Mocked<NativeBladeBridge>;
  let adapter: RemusBladeAdapter;
  let service: RemusBladeDeviceService;

  beforeEach(() => {
    mockBridge = {
      isSupported: jest.fn().mockResolvedValue(true),
      startScan: jest.fn().mockResolvedValue(true),
      stopScan: jest.fn().mockResolvedValue(undefined),
      connectPeripheral: jest.fn().mockResolvedValue(true),
      disconnectPeripheral: jest.fn().mockResolvedValue(undefined),
      sendCommand: jest.fn().mockResolvedValue(true),
      addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
      removeListeners: jest.fn(),
    };
    adapter = new RemusBladeAdapter(mockBridge);
    service = new RemusBladeDeviceService(adapter);
  });

  afterEach(() => {
    service.destroy();
  });

  it('provides initial CaptureSourceState with canonical domain identity', () => {
    const state = service.getSourceState();

    expect(state.deviceFamily).toBe('remus_blade');
    expect(state.deviceModel).toBe('rbp1');
    expect(state.sensorPlacement).toBe('paddle');
    expect(state.sourceId).toContain('rbp1');
    expect(state.operationalState).toBe('unavailable');
    expect(state.readiness).toEqual({
      sourceConnectionState: 'unavailable',
      availableMeasurementIdentifiers: [],
      liveTelemetryState: 'unavailable',
    });
  });

  it('updates readiness when a snapshot is received from hardware', async () => {
    await service.initialize();

    const listenerSpy = jest.fn();
    service.onStateChange(listenerSpy);

    // Simulate 1s notification from ESP32 with GPS lock and Edge SPM
    const emitter = new NativeEventEmitter();
    (emitter as any).emit('onRemusBladeSnapshot', {
      rawCsv: '124456,0.012,-0.045,0.982,1.20,-0.40,0.15,-23.550520,-46.633308,8.50,6/10:32:3.2m,120,480,24.5',
    });

    expect(listenerSpy).toHaveBeenCalled();
    const updatedState = service.getSourceState();

    expect(updatedState.readiness?.sourceConnectionState).toBe('connected');
    expect(updatedState.readiness?.horizontalAccuracyMeters).toBe(3.2);
    expect(updatedState.readiness?.availableMeasurementIdentifiers).toContain('positionWgs84');
    expect(service.getLatestSnapshot()?.liveSpm).toBe(24.5);
    expect(service.getLatestSnapshot()?.linesWritten).toBe(120);
    expect(service.getLatestSnapshot()?.maxSnrDbHz).toBe(32);
  });

  it('forwards start and stop commands to hardware via adapter', async () => {
    await service.initialize();
    const emitter = new NativeEventEmitter();
    (emitter as any).emit('onRemusBladeSnapshot', {
      rawCsv: '124456,0.012,-0.045,0.982,1.20,-0.40,0.15,-23.550520,-46.633308,8.50,6/10:32:3.2m,120,480,24.5',
    });
    await service.startWorkoutCapture();
    expect(mockBridge.sendCommand).toHaveBeenCalledWith('START');

    await service.stopWorkoutCapture();
    expect(mockBridge.sendCommand).toHaveBeenCalledWith('STOP');
  });

  it('forwards GPS aiding from phone coordinates to hardware', async () => {
    await service.initialize();
    await service.sendGpsAid(-23.55052, -46.633308);
    expect(mockBridge.sendCommand).toHaveBeenCalledWith('AID,-23.550520,-46.633308');
  });

  it('transitions to disconnected and marks source unavailable when hardware disconnects', async () => {
    await service.initialize();
    const listenerSpy = jest.fn();
    service.onStateChange(listenerSpy);

    // Simulate native BLE disconnect event
    const emitter = new NativeEventEmitter();
    (emitter as any).emit('onRemusBladeStateChanged', { state: 'disconnected' });

    expect(service.getConnectionState()).toBe('disconnected');
    const sourceState = service.getSourceState();
    expect(sourceState.operationalState).toBe('unavailable');
    expect(sourceState.readiness?.sourceConnectionState).toBe('unavailable');
    expect(sourceState.readiness?.liveTelemetryState).toBe('unavailable');
    expect(listenerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operationalState: 'unavailable',
        readiness: expect.objectContaining({
          sourceConnectionState: 'unavailable',
        }),
      })
    );
  });

  it('does not claim a connection before the first valid hardware snapshot', async () => {
    await service.initialize();

    const emitter = new NativeEventEmitter();
    (emitter as any).emit('onRemusBladeStateChanged', { state: 'connected' });

    expect(service.getConnectionState()).toBe('connecting');
    expect(service.getSourceState().operationalState).toBe('unavailable');
    expect(service.getSourceState().readiness).toEqual({
      sourceConnectionState: 'detected',
      availableMeasurementIdentifiers: [],
      liveTelemetryState: 'evaluation_pending',
    });
  });

  it('treats scanning as disconnected and remains unavailable (Buscando automaticamente...)', async () => {
    await service.initialize();

    const emitter = new NativeEventEmitter();
    (emitter as any).emit('onRemusBladeStateChanged', { state: 'scanning' });

    expect(service.getConnectionState()).toBe('disconnected');
    expect(service.getSourceState().operationalState).toBe('unavailable');
    expect(service.getSourceState().readiness?.sourceConnectionState).toBe('unavailable');
  });

  it('does not enter capture state or send START while the Blade is offline', async () => {
    await service.initialize();

    await expect(service.startWorkoutCapture()).resolves.toBe(false);
    expect(mockBridge.sendCommand).not.toHaveBeenCalled();
    expect(service.getSourceState().operationalState).toBe('unavailable');
    expect(service.getSourceState().recordingState).toBeUndefined();
  });

  it('detects loss of snapshots via watchdog timeout and marks device offline', async () => {
    jest.useFakeTimers();
    await service.initialize();
    const listenerSpy = jest.fn();
    service.onStateChange(listenerSpy);

    const emitter = new NativeEventEmitter();
    // Snapshot arrives -> connected
    (emitter as any).emit('onRemusBladeSnapshot', {
      rawCsv: '124456,0.012,-0.045,0.982,1.20,-0.40,0.15,-23.550520,-46.633308,8.50,6/10:32:3.2m,120,480,24.5',
    });
    expect(service.getConnectionState()).toBe('connected');

    // Hardware turned off -> no snapshots arrive for 3500ms
    jest.advanceTimersByTime(3500);

    expect(service.getConnectionState()).toBe('disconnected');
    expect(service.getSourceState().operationalState).toBe('unavailable');
    expect(service.getSourceState().readiness?.sourceConnectionState).toBe('unavailable');

    // Hardware turned back on -> snapshot resumes -> reconnects
    (emitter as any).emit('onRemusBladeSnapshot', {
      rawCsv: '125456,0.012,-0.045,0.982,1.20,-0.40,0.15,-23.550520,-46.633308,8.50,6/10:32:3.2m,121,481,24.5',
    });
    expect(service.getConnectionState()).toBe('connected');
    expect(service.getSourceState().operationalState).toBe('available_idle');
    expect(service.getSourceState().readiness?.sourceConnectionState).toBe('connected');

    jest.useRealTimers();
  });
});
