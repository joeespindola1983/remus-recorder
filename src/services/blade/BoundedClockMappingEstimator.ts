import {
  ClockAnchorObservation,
  ClockMapping,
  DecimalIntegerString,
} from '../../contracts/acquisition/types';

export interface ClockMappingPolicy {
  policyVersion: string;
  maxRoundTripUs: number;
  maxStalenessUs: number;
  minAnchorsForAffine: number;
  minAffineSpanUs: number;
  maxPhysicalDriftPpm: number;
  maxQualifiedErrorUs: number;
  maxApproximateErrorUs: number;
}

export const DEFAULT_CLOCK_MAPPING_POLICY: ClockMappingPolicy = {
  policyVersion: '1.0.0',
  maxRoundTripUs: 200_000,
  maxStalenessUs: 5_000_000,
  minAnchorsForAffine: 3,
  minAffineSpanUs: 2_000_000,
  maxPhysicalDriftPpm: 500,
  maxQualifiedErrorUs: 5_000,
  maxApproximateErrorUs: 25_000,
};

export type AnchorRejectionReason =
  | 'negative_rtt'
  | 'excessive_rtt'
  | 'timestamp_regression'
  | 'boot_id_mismatch'
  | 'clock_domain_mismatch'
  | 'implausible_drift';

export interface ClockAnchor {
  clockAnchorObservationId: string;
  sourceId: string;
  recordingId: string;
  sourceClockDomainId: string;
  comparisonClockDomainId: string;
  t1HostSendUs: number;
  t2SensorReceiveUs: number;
  t3SensorSendUs: number;
  t4HostReceiveUs: number;
  roundTripUs: number;
  observedOffsetUs: number;
  uncertaintyUs: number;
  deviceBootId?: number;
  accepted: boolean;
  rejectionReason?: AnchorRejectionReason;
  receivedOrder: number;
}

export interface BoundedClockMappingEstimatorOptions {
  sourceId: string;
  sourceClockDomainId?: string;
  comparisonClockDomainId?: string;
  recordingId?: string;
  deviceBootId?: number;
  policy?: ClockMappingPolicy;
  onAnchorObservation?: (obs: ClockAnchorObservation) => void;
  onMappingProduced?: (mapping: ClockMapping) => void;
}

export class BoundedClockMappingEstimator {
  private readonly policy: ClockMappingPolicy;
  private sourceClockDomainId: string;
  private readonly comparisonClockDomainId: string;
  private readonly sourceId: string;
  private recordingId: string;
  private readonly onAnchorObservation?: (obs: ClockAnchorObservation) => void;
  private readonly onMappingProduced?: (mapping: ClockMapping) => void;

  private currentDeviceBootId?: number;
  private allAnchors: ClockAnchor[] = [];
  private acceptedAnchors: ClockAnchor[] = [];
  private lastAcceptedT1HostSendUs?: number;
  private currentMapping: ClockMapping | null = null;
  private currentOffsetUs: number = 0;
  private currentSlopeUsPerSecond: number = 0;
  private currentOriginSensorUs: number = 0;

  private anchorSequence = 0;
  private mappingSequence = 0;

  constructor(options: BoundedClockMappingEstimatorOptions) {
    this.sourceId = options.sourceId;
    this.sourceClockDomainId = options.sourceClockDomainId ?? `clk:${options.sourceId}:pending`;
    this.comparisonClockDomainId = options.comparisonClockDomainId ?? 'phone:primary:monotonic';
    this.recordingId = options.recordingId ?? `rec:${options.sourceId}:pending`;
    this.currentDeviceBootId = options.deviceBootId;
    this.policy = options.policy ?? DEFAULT_CLOCK_MAPPING_POLICY;
    this.onAnchorObservation = options.onAnchorObservation;
    this.onMappingProduced = options.onMappingProduced;
  }

  setRecordingContext(recordingId: string, sourceClockDomainId: string, deviceBootId?: number): void {
    const isInitialPending = this.recordingId.endsWith(':pending');
    if (!isInitialPending && (this.recordingId !== recordingId || this.sourceClockDomainId !== sourceClockDomainId)) {
      this.invalidate('recording_change');
    }
    this.recordingId = recordingId;
    this.sourceClockDomainId = sourceClockDomainId;
    if (deviceBootId !== undefined) {
      if (this.currentDeviceBootId !== undefined && this.currentDeviceBootId !== deviceBootId) {
        this.invalidate('boot_change');
      }
      this.currentDeviceBootId = deviceBootId;
    }
  }

  getDeviceBootId(): number | undefined {
    return this.currentDeviceBootId;
  }

  getAllAnchors(): ClockAnchor[] {
    return [...this.allAnchors];
  }

  getAcceptedAnchors(): ClockAnchor[] {
    return [...this.acceptedAnchors];
  }

