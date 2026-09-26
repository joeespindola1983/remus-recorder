import { NativeModules } from 'react-native';

const emitterListeners: Record<string, ((...args: any[]) => void)[]> = {};

jest.mock('react-native', () => {
  return {
    NativeEventEmitter: jest.fn().mockImplementation(() => ({
      addListener: jest.fn((event: string, callback: (...args: any[]) => void) => {
        if (!emitterListeners[event]) emitterListeners[event] = [];
        emitterListeners[event].push(callback);
        return {
          remove: jest.fn(() => {
            emitterListeners[event] = (emitterListeners[event] || []).filter(cb => cb !== callback);
          }),
        };
      }),
      emit: (event: string, ...args: any[]) => {
        (emitterListeners[event] || []).forEach(cb => cb(...args));
      },
    })),
    NativeModules: {
      RemusBladeBridge: {
        isSupported: jest.fn().mockResolvedValue(true),
        startScan: jest.fn().mockResolvedValue(true),
        stopScan: jest.fn().mockResolvedValue(undefined),
        connectPeripheral: jest.fn().mockResolvedValue(true),
        disconnectPeripheral: jest.fn().mockResolvedValue(undefined),
        sendCommand: jest.fn().mockResolvedValue(true),
        sendBinaryCommand: jest.fn().mockResolvedValue(true),
        addListener: jest.fn(),
        removeListeners: jest.fn(),
      },
    },
  };
});

import { RemusBladeManager } from '../src/services/blade/RemusBladeManager';

const emitEvent = (event: string, payload: any) => {
  (emitterListeners[event] || []).forEach(cb => cb(payload));
};

