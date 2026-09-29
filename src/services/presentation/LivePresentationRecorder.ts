import {
  LiveMetricPresentation,
  PresentationAvailabilityReason,
  PresentationAvailabilityState,
} from '../recording/RecordingService';

export interface LivePresentationRecorderOptions {
  surfaceId?: string;
  presentationPolicyVersion?: string;
  algorithmVersion?: string;
  paceCutoffMetersPerSecond?: number;
  paceStalenessThresholdMs?: number;
  maxSpeedAccuracyMetersPerSecond?: number;
  spmTimeoutThresholdMs?: number;
  formatPaceFn?: (seconds?: number) => string;
  onPresentation: (presentation: LiveMetricPresentation) => void | Promise<void>;
}

interface LastEmittedRecord {
  contentKey: string;
  lastEmittedEpochMs: number;
}

export class LivePresentationRecorder {
  private readonly surfaceId: string;
  private readonly presentationPolicyVersion: string;
  private readonly algorithmVersion: string;
  private readonly paceCutoffMetersPerSecond: number;
  private readonly paceStalenessThresholdMs: number;
  private readonly maxSpeedAccuracyMetersPerSecond: number;
  private readonly spmTimeoutThresholdMs: number;
  private readonly formatPace: (seconds?: number) => string;
  private readonly onPresentation: (presentation: LiveMetricPresentation) => void | Promise<void>;

  private presentationSeq = 1;
  private readonly lastEmitted = new Map<string, LastEmittedRecord>();

  // SPM state tracking
  private lastSpmUpdateAt = 0;
  private lastSpmSourceId?: string;
  private lastSpmRecordingId?: string;
  private lastSupportedSpmValue: number | null = null;
  private lastSupportedSpmNativeTimestamp: number | null = null;
  private lastSpmClockDomainId?: string;
  private lastSpmAvailabilityState?: PresentationAvailabilityState;

  constructor(options: LivePresentationRecorderOptions) {
    this.surfaceId = options.surfaceId ?? 'surface:phone:active-screen';
    this.presentationPolicyVersion = options.presentationPolicyVersion ?? '1.1.0';
    this.algorithmVersion = options.algorithmVersion ?? '1.0.0';
    this.paceCutoffMetersPerSecond = options.paceCutoffMetersPerSecond ?? 0.8;
    this.paceStalenessThresholdMs = options.paceStalenessThresholdMs ?? 3500;
    this.maxSpeedAccuracyMetersPerSecond = options.maxSpeedAccuracyMetersPerSecond ?? 2.5;
    this.spmTimeoutThresholdMs = options.spmTimeoutThresholdMs ?? 3500;
    this.formatPace = options.formatPaceFn ?? (s => (s === undefined ? '—' : `${s}`));
    this.onPresentation = options.onPresentation;
  }

  private nextPresentationId(metricIdentifier: string): string {
    const id = `presentation:${this.surfaceId}:${metricIdentifier}:${this.presentationSeq}`;
    this.presentationSeq += 1;
    return id;
  }

  private emitIfChangedOrCheckpoint(
    presentation: LiveMetricPresentation,
    nowEpochMs: number,
  ): LiveMetricPresentation {
    const metric = presentation.metricIdentifier;
    const contentKey = [
      presentation.metricIdentifier,
      presentation.surfaceId,
      presentation.availabilityState,
      presentation.availabilityReason ?? '',
      presentation.numericValue !== null ? presentation.numericValue.toFixed(4) : 'null',
      presentation.renderedText,
      presentation.sourceId,
    ].join('|');

    const last = this.lastEmitted.get(metric);
    if (!last || last.contentKey !== contentKey) {
      this.lastEmitted.set(metric, { contentKey, lastEmittedEpochMs: nowEpochMs });
      this.onPresentation(presentation);
      return presentation;
    }

    if (nowEpochMs - last.lastEmittedEpochMs >= 1000) {
      this.lastEmitted.set(metric, { contentKey, lastEmittedEpochMs: nowEpochMs });
      this.onPresentation(presentation);
      return presentation;
    }

    return presentation;
  }

