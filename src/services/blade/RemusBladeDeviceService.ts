import { Buffer } from 'buffer';
import {
  CaptureSourceState,
  SourceReadinessSnapshot,
} from '../../application/capture/ActivityCapture';
import {
  PlacementProvenance,
  SensorPlacement,
  SourceDescriptor,
} from '../../contracts/acquisition/types';
import {
  BladeRosterEntry,
  RemusBladeAdapter,
  RemusBladeSnapshot,
  parseBladeIdentityHash,
} from './RemusBladeAdapter';
import { SensorSample, WearableConnectionState, WearableDevice } from '../../types/wearables';

export class RemusBladeDeviceService {
  private adapter: RemusBladeAdapter;
  private sourceState: CaptureSourceState;
  private latestSnapshot: RemusBladeSnapshot | null = null;
  private connectionState: WearableConnectionState = 'disconnected';
  private listeners: Set<(state: CaptureSourceState) => void> = new Set();
  private unsubSnapshot: (() => void) | null = null;
  private unsubDeviceState: (() => void) | null = null;
  private unsubSensorSample: (() => void) | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly WATCHDOG_TIMEOUT_MS = 3500;

  constructor(adapter?: RemusBladeAdapter) {
    if (!adapter) throw new Error('RemusBladeAdapter is required');
    this.adapter = adapter;
    this.sourceState = this.createDefaultSourceState();
  }

  private createDefaultSourceState(): CaptureSourceState {
    const isComputer = this.adapter.deviceFamily === 'remus_computer';
    const bladeIdentityHash = isComputer
      ? null
      : parseBladeIdentityHash(this.adapter.targetDeviceName);
    const sourceId = isComputer
      ? `computer:${this.adapter.targetDeviceId}`
      : bladeIdentityHash === null
        ? `blade:${this.adapter.targetDeviceId}`
        : `blade:${bladeIdentityHash.toString(16).padStart(8, '0')}`;
    const descriptor: SourceDescriptor = {
      sourceId,
      deviceFamily: this.adapter.deviceFamily,
      deviceModel: isComputer ? undefined : 'rbp1',
      deviceSerialNumber: this.adapter.targetDeviceName,
      operationalState: 'unavailable',
      sensorPlacement: isComputer ? 'hull' : 'paddle',
      placementProvenance: 'device_metadata',
      capabilities: {
        liveTransfer: true,
        volatileResend: !isComputer,
        standaloneCapture: isComputer,
        storeAndForward: isComputer,
        postSyncDeletion: false,
        relayCapture: isComputer,
      },
      clockDomains: [
        {
          clockDomainId: `${sourceId}:monotonic`,
          clockKind: 'monotonic',
          timestampUnit: 'us',
        },
        {
          clockDomainId: `${sourceId}:gnss`,
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

    if (typeof this.adapter.onSensorData === 'function') {
      this.unsubSensorSample = this.adapter.onSensorData(() => {
        if (this.connectionState === 'connected') {
          this.resetWatchdog();
        }
      });
    }

    this.unsubDeviceState = this.adapter.onDeviceStateChanged((device: WearableDevice) => {
      this.updateIdentityFromDevice(device);
      if (device.state === 'disconnected' || device.state === 'error') {
        this.handleDisconnection();
      } else if (device.state === 'detected') {
        this.connectionState = 'detected';
        this.markDetected();
      } else if (device.state === 'connected') {
        // A Blade does not stream until START. Keep telemetry evaluation
        // pending, but preserve the connected source so it receives a recording
        // identity before capture begins.
        this.connectionState = 'connected';
        this.latestSnapshot = null;
        this.clearWatchdog();
        this.sourceState = {
          ...this.sourceState,
          operationalState: 'available_idle',
          readiness: {
            sourceConnectionState: 'connected',
            availableMeasurementIdentifiers: [],
            liveTelemetryState: 'evaluation_pending',
          },
        };
        this.notifyListeners();
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
    if (this.connectionState !== 'connected') {
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

  setPlacement(placement: SensorPlacement): void {
    this.sourceState = {
      ...this.sourceState,
      sensorPlacement: placement,
      placementProvenance: 'user_declared',
    };
    this.notifyListeners();
  }

  configureBladeSlot(
    sourceIdentityHash: number,
    placement: 'left_paddle' | 'right_paddle',
  ): Promise<boolean> {
    return this.adapter.configureBladeSlot(sourceIdentityHash, placement);
  }

  calibrateBladeAlignment(): Promise<boolean> {
    return this.adapter.calibrateBladeAlignment();
  }

  onBladeRoster(listener: (entries: BladeRosterEntry[]) => void): () => void {
    return this.adapter.onBladeRoster(listener);
  }

  onSensorData(listener: (data: SensorSample) => void): () => void {
    if (typeof this.adapter.onSensorData === 'function') {
      return this.adapter.onSensorData(listener);
    }
    return () => {};
  }

  private updateIdentityFromDevice(device: WearableDevice): void {
    if (!device.id || device.id === 'remus-blade:p1') {
      return;
    }
    const isComputer = device.deviceFamily === 'remus_computer';
    const rawId = device.id.replace(/^(blade|computer):/, '');
    const bladeIdentityHash = isComputer ? null : parseBladeIdentityHash(device.name ?? '');
    const sourceId = isComputer
      ? `computer:${rawId}`
      : bladeIdentityHash === null
        ? `blade:${rawId}`
        : `blade:${bladeIdentityHash.toString(16).padStart(8, '0')}`;
    const sensorPlacement = isComputer
      ? 'hull'
      : this.sourceState.sensorPlacement === 'left_paddle' || this.sourceState.sensorPlacement === 'right_paddle'
        ? this.sourceState.sensorPlacement
        : 'paddle';
    const placementProvenance: PlacementProvenance = isComputer ? 'device_metadata' : this.sourceState.placementProvenance;

    this.sourceState = {
      ...this.sourceState,
      sourceId,
      deviceFamily: device.deviceFamily,
      sensorPlacement,
      placementProvenance,
      deviceSerialNumber: device.name ?? this.sourceState.deviceSerialNumber,
    };
  }

  destroy(): void {
    this.clearWatchdog();
    this.unsubSnapshot?.();
    this.unsubSnapshot = null;
    this.unsubSensorSample?.();
    this.unsubSensorSample = null;
    this.unsubDeviceState?.();
    this.unsubDeviceState = null;
    this.listeners.clear();
    this.adapter.destroy();
  }
}
