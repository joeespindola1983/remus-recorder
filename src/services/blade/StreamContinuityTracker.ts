import {
  CanonicalRecording,
  RecordingStartReason,
  RecordingEndReason,
} from '../recording/RecordingService';
import { DecodedImuBatch, TelemetryAccounting } from './RemusStreamPacketDecoder';

export interface SequenceGapRange {
  fromSampleSequence: number;
  toSampleSequence: number;
  count: number;
}

interface RecordingDomainContext {
  recording: CanonicalRecording;
  accounting: TelemetryAccounting;
  sequenceGaps: SequenceGapRange[];
  expectedBatchSequence: number | null;
  expectedSampleSequence: number | null;
  previousSampleSequence: number | null;
  previousSampleTimestampUs: number | null;
  lastBatchSequence: number | null;
  lastSampleTimestampUs: number | null;
  seenBatchSequences: Set<number>;
  saturationCounts: number[];
}

const createDefaultAccounting = (): TelemetryAccounting => ({
  transportNotificationCount: 0,
  decodedBatchCount: 0,
  decodedImuSampleCount: 0,
  invalidNotificationCount: 0,
  pendingFragmentCount: 0,
  accelSaturationCountX: 0,
  accelSaturationCountY: 0,
  accelSaturationCountZ: 0,
  gyroSaturationCountX: 0,
  gyroSaturationCountY: 0,
  gyroSaturationCountZ: 0,
  samplesWithAnySaturationCount: 0,
  samplesWithAnySaturationPercent: 0,
  lostPackets: 0,
  lostSamples: 0,
  duplicatedPackets: 0,
  outOfOrderPackets: 0,
  maxSampleGapMs: 0,
});

export class StreamContinuityTracker {
  private readonly completedDomains: RecordingDomainContext[] = [];
  private currentContext: RecordingDomainContext | null = null;
  private currentBootId: string | null = null;
  private segmentIndex = 0;

  constructor(
    public readonly sourceId: string,
    public readonly activityId: string,
  ) {}

  getCurrentRecording(): CanonicalRecording | null {
    return this.currentContext?.recording ?? null;
  }

  beginRecording(): void {
    this.completedDomains.splice(0, this.completedDomains.length);
    this.currentContext = null;
    this.currentBootId = null;
    this.segmentIndex = 0;
  }

  private nextRecordingId(): string {
    this.segmentIndex += 1;
    const indexStr = this.segmentIndex.toString().padStart(3, '0');
    return `rec:${this.sourceId}:${indexStr}`;
  }

  private nextClockDomainId(): string {
    const indexStr = this.segmentIndex.toString().padStart(3, '0');
    return `clk:${this.sourceId}:${indexStr}`;
  }

  startStream(receiptEpochMs: number, bootId?: string | number | null): CanonicalRecording {
    if (this.currentContext) {
      this.closeCurrentRecording('stream_disconnect', receiptEpochMs);
    }
    return this.openNewRecording('normal_start', receiptEpochMs, bootId);
  }

  private normalizeBootId(bootId?: string | number | null): string | null {
    if (bootId === undefined || bootId === null) return null;
    if (typeof bootId === 'number') {
      return `0x${bootId.toString(16).toLowerCase().padStart(8, '0')}`;
    }
    return bootId.toString().toLowerCase();
  }

  private openNewRecording(
    reason: RecordingStartReason,
    receiptEpochMs: number,
    bootId?: string | number | null,
  ): CanonicalRecording {
    const normBootId = this.normalizeBootId(bootId);
    this.currentBootId = normBootId;
    const recordingId = this.nextRecordingId();
    const clockDomainId = this.nextClockDomainId();

    const recording: CanonicalRecording = {
      recordingId,
      sourceId: this.sourceId,
      clockDomainId,
      deviceBootId: normBootId,
      startReason: reason,
      endReason: null,
      startedAtNativeMicroseconds: null,
      endedAtNativeMicroseconds: null,
      startedAtReceiptEpochMilliseconds: receiptEpochMs,
      endedAtReceiptEpochMilliseconds: receiptEpochMs,
      sampleCounts: {
        rawImu: 0,
      },
    };

    this.currentContext = {
      recording,
      accounting: createDefaultAccounting(),
      sequenceGaps: [],
      expectedBatchSequence: null,
      expectedSampleSequence: null,
      previousSampleSequence: null,
      previousSampleTimestampUs: null,
      lastBatchSequence: null,
      lastSampleTimestampUs: null,
      seenBatchSequences: new Set(),
      saturationCounts: [0, 0, 0, 0, 0, 0],
    };

    return recording;
  }