describe('RemusBladeManager (TDD - Connection & Sync Refactor)', () => {
  let manager: RemusBladeManager;
  let mockBridge: any;

  beforeEach(async () => {
    jest.useFakeTimers();
    Object.keys(emitterListeners).forEach(key => delete emitterListeners[key]);
    mockBridge = NativeModules.RemusBladeBridge;
    jest.clearAllMocks();

    manager = new RemusBladeManager(mockBridge);
    await manager.initialize();
  });

  afterEach(() => {
    manager.destroy();
    jest.useRealTimers();
  });

  it('syncs blade assignments once when Remus Computer connects', async () => {
    // 1. Discover Computer and a Blade
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'detected',
    });
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'blade-1',
      deviceName: 'REMUS-BLD-0BACC631',
      state: 'detected',
    });
    await jest.advanceTimersByTimeAsync(100);

    // Set a placement for the discovered blade
    manager.setPlacement('blade:0bacc631', 'left_paddle');

    // 2. Computer transitions to connected
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'connected',
    });
    await jest.advanceTimersByTimeAsync(500);

    expect(mockBridge.sendCommand).toHaveBeenCalledWith(
      'computer-1',
      'BLADE_SLOT,L,0BACC631'
    );
    expect(mockBridge.sendCommand).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-trigger blade sync on subsequent telemetry snapshots while connected', async () => {
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'detected',
    });
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'blade-1',
      deviceName: 'REMUS-BLD-0BACC631',
      state: 'detected',
    });
    await jest.advanceTimersByTimeAsync(100);

    manager.setPlacement('blade:0bacc631', 'left_paddle');

    // Transition to connected
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'connected',
    });
    await jest.advanceTimersByTimeAsync(500);

    expect(mockBridge.sendCommand).toHaveBeenCalledTimes(1);

    // Now send 10 consecutive telemetry snapshots (simulating 1Hz telemetry streaming)
    for (let i = 0; i < 10; i++) {
      emitEvent('onRemusBladeSnapshot', {
        deviceId: 'computer-1',
        deviceName: 'REMUS-PC-01',
        rawCsv: `${10000 + i * 1000},0.012,-0.045,0.982,1.20,-0.40,0.15,-23.55,-46.63,8.5,6/10:32:3.2m,120,480,24.5`,
      });
      await jest.advanceTimersByTimeAsync(1000);
    }

    // Must still be 1 call! No spamming on snapshots!
    expect(mockBridge.sendCommand).toHaveBeenCalledTimes(1);
  });

  it('syncs again when computer disconnects and reconnects (new connection session)', async () => {
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'detected',
    });
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'blade-1',
      deviceName: 'REMUS-BLD-0BACC631',
      state: 'detected',
    });
    await jest.advanceTimersByTimeAsync(100);

    manager.setPlacement('blade:0bacc631', 'left_paddle');

    // Connect #1
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'connected',
    });
    await jest.advanceTimersByTimeAsync(500);
    expect(mockBridge.sendCommand).toHaveBeenCalledTimes(1);

    // Disconnect
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'disconnected',
    });
    await jest.advanceTimersByTimeAsync(500);

    // Reconnect #2
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'connected',
    });
    await jest.advanceTimersByTimeAsync(500);

    // Should have synced for the 2nd session
    expect(mockBridge.sendCommand).toHaveBeenCalledTimes(2);
  });

  it('filters out invalid or null (0) identity hashes from sync commands', async () => {
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'detected',
    });
    await jest.advanceTimersByTimeAsync(100);

    // Simulate roster with null hash (slot empty: 00000000)
    emitEvent('onRemusBladeSnapshot', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      rawCsv: 'BLADE_ROSTER,2,00000000:0:L,00000000:0:R',
    });
    await jest.advanceTimersByTimeAsync(100);

    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'connected',
    });
    await jest.advanceTimersByTimeAsync(500);

    // Should NOT have sent any BLADE_SLOT for 00000000
    expect(mockBridge.sendCommand).not.toHaveBeenCalledWith(
      'computer-1',
      expect.stringContaining('00000000')
    );
  });

  it('debounces rapid connection/assignment events into a single sync', async () => {
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'detected',
    });
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'blade-1',
      deviceName: 'REMUS-BLD-0BACC631',
      state: 'detected',
    });
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'blade-2',
      deviceName: 'REMUS-BLD-EE907E5A',
      state: 'detected',
    });
    await jest.advanceTimersByTimeAsync(100);

    manager.setPlacement('blade:0bacc631', 'left_paddle');
    manager.setPlacement('blade:ee907e5a', 'right_paddle');

    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'connected',
    });

    // Rapid event
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'connected',
    });

    // Before timer advances, no sendCommand called yet
    expect(mockBridge.sendCommand).toHaveBeenCalledTimes(0);

    // Advance debounce
    await jest.advanceTimersByTimeAsync(500);

    // Both blades synced in a single batch
    expect(mockBridge.sendCommand).toHaveBeenCalledWith(
      'computer-1',
      'BLADE_SLOT,L,0BACC631'
    );
    expect(mockBridge.sendCommand).toHaveBeenCalledWith(
      'computer-1',
      'BLADE_SLOT,R,EE907E5A'
    );
    expect(mockBridge.sendCommand).toHaveBeenCalledTimes(2);
  });

  it('defers syncBladeAssignments while workout capture is actively recording', async () => {
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'detected',
    });
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'blade-1',
      deviceName: 'REMUS-BLD-0BACC631',
      state: 'detected',
    });
    await jest.advanceTimersByTimeAsync(100);

    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'connected',
    });
    await jest.advanceTimersByTimeAsync(500);

    // Initial sync done
    expect(mockBridge.sendCommand).toHaveBeenCalledTimes(0);

    // Start workout
    await manager.startWorkoutCapture();

    // User changes placement DURING recording
    manager.setPlacement('blade:0bacc631', 'left_paddle');
    await jest.advanceTimersByTimeAsync(500);

    // Must NOT have sent command during active recording
    expect(mockBridge.sendCommand).not.toHaveBeenCalledWith(
      'computer-1',
      'BLADE_SLOT,L,0BACC631'
    );

    // Stop workout
    await manager.stopWorkoutCapture();
    await jest.advanceTimersByTimeAsync(500);

    // Now deferred sync executes
    expect(mockBridge.sendCommand).toHaveBeenCalledWith(
      'computer-1',
      'BLADE_SLOT,L,0BACC631'
    );
  });

  it('aggregates sensor data and resolves sensorPlacement for direct and relayed blades', async () => {
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'computer-1',
      deviceName: 'REMUS-PC-01',
      state: 'detected',
    });
    emitEvent('onRemusBladeStateChanged', {
      deviceId: 'blade-left',
      deviceName: 'REMUS-BLD-0BACC631',
      state: 'detected',
    });
    await jest.advanceTimersByTimeAsync(100);

    manager.setPlacement('blade:0bacc631', 'left_paddle');

    const received: Array<{ sample: any; placement?: string }> = [];
    const unsub = manager.onSensorData((sample, placement) => {
      received.push({ sample, placement });
    });

    const leftService = manager.getDevice('blade-left');
    expect(leftService).toBeDefined();

    const sampleDirect: any = {
      deviceId: 'blade-left',
      deviceFamily: 'remus_blade',
      rotationRateRadiansPerSecond: { x: 0, y: 0, z: 2.1 },
      nativeTimestamp: 1000,
    };

    // Emit on direct blade adapter
    ((leftService as any).adapter as any).sensorListeners.forEach((l: any) => l(sampleDirect));

    expect(received).toHaveLength(1);
    expect(received[0].placement).toBe('left_paddle');
    expect(received[0].sample).toBe(sampleDirect);

    // Now test relayed sample from computer
    const computerService = manager.getDevice('computer-1');
    expect(computerService).toBeDefined();

    // Roster assigns EE907E5A to right
    emitEvent('onRemusBladeSnapshot', {
      deviceId: 'computer-1',
      rawCsv: 'BLADE_ROSTER,2,0BACC631:0:L,EE907E5A:0:R',
    });
    await jest.advanceTimersByTimeAsync(100);

    const sampleRelayedRight: any = {
      deviceId: 'computer-1',
      deviceFamily: 'remus_blade',
      rotationRateRadiansPerSecond: { x: 0, y: 0, z: -2.0 },
      nativeTimestamp: 1020,
      sourcePayload: {
        sourceIdentityHash: 0xee907e5a,
      },
    };

    ((computerService as any).adapter as any).sensorListeners.forEach((l: any) => l(sampleRelayedRight));

    const bladeSamples = received.filter(r => r.placement !== 'hull');
    expect(bladeSamples).toHaveLength(2);
    expect(bladeSamples[0].placement).toBe('left_paddle');
    expect(bladeSamples[0].sample).toBe(sampleDirect);
    expect(bladeSamples[1].placement).toBe('right_paddle');
    expect(bladeSamples[1].sample).toBe(sampleRelayedRight);

    unsub();
    ((leftService as any).adapter as any).sensorListeners.forEach((l: any) => l(sampleDirect));
    expect(received.filter(r => r.placement !== 'hull')).toHaveLength(2);
  });
});


