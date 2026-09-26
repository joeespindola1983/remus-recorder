import { NativeEventEmitter, NativeModules } from 'react-native';
import { RemusBladeDeviceService } from './RemusBladeDeviceService';
import {
  BladeRosterEntry,
  parseBladeIdentityHash,
  RemusBladeAdapter,
} from './RemusBladeAdapter';
import { CaptureSourceState } from '../../application/capture/ActivityCapture';
import { SensorPlacement } from '../../contracts/acquisition/types';
import { SensorSample } from '../../types/wearables';

export class RemusBladeManager {
  private nativeBridge: any;
  private eventEmitter: NativeEventEmitter | null = null;
  private devices: Map<string, RemusBladeDeviceService> = new Map();
  private initializingDeviceIds: Set<string> = new Set();
  private pendingStatePayloads: Map<string, any> = new Map();
  private listeners: Set<(sourceState: CaptureSourceState) => void> = new Set();
  private sensorDataListeners: Set<(sample: SensorSample, placement?: SensorPlacement) => void> = new Set();
  private deviceSensorSubscriptions: Map<string, () => void> = new Map();
  private stateSubscription: { remove(): void } | null = null;
  private bladeAssignments: Map<number, 'left_paddle' | 'right_paddle'> = new Map();
  private relaySources: Map<number, CaptureSourceState> = new Map();
  private syncInFlight: boolean = false;
  private lastKnownConnectionState: Map<string, string> = new Map();
  private syncedComputerSessionIds: Set<string> = new Set();
  private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSyncAfterWorkout: boolean = false;

  constructor(nativeBridge?: any) {
    this.nativeBridge = nativeBridge ?? NativeModules.RemusBladeBridge;
    if (this.nativeBridge) {
      this.eventEmitter = new NativeEventEmitter(this.nativeBridge);
    }
  }

  async initialize(): Promise<boolean> {
    if (!this.nativeBridge || !this.eventEmitter) {
      console.warn('[RemusBladeManager] NativeBridge or EventEmitter not available.');
      return false;
    }

    try {
      const supported = this.nativeBridge.isSupported ? await this.nativeBridge.isSupported() : true;
      if (!supported) {
        console.warn('[RemusBladeManager] NativeBridge is not supported.');
        return false;
      }
      
      console.log('[RemusBladeManager] Initialized. Listening for new devices...');

      this.stateSubscription = this.eventEmitter.addListener(
        'onRemusBladeStateChanged',
        (payload: any) => {
          const deviceId = payload?.deviceId;
          if (!deviceId) return;
          const deviceName = payload?.deviceName ?? 'Remus Blade';
          
          if (!this.devices.has(deviceId)) {
            console.log(`[RemusBladeManager] Discovered new device: ${deviceName} (${deviceId})`);
            const adapter = new RemusBladeAdapter(deviceId, deviceName, this.nativeBridge);
            const service = new RemusBladeDeviceService(adapter);
            this.devices.set(deviceId, service);
            this.initializingDeviceIds.add(deviceId);
            this.pendingStatePayloads.set(deviceId, payload);

            const unsubSensor = service.onSensorData(sample => {
              this.handleIncomingSensorData(service, sample);
            });
            this.deviceSensorSubscriptions.set(deviceId, unsubSensor);
            
            service.onStateChange(state => {
              this.listeners.forEach(l => l(state));
              if (state.deviceFamily === 'remus_computer') {
                const prev = this.lastKnownConnectionState.get(deviceId) ?? 'unavailable';
                const curr = state.readiness?.sourceConnectionState ?? 'unavailable';
                this.lastKnownConnectionState.set(deviceId, curr);

                if (curr === 'connected') {
                  if (prev !== 'connected' && !this.syncedComputerSessionIds.has(deviceId)) {
                    this.syncedComputerSessionIds.add(deviceId);
                    this.scheduleSyncBladeAssignments(service);
                  }
                } else {
                  this.syncedComputerSessionIds.delete(deviceId);
                  if (this.syncDebounceTimer) {
                    clearTimeout(this.syncDebounceTimer);
                    this.syncDebounceTimer = null;
                  }
                }
              }
            });
            if (adapter.deviceFamily === 'remus_computer') {
              service.onBladeRoster(entries => this.updateRelaySources(entries));
            }
            
            service.initialize()
              .then(() => {
                const latestPayload = this.pendingStatePayloads.get(deviceId) ?? payload;
                this.pendingStatePayloads.delete(deviceId);
                this.initializingDeviceIds.delete(deviceId);
                adapter.handleStatePayload(latestPayload);
              })
              .catch(err => {
                this.pendingStatePayloads.delete(deviceId);
                this.initializingDeviceIds.delete(deviceId);
                console.warn(`[RemusBladeManager] Failed to initialize device ${deviceId}:`, err);
              });
          } else if (this.initializingDeviceIds.has(deviceId)) {
            // Service discovery may progress from detected -> connecting ->
            // connected while the per-device adapter is still subscribing.
            // Replay only the newest state once initialization completes.
            this.pendingStatePayloads.set(deviceId, payload);
          }
        }
      );

      // Start a scan if the bridge provides it
      if (this.nativeBridge.startScan) {
        this.nativeBridge.startScan();
      }

      return true;
    } catch (err) {
      console.error('[RemusBladeManager] Error during initialization:', err);
      return false;
    }
  }

