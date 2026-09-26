import {
  ACQUISITION_CONTRACT_VERSION,
  type AcquisitionMessage,
  type MeasurementIdentifier,
  type MeasurementUnit,
  type ValueShape,
} from './types';

export type AcquisitionValidationResult =
  | {ok: true}
  | {ok: false; errors: string[]};

type UnknownRecord = Record<string, unknown>;

const DECIMAL_INTEGER = /^(0|[1-9][0-9]*)$/;
const SHA_256 = /^[a-f0-9]{64}$/;

const streamSemantics: Record<
  MeasurementIdentifier,
  {unit: MeasurementUnit; shape: ValueShape; frameId?: string}
> = {
  positionWgs84: {unit: 'deg', shape: 'position_wgs84', frameId: 'wgs84'},
  horizontalAccuracyMeters: {unit: 'm', shape: 'scalar'},
  altitudeMeters: {unit: 'm', shape: 'scalar'},
  verticalAccuracyMeters: {unit: 'm', shape: 'scalar'},
  groundSpeedMetersPerSecond: {unit: 'm/s', shape: 'scalar'},
  speedAccuracyMetersPerSecond: {unit: 'm/s', shape: 'scalar'},
  courseDegrees: {unit: 'deg', shape: 'scalar'},
  courseAccuracyDegrees: {unit: 'deg', shape: 'scalar'},
  headingDegrees: {unit: 'deg', shape: 'scalar'},
  accelerationIncludingGravityG: {unit: 'g', shape: 'vector3'},
  linearAccelerationG: {unit: 'g', shape: 'vector3'},
  gravityG: {unit: 'g', shape: 'vector3'},
  rotationRateRadiansPerSecond: {unit: 'rad/s', shape: 'vector3'},
  heartRateBeatsPerMinute: {unit: 'bpm', shape: 'scalar'},
  strokeRateSpm: {unit: 'strokes/min', shape: 'scalar'},
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(
  value: unknown,
  path: string,
  errors: string[],
): UnknownRecord | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  return value;
}

function requireString(
  object: UnknownRecord,
  field: string,
  path: string,
  errors: string[],
): string | undefined {
  const value = object[field];
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${path}.${field} must be a non-empty string`);
    return undefined;
  }
  return value;
}

function requireDecimal(
  object: UnknownRecord,
  field: string,
  path: string,
  errors: string[],
): string | undefined {
  const value = requireString(object, field, path, errors);
  if (value !== undefined && !DECIMAL_INTEGER.test(value)) {
    errors.push(`${path}.${field} must be a decimal integer string`);
    return undefined;
  }
  return value;
}

function requireFiniteNumber(
  object: UnknownRecord,
  field: string,
  path: string,
  errors: string[],
): number | undefined {
  const value = object[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path}.${field} must be a finite number`);
    return undefined;
  }
  return value;
}

function requireBoolean(
  object: UnknownRecord,
  field: string,
  path: string,
  errors: string[],
): boolean | undefined {
  const value = object[field];
  if (typeof value !== 'boolean') {
    errors.push(`${path}.${field} must be a boolean`);
    return undefined;
  }
  return value;
}

function rejectUnknownFields(
  object: UnknownRecord,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  if (Object.keys(object).some(key => !allowed.includes(key))) {
    errors.push(`${path} contains unsupported fields`);
  }
}

