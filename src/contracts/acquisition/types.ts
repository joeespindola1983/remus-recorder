export const ACQUISITION_CONTRACT_VERSION = '1.0.0' as const;

export type AcquisitionContractVersion = typeof ACQUISITION_CONTRACT_VERSION;
export type DecimalIntegerString = string;

export type SensorPlacement =
  | 'hull'
  | 'left_wrist'
  | 'right_wrist'
  | 'body'
  | 'oar'
  | 'paddle'
  | 'left_paddle'
  | 'right_paddle'
  | 'unknown';

export type PlacementProvenance =
  | 'user_declared'
  | 'device_metadata'
  | 'calibrated'
  | 'unknown';

export interface ClockDomainDescriptor {
  clockDomainId: string;
  clockKind: 'monotonic' | 'utc' | 'elapsed' | 'unknown';
  timestampUnit: 'us';
}

export interface SourceCapabilities {
  liveTransfer: boolean;
  volatileResend: boolean;
  standaloneCapture: boolean;
  storeAndForward: boolean;
  postSyncDeletion: boolean;
  relayCapture: boolean;
  relayModes?: Array<'source_push' | 'standard_ble_pull'>;
}

export interface SourceDescriptor {
  sourceId: string;
  recordingId?: string;
  deviceFamily: string;
  deviceModel?: string;
  deviceSerialNumber?: string;
  hardwareRevision?: string;
  firmwareVersion?: string;
  bootId?: string;
  continuationOfRecordingId?: string;
  operationalState:
    | 'available_idle'
    | 'preparing_capture'
    | 'capturing'
    | 'shutting_down'
    | 'unavailable';
  sensorPlacement: SensorPlacement;
  placementProvenance: PlacementProvenance;
  capabilities: SourceCapabilities;
  clockDomains: ClockDomainDescriptor[];
}

export type MeasurementIdentifier =
  | 'positionWgs84'
  | 'horizontalAccuracyMeters'
  | 'altitudeMeters'
  | 'verticalAccuracyMeters'
  | 'groundSpeedMetersPerSecond'
  | 'speedAccuracyMetersPerSecond'
  | 'courseDegrees'
  | 'courseAccuracyDegrees'
  | 'headingDegrees'
  | 'accelerationIncludingGravityG'
  | 'linearAccelerationG'
  | 'gravityG'
  | 'rotationRateRadiansPerSecond'
  | 'heartRateBeatsPerMinute'
  | 'strokeRateSpm';

export type MeasurementUnit =
  | 'deg'
  | 'm'
  | 'm/s'
  | 'g'
  | 'rad/s'
  | 'bpm'
  | 'strokes/min';

export type ValueShape = 'scalar' | 'vector3' | 'position_wgs84';

export interface SensorStreamDescriptor {
  sensorStreamId: string;
  sourceId: string;
  recordingId: string;
  physicalSensorGroupId: string;
  clockDomainId: string;
  measurementIdentifier: MeasurementIdentifier;
  unit: MeasurementUnit;
  valueShape: ValueShape;
  frameId?: string;
  timestampSemantics: 'sample_time' | 'fix_time' | 'observation_time';
  measurementStage:
    | 'raw'
    | 'normalized'
    | 'vendor_fused'
    | 'source_reported'
    | 'derived';
  evaluationRole: 'estimator_input' | 'reference_only' | 'annotation';
  cadence:
    | { mode: 'source_driven' }
    | { mode: 'fixed'; targetSamplingRateHertz: number };
}

export interface ScalarSampleValue {
  kind: 'scalar';
  value: number;
}

export interface Vector3SampleValue {
  kind: 'vector3';
  x: number;
  y: number;
  z: number;
}

export interface PositionWgs84SampleValue {
  kind: 'position_wgs84';
  latitudeDegrees: number;
  longitudeDegrees: number;
  altitudeMeters?: number;
  verticalDatum?: 'wgs84_ellipsoid' | 'egm96' | 'unknown';
}