  updatePace(params: {
    groundSpeedMetersPerSecond?: number | null;
    locationSourceTimeEpochMs?: number;
    speedAccuracyMetersPerSecond?: number;
    locationFreshnessMs?: number;
    nowEpochMs?: number;
    sourceId?: string;
    recordingId?: string;
    supportedAtNativeTimestamp?: number;
    clockDomainId?: string;
  }): LiveMetricPresentation {
    const now = params.nowEpochMs ?? Date.now();
    const sourceId = params.sourceId ?? 'phone:primary';

    let availabilityState: PresentationAvailabilityState = 'unavailable';
    let availabilityReason: PresentationAvailabilityReason = 'source_unavailable';
    let numericValue: number | null = null;
    let renderedText = '—';
    let supportedAt = params.locationSourceTimeEpochMs;

    const speed = params.groundSpeedMetersPerSecond;

    if (speed === undefined || speed === null) {
      availabilityState = 'unavailable';
      availabilityReason = 'source_unavailable';
      numericValue = null;
      renderedText = '—';
    } else if (
      params.locationSourceTimeEpochMs !== undefined &&
      now - params.locationSourceTimeEpochMs > this.paceStalenessThresholdMs
    ) {
      availabilityState = 'unavailable';
      availabilityReason = 'stale_location';
      numericValue = null;
      renderedText = '—';
    } else if (
      params.speedAccuracyMetersPerSecond !== undefined &&
      (params.speedAccuracyMetersPerSecond > this.maxSpeedAccuracyMetersPerSecond ||
        params.speedAccuracyMetersPerSecond > speed)
    ) {
      availabilityState = 'unavailable';
      availabilityReason = 'poor_speed_accuracy';
      numericValue = null;
      renderedText = '—';
    } else if (speed < this.paceCutoffMetersPerSecond) {
      availabilityState = 'unavailable';
      availabilityReason = 'below_movement_threshold';
      numericValue = null;
      renderedText = '—';
    } else {
      availabilityState = 'available';
      availabilityReason = 'available';
      numericValue = 500 / speed;
      renderedText = this.formatPace(numericValue);
      supportedAt = params.locationSourceTimeEpochMs;
    }

    const presentation: LiveMetricPresentation = {
      presentationId: this.nextPresentationId('paceSecondsPer500Meters'),
      surfaceId: this.surfaceId,
      metricIdentifier: 'paceSecondsPer500Meters',
      numericValue,
      canonicalUnit: 's/500m',
      renderedText,
      availabilityState,
      availabilityReason,
      sourceId,
      recordingId: params.recordingId,
      ...(supportedAt !== undefined ? {supportedAtEpochMilliseconds: supportedAt} : {}),
      ...(params.supportedAtNativeTimestamp !== undefined
        ? {supportedAtNativeTimestamp: params.supportedAtNativeTimestamp}
        : {}),
      ...(params.clockDomainId ? {clockDomainId: params.clockDomainId} : {}),
      presentedAtEpochMilliseconds: now,
      algorithmVersion: this.algorithmVersion,
      presentationPolicyVersion: this.presentationPolicyVersion,
    };

    return this.emitIfChangedOrCheckpoint(presentation, now);
  }