function validateSourceDescriptor(payload: UnknownRecord, errors: string[]) {
  const path = 'source_descriptor';
  requireString(payload, 'sourceId', path, errors);
  requireString(payload, 'deviceFamily', path, errors);
  requireString(payload, 'sensorPlacement', path, errors);
  requireString(payload, 'placementProvenance', path, errors);

  const operationalState = requireString(
    payload,
    'operationalState',
    path,
    errors,
  );
  const operationalStates = [
    'available_idle',
    'preparing_capture',
    'capturing',
    'shutting_down',
    'unavailable',
  ];
  if (operationalState && !operationalStates.includes(operationalState)) {
    errors.push(`${path}.operationalState is unsupported`);
  }
  if (
    operationalState &&
    ['preparing_capture', 'capturing', 'shutting_down'].includes(
      operationalState,
    )
  ) {
    requireString(payload, 'recordingId', path, errors);
  }
  if (operationalState === 'available_idle' && payload.recordingId !== undefined) {
    errors.push(`${path}.recordingId must be absent while available_idle`);
  }

  const capabilities = requireRecord(payload.capabilities, `${path}.capabilities`, errors);
  if (capabilities) {
    for (const field of [
      'liveTransfer',
      'volatileResend',
      'standaloneCapture',
      'storeAndForward',
      'postSyncDeletion',
      'relayCapture',
    ]) {
      requireBoolean(capabilities, field, `${path}.capabilities`, errors);
    }
    if (capabilities.standaloneCapture === true && capabilities.storeAndForward !== true) {
      errors.push(`${path}.capabilities standaloneCapture requires storeAndForward`);
    }
  }

  if (!Array.isArray(payload.clockDomains) || payload.clockDomains.length === 0) {
    errors.push(`${path}.clockDomains must contain at least one clock domain`);
  } else {
    payload.clockDomains.forEach((candidate, index) => {
      const clock = requireRecord(candidate, `${path}.clockDomains[${index}]`, errors);
      if (!clock) return;
      requireString(clock, 'clockDomainId', `${path}.clockDomains[${index}]`, errors);
      if (clock.timestampUnit !== 'us') {
        errors.push(`${path}.clockDomains[${index}].timestampUnit must be us`);
      }
    });
  }
}

function validateStreamDescriptor(payload: UnknownRecord, errors: string[]) {
  const path = 'stream_descriptor';
  for (const field of [
    'sensorStreamId',
    'sourceId',
    'recordingId',
    'physicalSensorGroupId',
    'clockDomainId',
  ]) {
    requireString(payload, field, path, errors);
  }

  const identifier = payload.measurementIdentifier;
  if (typeof identifier !== 'string' || !(identifier in streamSemantics)) {
    errors.push(`${path}.measurementIdentifier is unsupported`);
    return;
  }
  const expected = streamSemantics[identifier as MeasurementIdentifier];
  if (payload.unit !== expected.unit) {
    errors.push(`${path}.unit must be ${expected.unit} for ${identifier}`);
  }
  if (payload.valueShape !== expected.shape) {
    errors.push(`${path}.valueShape must be ${expected.shape} for ${identifier}`);
  }
  if (expected.frameId && payload.frameId !== expected.frameId) {
    errors.push(`${path}.frameId must be ${expected.frameId} for ${identifier}`);
  }

  const cadence = requireRecord(payload.cadence, `${path}.cadence`, errors);
  if (cadence?.mode === 'fixed') {
    const rate = requireFiniteNumber(
      cadence,
      'targetSamplingRateHertz',
      `${path}.cadence`,
      errors,
    );
    if (rate !== undefined && rate <= 0) {
      errors.push(`${path}.cadence.targetSamplingRateHertz must be positive`);
    }
  } else if (cadence?.mode !== 'source_driven') {
    errors.push(`${path}.cadence.mode is unsupported`);
  }
}

function validateSampleValue(value: unknown, path: string, errors: string[]) {
  const sampleValue = requireRecord(value, path, errors);
  if (!sampleValue) return;

  switch (sampleValue.kind) {
    case 'scalar':
      rejectUnknownFields(sampleValue, ['kind', 'value'], path, errors);
      requireFiniteNumber(sampleValue, 'value', path, errors);
      break;
    case 'vector3':
      rejectUnknownFields(sampleValue, ['kind', 'x', 'y', 'z'], path, errors);
      for (const axis of ['x', 'y', 'z']) {
        requireFiniteNumber(sampleValue, axis, path, errors);
      }
      break;
    case 'position_wgs84': {
      rejectUnknownFields(
        sampleValue,
        [
          'kind',
          'latitudeDegrees',
          'longitudeDegrees',
          'altitudeMeters',
          'verticalDatum',
        ],
        path,
        errors,
      );
      const latitude = requireFiniteNumber(sampleValue, 'latitudeDegrees', path, errors);
      const longitude = requireFiniteNumber(sampleValue, 'longitudeDegrees', path, errors);
      if (latitude !== undefined && (latitude < -90 || latitude > 90)) {
        errors.push(`${path}.latitudeDegrees is outside WGS84 bounds`);
      }
      if (longitude !== undefined && (longitude < -180 || longitude > 180)) {
        errors.push(`${path}.longitudeDegrees is outside WGS84 bounds`);
      }
      if (
        sampleValue.altitudeMeters !== undefined &&
        (typeof sampleValue.altitudeMeters !== 'number' ||
          !Number.isFinite(sampleValue.altitudeMeters))
      ) {
        errors.push(`${path}.altitudeMeters must be a finite number when present`);
      }
      break;
    }
    default:
      errors.push(`${path}.kind is unsupported`);
  }
}

