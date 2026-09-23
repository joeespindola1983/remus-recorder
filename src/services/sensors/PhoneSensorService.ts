import {
  PositionCoordinates,
  SensorSample,
  Vector3,
} from '../../types/wearables';

export interface StartOptions {
  mockLocation?: PositionCoordinates;
  intervalMs?: number;
}

export class PhoneSensorService {
  private listeners: Set<(sample: SensorSample) => void> = new Set();
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private currentLocation: PositionCoordinates | null = null;
  private currentMotion: Vector3 | null = null;

  start(options?: StartOptions): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (options?.mockLocation) {
      this.currentLocation = options.mockLocation;
      this.emitCurrentSample();
    }

    const interval = options?.intervalMs || 1000;
    this.timer = setInterval(() => {
      this.emitCurrentSample();
    }, interval);
  }

  emitMotionSample(accelerationIncludingGravityG: Vector3): void {
    this.currentMotion = accelerationIncludingGravityG;
    this.emitCurrentSample();
  }

  updateLocation(loc: PositionCoordinates): void {
    this.currentLocation = loc;
    this.emitCurrentSample();
  }

  private emitCurrentSample(): void {
    if (!this.isRunning) return;

    const sample: SensorSample = {
      nativeTimestamp: Date.now(),
      deviceId: 'local-phone',
      deviceFamily: 'phone',
      location: this.currentLocation || undefined,
      accelerationIncludingGravityG: this.currentMotion || undefined,
    };

    this.listeners.forEach(listener => listener(sample));
  }

  onSample(listener: (sample: SensorSample) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
