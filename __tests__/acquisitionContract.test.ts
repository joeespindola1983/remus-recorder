import {
  canDeleteSourceArtifact,
  validateAcquisitionMessage,
  type AcquisitionMessage,
  type ArtifactManifestMessage,
  type ArtifactPersistenceAcknowledgementMessage,
} from '../src/contracts/acquisition';

const clone = <Value>(value: Value): Value =>
  JSON.parse(JSON.stringify(value)) as Value;

const sourceDescriptor: AcquisitionMessage = {
  contractVersion: '1.0.0',
  messageId: 'msg-source-rbp1-001',
  messageKind: 'source_descriptor',
  payload: {
    sourceId: 'source-rbp1-port',
    recordingId: 'recording-rbp1-port-001',
    deviceFamily: 'remus_blade',
    deviceModel: 'rbp1',
    hardwareRevision: 'prototype-a',
    firmwareVersion: '0.1.0-dev',
    operationalState: 'capturing',
    sensorPlacement: 'oar',
    placementProvenance: 'user_declared',
    capabilities: {
      liveTransfer: true,
      volatileResend: true,
      standaloneCapture: true,
      storeAndForward: true,
      postSyncDeletion: true,
      relayCapture: true,
      relayModes: ['source_push', 'standard_ble_pull'],
    },
    clockDomains: [
      {
        clockDomainId: 'clock-rbp1-monotonic',
        clockKind: 'monotonic',
        timestampUnit: 'us',
      },
      {
        clockDomainId: 'clock-rbp1-gnss-utc',
        clockKind: 'utc',
        timestampUnit: 'us',
      },
    ],
  },
};

const positionStream: AcquisitionMessage = {
  contractVersion: '1.0.0',
  messageId: 'msg-stream-position-001',
  messageKind: 'stream_descriptor',
  payload: {
    sensorStreamId: 'stream-rbp1-position',
    sourceId: 'source-rbp1-port',
    recordingId: 'recording-rbp1-port-001',
    physicalSensorGroupId: 'reb-4126-gnss',
    clockDomainId: 'clock-rbp1-gnss-utc',
    measurementIdentifier: 'positionWgs84',
    unit: 'deg',
    valueShape: 'position_wgs84',
    frameId: 'wgs84',
    timestampSemantics: 'fix_time',
    measurementStage: 'source_reported',
    evaluationRole: 'estimator_input',
    cadence: { mode: 'source_driven' },
  },
};

const positionBatch: AcquisitionMessage = {
  contractVersion: '1.0.0',
  messageId: 'msg-batch-position-001',
  messageKind: 'telemetry_batch',
  payload: {
    telemetryBatchId: 'batch-rbp1-position-001',
    sourceId: 'source-rbp1-port',
    recordingId: 'recording-rbp1-port-001',
    sensorStreamId: 'stream-rbp1-position',
    firstSequenceNumber: '41',
    lastSequenceNumber: '42',
    samples: [
      {
        sequenceNumber: '41',
        nativeTimestampMicroseconds: '1726106400000000',
        value: {
          kind: 'position_wgs84',
          latitudeDegrees: -22.9068,
          longitudeDegrees: -43.1729,
        },
      },
      {
        sequenceNumber: '42',
        nativeTimestampMicroseconds: '1726106401000000',
        value: {
          kind: 'position_wgs84',
          latitudeDegrees: -22.9067,
          longitudeDegrees: -43.1728,
          altitudeMeters: 3.2,
          verticalDatum: 'wgs84_ellipsoid',
        },
      },
    ],
  },
};

