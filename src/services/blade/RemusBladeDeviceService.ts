import { Buffer } from 'buffer';
import {
  CaptureSourceState,
  SourceReadinessSnapshot,
} from '../../application/capture/ActivityCapture';
import {
  SourceDescriptor,
} from '../../contracts/acquisition/types';
import {
  RemusBladeAdapter,
  RemusBladeSnapshot,
} from './RemusBladeAdapter';
import { WearableConnectionState, WearableDevice } from '../../types/wearables';

export class RemusBladeDeviceService {
  private adapter: RemusBladeAdapter;
  private sourceState: CaptureSourceState;
  private latestSnapshot: RemusBladeSnapshot | null = null;
  private connectionState: WearableConnectionState = 'disconnected';
  private listeners: Set<(state: CaptureSourceState) => void> = new Set();
  private unsubSnapshot: (() => void) | null = null;
  private unsubDeviceState: (() => void) | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly WATCHDOG_TIMEOUT_MS = 3500;

  constructor(adapter?: RemusBladeAdapter) {
    this.adapter = adapter || new RemusBladeAdapter();
    this.sourceState = this.createDefaultSourceState();
  }

  private createDefaultSourceState(): CaptureSourceState {
    const sourceId = 'rbp1:primary';
    const descriptor: SourceDescriptor = {
      sourceId,
      deviceFamily: 'remus_blade',
      deviceModel: 'rbp1',
      deviceSerialNumber: 'ESP32C3-RBP1-DEMO',
      hardwareRevision: 'p1_rev1',
      firmwareVersion: '0.1.0',
      operationalState: 'unavailable',
      sensorPlacement: 'paddle',
      placementProvenance: 'device_metadata',
      capabilities: {
        liveTransfer: true,
        volatileResend: true,
        standaloneCapture: true,
        storeAndForward: true,
        postSyncDeletion: false,
        relayCapture: false,
      },
      clockDomains: [
        {
          clockDomainId: 'rbp1:monotonic',
          clockKind: 'monotonic',
          timestampUnit: 'us',
        },
        {
          clockDomainId: 'rbp1:gnss',
          clockKind: 'utc',
          timestampUnit: 'us',
        },
      ],
    };

    const readiness: SourceReadinessSnapshot = {
      sourceConnectionState: 'unavailable',
      availableMeasurementIdentifiers: [],
      liveTelemetryState: 'unavailable',
    };

    return {
      ...descriptor,
      required: false,
      coverageSegments: [],
      readiness,
    };
  }

  async initialize(): Promise<boolean> {
    this.unsubSnapshot = this.adapter.onSnapshot(snapshot => {
      this.handleSnapshot(snapshot);
    });

    this.unsubDeviceState = this.adapter.onDeviceStateChanged((device: WearableDevice) => {
      if (device.state === 'disconnected' || device.state === 'error') {
        this.handleDisconnection();
      } else if (device.state === 'detected') {
        this.connectionState = 'detected';
        this.markDetected();
      } else if (device.state === 'connected') {
        // BLE service discovery is not sufficient evidence of a live data source.
        // A valid snapshot promotes the source to connected in handleSnapshot().
        this.connectionState = 'connecting';
        this.markDetected();
      } else if (device.state === 'connecting') {
        this.connectionState = 'connecting';
        this.markDetected();
      } else {
        this.notifyListeners();
      }
    });

    const ok = await this.adapter.initialize();
    if (!ok) {
      this.handleDisconnection();
    }

    return ok;
  }

  private markDetected(): void {
    this.latestSnapshot = null;
    this.clearWatchdog();
    this.sourceState = {
      ...this.sourceState,
      operationalState: 'unavailable',
      readiness: {
        sourceConnectionState: 'detected',
        availableMeasurementIdentifiers: [],
        liveTelemetryState: 'evaluation_pending',
      },
    };
    this.notifyListeners();
  }