  updateSpm(params: {
    sourceId?: string;
    liveSpm?: number | null;
    availabilityState?: PresentationAvailabilityState;
    availabilityReason?: PresentationAvailabilityReason | string;
    supportedAtNativeTimestamp?: number;
    clockDomainId?: string;
    nowEpochMs?: number;
    recordingId?: string;
  }): LiveMetricPresentation | null {
    if (!params.sourceId) {
      return null;
    }
    const sourceId = params.sourceId;
    const now = params.nowEpochMs ?? Date.now();
    this.lastSpmUpdateAt = now;
    this.lastSpmSourceId = sourceId;
    this.lastSpmRecordingId = params.recordingId;
    if (params.clockDomainId !== undefined) {
      this.lastSpmClockDomainId = params.clockDomainId;
    }

    const rawSpm = params.liveSpm;
    let availabilityState: PresentationAvailabilityState =
      params.availabilityState ??
      (rawSpm !== undefined && rawSpm !== null && rawSpm > 0 ? 'available' : 'unavailable');
    let availabilityReason: PresentationAvailabilityReason | string =
      params.availabilityReason ??
      (availabilityState === 'available' ? 'available' : 'source_unavailable');

    let numericValue: number | null = null;
    let renderedText = '—';
    let supportedAtNativeTimestamp = params.supportedAtNativeTimestamp;

    if (availabilityState === 'available') {
      numericValue = rawSpm ?? null;
      renderedText = numericValue !== null ? String(Math.round(numericValue)) : '—';
      this.lastSupportedSpmValue = numericValue;
      this.lastSupportedSpmNativeTimestamp = supportedAtNativeTimestamp ?? null;
    } else if (availabilityState === 'held') {
      numericValue = rawSpm ?? this.lastSupportedSpmValue;
      renderedText = numericValue !== null ? String(Math.round(numericValue)) : '—';
      supportedAtNativeTimestamp =
        params.supportedAtNativeTimestamp ?? this.lastSupportedSpmNativeTimestamp ?? undefined;
    } else {
      numericValue = null;
      renderedText = '—';
    }

    this.lastSpmAvailabilityState = availabilityState;

    const presentation: LiveMetricPresentation = {
      presentationId: this.nextPresentationId('strokeRateSpm'),
      surfaceId: this.surfaceId,
      metricIdentifier: 'strokeRateSpm',
      numericValue,
      canonicalUnit: 'strokes/min',
      renderedText,
      availabilityState,
      availabilityReason,
      sourceId: params.sourceId,
      recordingId: params.recordingId,
      supportedAtNativeTimestamp,
      clockDomainId: params.clockDomainId ?? this.lastSpmClockDomainId,
      presentedAtEpochMilliseconds: now,
      algorithmVersion: this.algorithmVersion,
      presentationPolicyVersion: this.presentationPolicyVersion,
    };

    return this.emitIfChangedOrCheckpoint(presentation, now);
  }

  checkHeartbeat(nowEpochMs?: number): void {
    const now = nowEpochMs ?? Date.now();

    // Check SPM timeout
    if (
      this.lastSpmUpdateAt > 0 &&
      this.lastSpmSourceId &&
      now - this.lastSpmUpdateAt > this.spmTimeoutThresholdMs &&
      this.lastSpmAvailabilityState !== 'unavailable'
    ) {
      this.lastSpmAvailabilityState = 'unavailable';
      const presentation: LiveMetricPresentation = {
        presentationId: this.nextPresentationId('strokeRateSpm'),
        surfaceId: this.surfaceId,
        metricIdentifier: 'strokeRateSpm',
        numericValue: null,
        canonicalUnit: 'strokes/min',
        renderedText: '—',
        availabilityState: 'unavailable',
        availabilityReason: 'telemetry_timeout',
        sourceId: this.lastSpmSourceId,
        recordingId: this.lastSpmRecordingId,
        presentedAtEpochMilliseconds: now,
        algorithmVersion: this.algorithmVersion,
        presentationPolicyVersion: this.presentationPolicyVersion,
      };
      this.emitIfChangedOrCheckpoint(presentation, now);
    }
  }

  isSpmActive(nowEpochMs?: number): boolean {
    const now = nowEpochMs ?? Date.now();
    if (this.lastSpmUpdateAt === 0) return false;
    if (now - this.lastSpmUpdateAt > this.spmTimeoutThresholdMs) return false;
    return this.lastSpmAvailabilityState === 'available' || this.lastSpmAvailabilityState === 'held';
  }

  reset(): void {
    this.presentationSeq = 0;
    this.lastEmitted.clear();
    this.lastSpmAvailabilityState = undefined;
    this.lastSpmSourceId = undefined;
    this.lastSpmRecordingId = undefined;
    this.lastSpmUpdateAt = 0;
    this.lastSupportedSpmValue = null;
    this.lastSupportedSpmNativeTimestamp = null;
    this.lastSpmClockDomainId = undefined;
  }
}