describe('acquisition contract v1', () => {
  it.each([
    sourceDescriptor,
    positionStream,
    positionBatch,
  ])('accepts a valid $messageKind message', message => {
    expect(validateAcquisitionMessage(message)).toEqual({ ok: true });
  });

  it('keeps GNSS position, ground speed, course and quality as independent streams', () => {
    const invalidCompositePosition = clone(positionBatch);

    if (invalidCompositePosition.messageKind !== 'telemetry_batch') {
      throw new Error('fixture has unexpected kind');
    }

    invalidCompositePosition.payload.samples[0].value = {
      kind: 'position_wgs84',
      latitudeDegrees: -22.9068,
      longitudeDegrees: -43.1729,
      groundSpeedMetersPerSecond: 4.2,
    } as never;

    const result = validateAcquisitionMessage(invalidCompositePosition);
    if (result.ok) {
      throw new Error('invalid composite position was accepted');
    }
    expect(result.errors).toContain(
      'telemetry_batch.samples[0].value contains unsupported fields',
    );
  });

  it('accepts zero as a measured value but rejects null placeholders', () => {
    const zeroSpeed: AcquisitionMessage = {
      contractVersion: '1.0.0',
      messageId: 'msg-speed-zero-001',
      messageKind: 'telemetry_batch',
      payload: {
        telemetryBatchId: 'batch-speed-zero-001',
        sourceId: 'source-phone',
        recordingId: 'recording-phone-001',
        sensorStreamId: 'stream-phone-ground-speed',
        firstSequenceNumber: '0',
        lastSequenceNumber: '0',
        samples: [
          {
            sequenceNumber: '0',
            nativeTimestampMicroseconds: '12000000',
            value: { kind: 'scalar', value: 0 },
          },
        ],
      },
    };

    expect(validateAcquisitionMessage(zeroSpeed)).toEqual({ ok: true });

    const nullSpeed = clone(zeroSpeed);
    if (nullSpeed.messageKind !== 'telemetry_batch') {
      throw new Error('fixture has unexpected kind');
    }
    nullSpeed.payload.samples[0].value = {
      kind: 'scalar',
      value: null,
    } as never;

    expect(validateAcquisitionMessage(nullSpeed).ok).toBe(false);
  });

  it('requires decimal strings for 64-bit timestamps and sequence numbers', () => {
    const unsafeTimestamp = clone(positionBatch);
    if (unsafeTimestamp.messageKind !== 'telemetry_batch') {
      throw new Error('fixture has unexpected kind');
    }
    unsafeTimestamp.payload.samples[0].nativeTimestampMicroseconds =
      1726106400000000 as never;

    expect(validateAcquisitionMessage(unsafeTimestamp).ok).toBe(false);
  });

  it('records explicit sequence gaps instead of manufacturing samples', () => {
    const batchWithGap = clone(positionBatch);
    if (batchWithGap.messageKind !== 'telemetry_batch') {
      throw new Error('fixture has unexpected kind');
    }
    batchWithGap.payload.lastSequenceNumber = '44';
    batchWithGap.payload.declaredGaps = [
      {
        firstSequenceNumber: '43',
        lastSequenceNumber: '44',
        reason: 'volatile_buffer_exhausted',
      },
    ];

    expect(validateAcquisitionMessage(batchWithGap)).toEqual({ ok: true });
  });

  it('accepts an explicit clock anchor and bounded mapping but never invents one', () => {
    const anchor: AcquisitionMessage = {
      contractVersion: '1.0.0',
      messageId: 'msg-clock-anchor-001',
      messageKind: 'clock_anchor_observation',
      payload: {
        clockAnchorObservationId: 'anchor-rbp1-001',
        sourceId: 'source-rbp1-port',
        recordingId: 'recording-rbp1-port-001',
        sourceClockDomainId: 'clock-rbp1-monotonic',
        comparisonClockDomainId: 'clock-rbp1-gnss-utc',
        sourceTimestampMicroseconds: '10000000',
        comparisonTimestampMicroseconds: '1726106400000000',
        observationMethod: 'gnss_utc',
        uncertaintyMicroseconds: '50000',
      },
    };
    const mapping: AcquisitionMessage = {
      contractVersion: '1.0.0',
      messageId: 'msg-clock-map-001',
      messageKind: 'clock_mapping',
      payload: {
        clockMappingId: 'mapping-rbp1-001',
        sourceClockDomainId: 'clock-rbp1-monotonic',
        comparisonClockDomainId: 'clock-rbp1-gnss-utc',
        sourceAnchorMicroseconds: '10000000',
        comparisonAnchorMicroseconds: '1726106400000000',
        scale: 1.000004,
        validFromSourceMicroseconds: '10000000',
        validThroughSourceMicroseconds: '3700000000',
        maximumErrorMicroseconds: '80000',
        mappingMethod: 'piecewise_affine',
        mappingQuality: 'qualified',
        supportingClockAnchorObservationIds: ['anchor-rbp1-001'],
      },
    };

    expect(validateAcquisitionMessage(anchor)).toEqual({ ok: true });
    expect(validateAcquisitionMessage(mapping)).toEqual({ ok: true });

    const unbounded = clone(mapping);
    if (unbounded.messageKind !== 'clock_mapping') {
      throw new Error('fixture has unexpected kind');
    }
    unbounded.payload.maximumErrorMicroseconds = undefined as never;
    expect(validateAcquisitionMessage(unbounded).ok).toBe(false);
  });

  it('allows a future source family without changing the core contract', () => {
    const futureSource = clone(sourceDescriptor);
    if (futureSource.messageKind !== 'source_descriptor') {
      throw new Error('fixture has unexpected kind');
    }
    futureSource.payload.deviceFamily = 'future_gnss_instrument';
    futureSource.payload.deviceModel = 'fg-1';

    expect(validateAcquisitionMessage(futureSource)).toEqual({ ok: true });
  });

  it('keeps powered-on idle availability separate from a recording', () => {
    const idleSource = clone(sourceDescriptor) as unknown as {
      payload: Record<string, unknown>;
    };
    idleSource.payload.operationalState = 'available_idle';
    delete idleSource.payload.recordingId;

    expect(validateAcquisitionMessage(idleSource)).toEqual({ok: true});

    const capturingWithoutRecording = clone(idleSource);
    capturingWithoutRecording.payload.operationalState = 'capturing';
    expect(validateAcquisitionMessage(capturingWithoutRecording).ok).toBe(false);
  });

  it('records attributable RBP1 start and power-off boundaries', () => {
    const started = {
      contractVersion: '1.0.0',
      messageId: 'msg-lifecycle-start-001',
      messageKind: 'recording_lifecycle_event',
      payload: {
        recordingLifecycleEventId: 'lifecycle-start-001',
        sourceId: 'source-rbp1-port',
        recordingId: 'recording-rbp1-port-001',
        bootId: 'boot-rbp1-001',
        nativeTimestampMicroseconds: '12000000',
        eventKind: 'recording_started',
        startCause: 'app_commit',
        activityCorrelationId: 'activity-correlation-001',
        disconnectGracePeriodMilliseconds: 600000,
      },
    };
    const poweredOff = {
      ...started,
      messageId: 'msg-lifecycle-stop-001',
      payload: {
        ...started.payload,
        recordingLifecycleEventId: 'lifecycle-stop-001',
        nativeTimestampMicroseconds: '3720000000',
        eventKind: 'recording_finalized',
        startCause: undefined,
        finalizationReason: 'user_power_off',
      },
    };

    expect(validateAcquisitionMessage(started)).toEqual({ok: true});
    expect(validateAcquisitionMessage(poweredOff)).toEqual({ok: true});
  });

  it('suggests bounded association but never confirms from heuristics alone', () => {
    const suggestion = {
      contractVersion: '1.0.0',
      messageId: 'msg-association-001',
      messageKind: 'recording_activity_association',
      payload: {
        recordingActivityAssociationId: 'association-001',
        recordingId: 'recording-rbp1-port-001',
        activityId: 'activity-phone-001',
        associationState: 'suggested',
        associationMethod: 'heuristic_suggestion',
        includedStartNativeTimestampMicroseconds: '1200000000',
        includedEndNativeTimestampMicroseconds: '3720000000',
        reasonCodes: ['time_overlap', 'route_overlap'],
        attributedAtUtcMicroseconds: '1726106500000000',
      },
    };

    expect(validateAcquisitionMessage(suggestion)).toEqual({ok: true});

    const silentlyConfirmed = clone(suggestion);
    silentlyConfirmed.payload.associationState = 'confirmed';
    expect(validateAcquisitionMessage(silentlyConfirmed).ok).toBe(false);

    const invertedRange = clone(suggestion);
    invertedRange.payload.includedStartNativeTimestampMicroseconds = '4000000000';
    expect(validateAcquisitionMessage(invertedRange).ok).toBe(false);
  });
});