  invalidate(_reason?: string): void {
    this.acceptedAnchors = [];
    this.lastAcceptedT1HostSendUs = undefined;
    this.currentMapping = null;
    this.currentOffsetUs = 0;
    this.currentSlopeUsPerSecond = 0;
  }

  addObservation(params: {
    t1HostSendUs: number;
    t2SensorReceiveUs: number;
    t3SensorSendUs: number;
    t4HostReceiveUs: number;
    deviceBootId?: number;
  }): ClockAnchor {
    const roundTripUs =
      params.t4HostReceiveUs - params.t1HostSendUs - (params.t3SensorSendUs - params.t2SensorReceiveUs);
    const observedOffsetUs =
      (params.t2SensorReceiveUs - params.t1HostSendUs + (params.t3SensorSendUs - params.t4HostReceiveUs)) / 2;
    const uncertaintyUs = Math.max(1, Math.round(roundTripUs / 2));

    const receivedOrder = this.anchorSequence++;
    const clockAnchorObservationId = `anchor:${this.sourceId}:${receivedOrder}`;

    // Boot ID handling
    if (params.deviceBootId !== undefined) {
      if (this.currentDeviceBootId !== undefined && this.currentDeviceBootId !== params.deviceBootId) {
        this.invalidate('boot_change');
      }
      this.currentDeviceBootId = params.deviceBootId;
    }

    let accepted = true;
    let rejectionReason: AnchorRejectionReason | undefined;

    if (this.lastAcceptedT1HostSendUs !== undefined && params.t1HostSendUs < this.lastAcceptedT1HostSendUs) {
      accepted = false;
      rejectionReason = 'timestamp_regression';
    } else if (roundTripUs < 0) {
      accepted = false;
      rejectionReason = 'negative_rtt';
    } else if (roundTripUs > this.policy.maxRoundTripUs) {
      accepted = false;
      rejectionReason = 'excessive_rtt';
    }

    const anchor: ClockAnchor = {
      clockAnchorObservationId,
      sourceId: this.sourceId,
      recordingId: this.recordingId,
      sourceClockDomainId: this.sourceClockDomainId,
      comparisonClockDomainId: this.comparisonClockDomainId,
      t1HostSendUs: params.t1HostSendUs,
      t2SensorReceiveUs: params.t2SensorReceiveUs,
      t3SensorSendUs: params.t3SensorSendUs,
      t4HostReceiveUs: params.t4HostReceiveUs,
      roundTripUs,
      observedOffsetUs,
      uncertaintyUs,
      deviceBootId: params.deviceBootId,
      accepted,
      rejectionReason,
      receivedOrder,
    };

    this.allAnchors.push(anchor);

    if (accepted) {
      this.lastAcceptedT1HostSendUs = params.t1HostSendUs;
      this.acceptedAnchors.push(anchor);
      if (this.acceptedAnchors.length > 60) {
        this.acceptedAnchors.shift();
      }
      this.recalculateMapping();

      if (this.onAnchorObservation) {
        const obs: ClockAnchorObservation = {
          clockAnchorObservationId: anchor.clockAnchorObservationId,
          sourceId: anchor.sourceId,
          recordingId: anchor.recordingId,
          sourceClockDomainId: anchor.sourceClockDomainId,
          comparisonClockDomainId: anchor.comparisonClockDomainId,
          sourceTimestampMicroseconds: String(Math.round(anchor.t2SensorReceiveUs)) as DecimalIntegerString,
          comparisonTimestampMicroseconds: String(Math.round(anchor.t1HostSendUs)) as DecimalIntegerString,
          observationMethod: 'paired_exchange',
          uncertaintyMicroseconds: String(Math.round(anchor.uncertaintyUs)) as DecimalIntegerString,
        };
        this.onAnchorObservation(obs);
      }
    }

    return anchor;
  }