  private closeCurrentRecording(
    reason: RecordingEndReason,
    receiptEpochMs: number,
  ): CanonicalRecording {
    if (!this.currentContext) {
      throw new Error('No active recording to close');
    }
    this.currentContext.recording.endReason = reason;
    this.currentContext.recording.endedAtReceiptEpochMilliseconds = receiptEpochMs;
    this.completedDomains.push(this.currentContext);
    const closed = this.currentContext.recording;
    this.currentContext = null;
    return closed;
  }

  ingestBatch(
    batch: DecodedImuBatch,
    receiptEpochMs: number,
    bootId?: string | number | null,
  ): { newRecordingStarted: boolean; recording: CanonicalRecording } {
    const normBootId = this.normalizeBootId(bootId);
    let newRecordingStarted = false;

    if (!this.currentContext) {
      this.openNewRecording('normal_start', receiptEpochMs, normBootId);
      newRecordingStarted = true;
    } else {
      // Discontinuity check 1: Device boot ID changed
      const bootIdChanged =
        this.currentBootId !== null &&
        normBootId !== null &&
        this.currentBootId !== normBootId;

      // Discontinuity check 2: Joint sequence and timestamp regression
      const firstSample = batch.samples[0];
      const lastBatchSeq = this.currentContext.lastBatchSequence;
      const lastSampleTs = this.currentContext.lastSampleTimestampUs;
      const hasRegression =
        lastBatchSeq !== null &&
        lastSampleTs !== null &&
        firstSample !== undefined &&
        batch.batchSequence < lastBatchSeq &&
        firstSample.nativeTimestampUs < lastSampleTs;

      const isTrueDiscontinuity =
        bootIdChanged ||
        (hasRegression &&
          lastBatchSeq !== null &&
          lastSampleTs !== null &&
          (normBootId === null ||
            batch.batchSequence === 0 ||
            lastBatchSeq - batch.batchSequence > 3 ||
            lastSampleTs - firstSample.nativeTimestampUs > 1_000_000));

      if (isTrueDiscontinuity) {
        const reason: RecordingEndReason = bootIdChanged
          ? 'device_restarted'
          : 'suspected_clock_discontinuity';

        this.closeCurrentRecording(reason, receiptEpochMs);
        this.openNewRecording(reason as RecordingStartReason, receiptEpochMs, normBootId);
        newRecordingStarted = true;
      } else if (this.currentBootId === null && normBootId !== null) {
        this.currentBootId = normBootId;
        this.currentContext.recording.deviceBootId = normBootId;
      }
    }

    const ctx = this.currentContext!;
    const rec = ctx.recording;
    const acct = ctx.accounting;

    if (batch.samples.length > 0) {
      const firstSample = batch.samples[0];
      const lastSample = batch.samples[batch.samples.length - 1];

      if (rec.startedAtNativeMicroseconds === null) {
        rec.startedAtNativeMicroseconds = firstSample.nativeTimestampUs.toString();
      }
      rec.endedAtNativeMicroseconds = lastSample.nativeTimestampUs.toString();
      rec.endedAtReceiptEpochMilliseconds = receiptEpochMs;
      rec.sampleCounts.rawImu = (rec.sampleCounts.rawImu ?? 0) + batch.samples.length;

      if (ctx.seenBatchSequences.has(batch.batchSequence)) {
        acct.duplicatedPackets += 1;
      } else {
        if (ctx.expectedBatchSequence !== null) {
          if (batch.batchSequence > ctx.expectedBatchSequence) {
            const lost = batch.batchSequence - ctx.expectedBatchSequence;
            acct.lostPackets += lost;
          } else if (batch.batchSequence < ctx.expectedBatchSequence) {
            acct.outOfOrderPackets += 1;
            if (acct.lostPackets > 0) {
              acct.lostPackets -= 1;
            }
          }
        }
        ctx.seenBatchSequences.add(batch.batchSequence);
      }

      ctx.expectedBatchSequence = Math.max(ctx.expectedBatchSequence ?? 0, batch.batchSequence + 1);
      ctx.lastBatchSequence = Math.max(ctx.lastBatchSequence ?? 0, batch.batchSequence);

      // Sample sequence tracking within domain
      if (ctx.expectedSampleSequence !== null && firstSample.sampleSequence > ctx.expectedSampleSequence) {
        const lost = firstSample.sampleSequence - ctx.expectedSampleSequence;
        acct.lostSamples += lost;
        ctx.sequenceGaps.push({
          fromSampleSequence: ctx.expectedSampleSequence,
          toSampleSequence: firstSample.sampleSequence - 1,
          count: lost,
        });
      } else if (ctx.expectedSampleSequence !== null && firstSample.sampleSequence < ctx.expectedSampleSequence) {
        // Out of order batch filling a previously recorded gap
        const gapIdx = ctx.sequenceGaps.findIndex(
          g => firstSample.sampleSequence >= g.fromSampleSequence && lastSample.sampleSequence <= g.toSampleSequence,
        );
        if (gapIdx !== -1) {
          acct.lostSamples = Math.max(0, acct.lostSamples - batch.samples.length);
          ctx.sequenceGaps.splice(gapIdx, 1);
        }
      }

      for (let i = 0; i < batch.samples.length; i += 1) {
        const sample = batch.samples[i];
        if (
          ctx.previousSampleTimestampUs !== null &&
          ctx.previousSampleSequence !== null &&
          sample.sampleSequence === ctx.previousSampleSequence + 1
        ) {
          const gapUs = sample.nativeTimestampUs - ctx.previousSampleTimestampUs;
          if (gapUs > 0) {
            acct.maxSampleGapMs = Math.max(acct.maxSampleGapMs, gapUs / 1000);
          }
        }
        ctx.previousSampleSequence = sample.sampleSequence;
        ctx.previousSampleTimestampUs = sample.nativeTimestampUs;

        const axes = [
          sample.rawAccel.x,
          sample.rawAccel.y,
          sample.rawAccel.z,
          sample.rawGyro.x,
          sample.rawGyro.y,
          sample.rawGyro.z,
        ];
        let sampleSaturated = false;
        axes.forEach((val, axis) => {
          if (val === 32767 || val === -32768) {
            ctx.saturationCounts[axis] += 1;
            sampleSaturated = true;
          }
        });
        if (sampleSaturated) acct.samplesWithAnySaturationCount += 1;
      }

      acct.accelSaturationCountX = ctx.saturationCounts[0];
      acct.accelSaturationCountY = ctx.saturationCounts[1];
      acct.accelSaturationCountZ = ctx.saturationCounts[2];
      acct.gyroSaturationCountX = ctx.saturationCounts[3];
      acct.gyroSaturationCountY = ctx.saturationCounts[4];
      acct.gyroSaturationCountZ = ctx.saturationCounts[5];

      ctx.expectedSampleSequence = Math.max(
        ctx.expectedSampleSequence ?? 0,
        firstSample.sampleSequence + batch.samples.length,
      );
      ctx.lastSampleTimestampUs = Math.max(ctx.lastSampleTimestampUs ?? 0, lastSample.nativeTimestampUs);
      acct.decodedBatchCount += 1;
      acct.decodedImuSampleCount += batch.samples.length;
      acct.samplesWithAnySaturationPercent = acct.decodedImuSampleCount === 0
        ? 0
        : (acct.samplesWithAnySaturationCount / acct.decodedImuSampleCount) * 100;
    }

    return { newRecordingStarted, recording: rec };
  }