export type TelemetrySampleValue =
  | ScalarSampleValue
  | Vector3SampleValue
  | PositionWgs84SampleValue;

export interface TelemetrySample {
  sequenceNumber: DecimalIntegerString;
  nativeTimestampMicroseconds: DecimalIntegerString;
  receivedAtUtcMicroseconds?: DecimalIntegerString;
  value: TelemetrySampleValue;
}

export interface SequenceGap {
  firstSequenceNumber: DecimalIntegerString;
  lastSequenceNumber: DecimalIntegerString;
  reason:
    | 'volatile_buffer_exhausted'
    | 'source_restart'
    | 'transport_loss'
    | 'sample_rejected'
    | 'unknown';
}

export interface TelemetryBatch {
  telemetryBatchId: string;
  sourceId: string;
  recordingId: string;
  sensorStreamId: string;
  firstSequenceNumber: DecimalIntegerString;
  lastSequenceNumber: DecimalIntegerString;
  samples: TelemetrySample[];
  declaredGaps?: SequenceGap[];
}

export interface ClockAnchorObservation {
  clockAnchorObservationId: string;
  sourceId: string;
  recordingId: string;
  sourceClockDomainId: string;
  comparisonClockDomainId: string;
  sourceTimestampMicroseconds: DecimalIntegerString;
  comparisonTimestampMicroseconds: DecimalIntegerString;
  observationMethod:
    | 'gnss_utc'
    | 'paired_exchange'
    | 'host_receive'
    | 'imported_anchor'
    | 'manual';
  uncertaintyMicroseconds: DecimalIntegerString;
}

export interface ClockMapping {
  clockMappingId: string;
  sourceClockDomainId: string;
  comparisonClockDomainId: string;
  sourceAnchorMicroseconds: DecimalIntegerString;
  comparisonAnchorMicroseconds: DecimalIntegerString;
  scale: number;
  validFromSourceMicroseconds: DecimalIntegerString;
  validThroughSourceMicroseconds: DecimalIntegerString;
  maximumErrorMicroseconds: DecimalIntegerString;
  mappingMethod: 'piecewise_affine';
  mappingQuality: 'qualified' | 'approximate';
  supportingClockAnchorObservationIds: string[];
}

export type CaptureMode =
  | 'coordinated'
  | 'autonomous'
  | 'disconnection_recovery';

export interface ArtifactPartManifest {
  artifactPartId: string;
  partKind: 'metadata' | 'sensor_stream' | 'clock' | 'health' | 'diagnostic';
  sensorStreamId?: string;
  firstSequenceNumber?: DecimalIntegerString;
  lastSequenceNumber?: DecimalIntegerString;
  byteLength: DecimalIntegerString;
  contentSha256: string;
  required: boolean;
}

export interface ArtifactManifest {
  artifactId: string;
  sourceId: string;
  recordingId: string;
  byteLength: DecimalIntegerString;
  contentSha256: string;
  chunkSizeBytes: number;
  artifactFormat: 'remus_acquisition_v1';
  captureMode: CaptureMode;
  sensorStreamIds: string[];
  parts?: ArtifactPartManifest[];
  finalized: true;
}

export interface ArtifactChunk {
  artifactId: string;
  artifactPartId: string;
  offsetBytes: DecimalIntegerString;
  byteLength: number;
  contentBase64: string;
  chunkSha256: string;
}

export interface ArtifactPersistenceAcknowledgement {
  artifactId: string;
  recordingId: string;
  byteLength: DecimalIntegerString;
  contentSha256: string;
  persistenceStatus: 'partial' | 'persisted_verified' | 'rejected';
  persistedAtUtcMicroseconds?: DecimalIntegerString;
}

export interface ArtifactDeletionResult {
  artifactId: string;
  acknowledgementMessageId: string;
  deletionStatus: 'deleted' | 'retained' | 'not_found' | 'failed';
}

