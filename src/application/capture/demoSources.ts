import {SourceDescriptor} from '../../contracts/acquisition';
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
  clockDomains: [{clockDomainId: 'phone:monotonic', clockKind: 'monotonic', timestampUnit: 'us'}],
};

export const rbp1Source: SourceDescriptor = {
  sourceId: 'rbp1:demo',
  deviceFamily: 'remus_blade_p1',
  deviceModel: 'RBP1',
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
    {clockDomainId: 'rbp1:monotonic', clockKind: 'monotonic', timestampUnit: 'us'},
    {clockDomainId: 'rbp1:gnss', clockKind: 'utc', timestampUnit: 'us'},
  ],
};

export const appleWatchSource: SourceDescriptor = {
  sourceId: 'watch:apple:demo',
  deviceFamily: 'apple_watch',
  operationalState: 'available_idle',
  sensorPlacement: 'left_wrist',
  placementProvenance: 'device_metadata',
  capabilities: baseCapabilities,
  clockDomains: [{clockDomainId: 'watch:monotonic', clockKind: 'monotonic', timestampUnit: 'us'}],
};

export const createDemoActivityCapture = (): ActivityCaptureState => {
  let state = createInitialActivityCapture(phoneSource);
  state = activityCaptureReducer(state, {type: 'source_discovered', source: rbp1Source});
  return activityCaptureReducer(state, {type: 'source_discovered', source: appleWatchSource});
};