  private recalculateMapping(): void {
    if (this.acceptedAnchors.length === 0) {
      this.currentMapping = null;
      return;
    }

    // Sort by lowest RTT envelope
    const selectedCount = Math.min(
      this.acceptedAnchors.length,
      Math.max(this.policy.minAnchorsForAffine, Math.ceil(this.acceptedAnchors.length / 2)),
    );
    const selected = [...this.acceptedAnchors]
      .sort((a, b) => a.roundTripUs - b.roundTripUs)
      .slice(0, selectedCount)
      .sort((a, b) => a.t1HostSendUs - b.t1HostSendUs);

    const lowestRttAnchor = selected[0];
    const minimumTransportErrorUs = lowestRttAnchor.uncertaintyUs;

    const spanUs = selected[selected.length - 1].t1HostSendUs - selected[0].t1HostSendUs;
    const canDoAffine =
      selected.length >= this.policy.minAnchorsForAffine && spanUs >= this.policy.minAffineSpanUs;

    let offsetUs = lowestRttAnchor.observedOffsetUs;
    let slopeUsPerSecond = 0;
    let maximumErrorUs = minimumTransportErrorUs;
    let mappingQuality: 'qualified' | 'approximate' = 'approximate';
    let supportingIds = [lowestRttAnchor.clockAnchorObservationId];

    if (canDoAffine) {
      const originHostUs = selected[0].t1HostSendUs;
      let sumW = 0;
      let sumWT = 0;
      let sumWO = 0;
      let sumWTO = 0;
      let sumWTT = 0;

      for (const obs of selected) {
        const weight = 1 / Math.max(1_000, obs.roundTripUs);
        const timeSeconds = (obs.t1HostSendUs - originHostUs) / 1_000_000;
        sumW += weight;
        sumWT += weight * timeSeconds;
        sumWO += weight * obs.observedOffsetUs;
        sumWTO += weight * timeSeconds * obs.observedOffsetUs;
        sumWTT += weight * timeSeconds * timeSeconds;
      }

      const denominator = sumW * sumWTT - sumWT * sumWT;
      if (Math.abs(denominator) > 1e-12) {
        const slope = (sumW * sumWTO - sumWT * sumWO) / denominator;
        const intercept = (sumWO - slope * sumWT) / sumW;

        if (Math.abs(slope) <= this.policy.maxPhysicalDriftPpm) {
          slopeUsPerSecond = slope;
          offsetUs = intercept;
          this.currentOriginSensorUs = selected[0].t2SensorReceiveUs;

          const predictOffset = (hostUs: number): number =>
            intercept + slope * ((hostUs - originHostUs) / 1_000_000);

          const maxResidual = selected.reduce(
            (max, obs) => Math.max(max, Math.abs(obs.observedOffsetUs - predictOffset(obs.t1HostSendUs))),
            0,
          );

          maximumErrorUs = Math.round(minimumTransportErrorUs + maxResidual);
          if (maximumErrorUs <= this.policy.maxQualifiedErrorUs) {
            mappingQuality = 'qualified';
          }
          supportingIds = selected.map(s => s.clockAnchorObservationId);
        }
      }
    }

    this.currentOffsetUs = offsetUs;
    this.currentSlopeUsPerSecond = slopeUsPerSecond;

    const latestSensorUs = selected[selected.length - 1].t2SensorReceiveUs;
    const earliestSensorUs = selected[0].t2SensorReceiveUs;

    const mappingId = `map:${this.sourceId}:${this.mappingSequence++}`;
    const mapping: ClockMapping = {
      clockMappingId: mappingId,
      sourceClockDomainId: this.sourceClockDomainId,
      comparisonClockDomainId: this.comparisonClockDomainId,
      sourceAnchorMicroseconds: String(Math.round(earliestSensorUs)) as DecimalIntegerString,
      comparisonAnchorMicroseconds: String(Math.round(selected[0].t1HostSendUs)) as DecimalIntegerString,
      scale: 1.0 + slopeUsPerSecond / 1_000_000,
      validFromSourceMicroseconds: String(
        Math.max(0, Math.round(earliestSensorUs - this.policy.maxStalenessUs)),
      ) as DecimalIntegerString,
      validThroughSourceMicroseconds: String(
        Math.round(latestSensorUs + this.policy.maxStalenessUs),
      ) as DecimalIntegerString,
      maximumErrorMicroseconds: String(maximumErrorUs) as DecimalIntegerString,
      mappingMethod: 'piecewise_affine',
      mappingQuality,
      supportingClockAnchorObservationIds: supportingIds,
    };

    this.currentMapping = mapping;
    this.onMappingProduced?.(mapping);
  }

  getMapping(sensorTimeUs?: number): ClockMapping | null {
    if (!this.currentMapping) return null;
    if (sensorTimeUs !== undefined) {
      const validFrom = Number(this.currentMapping.validFromSourceMicroseconds);
      const validThrough = Number(this.currentMapping.validThroughSourceMicroseconds);
      if (sensorTimeUs < validFrom || sensorTimeUs > validThrough) {
        return null;
      }
    }
    return this.currentMapping;
  }

  convertSensorTimeToComparisonUs(sensorTimeUs: number): {
    comparisonTimestampUs: number;
    clockMappingId: string;
    maximumErrorUs: number;
    mappingQuality: 'qualified' | 'approximate';
  } | null {
    const mapping = this.getMapping(sensorTimeUs);
    if (!mapping) return null;

    let offsetAtTimeUs = this.currentOffsetUs;
    if (this.currentSlopeUsPerSecond !== 0 && this.currentOriginSensorUs > 0) {
      const elapsedSeconds = (sensorTimeUs - this.currentOriginSensorUs) / 1_000_000;
      offsetAtTimeUs += this.currentSlopeUsPerSecond * elapsedSeconds;
    }

    const comparisonTimestampUs = Math.round(sensorTimeUs - offsetAtTimeUs);
    return {
      comparisonTimestampUs,
      clockMappingId: mapping.clockMappingId,
      maximumErrorUs: Number(mapping.maximumErrorMicroseconds),
      mappingQuality: mapping.mappingQuality,
    };
  }
}