function validateTelemetryBatch(payload: UnknownRecord, errors: string[]) {
  const path = 'telemetry_batch';
  for (const field of ['telemetryBatchId', 'sourceId', 'recordingId', 'sensorStreamId']) {
    requireString(payload, field, path, errors);
  }
  const first = requireDecimal(payload, 'firstSequenceNumber', path, errors);
  const last = requireDecimal(payload, 'lastSequenceNumber', path, errors);
  if (first && last && BigInt(first) > BigInt(last)) {
    errors.push(`${path}.firstSequenceNumber must not exceed lastSequenceNumber`);
  }
  if (!Array.isArray(payload.samples)) {
    errors.push(`${path}.samples must be an array`);
  } else {
    payload.samples.forEach((candidate, index) => {
      const samplePath = `${path}.samples[${index}]`;
      const sample = requireRecord(candidate, samplePath, errors);
      if (!sample) return;
      requireDecimal(sample, 'sequenceNumber', samplePath, errors);
      requireDecimal(sample, 'nativeTimestampMicroseconds', samplePath, errors);
      if (sample.receivedAtUtcMicroseconds !== undefined) {
        requireDecimal(sample, 'receivedAtUtcMicroseconds', samplePath, errors);
      }
      validateSampleValue(sample.value, `${samplePath}.value`, errors);
    });
  }
  if (payload.declaredGaps !== undefined) {
    if (!Array.isArray(payload.declaredGaps)) {
      errors.push(`${path}.declaredGaps must be an array`);
    } else {
      payload.declaredGaps.forEach((candidate, index) => {
        const gapPath = `${path}.declaredGaps[${index}]`;
        const gap = requireRecord(candidate, gapPath, errors);
        if (!gap) return;
        requireDecimal(gap, 'firstSequenceNumber', gapPath, errors);
        requireDecimal(gap, 'lastSequenceNumber', gapPath, errors);
        requireString(gap, 'reason', gapPath, errors);
      });
    }
  }
}

function validateClockAnchor(payload: UnknownRecord, errors: string[]) {
  const path = 'clock_anchor_observation';
  for (const field of [
    'clockAnchorObservationId',
    'sourceId',
    'recordingId',
    'sourceClockDomainId',
    'comparisonClockDomainId',
    'observationMethod',
  ]) {
    requireString(payload, field, path, errors);
  }
  for (const field of [
    'sourceTimestampMicroseconds',
    'comparisonTimestampMicroseconds',
    'uncertaintyMicroseconds',
  ]) {
    requireDecimal(payload, field, path, errors);
  }
}

function validateClockMapping(payload: UnknownRecord, errors: string[]) {
  const path = 'clock_mapping';
  for (const field of [
    'clockMappingId',
    'sourceClockDomainId',
    'comparisonClockDomainId',
    'mappingMethod',
    'mappingQuality',
  ]) {
    requireString(payload, field, path, errors);
  }
  for (const field of [
    'sourceAnchorMicroseconds',
    'comparisonAnchorMicroseconds',
    'validFromSourceMicroseconds',
    'validThroughSourceMicroseconds',
    'maximumErrorMicroseconds',
  ]) {
    requireDecimal(payload, field, path, errors);
  }
  requireFiniteNumber(payload, 'scale', path, errors);
  if (
    !Array.isArray(payload.supportingClockAnchorObservationIds) ||
    payload.supportingClockAnchorObservationIds.length === 0
  ) {
    errors.push(`${path}.supportingClockAnchorObservationIds must not be empty`);
  }
}

function validateSha256(
  object: UnknownRecord,
  field: string,
  path: string,
  errors: string[],
) {
  const digest = requireString(object, field, path, errors);
  if (digest !== undefined && !SHA_256.test(digest)) {
    errors.push(`${path}.${field} must be a lowercase SHA-256 digest`);
  }
}