  private resetWatchdog(): void {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      if (this.connectionState === 'connected') {
        this.handleDisconnection();
      }
    }, this.WATCHDOG_TIMEOUT_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private handleDisconnection(): void {
    this.connectionState = 'disconnected';
    this.latestSnapshot = null;
    this.clearWatchdog();
    this.sourceState = {
      ...this.sourceState,
      operationalState: 'unavailable',
      readiness: {
        sourceConnectionState: 'unavailable',
        batteryLevelPercent: this.sourceState.readiness?.batteryLevelPercent,
        horizontalAccuracyMeters: undefined,
        availableMeasurementIdentifiers: [],
        liveTelemetryState: 'unavailable',
      },
    };
    this.notifyListeners();
  }

  private handleSnapshot(snapshot: RemusBladeSnapshot): void {
    this.latestSnapshot = snapshot;
    this.connectionState = 'connected';
    this.resetWatchdog();

    const hasGpsFix = snapshot.satsInUse >= 4 && snapshot.location !== undefined;

    const readiness: SourceReadinessSnapshot = {
      sourceConnectionState: 'connected',
      batteryLevelPercent: this.sourceState.readiness?.batteryLevelPercent,
      horizontalAccuracyMeters: snapshot.horizontalAccuracyMeters,
      availableMeasurementIdentifiers: hasGpsFix
        ? [
            'accelerationIncludingGravityG',
            'rotationRateRadiansPerSecond',
            'strokeRateSpm',
            'positionWgs84',
            'horizontalAccuracyMeters',
          ]
        : [
            'accelerationIncludingGravityG',
            'rotationRateRadiansPerSecond',
            'strokeRateSpm',
          ],
      liveTelemetryState: 'qualified',
    };

    this.sourceState = {
      ...this.sourceState,
      operationalState: this.sourceState.operationalState === 'capturing' ? 'capturing' : 'available_idle',
      readiness,
    };

    this.notifyListeners();
  }

  getSourceState(): CaptureSourceState {
    return this.sourceState;
  }

  getLatestSnapshot(): RemusBladeSnapshot | null {
    return this.latestSnapshot;
  }

  getConnectionState(): WearableConnectionState {
    return this.connectionState;
  }

  async startWorkoutCapture(): Promise<boolean> {
    if (this.connectionState !== 'connected' || !this.latestSnapshot) {
      this.handleDisconnection();
      return false;
    }
    const accepted = await this.adapter.sendStart();
    if (!accepted) return false;
    this.sourceState = {
      ...this.sourceState,
      operationalState: 'capturing',
      recordingState: 'recording',
    };
    this.notifyListeners();
    return true;
  }

  async stopWorkoutCapture(): Promise<boolean> {
    if (this.connectionState !== 'connected') return false;
    const accepted = await this.adapter.sendStop();
    if (!accepted) return false;
    this.sourceState = {
      ...this.sourceState,
      operationalState: 'available_idle',
      recordingState: 'finalized',
    };
    this.notifyListeners();
    return true;
  }

  async disconnect(): Promise<void> {
    await this.adapter.disconnect();
    this.handleDisconnection();
  }

  async connect(): Promise<boolean> {
    this.connectionState = 'connecting';
    this.markDetected();
    return this.adapter.connect();
  }

  async downloadSessionFile(
    arg1?: string | ((progress: number, received: number, total: number) => void),
    arg2?: string | ((progress: number, received: number, total: number) => void)
  ): Promise<{ filename: string; data: Buffer }> {
    return this.adapter.downloadSessionFile(arg1, arg2);
  }

  onStateChange(listener: (state: CaptureSourceState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.sourceState));
  }

  destroy(): void {
    this.clearWatchdog();
    this.unsubSnapshot?.();
    this.unsubSnapshot = null;
    this.unsubDeviceState?.();
    this.unsubDeviceState = null;
    this.listeners.clear();
    this.adapter.destroy();
  }
}
