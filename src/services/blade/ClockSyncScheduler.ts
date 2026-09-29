export interface ClockSyncSchedulerOptions {
  tickIntervalMs?: number;
  initialBurstCount?: number;
  periodicSyncIntervalMs?: number;
  maxInFlightTimeoutMs?: number;
}

export class ClockSyncScheduler {
  private readonly tickIntervalMs: number;
  private readonly initialBurstCount: number;
  private readonly periodicSyncIntervalMs: number;
  private readonly maxInFlightTimeoutMs: number;

  private readonly registeredDevices = new Map<string, () => Promise<boolean>>();
  private readonly inFlight = new Set<string>();
  private readonly burstRemaining = new Map<string, number>();
  private readonly lastSyncAtMs = new Map<string, number>();

  private deviceOrder: string[] = [];
  private rrIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: ClockSyncSchedulerOptions) {
    this.tickIntervalMs = options?.tickIntervalMs ?? 250;
    this.initialBurstCount = options?.initialBurstCount ?? 6;
    this.periodicSyncIntervalMs = options?.periodicSyncIntervalMs ?? 10_000;
    this.maxInFlightTimeoutMs = options?.maxInFlightTimeoutMs ?? 1_000;

    this.timer = setInterval(() => {
      this.tick();
    }, this.tickIntervalMs);
  }

  registerDevice(deviceId: string, requestFn: () => Promise<boolean>): void {
    this.registeredDevices.set(deviceId, requestFn);
    if (!this.deviceOrder.includes(deviceId)) {
      this.deviceOrder.push(deviceId);
    }
  }

  unregisterDevice(deviceId: string): void {
    this.registeredDevices.delete(deviceId);
    this.inFlight.delete(deviceId);
    this.burstRemaining.delete(deviceId);
    this.lastSyncAtMs.delete(deviceId);
    this.deviceOrder = this.deviceOrder.filter(id => id !== deviceId);
  }

  queueBurst(deviceId: string, count?: number): void {
    this.burstRemaining.set(deviceId, count ?? this.initialBurstCount);
  }

  private tick(): void {
    if (this.deviceOrder.length === 0) return;

    const now = Date.now();
    const count = this.deviceOrder.length;

    for (let i = 0; i < count; i++) {
      const deviceId = this.deviceOrder[this.rrIndex % count];
      this.rrIndex = (this.rrIndex + 1) % count;

      if (this.inFlight.has(deviceId)) {
        continue;
      }

      const requestFn = this.registeredDevices.get(deviceId);
      if (!requestFn) {
        continue;
      }

      const burstsLeft = this.burstRemaining.get(deviceId) ?? 0;
      const lastSync = this.lastSyncAtMs.get(deviceId) ?? 0;
      const needsSync = burstsLeft > 0 || now - lastSync >= this.periodicSyncIntervalMs;

      if (needsSync) {
        this.inFlight.add(deviceId);
        this.lastSyncAtMs.set(deviceId, now);
        if (burstsLeft > 0) {
          this.burstRemaining.set(deviceId, burstsLeft - 1);
        }

        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            this.inFlight.delete(deviceId);
          }
        };

        const timeout = setTimeout(done, this.maxInFlightTimeoutMs);

        requestFn()
          .catch(() => false)
          .finally(() => {
            clearTimeout(timeout);
            done();
          });

        break;
      }
    }
  }

  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.registeredDevices.clear();
    this.inFlight.clear();
    this.burstRemaining.clear();
    this.lastSyncAtMs.clear();
    this.deviceOrder = [];
  }
}