  getDevice(deviceId: string): RemusBladeDeviceService | undefined {
    return this.devices.get(deviceId);
  }

  getAllDevices(): RemusBladeDeviceService[] {
    return Array.from(this.devices.values());
  }

  onStateChange(listener: (state: CaptureSourceState) => void): () => void {
    this.listeners.add(listener);
    // Emit initial state for already discovered devices
    this.devices.forEach(device => {
      listener(device.getSourceState());
    });
    this.relaySources.forEach(source => listener(source));
    return () => this.listeners.delete(listener);
  }

  onSensorData(
    listener: (sample: SensorSample, placement?: SensorPlacement) => void,
  ): () => void {
    this.sensorDataListeners.add(listener);
    return () => {
      this.sensorDataListeners.delete(listener);
    };
  }

  private handleIncomingSensorData(
    service: RemusBladeDeviceService,
    sample: SensorSample,
  ): void {
    if (this.sensorDataListeners.size === 0) return;

    let placement: SensorPlacement = 'unknown';
    const sourceIdentityHash = sample.sourcePayload?.sourceIdentityHash;
    if (typeof sourceIdentityHash === 'number' && Number.isSafeInteger(sourceIdentityHash)) {
      placement =
        this.bladeAssignments.get(sourceIdentityHash) ??
        this.relaySources.get(sourceIdentityHash)?.sensorPlacement ??
        'unknown';
    } else {
      placement = service.getSourceState().sensorPlacement;
    }

    this.sensorDataListeners.forEach(l => l(sample, placement));
  }