function validateArtifactManifest(payload: UnknownRecord, errors: string[]) {
  const path = 'artifact_manifest';
  for (const field of ['artifactId', 'sourceId', 'recordingId']) {
    requireString(payload, field, path, errors);
  }
  requireDecimal(payload, 'byteLength', path, errors);
  validateSha256(payload, 'contentSha256', path, errors);
  const chunkSize = requireFiniteNumber(payload, 'chunkSizeBytes', path, errors);
  if (chunkSize !== undefined && (!Number.isInteger(chunkSize) || chunkSize <= 0)) {
    errors.push(`${path}.chunkSizeBytes must be a positive integer`);
  }
  if (payload.artifactFormat !== 'remus_acquisition_v1') {
    errors.push(`${path}.artifactFormat is unsupported`);
  }
  if (payload.finalized !== true) {
    errors.push(`${path}.finalized must be true`);
  }
  if (!Array.isArray(payload.sensorStreamIds)) {
    errors.push(`${path}.sensorStreamIds must be an array`);
  }
}

function validateArtifactChunk(payload: UnknownRecord, errors: string[]) {
  const path = 'artifact_chunk';
  requireString(payload, 'artifactId', path, errors);
  requireString(payload, 'artifactPartId', path, errors);
  requireDecimal(payload, 'offsetBytes', path, errors);
  const length = requireFiniteNumber(payload, 'byteLength', path, errors);
  if (length !== undefined && (!Number.isInteger(length) || length <= 0)) {
    errors.push(`${path}.byteLength must be a positive integer`);
  }
  requireString(payload, 'contentBase64', path, errors);
  validateSha256(payload, 'chunkSha256', path, errors);
}

function validatePersistenceAcknowledgement(
  payload: UnknownRecord,
  errors: string[],
) {
  const path = 'artifact_persistence_acknowledgement';
  requireString(payload, 'artifactId', path, errors);
  requireString(payload, 'recordingId', path, errors);
  requireDecimal(payload, 'byteLength', path, errors);
  validateSha256(payload, 'contentSha256', path, errors);
  requireString(payload, 'persistenceStatus', path, errors);
  if (payload.persistedAtUtcMicroseconds !== undefined) {
    requireDecimal(payload, 'persistedAtUtcMicroseconds', path, errors);
  }
  if (
    payload.persistenceStatus === 'persisted_verified' &&
    payload.persistedAtUtcMicroseconds === undefined
  ) {
    errors.push(
      `${path}.persistedAtUtcMicroseconds is required for persisted_verified`,
    );
  }
}

function validateDeletionResult(payload: UnknownRecord, errors: string[]) {
  const path = 'artifact_deletion_result';
  requireString(payload, 'artifactId', path, errors);
  requireString(payload, 'acknowledgementMessageId', path, errors);
  requireString(payload, 'deletionStatus', path, errors);
}

function validateRecordingLifecycleEvent(
  payload: UnknownRecord,
  errors: string[],
) {
  const path = 'recording_lifecycle_event';
  for (const field of [
    'recordingLifecycleEventId',
    'sourceId',
    'recordingId',
    'bootId',
  ]) {
    requireString(payload, field, path, errors);
  }
  requireDecimal(payload, 'nativeTimestampMicroseconds', path, errors);
  const eventKind = requireString(payload, 'eventKind', path, errors);
  const eventKinds = [
    'recording_started',
    'stop_intent_journaled',
    'recording_finalized',
    'recording_interrupted',
  ];
  if (eventKind && !eventKinds.includes(eventKind)) {
    errors.push(`${path}.eventKind is unsupported`);
  }

  if (eventKind === 'recording_started') {
    const startCause = requireString(payload, 'startCause', path, errors);
    if (
      startCause &&
      !['app_commit', 'local_action', 'autonomous_policy'].includes(startCause)
    ) {
      errors.push(`${path}.startCause is unsupported`);
    }
    if (startCause === 'app_commit') {
      requireString(payload, 'activityCorrelationId', path, errors);
    }
  } else if (
    eventKind === 'stop_intent_journaled' ||
    eventKind === 'recording_finalized' ||
    eventKind === 'recording_interrupted'
  ) {
    const reason = requireString(payload, 'finalizationReason', path, errors);
    const reasons = [
      'app_stop',
      'local_stop',
      'user_power_off',
      'control_lease_expired',
      'power_depleted',
      'power_loss',
      'telemetry_timeout',
      'storage_exhausted',
    ];
    if (reason && !reasons.includes(reason)) {
      errors.push(`${path}.finalizationReason is unsupported`);
    }
  }

  if (payload.disconnectGracePeriodMilliseconds !== undefined) {
    const grace = requireFiniteNumber(
      payload,
      'disconnectGracePeriodMilliseconds',
      path,
      errors,
    );
    if (grace !== undefined && (!Number.isInteger(grace) || grace <= 0)) {
      errors.push(
        `${path}.disconnectGracePeriodMilliseconds must be a positive integer`,
      );
    }
  }
}

