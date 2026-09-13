import {appleWatchSource, phoneSource, rbp1Source} from '../capture/demoSources';
import {CaptureScenarioStep} from './CaptureSimulator';

export const appOnlyCaptureScenario: readonly CaptureScenarioStep[] = [
  {
    type: 'commit_capture',
    activityId: 'activity:app-only',
    activityCorrelationId: 'correlation:app-only',
    recordingIdsBySource: {[phoneSource.sourceId]: 'recording:phone:app-only'},
  },
  {type: 'advance_time', seconds: 1800, metrics: {distanceMeters: 6000}},
  {type: 'request_stop'},
  {type: 'finalize_source', sourceId: phoneSource.sourceId, reason: 'app_stop'},
];

export const watchPowerDepletionScenario: readonly CaptureScenarioStep[] = [
  {
    type: 'commit_capture',
    activityId: 'activity:watch-power',
    activityCorrelationId: 'correlation:watch-power',
    recordingIdsBySource: {
      [phoneSource.sourceId]: 'recording:phone:watch-power',
      [rbp1Source.sourceId]: 'recording:rbp1:watch-power',
      [appleWatchSource.sourceId]: 'recording:watch:watch-power',
    },
  },
  {type: 'advance_time', seconds: 600},
  {type: 'interrupt_source', sourceId: appleWatchSource.sourceId, reason: 'power_depleted'},
  {type: 'advance_time', seconds: 300},
];

export const disconnectedRbp1TransferScenario: readonly CaptureScenarioStep[] = [
  {
    type: 'commit_capture',
    activityId: 'activity:rbp1-transfer',
    activityCorrelationId: 'correlation:rbp1-transfer',
    recordingIdsBySource: {
      [phoneSource.sourceId]: 'recording:phone:rbp1-transfer',
      [rbp1Source.sourceId]: 'recording:rbp1:transfer',
      [appleWatchSource.sourceId]: 'recording:watch:rbp1-transfer',
    },
  },
  {type: 'advance_time', seconds: 300},
  {type: 'disconnect_source', sourceId: rbp1Source.sourceId},
  {type: 'advance_time', seconds: 30},
  {type: 'reconnect_source', sourceId: rbp1Source.sourceId},
  {type: 'request_stop'},
  {type: 'finalize_source', sourceId: rbp1Source.sourceId, reason: 'app_stop'},
  {type: 'finalize_source', sourceId: phoneSource.sourceId, reason: 'app_stop'},
  {type: 'finalize_source', sourceId: appleWatchSource.sourceId, reason: 'app_stop'},
  {
    type: 'artifact_discovered',
    artifactId: 'artifact:rbp1:1',
    sourceId: rbp1Source.sourceId,
    recordingId: 'recording:rbp1:transfer',
    byteLength: '9007199254740994',
  },
  {
    type: 'transfer_artifact_range',
    artifactId: 'artifact:rbp1:1',
    offsetBytes: '0',
    byteLength: '4503599627370497',
    contentSha256: 'a'.repeat(64),
  },
  {type: 'disconnect_source', sourceId: rbp1Source.sourceId},
  {type: 'reconnect_source', sourceId: rbp1Source.sourceId},
  {
    type: 'transfer_artifact_range',
    artifactId: 'artifact:rbp1:1',
    offsetBytes: '4503599627370497',
    byteLength: '4503599627370497',
    contentSha256: 'b'.repeat(64),
  },
  {type: 'verify_artifact_persistence', artifactId: 'artifact:rbp1:1'},
];

export const storagePressureTransferScenario: readonly CaptureScenarioStep[] = [
  {
    type: 'artifact_discovered',
    artifactId: 'artifact:storage',
    sourceId: rbp1Source.sourceId,
    recordingId: 'recording:rbp1:storage',
    byteLength: '100',
  },
  {
    type: 'transfer_artifact_range',
    artifactId: 'artifact:storage',
    offsetBytes: '0',
    byteLength: '100',
    contentSha256: 'd'.repeat(64),
  },
  {type: 'evict_regenerable_data', byteLength: '100'},
  {
    type: 'transfer_artifact_range',
    artifactId: 'artifact:storage',
    offsetBytes: '0',
    byteLength: '100',
    contentSha256: 'd'.repeat(64),
  },
];