  destroy(): void {
    console.log('[RemusBladeManager] Destroying manager and all device services.');
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
      this.syncDebounceTimer = null;
    }
    this.syncedComputerSessionIds.clear();
    this.lastKnownConnectionState.clear();
    this.stateSubscription?.remove();
    this.deviceSensorSubscriptions.forEach(unsub => unsub());
    this.deviceSensorSubscriptions.clear();
    this.sensorDataListeners.clear();
    this.devices.forEach(d => d.destroy());
    this.devices.clear();
    this.initializingDeviceIds.clear();
    this.pendingStatePayloads.clear();
    this.listeners.clear();
    this.relaySources.clear();
  }

  // Facade methods for App.tsx compatibility

  getLatestSnapshot(): any {
    // Stroke rate is authoritative only from Remus Computer. Blade v1 sends
    // raw IMU for later analysis and must never drive the live SPM card.
    for (const device of this.devices.values()) {
      if (device.getSourceState().deviceFamily !== 'remus_computer') continue;
      const snap = device.getLatestSnapshot();
      if (snap) return snap;
    }
    return null;
  }

  getConnectionState(): string {
    // If any device is connected, return connected
    for (const device of this.devices.values()) {
      if (device.getConnectionState() === 'connected') return 'connected';
    }
    for (const device of this.devices.values()) {
      if (device.getConnectionState() === 'connecting') return 'connecting';
    }
    return 'disconnected';
  }

  async startWorkoutCapture(): Promise<boolean> {
    console.log('[RemusBladeManager] Starting capture with Computer relay preference...');
    const connected = Array.from(this.devices.values())
      .filter(device => device.getConnectionState() === 'connected');
    const computers = connected.filter(
      device => device.getSourceState().deviceFamily === 'remus_computer',
    );
    const targets = computers.length > 0 ? computers : connected;
    const results = await Promise.all(
      targets.map(d => d.startWorkoutCapture())
    );
    return results.some(r => r);
  }

  async stopWorkoutCapture(): Promise<boolean> {
    console.log('[RemusBladeManager] Stopping active Remus capture sources...');
    const capturing = Array.from(this.devices.values()).filter(
      device => device.getSourceState().recordingState === 'recording',
    );
    const results = await Promise.all(
      capturing.map(d => d.stopWorkoutCapture())
    );
    if (this.pendingSyncAfterWorkout) {
      this.pendingSyncAfterWorkout = false;
      this.scheduleSyncBladeAssignments();
    }
    return results.some(r => r);
  }

  async connect(sourceId?: string): Promise<boolean> {
    if (sourceId?.startsWith('blade:')) {
      const identityHash = Number.parseInt(sourceId.substring('blade:'.length), 16);
      if (this.relaySources.has(identityHash)) {
        const computers = Array.from(this.devices.values()).filter(
          device => device.getSourceState().deviceFamily === 'remus_computer'
        );
        // If the computer is already connected, we are done — the blade is reachable
        // through it and syncBladeAssignments was already fired by onStateChange.
        // If not yet connected, kick off the BLE connection. The onStateChange
        // listener will fire syncBladeAssignments once the computer is actually up.
        let anyConnected = false;
        for (const computer of computers) {
          if (computer.getConnectionState() === 'connected') {
            anyConnected = true;
          } else {
            const ok = await computer.connect();
            if (ok) anyConnected = true;
          }
        }
        return anyConnected;
      }
    }

    const devices = Array.from(this.devices.values());
    if (sourceId) {
      const target = devices.find(device => device.getSourceState().sourceId === sourceId);
      return target ? target.connect() : false;
    }
    const computers = devices.filter(
      device => device.getSourceState().deviceFamily === 'remus_computer',
    );
    const targets = computers.length > 0 ? computers : devices;
    const results = await Promise.all(
      targets.map(d => d.connect())
    );
    return results.some(r => r);
  }

  async disconnect(): Promise<void> {
    await Promise.all(
      Array.from(this.devices.values()).map(d => d.disconnect())
    );
  }

  async calibrateBladeAlignment(): Promise<boolean> {
    for (const device of this.devices.values()) {
      if (device.getSourceState().deviceFamily === 'remus_computer' &&
          device.getConnectionState() === 'connected') {
        return device.calibrateBladeAlignment();
      }
    }
    return false;
  }

  setPlacement(sourceId: string, placement: SensorPlacement): void {
    if (sourceId.startsWith('blade:') &&
        (placement === 'left_paddle' || placement === 'right_paddle')) {
      const identityText = sourceId.substring('blade:'.length);
      const identityHash = /^[0-9a-f]{8}$/i.test(identityText)
        ? Number.parseInt(identityText, 16)
        : Number.NaN;
      if (Number.isSafeInteger(identityHash) && identityHash > 0 && this.relaySources.has(identityHash)) {
        this.rememberBladeAssignment(identityHash, placement);
        const source = this.relaySources.get(identityHash);
        if (source) {
          const updated: CaptureSourceState = {
            ...source,
            sensorPlacement: placement,
            placementProvenance: 'user_declared',
          };
          this.relaySources.set(identityHash, updated);
          this.listeners.forEach(listener => listener(updated));
        }
        this.scheduleSyncBladeAssignments();
        return;
      }
    }
    for (const device of this.devices.values()) {
      if (device.getSourceState().sourceId === sourceId) {
        device.setPlacement(placement);
        if (placement === 'left_paddle' || placement === 'right_paddle') {
          const identityHash = parseBladeIdentityHash(
            device.getSourceState().deviceSerialNumber ?? '',
          );
          if (identityHash !== null) {
            this.rememberBladeAssignment(identityHash, placement);
            this.scheduleSyncBladeAssignments();
          }
        }
        return;
      }
    }
  }

  private rememberBladeAssignment(
    identityHash: number,
    placement: 'left_paddle' | 'right_paddle',
  ): void {
    // Never store null/zero hashes — they represent unidentified slots in BLADE_ROSTER
    if (!Number.isSafeInteger(identityHash) || identityHash <= 0) return;
    for (const [otherHash, otherPlacement] of this.bladeAssignments) {
      if (otherHash !== identityHash && otherPlacement === placement) {
        this.bladeAssignments.delete(otherHash);
      }
    }
    this.bladeAssignments.set(identityHash, placement);
  }


  private updateRelaySources(entries: BladeRosterEntry[]): void {
    const present = new Set<number>();
    for (const entry of entries) {
      present.add(entry.sourceIdentityHash);
      if (entry.assignedSide) {
        this.rememberBladeAssignment(entry.sourceIdentityHash, entry.assignedSide);
      }
      const placement = this.bladeAssignments.get(entry.sourceIdentityHash) ?? 'paddle';
      const hash = entry.sourceIdentityHash.toString(16).padStart(8, '0');
      const sourceId = `blade:${hash}`;
      const source: CaptureSourceState = {
        sourceId,
        deviceFamily: 'remus_blade',
        deviceModel: 'rbp1',
        deviceSerialNumber: `REMUS-BLD-${hash.toUpperCase()}`,
        operationalState: entry.connected ? 'available_idle' : 'unavailable',
        sensorPlacement: placement,
        placementProvenance: placement === 'paddle' ? 'device_metadata' : 'user_declared',
        capabilities: {
          liveTransfer: true,
          volatileResend: true,
          standaloneCapture: false,
          storeAndForward: false,
          postSyncDeletion: false,
          relayCapture: true,
        },
        clockDomains: [{
          clockDomainId: `${sourceId}:monotonic`,
          clockKind: 'monotonic',
          timestampUnit: 'us',
        }],
        required: false,
        coverageSegments: [],
        readiness: {
          sourceConnectionState: entry.connected ? 'connected' : 'detected',
          availableMeasurementIdentifiers: entry.connected
            ? ['accelerationIncludingGravityG', 'rotationRateRadiansPerSecond']
            : [],
          liveTelemetryState: entry.connected ? 'evaluation_pending' : 'unavailable',
        },
      };
      this.relaySources.set(entry.sourceIdentityHash, source);
      this.listeners.forEach(listener => listener(source));
    }
    for (const [identityHash, source] of this.relaySources) {
      if (present.has(identityHash)) continue;
      const unavailable: CaptureSourceState = {
        ...source,
        operationalState: 'unavailable',
        readiness: {
          sourceConnectionState: 'unavailable',
          availableMeasurementIdentifiers: [],
          liveTelemetryState: 'unavailable',
        },
      };
      this.relaySources.set(identityHash, unavailable);
      this.listeners.forEach(listener => listener(unavailable));
    }
  }

  private isWorkoutCaptureActive(): boolean {
    return Array.from(this.devices.values()).some(
      d => d.getSourceState().recordingState === 'recording'
    );
  }

  private scheduleSyncBladeAssignments(target?: RemusBladeDeviceService): void {
    if (this.isWorkoutCaptureActive()) {
      this.pendingSyncAfterWorkout = true;
      return;
    }
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
    }
    this.syncDebounceTimer = setTimeout(() => {
      this.syncDebounceTimer = null;
      this.syncBladeAssignments(target).catch(() => {});
    }, 300);
  }

  private async syncBladeAssignments(target?: RemusBladeDeviceService): Promise<void> {
    if (this.syncInFlight) {
      console.log('[RemusBladeManager] syncBladeAssignments already in flight, skipping.');
      return;
    }
    this.syncInFlight = true;
    try {
      const candidates = target ? [target] : Array.from(this.devices.values());
      const computers = candidates.filter(device =>
        device.getSourceState().deviceFamily === 'remus_computer' &&
        device.getConnectionState() === 'connected'
      );
      for (const computer of computers) {
        for (const [identityHash, placement] of this.bladeAssignments) {
          // Skip null/zero hashes that arrive from unidentified slots in BLADE_ROSTER
          if (!Number.isSafeInteger(identityHash) || identityHash <= 0) continue;
          await computer.configureBladeSlot(identityHash, placement);
        }
      }
    } finally {
      this.syncInFlight = false;
    }
  }


  async downloadSessionFile(onProgress?: any): Promise<any> {
    // Download from the first connected device for now, or ideally from all.
    // For App.tsx compatibility, we'll try to find one device that is connected.
    for (const device of this.devices.values()) {
      if (device.getConnectionState() === 'connected') {
        try {
          return await device.downloadSessionFile(onProgress);
        } catch (err) {
          console.warn(`[RemusBladeManager] Download failed for device`, err);
        }
      }
    }
    return null;
  }
}
