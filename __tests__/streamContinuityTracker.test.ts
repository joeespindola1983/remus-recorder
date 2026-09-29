import {
  createStreamContinuityTracker,
} from '../src/services/blade/StreamContinuityTracker';
import { DecodedImuBatch } from '../src/services/blade/RemusStreamPacketDecoder';

const makeBatch = (
  batchSequence: number,
  firstSampleSequence: number,
  firstTimestampUs: number,
  count = 10,
): DecodedImuBatch => {
  const samples = [];
  for (let i = 0; i < count; i += 1) {
    samples.push({
      sampleSequence: firstSampleSequence + i,
      nativeTimestampUs: firstTimestampUs + i * 5000,
      rawAccel: { x: 100, y: 200, z: 4000 },
      rawGyro: { x: 10, y: 20, z: 30 },
      status: 0,
    });
  }
  return { batchSequence, samples };
};

describe('StreamContinuityTracker (TDD)', () => {
  it('tracks a continuous stream in a single recording domain', () => {
    const tracker = createStreamContinuityTracker('blade:1', 'activity-100');
    tracker.startStream(1700000000000, '0xa1b2c3d4');

    tracker.ingestBatch(makeBatch(0, 0, 1000000), 1700000000050, '0xa1b2c3d4');
    tracker.ingestBatch(makeBatch(1, 10, 1050000), 1700000000100, '0xa1b2c3d4');
    tracker.ingestBatch(makeBatch(2, 20, 1100000), 1700000000150, '0xa1b2c3d4');

    const closed = tracker.stopStream(1700000001000);
    expect(closed.endReason).toBe('normal_stop');
    expect(closed.sampleCounts.rawImu).toBe(30);

    const recordings = tracker.getAllRecordings();
    expect(recordings).toHaveLength(1);
    expect(recordings[0].recordingId).toBe('rec:blade:1:001');
    expect(recordings[0].clockDomainId).toBe('clk:blade:1:001');
    expect(recordings[0].startReason).toBe('normal_start');
    expect(recordings[0].endReason).toBe('normal_stop');
    expect(recordings[0].deviceBootId).toBe('0xa1b2c3d4');
    expect(recordings[0].startedAtNativeMicroseconds).toBe('1000000');
    expect(recordings[0].endedAtNativeMicroseconds).toBe('1145000');
    expect(tracker.getAccounting().lostPackets).toBe(0);
    expect(tracker.getAccounting().lostSamples).toBe(0);
    expect(tracker.getSequenceGaps()).toEqual([]);
  });

  it('records packet loss and sample gap ranges within the same recording domain', () => {
    const tracker = createStreamContinuityTracker('blade:1', 'activity-100');
    tracker.startStream(1700000000000, '0xa1b2c3d4');

    // Batch 0: samples 0..9
    tracker.ingestBatch(makeBatch(0, 0, 1000000), 1700000000050, '0xa1b2c3d4');
    // Drop Batch 1 (samples 10..19); receive Batch 2 (samples 20..29)
    tracker.ingestBatch(makeBatch(2, 20, 1100000), 1700000000150, '0xa1b2c3d4');

    expect(tracker.getAccounting().lostPackets).toBe(1);
    expect(tracker.getAccounting().lostSamples).toBe(10);
    expect(tracker.getSequenceGaps()).toEqual([
      { fromSampleSequence: 10, toSampleSequence: 19, count: 10 },
    ]);

    const recordings = tracker.getAllRecordings();
    expect(recordings).toHaveLength(1);
    expect(recordings[0].sampleCounts.rawImu).toBe(20);
  });

  it('splits recording and opens new clock domain when deviceBootId changes (sensor reboot)', () => {
    const tracker = createStreamContinuityTracker('blade:1', 'activity-100');
    tracker.startStream(1700000000000, '0xa1b2c3d4');

    tracker.ingestBatch(makeBatch(0, 0, 1000000), 1700000000050, '0xa1b2c3d4');
    tracker.ingestBatch(makeBatch(1, 10, 1050000), 1700000000100, '0xa1b2c3d4');

    // Sensor reboots! Sequence resets to 0, timestamp resets to 50000, new bootId 0xe5f60718
    const event = tracker.ingestBatch(makeBatch(0, 0, 50000), 1700000005000, '0xe5f60718');
    expect(event.newRecordingStarted).toBe(true);

    tracker.ingestBatch(makeBatch(1, 10, 100000), 1700000005050, '0xe5f60718');
    tracker.stopStream(1700000006000);

    const recordings = tracker.getAllRecordings();
    expect(recordings).toHaveLength(2);

    // First recording before reboot
    expect(recordings[0].recordingId).toBe('rec:blade:1:001');
    expect(recordings[0].clockDomainId).toBe('clk:blade:1:001');
    expect(recordings[0].startReason).toBe('normal_start');
    expect(recordings[0].endReason).toBe('device_restarted');
    expect(recordings[0].deviceBootId).toBe('0xa1b2c3d4');
    expect(recordings[0].sampleCounts.rawImu).toBe(20);

    // Second recording after reboot
    expect(recordings[1].recordingId).toBe('rec:blade:1:002');
    expect(recordings[1].clockDomainId).toBe('clk:blade:1:002');
    expect(recordings[1].startReason).toBe('device_restarted');
    expect(recordings[1].endReason).toBe('normal_stop');
    expect(recordings[1].deviceBootId).toBe('0xe5f60718');
    expect(recordings[1].sampleCounts.rawImu).toBe(20);

    // Invariant: counters did NOT treat reset as 1000000 lost packets
    expect(tracker.getAccounting().lostPackets).toBe(0);
    expect(tracker.getAccounting().lostSamples).toBe(0);
  });

  it('classifies regression without boot identity as suspected_clock_discontinuity', () => {
    const tracker = createStreamContinuityTracker('blade:1', 'activity-100');
    // Legacy sensor without boot ID
    tracker.startStream(1700000000000, null);

    tracker.ingestBatch(makeBatch(50, 500, 25000000), 1700000000050, null);

    // Sudden sequence and time regression without boot ID
    const event = tracker.ingestBatch(makeBatch(0, 0, 100000), 1700000005000, null);
    expect(event.newRecordingStarted).toBe(true);

    tracker.stopStream(1700000006000);
    const recordings = tracker.getAllRecordings();
    expect(recordings).toHaveLength(2);
    expect(recordings[0].endReason).toBe('suspected_clock_discontinuity');
    expect(recordings[1].startReason).toBe('suspected_clock_discontinuity');
    expect(recordings[0].deviceBootId).toBeNull();
    expect(recordings[1].deviceBootId).toBeNull();
  });

  it('keeps the same recording domain during reconnection with the same bootId', () => {
    const tracker = createStreamContinuityTracker('blade:1', 'activity-100');
    tracker.startStream(1700000000000, '0xa1b2c3d4');

    tracker.ingestBatch(makeBatch(0, 0, 1000000), 1700000000050, '0xa1b2c3d4');

    // 2-second transport gap, then batch 400 arrives with same bootId
    const event = tracker.ingestBatch(makeBatch(400, 4000, 3000000), 1700000002100, '0xa1b2c3d4');
    expect(event.newRecordingStarted).toBe(false);

    tracker.stopStream(1700000003000);
    const recordings = tracker.getAllRecordings();
    expect(recordings).toHaveLength(1);
    expect(recordings[0].recordingId).toBe('rec:blade:1:001');
    expect(tracker.getAccounting().lostPackets).toBe(399);
    expect(tracker.getAccounting().lostSamples).toBe(3990);
  });

  it('handles missing, duplicate, and out-of-order batches without false native gap', () => {
    const tracker = createStreamContinuityTracker('blade:1', 'activity-100');
    tracker.startStream(1700000000000, '0xa1b2c3d4');

    // Batch 0: samples 0..9 (timestamp 1000..1045ms)
    tracker.ingestBatch(makeBatch(0, 0, 1000000), 1700000000050, '0xa1b2c3d4');
    // Batch 2 arrives before Batch 1: samples 20..29 (timestamp 1100..1145ms)
    tracker.ingestBatch(makeBatch(2, 20, 1100000), 1700000000100, '0xa1b2c3d4');
    // Batch 1 arrives late (out of order): samples 10..19 (timestamp 1050..1095ms)
    tracker.ingestBatch(makeBatch(1, 10, 1050000), 1700000000150, '0xa1b2c3d4');
    // Duplicate of Batch 2 arrives
    tracker.ingestBatch(makeBatch(2, 20, 1100000), 1700000000200, '0xa1b2c3d4');

    const accounting = tracker.getAccounting();
    expect(accounting.outOfOrderPackets).toBe(1);
    expect(accounting.duplicatedPackets).toBe(1);
    // maxSampleGapUs only computes between consecutive samples (sampleSequence === prev + 1)
    // and never treats out-of-order or duplicate as a gigantic jump
    expect(accounting.maxSampleGapMs).toBeLessThanOrEqual(5.0);
  });

  it('tracks saturation independently before and after a recording domain boundary', () => {
    const tracker = createStreamContinuityTracker('blade:1', 'activity-100');
    tracker.startStream(1700000000000, '0xa1b2c3d4');

    // Batch with saturated accelerometer (+32767 on X)
    const saturatedBatch: DecodedImuBatch = {
      batchSequence: 0,
      samples: [
        {
          sampleSequence: 0,
          nativeTimestampUs: 1000000,
          rawAccel: { x: 32767, y: 100, z: 4000 },
          rawGyro: { x: 0, y: 0, z: 0 },
          status: 0,
        },
      ],
    };
    tracker.ingestBatch(saturatedBatch, 1700000000050, '0xa1b2c3d4');

    const firstRec = tracker.getAllRecordings()[0];
    const accountingBeforeReboot = tracker.getAccounting(firstRec.recordingId);
    expect(accountingBeforeReboot.accelSaturationCountX).toBe(1);
    expect(accountingBeforeReboot.samplesWithAnySaturationCount).toBe(1);

    // Sensor reboots!
    const cleanBatchAfterReboot: DecodedImuBatch = {
      batchSequence: 0,
      samples: [
        {
          sampleSequence: 0,
          nativeTimestampUs: 20000,
          rawAccel: { x: 100, y: 100, z: 4000 },
          rawGyro: { x: 0, y: 0, z: 0 },
          status: 0,
        },
      ],
    };
    tracker.ingestBatch(cleanBatchAfterReboot, 1700000005000, '0xe5f60718');
    tracker.stopStream(1700000006000);

    const recordings = tracker.getAllRecordings();
    expect(recordings).toHaveLength(2);

    const accountingAfterReboot = tracker.getAccounting(recordings[1].recordingId);
    // Boundary invariant: saturation from recording 1 does NOT leak into recording 2
    expect(accountingAfterReboot.accelSaturationCountX).toBe(0);
    expect(accountingAfterReboot.samplesWithAnySaturationCount).toBe(0);
  });

  it('handles two independent relayed blades with identical local sequence counters without cross-talk', () => {
    const leftBladeTracker = createStreamContinuityTracker('blade:11223344', 'activity-100');
    const rightBladeTracker = createStreamContinuityTracker('blade:55667788', 'activity-100');

    leftBladeTracker.startStream(1700000000000, null);
    rightBladeTracker.startStream(1700000000000, null);

    // Both blades send batch 0 at slightly different native times
    leftBladeTracker.ingestBatch(makeBatch(0, 0, 1000000), 1700000000050, null);
    rightBladeTracker.ingestBatch(makeBatch(0, 0, 2000000), 1700000000050, null);

    // Left blade drops batch 1, receives batch 2
    leftBladeTracker.ingestBatch(makeBatch(2, 20, 1100000), 1700000000150, null);
    // Right blade receives batch 1 normally
    rightBladeTracker.ingestBatch(makeBatch(1, 10, 2050000), 1700000000100, null);

    expect(leftBladeTracker.getAccounting().lostPackets).toBe(1);
    expect(leftBladeTracker.getAccounting().lostSamples).toBe(10);
    expect(rightBladeTracker.getAccounting().lostPackets).toBe(0);
    expect(rightBladeTracker.getAccounting().lostSamples).toBe(0);

    const leftRec = leftBladeTracker.getAllRecordings()[0];
    const rightRec = rightBladeTracker.getAllRecordings()[0];
    expect(leftRec.recordingId).not.toBe(rightRec.recordingId);
    expect(leftRec.clockDomainId).not.toBe(rightRec.clockDomainId);
    expect(leftRec.clockDomainId).toBe('clk:blade:11223344:001');
    expect(rightRec.clockDomainId).toBe('clk:blade:55667788:001');
  });
});
