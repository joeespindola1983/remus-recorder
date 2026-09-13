import { SourceDescriptor } from '../../contracts/acquisition';
import {
  activityCaptureReducer,
  ActivityCaptureState,
  createInitialActivityCapture,
} from './ActivityCapture';

const baseCapabilities = {
  liveTransfer: true,
  volatileResend: false,
  standaloneCapture: true,
  storeAndForward: true,
  postSyncDeletion: false,
  relayCapture: false,
};

export const phoneSource: SourceDescriptor = {
  sourceId: 'phone:primary',
  deviceFamily: 'iphone',
  operationalState: 'available_idle',
  sensorPlacement: 'body',
  placementProvenance: 'device_metadata',
  capabilities: baseCapabilities,
  clockDomains: [
    {
      clockDomainId: 'phone:monotonic',
      clockKind: 'monotonic',
      timestampUnit: 'us',
    },
  ],
};

export const rbp1Source: SourceDescriptor = {
  sourceId: 'rbp1:demo',
  deviceFamily: 'remus_blade',
  deviceModel: 'rbp1',
  operationalState: 'available_idle',
  sensorPlacement: 'paddle',
  placementProvenance: 'device_metadata',
  capabilities: {
    ...baseCapabilities,
    volatileResend: true,
    postSyncDeletion: true,
    relayCapture: true,
    relayModes: ['source_push', 'standard_ble_pull'],
  },
  clockDomains: [
    {
      clockDomainId: 'rbp1:monotonic',
      clockKind: 'monotonic',
      timestampUnit: 'us',
    },
    { clockDomainId: 'rbp1:gnss', clockKind: 'utc', timestampUnit: 'us' },
  ],
};

export const appleWatchSource: SourceDescriptor = {
  sourceId: 'watch:apple:demo',
  deviceFamily: 'apple_watch',
  operationalState: 'available_idle',
  sensorPlacement: 'left_wrist',
  placementProvenance: 'device_metadata',
  capabilities: baseCapabilities,
  clockDomains: [
    {
      clockDomainId: 'watch:monotonic',
      clockKind: 'monotonic',
      timestampUnit: 'us',
    },
  ],
};

export const createDemoActivityCapture = (): ActivityCaptureState => {
  const initialState = createInitialActivityCapture(phoneSource);
  let state: ActivityCaptureState = {
    ...initialState,
    sources: {
      ...initialState.sources,
      [phoneSource.sourceId]: {
        ...initialState.sources[phoneSource.sourceId],
        readiness: {
          sourceConnectionState: 'connected',
          batteryLevelPercent: 92,
          availableMeasurementIdentifiers: [
            'positionWgs84',
            'horizontalAccuracyMeters',
            'accelerationIncludingGravityG',
            'rotationRateRadiansPerSecond',
          ],
          liveTelemetryState: 'qualified',
        },
      },
    },
  };
  state = activityCaptureReducer(state, {
    type: 'source_discovered',
    source: rbp1Source,
    readiness: {
      sourceConnectionState: 'connected',
      batteryLevelPercent: 84,
      availableMeasurementIdentifiers: [
        'positionWgs84',
        'horizontalAccuracyMeters',
        'accelerationIncludingGravityG',
        'rotationRateRadiansPerSecond',
      ],
      liveTelemetryState: 'qualified',
    },
  });
  state = activityCaptureReducer(state, {
    type: 'source_discovered',
    source: appleWatchSource,
    readiness: {
      sourceConnectionState: 'connected',
      batteryLevelPercent: 72,
      availableMeasurementIdentifiers: ['heartRateBeatsPerMinute'],
      liveTelemetryState: 'qualified',
    },
  });
  return activityCaptureReducer(state, {
    type: 'source_discovered',
    source: speedCoachSource,
    readiness: {
      sourceConnectionState: 'detected',
      availableMeasurementIdentifiers: [],
      liveTelemetryState: 'evaluation_pending',
    },
  });
};

export const speedCoachSource: SourceDescriptor = {
  sourceId: 'instrument:speedcoach:demo',
  deviceFamily: 'speedcoach',
  operationalState: 'available_idle',
  sensorPlacement: 'hull',
  placementProvenance: 'device_metadata',
  capabilities: {
    ...baseCapabilities,
    standaloneCapture: true,
    storeAndForward: false,
  },
  clockDomains: [
    {
      clockDomainId: 'speedcoach:clock',
      clockKind: 'unknown',
      timestampUnit: 'us',
    },
  ],
};
