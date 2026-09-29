import {
  BoundedClockMappingEstimator,
} from '../src/services/blade/BoundedClockMappingEstimator';

describe('BoundedClockMappingEstimator (TDD)', () => {
  let estimator: BoundedClockMappingEstimator;

  beforeEach(() => {
    estimator = new BoundedClockMappingEstimator({
      sourceClockDomainId: 'blade:PC01:monotonic',
      comparisonClockDomainId: 'phone:primary:monotonic',
      sourceId: 'blade:PC01',
      recordingId: 'rec:blade:001',
      deviceBootId: 42,
    });
  });

  describe('Single anchor and offset-only mapping', () => {
    it('produces offset-only mapping with short validity for a single anchor, never qualified affine', () => {
      // T1 = 1_000_000 (host send)
      // T2 = 1_050_000 (sensor receive, offset ~ +50_000 us)
      // T3 = 1_050_100 (sensor send, turnaround 100 us)
      // T4 = 1_001_100 (host receive, RTT = 1000 us)
      const anchor = estimator.addObservation({
        t1HostSendUs: 1_000_000,
        t2SensorReceiveUs: 1_050_000,
        t3SensorSendUs: 1_050_100,
        t4HostReceiveUs: 1_001_100,
        deviceBootId: 42,
      });

      expect(anchor.accepted).toBe(true);
      expect(anchor.roundTripUs).toBe(1000);
      expect(anchor.observedOffsetUs).toBe(49500); // ((1050000-1000000) + (1050100-1001100)) / 2 = (50000 + 49000)/2 = 49500

      const mapping = estimator.getMapping(1_050_000);
      expect(mapping).not.toBeNull();
      // Never qualified for a single exchange
      expect(mapping!.mappingQuality).toBe('approximate');
      expect(mapping!.scale).toBe(1.0);
      expect(mapping!.supportingClockAnchorObservationIds).toEqual([anchor.clockAnchorObservationId]);

      // Check validity window: validFrom <= 1_050_000, expires after short staleness (e.g. 5s)
      expect(Number(mapping!.validFromSourceMicroseconds)).toBeLessThanOrEqual(1_050_000);
      expect(Number(mapping!.validThroughSourceMicroseconds)).toBeGreaterThanOrEqual(1_050_000);
    });

    it('returns null mapping when queried outside validity window', () => {
      estimator.addObservation({
        t1HostSendUs: 1_000_000,
        t2SensorReceiveUs: 1_050_000,
        t3SensorSendUs: 1_050_100,
        t4HostReceiveUs: 1_001_100,
        deviceBootId: 42,
      });

      // 10 seconds later without any new anchors
      const staleQuery = 1_050_000 + 10_000_000;
      expect(estimator.getMapping(staleQuery)).toBeNull();
    });
  });

  describe('Affine fitting with known drift and RTT envelope', () => {
    it('estimates affine mapping with drift and maximumError <= 5000us when >= 3 anchors and span >= 2s', () => {
      // Anchor 1 at t=0s
      // Host: 10_000_000, Sensor: 10_200_000 (offset 200_000), RTT 800us
      estimator.addObservation({
        t1HostSendUs: 10_000_000,
        t2SensorReceiveUs: 10_200_300,
        t3SensorSendUs: 10_200_400,
        t4HostReceiveUs: 10_000_900, // RTT = 900 - 100 = 800us
        deviceBootId: 42,
      });

      // Anchor 2 at t=2s (Sensor ran faster by 100us over 2s -> drift +50 ppm)
      estimator.addObservation({
        t1HostSendUs: 12_000_000,
        t2SensorReceiveUs: 12_200_400,
        t3SensorSendUs: 12_200_500,
        t4HostReceiveUs: 12_000_900, // RTT = 800us
        deviceBootId: 42,
      });

      // Anchor 3 at t=4s (Sensor ran faster by another 100us -> drift +50 ppm)
      estimator.addObservation({
        t1HostSendUs: 14_000_000,
        t2SensorReceiveUs: 14_200_500,
        t3SensorSendUs: 14_200_600,
        t4HostReceiveUs: 14_000_900, // RTT = 800us
        deviceBootId: 42,
      });

      const mapping = estimator.getMapping(12_200_400);
      expect(mapping).not.toBeNull();
      expect(mapping!.mappingQuality).toBe('qualified');
      expect(Number(mapping!.maximumErrorMicroseconds)).toBeLessThanOrEqual(5000);
      expect(mapping!.supportingClockAnchorObservationIds).toHaveLength(3);
    });

    it('filters out large RTT outliers at start, middle, or end using lowest RTT envelope', () => {
      // Good anchor at t=0s (RTT 600us)
      estimator.addObservation({
        t1HostSendUs: 1_000_000,
        t2SensorReceiveUs: 1_050_250,
        t3SensorSendUs: 1_050_350,
        t4HostReceiveUs: 1_000_700,
        deviceBootId: 42,
      });

      // Outlier with huge BLE latency at t=1s (RTT 150_000us)
      estimator.addObservation({
        t1HostSendUs: 2_000_000,
        t2SensorReceiveUs: 2_090_000,
        t3SensorSendUs: 2_090_100,
        t4HostReceiveUs: 2_150_100,
        deviceBootId: 42,
      });

      // Good anchor at t=2s (RTT 700us)
      estimator.addObservation({
        t1HostSendUs: 3_000_000,
        t2SensorReceiveUs: 3_050_300,
        t3SensorSendUs: 3_050_400,
        t4HostReceiveUs: 3_000_800,
        deviceBootId: 42,
      });

      // Good anchor at t=4s (RTT 650us)
      estimator.addObservation({
        t1HostSendUs: 5_000_000,
        t2SensorReceiveUs: 5_050_400,
        t3SensorSendUs: 5_050_500,
        t4HostReceiveUs: 5_000_750,
        deviceBootId: 42,
      });

      const mapping = estimator.getMapping(3_050_300);
      expect(mapping).not.toBeNull();
      expect(mapping!.mappingQuality).toBe('qualified');
      // The outlier should not blow up maximum error
      expect(Number(mapping!.maximumErrorMicroseconds)).toBeLessThanOrEqual(5000);
    });
  });

  describe('Invalidation and rejection boundaries', () => {
    it('rejects observation with negative RTT and preserves diagnostic reason', () => {
      const anchor = estimator.addObservation({
        t1HostSendUs: 2_000_000,
        t2SensorReceiveUs: 2_050_000,
        t3SensorSendUs: 2_050_500, // turnaround 500us
        t4HostReceiveUs: 2_000_200, // host elapsed 200us < turnaround 500us!
        deviceBootId: 42,
      });

      expect(anchor.accepted).toBe(false);
      expect(anchor.rejectionReason).toBe('negative_rtt');
      expect(estimator.getAcceptedAnchors()).toHaveLength(0);
      expect(estimator.getAllAnchors()).toHaveLength(1);
    });

    it('rejects observation with excessive RTT (> 200_000us)', () => {
      const anchor = estimator.addObservation({
        t1HostSendUs: 1_000_000,
        t2SensorReceiveUs: 1_100_000,
        t3SensorSendUs: 1_100_100,
        t4HostReceiveUs: 1_250_000, // RTT > 200ms
        deviceBootId: 42,
      });

      expect(anchor.accepted).toBe(false);
      expect(anchor.rejectionReason).toBe('excessive_rtt');
    });

    it('invalidates state and clears anchors when deviceBootId changes', () => {
      estimator.addObservation({
        t1HostSendUs: 1_000_000,
        t2SensorReceiveUs: 1_050_000,
        t3SensorSendUs: 1_050_100,
        t4HostReceiveUs: 1_001_100,
        deviceBootId: 42,
      });
      expect(estimator.getAcceptedAnchors()).toHaveLength(1);

      // Reboot detected: new boot ID 43
      estimator.addObservation({
        t1HostSendUs: 2_000_000,
        t2SensorReceiveUs: 100_000, // sensor clock reset after reboot
        t3SensorSendUs: 100_100,
        t4HostReceiveUs: 2_001_100,
        deviceBootId: 43,
      });

      // Old anchors cleared; only new boot ID anchor present
      expect(estimator.getAcceptedAnchors()).toHaveLength(1);
      expect(estimator.getAcceptedAnchors()[0].deviceBootId).toBe(43);
      expect(estimator.getDeviceBootId()).toBe(43);
    });

    it('resets all anchors and active mapping on explicit invalidate()', () => {
      estimator.addObservation({
        t1HostSendUs: 1_000_000,
        t2SensorReceiveUs: 1_050_000,
        t3SensorSendUs: 1_050_100,
        t4HostReceiveUs: 1_001_100,
        deviceBootId: 42,
      });
      expect(estimator.getMapping(1_050_000)).not.toBeNull();

      estimator.invalidate('disconnect');
      expect(estimator.getMapping(1_050_000)).toBeNull();
      expect(estimator.getAcceptedAnchors()).toHaveLength(0);
    });

    it('rejects observation with timestamp regression', () => {
      estimator.addObservation({
        t1HostSendUs: 2_000_000,
        t2SensorReceiveUs: 2_050_000,
        t3SensorSendUs: 2_050_100,
        t4HostReceiveUs: 2_001_100,
        deviceBootId: 42,
      });

      // Subsequent observation has hostSendUs earlier than previous
      const regressed = estimator.addObservation({
        t1HostSendUs: 1_500_000,
        t2SensorReceiveUs: 2_050_000,
        t3SensorSendUs: 2_050_100,
        t4HostReceiveUs: 1_501_100,
        deviceBootId: 42,
      });

      expect(regressed.accepted).toBe(false);
      expect(regressed.rejectionReason).toBe('timestamp_regression');
    });
  });

  describe('Conversion from sensor time to comparison time', () => {
    it('converts sensor timestamp to comparison timeline and returns associated mapping ID and bound', () => {
      estimator.addObservation({
        t1HostSendUs: 1_000_000,
        t2SensorReceiveUs: 1_050_000,
        t3SensorSendUs: 1_050_100,
        t4HostReceiveUs: 1_001_000, // RTT = 900us, offset = 49550us
        deviceBootId: 42,
      });

      const converted = estimator.convertSensorTimeToComparisonUs(1_050_000);
      expect(converted).not.toBeNull();
      // sensorUs - offsetUs = 1_050_000 - 49550 = 1_000_450
      expect(converted!.comparisonTimestampUs).toBe(1_000_450);
      expect(converted!.clockMappingId).toMatch(/^map:/);
      expect(converted!.maximumErrorUs).toBeLessThanOrEqual(5000);
    });
  });
});