describe('store-and-forward deletion safety', () => {
  const manifest: ArtifactManifestMessage = {
    contractVersion: '1.0.0',
    messageId: 'msg-manifest-001',
    messageKind: 'artifact_manifest',
    payload: {
      artifactId: 'artifact-rbp1-001',
      sourceId: 'source-rbp1-port',
      recordingId: 'recording-rbp1-port-001',
      byteLength: '1048576',
      contentSha256:
        '5f70bf18a08660b5e02d9ed1507be88ac7d6d0793344a5f3c91b35f71e9e6b4d',
      chunkSizeBytes: 4096,
      artifactFormat: 'remus_acquisition_v1',
      captureMode: 'autonomous',
      sensorStreamIds: ['stream-rbp1-position'],
      finalized: true,
    },
  };

  const acknowledgement: ArtifactPersistenceAcknowledgementMessage = {
    contractVersion: '1.0.0',
    messageId: 'msg-artifact-ack-001',
    messageKind: 'artifact_persistence_acknowledgement',
    payload: {
      artifactId: 'artifact-rbp1-001',
      recordingId: 'recording-rbp1-port-001',
      byteLength: '1048576',
      contentSha256:
        '5f70bf18a08660b5e02d9ed1507be88ac7d6d0793344a5f3c91b35f71e9e6b4d',
      persistenceStatus: 'persisted_verified',
      persistedAtUtcMicroseconds: '1726106500000000',
    },
  };

  it('authorizes deletion only for the exact finalized artifact verified by the app', () => {
    expect(canDeleteSourceArtifact(manifest, acknowledgement)).toBe(true);

    expect(
      canDeleteSourceArtifact(manifest, {
        ...acknowledgement,
        payload: {
          ...acknowledgement.payload,
          contentSha256:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      }),
    ).toBe(false);

    expect(
      canDeleteSourceArtifact(manifest, {
        ...acknowledgement,
        payload: {
          ...acknowledgement.payload,
          persistenceStatus: 'partial',
        },
      }),
    ).toBe(false);
  });

  it('rejects a manifest that is incomplete or uses an invalid digest', () => {
    expect(validateAcquisitionMessage(manifest)).toEqual({ ok: true });

    const invalidManifest = clone(manifest);
    invalidManifest.payload.finalized = false as never;
    invalidManifest.payload.contentSha256 = 'not-a-sha256';

    expect(validateAcquisitionMessage(invalidManifest).ok).toBe(false);
  });
});