function validateRecordingActivityAssociation(
  payload: UnknownRecord,
  errors: string[],
) {
  const path = 'recording_activity_association';
  requireString(payload, 'recordingActivityAssociationId', path, errors);
  requireString(payload, 'recordingId', path, errors);
  const state = requireString(payload, 'associationState', path, errors);
  const method = requireString(payload, 'associationMethod', path, errors);
  requireDecimal(payload, 'attributedAtUtcMicroseconds', path, errors);

  const states = [
    'unassociated',
    'suggested',
    'confirmed',
    'rejected',
    'needs_review',
  ];
  if (state && !states.includes(state)) {
    errors.push(`${path}.associationState is unsupported`);
  }
  const methods = [
    'exact_shared_correlation',
    'user_confirmation',
    'heuristic_suggestion',
    'system_recovery',
  ];
  if (method && !methods.includes(method)) {
    errors.push(`${path}.associationMethod is unsupported`);
  }
  if (
    state &&
    ['suggested', 'confirmed', 'rejected'].includes(state) &&
    typeof payload.activityId !== 'string'
  ) {
    errors.push(`${path}.activityId is required for ${state}`);
  }
  if (state === 'confirmed' && method === 'heuristic_suggestion') {
    errors.push(`${path} cannot confirm an association from heuristics alone`);
  }
  if (
    method === 'exact_shared_correlation' &&
    typeof payload.activityCorrelationId !== 'string'
  ) {
    errors.push(`${path}.activityCorrelationId is required for exact correlation`);
  }

  const start =
    payload.includedStartNativeTimestampMicroseconds === undefined
      ? undefined
      : requireDecimal(
          payload,
          'includedStartNativeTimestampMicroseconds',
          path,
          errors,
        );
  const end =
    payload.includedEndNativeTimestampMicroseconds === undefined
      ? undefined
      : requireDecimal(
          payload,
          'includedEndNativeTimestampMicroseconds',
          path,
          errors,
        );
  if (start && end && BigInt(start) > BigInt(end)) {
    errors.push(`${path}.included time range is inverted`);
  }
  if (!Array.isArray(payload.reasonCodes)) {
    errors.push(`${path}.reasonCodes must be an array`);
  } else if (method === 'heuristic_suggestion' && payload.reasonCodes.length === 0) {
    errors.push(`${path}.reasonCodes must explain a heuristic suggestion`);
  }
}

export function validateAcquisitionMessage(
  candidate: unknown,
): AcquisitionValidationResult {
  const errors: string[] = [];
  const message = requireRecord(candidate, 'message', errors);
  if (!message) return {ok: false, errors};

  if (message.contractVersion !== ACQUISITION_CONTRACT_VERSION) {
    errors.push(`message.contractVersion is unsupported`);
  }
  requireString(message, 'messageId', 'message', errors);
  const kind = requireString(message, 'messageKind', 'message', errors);
  const payload = requireRecord(message.payload, kind ?? 'payload', errors);
  if (!payload || !kind) return {ok: false, errors};

  switch (kind as AcquisitionMessage['messageKind']) {
    case 'source_descriptor':
      validateSourceDescriptor(payload, errors);
      break;
    case 'stream_descriptor':
      validateStreamDescriptor(payload, errors);
      break;
    case 'telemetry_batch':
      validateTelemetryBatch(payload, errors);
      break;
    case 'clock_anchor_observation':
      validateClockAnchor(payload, errors);
      break;
    case 'clock_mapping':
      validateClockMapping(payload, errors);
      break;
    case 'artifact_manifest':
      validateArtifactManifest(payload, errors);
      break;
    case 'artifact_chunk':
      validateArtifactChunk(payload, errors);
      break;
    case 'artifact_persistence_acknowledgement':
      validatePersistenceAcknowledgement(payload, errors);
      break;
    case 'artifact_deletion_result':
      validateDeletionResult(payload, errors);
      break;
    case 'recording_lifecycle_event':
      validateRecordingLifecycleEvent(payload, errors);
      break;
    case 'recording_activity_association':
      validateRecordingActivityAssociation(payload, errors);
      break;
    default:
      errors.push(`message.messageKind is unsupported`);
  }

  return errors.length === 0 ? {ok: true} : {ok: false, errors};
}
