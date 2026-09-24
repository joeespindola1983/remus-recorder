import { Platform } from 'react-native';
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
  deviceFamily: Platform.OS === 'android' ? 'android_phone' : 'iphone',
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
  sourceId: 'rbp1:primary',
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
  sourceId: 'watch:apple:primary',
  deviceFamily: 'apple_watch',
  operationalState: 'available_idle',
  sensorPlacement: 'left_wrist',
  placementProvenance: 'device_metadata',
  capabilities: {
    ...baseCapabilities,
    standaloneCapture: false,
    storeAndForward: false,
  },
  clockDomains: [
    {
      clockDomainId: 'watch:monotonic',
      clockKind: 'monotonic',
      timestampUnit: 'us',
    },
  ],
};

export const wearOSSource: SourceDescriptor = {
  ...appleWatchSource,
  sourceId: 'watch:wear-os:primary',
  deviceFamily: 'wear_os',
  clockDomains: [
    {
      clockDomainId: 'wear-os:health-services',
      clockKind: 'monotonic',
      timestampUnit: 'us',
    },
  ],
};

export const createDemoActivityCapture = (
  initialConnectionMode: 'connected' | 'unavailable' = 'connected',
  wearableFamily: 'apple_watch' | 'wear_os' = 'apple_watch',
): ActivityCaptureState => {
  const wearableSource = wearableFamily === 'apple_watch' ? appleWatchSource : wearOSSource;
  const initialState = createInitialActivityCapture(phoneSource);
  let state: ActivityCaptureState = {
    ...initialState,
    sources: {
      ...initialState.sources,
      [phoneSource.sourceId]: {
        ...initialState.sources[phoneSource.sourceId],
        readiness: initialConnectionMode === 'connected' ? {
          sourceConnectionState: 'connected',
          batteryLevelPercent: 92,
          availableMeasurementIdentifiers: [
            'positionWgs84',
            'horizontalAccuracyMeters',
            'accelerationIncludingGravityG',
            'rotationRateRadiansPerSecond',
          ],
          liveTelemetryState: 'qualified',
        } : {
          sourceConnectionState: 'unavailable',
          availableMeasurementIdentifiers: [],
          liveTelemetryState: 'evaluation_pending',
        },
      },
    },
  };
  state = activityCaptureReducer(state, {
    type: 'source_discovered',
    source: rbp1Source,
    readiness: initialConnectionMode === 'connected' ? {
      sourceConnectionState: 'connected',
      batteryLevelPercent: 84,
      availableMeasurementIdentifiers: [
        'positionWgs84',
        'horizontalAccuracyMeters',
        'accelerationIncludingGravityG',
        'rotationRateRadiansPerSecond',
      ],
      liveTelemetryState: 'qualified',
    } : {
      sourceConnectionState: 'unavailable',
      availableMeasurementIdentifiers: [],
      liveTelemetryState: 'evaluation_pending',
    },
  });
  state = activityCaptureReducer(state, {
    type: 'source_discovered',
    source: wearableSource,
    readiness: initialConnectionMode === 'connected' ? {
      sourceConnectionState: 'connected',
      batteryLevelPercent: 72,
      availableMeasurementIdentifiers: ['heartRateBeatsPerMinute'],
      liveTelemetryState: 'qualified',
    } : {
      sourceConnectionState: 'unavailable',
      availableMeasurementIdentifiers: [],
      liveTelemetryState: 'evaluation_pending',
    },
  });
  return state;
};

export const createActivityCapture = (
  initialConnectionMode: 'connected' | 'unavailable' = 'unavailable',
  wearableFamily: 'apple_watch' | 'wear_os' = 'apple_watch',
): ActivityCaptureState => {
  const wearableSource = wearableFamily === 'apple_watch' ? appleWatchSource : wearOSSource;
  const initialState = createInitialActivityCapture(phoneSource);
  let state: ActivityCaptureState = {
    ...initialState,
    sources: {
      ...initialState.sources,
      [phoneSource.sourceId]: {
        ...initialState.sources[phoneSource.sourceId],
        readiness: initialConnectionMode === 'connected' ? {
          sourceConnectionState: 'connected',
          batteryLevelPercent: 92,
          availableMeasurementIdentifiers: [
            'positionWgs84',
            'horizontalAccuracyMeters',
            'accelerationIncludingGravityG',
            'rotationRateRadiansPerSecond',
          ],
          liveTelemetryState: 'qualified',
        } : {
          sourceConnectionState: 'unavailable',
          availableMeasurementIdentifiers: [],
          liveTelemetryState: 'evaluation_pending',
        },
      },
    },
  };
  state = activityCaptureReducer(state, {
    type: 'source_discovered',
    source: wearableSource,
    readiness: initialConnectionMode === 'connected' ? {
      sourceConnectionState: 'connected',
      batteryLevelPercent: 72,
      availableMeasurementIdentifiers: ['heartRateBeatsPerMinute'],
      liveTelemetryState: 'qualified',
    } : {
      sourceConnectionState: 'unavailable',
      availableMeasurementIdentifiers: [],
      liveTelemetryState: 'evaluation_pending',
    },
  });
  return state;
};