export interface RecordingLifecycleEvent {
  recordingLifecycleEventId: string;
  sourceId: string;
  recordingId: string;
  bootId: string;
  nativeTimestampMicroseconds: DecimalIntegerString;
  eventKind:
    | 'recording_started'
    | 'stop_intent_journaled'
    | 'recording_finalized'
    | 'recording_interrupted';
  startCause?: 'app_commit' | 'local_action' | 'autonomous_policy';
  finalizationReason?:
    | 'app_stop'
    | 'local_stop'
    | 'user_power_off'
    | 'control_lease_expired'
    | 'power_depleted'
    | 'power_loss'
    | 'telemetry_timeout'
    | 'storage_exhausted';
  activityCorrelationId?: string;
  disconnectGracePeriodMilliseconds?: number;
}

export interface RecordingActivityAssociation {
  recordingActivityAssociationId: string;
  recordingId: string;
  activityId?: string;
  associationState:
    | 'unassociated'
    | 'suggested'
    | 'confirmed'
    | 'rejected'
    | 'needs_review';
  associationMethod:
    | 'exact_shared_correlation'
    | 'user_confirmation'
    | 'heuristic_suggestion'
    | 'system_recovery';
  activityCorrelationId?: string;
  includedStartNativeTimestampMicroseconds?: DecimalIntegerString;
  includedEndNativeTimestampMicroseconds?: DecimalIntegerString;
  reasonCodes: Array<
    | 'shared_activity_correlation'
    | 'time_overlap'
    | 'route_overlap'
    | 'source_context'
    | 'phone_start_boundary'
    | 'manual_selection'
  >;
  attributedAtUtcMicroseconds: DecimalIntegerString;
  supersedesRecordingActivityAssociationId?: string;
}

export interface BaseAcquisitionMessage<Kind extends string, Payload> {
  contractVersion: AcquisitionContractVersion;
  messageId: string;
  messageKind: Kind;
  payload: Payload;
}

export type SourceDescriptorMessage = BaseAcquisitionMessage<
  'source_descriptor',
  SourceDescriptor
>;
export type StreamDescriptorMessage = BaseAcquisitionMessage<
  'stream_descriptor',
  SensorStreamDescriptor
>;
export type TelemetryBatchMessage = BaseAcquisitionMessage<
  'telemetry_batch',
  TelemetryBatch
>;
export type ClockAnchorObservationMessage = BaseAcquisitionMessage<
  'clock_anchor_observation',
  ClockAnchorObservation
>;
export type ClockMappingMessage = BaseAcquisitionMessage<
  'clock_mapping',
  ClockMapping
>;
export type ArtifactManifestMessage = BaseAcquisitionMessage<
  'artifact_manifest',
  ArtifactManifest
>;
export type ArtifactChunkMessage = BaseAcquisitionMessage<
  'artifact_chunk',
  ArtifactChunk
>;
export type ArtifactPersistenceAcknowledgementMessage = BaseAcquisitionMessage<
  'artifact_persistence_acknowledgement',
  ArtifactPersistenceAcknowledgement
>;
export type ArtifactDeletionResultMessage = BaseAcquisitionMessage<
  'artifact_deletion_result',
  ArtifactDeletionResult
>;
export type RecordingLifecycleEventMessage = BaseAcquisitionMessage<
  'recording_lifecycle_event',
  RecordingLifecycleEvent
>;
export type RecordingActivityAssociationMessage = BaseAcquisitionMessage<
  'recording_activity_association',
  RecordingActivityAssociation
>;

export type AcquisitionMessage =
  | SourceDescriptorMessage
  | StreamDescriptorMessage
  | TelemetryBatchMessage
  | ClockAnchorObservationMessage
  | ClockMappingMessage
  | ArtifactManifestMessage
  | ArtifactChunkMessage
  | ArtifactPersistenceAcknowledgementMessage
  | ArtifactDeletionResultMessage
  | RecordingLifecycleEventMessage
  | RecordingActivityAssociationMessage;
