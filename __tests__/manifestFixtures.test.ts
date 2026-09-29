import { RecordingManifest } from '../src/services/recording/RecordingService';
import manifest100 from './fixtures/manifest/manifest-1.0.0-synthetic.json';
import manifest110 from './fixtures/manifest/manifest-1.1.0-synthetic.json';
import manifestSuspectedDisc from './fixtures/manifest/manifest-1.1.0-suspected-discontinuity.json';
import manifestRelayedDual from './fixtures/manifest/manifest-1.1.0-relayed-dual-blades.json';

describe('Recording manifest version compatibility', () => {
  it('reads manifest 1.0.0 with single recording per source and legacy map', () => {
    const manifest = manifest100 as unknown as RecordingManifest;
    expect(manifest.schemaVersion).toBe('1.0.0');
    expect(manifest.activityId).toBe('activity:synthetic-100');
    expect(manifest.recordingIdsBySource['phone:primary']).toBe('rec:phone:001');
    expect(manifest.recordingIdsBySource['remus-blade:p1:left']).toBe('rec:blade:001');
    expect(manifest.sampleCounts['phone:primary']).toBe(60000);
    expect(manifest.sampleCounts['remus-blade:p1:left']).toBe(240000);
    expect(manifest.recordings).toBeUndefined();
  });

  it('reads manifest 1.1.0 with canonical recordings array and source multiplicity', () => {
    const manifest = manifest110 as unknown as RecordingManifest;
    expect(manifest.schemaVersion).toBe('1.1.0');
    expect(manifest.activityId).toBe('activity:synthetic-110');
    expect(manifest.recordings).toBeDefined();
    expect(manifest.recordings?.length).toBe(3);

    // Verify two recordings for the same physical source
    const bladeRecordings = manifest.recordings?.filter(
      r => r.sourceId === 'remus-blade:p1:left'
    );
    expect(bladeRecordings?.length).toBe(2);

    const [first, second] = bladeRecordings!;
    expect(first.recordingId).not.toBe(second.recordingId);
    expect(first.clockDomainId).not.toBe(second.clockDomainId);
    expect(first.deviceBootId).toBe('boot-token-001');
    expect(second.deviceBootId).toBe('boot-token-002');
    expect(first.startReason).toBe('normal_start');
    expect(first.endReason).toBe('device_restarted');
    expect(second.startReason).toBe('device_restarted');
    expect(second.endReason).toBe('normal_stop');

    // Verify native timestamps are decimal strings preserving 64-bit precision
    expect(typeof first.startedAtNativeMicroseconds).toBe('string');
    expect(/^\d+$/.test(first.startedAtNativeMicroseconds!)).toBe(true);

    // Verify backwards compatibility of recordingIdsBySource pointing to initial recording
    expect(manifest.recordingIdsBySource['remus-blade:p1:left']).toBe(first.recordingId);
  });

  it('reads manifest 1.1.0 with suspected_clock_discontinuity and null bootId', () => {
    const manifest = manifestSuspectedDisc as unknown as RecordingManifest;
    expect(manifest.schemaVersion).toBe('1.1.0');
    expect(manifest.activityId).toBe('activity:synthetic-suspected-discontinuity');
    expect(manifest.recordings?.length).toBe(3);

    const bladeRecordings = manifest.recordings?.filter(
      r => r.sourceId === 'blade:legacy-001'
    );
    expect(bladeRecordings?.length).toBe(2);

    const [first, second] = bladeRecordings!;
    expect(first.deviceBootId).toBeNull();
    expect(second.deviceBootId).toBeNull();
    expect(first.endReason).toBe('suspected_clock_discontinuity');
    expect(second.startReason).toBe('suspected_clock_discontinuity');
    expect(second.endReason).toBe('normal_stop');
  });

  it('reads manifest 1.1.0 with relayed dual blades having independent clock domains', () => {
    const manifest = manifestRelayedDual as unknown as RecordingManifest;
    expect(manifest.schemaVersion).toBe('1.1.0');
    expect(manifest.activityId).toBe('activity:synthetic-relayed-dual-blades');
    expect(manifest.recordings?.length).toBe(3);

    const blade1 = manifest.recordings?.find(r => r.sourceId === 'blade:11112222');
    const blade2 = manifest.recordings?.find(r => r.sourceId === 'blade:33334444');
    expect(blade1).toBeDefined();
    expect(blade2).toBeDefined();

    expect(blade1?.clockDomainId).toBe('clk:blade:11112222:001');
    expect(blade2?.clockDomainId).toBe('clk:blade:33334444:001');
    expect(blade1?.deviceBootId).toBe('0x11112222');
    expect(blade2?.deviceBootId).toBe('0x33334444');
  });
});