  stopStream(receiptEpochMs: number): CanonicalRecording {
    if (this.currentContext) {
      return this.closeCurrentRecording('normal_stop', receiptEpochMs);
    }
    if (this.completedDomains.length > 0) {
      return this.completedDomains[this.completedDomains.length - 1].recording;
    }
    throw new Error('No recording was active');
  }

  getActiveRecording(): CanonicalRecording | null {
    return this.currentContext ? this.currentContext.recording : null;
  }

  getAllRecordings(): CanonicalRecording[] {
    const list = this.completedDomains.map(d => d.recording);
    if (this.currentContext) {
      list.push(this.currentContext.recording);
    }
    return list;
  }

  getSequenceGaps(recordingId?: string): SequenceGapRange[] {
    if (recordingId) {
      if (this.currentContext?.recording.recordingId === recordingId) {
        return [...this.currentContext.sequenceGaps];
      }
      const domain = this.completedDomains.find(d => d.recording.recordingId === recordingId);
      return domain ? [...domain.sequenceGaps] : [];
    }
    if (this.currentContext) {
      return [...this.currentContext.sequenceGaps];
    }
    if (this.completedDomains.length > 0) {
      return [...this.completedDomains[this.completedDomains.length - 1].sequenceGaps];
    }
    return [];
  }

  getAccounting(recordingId?: string): TelemetryAccounting {
    if (recordingId) {
      if (this.currentContext?.recording.recordingId === recordingId) {
        return { ...this.currentContext.accounting };
      }
      const domain = this.completedDomains.find(d => d.recording.recordingId === recordingId);
      if (domain) {
        return { ...domain.accounting };
      }
    }
    if (this.currentContext) {
      return { ...this.currentContext.accounting };
    }
    if (this.completedDomains.length > 0) {
      return { ...this.completedDomains[this.completedDomains.length - 1].accounting };
    }
    return createDefaultAccounting();
  }
}

export const createStreamContinuityTracker = (
  sourceId: string,
  activityId: string,
): StreamContinuityTracker => new StreamContinuityTracker(sourceId, activityId);
