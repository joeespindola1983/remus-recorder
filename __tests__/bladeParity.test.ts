import { SensorSample } from '../src/types/wearables';
import {
  normalizeBladeRotation,
  calculateParityPercentage,
  addParityHistoryPoint,
  ParityHistoryPoint,
} from '../src/ui/presentation/bladeParity';

describe('bladeParity (TDD)', () => {
  describe('normalizeBladeRotation', () => {
    it('returns null if rotationRateRadiansPerSecond is missing', () => {
      const sample: SensorSample = {
        deviceId: 'bld-1',
        deviceFamily: 'remus_blade',
        nativeTimestamp: 1000,
      };
      expect(normalizeBladeRotation(sample, 'left_paddle')).toBeNull();
    });

    it('preserves sign for left_paddle', () => {
      const sample: SensorSample = {
        deviceId: 'bld-1',
        deviceFamily: 'remus_blade',
        nativeTimestamp: 1000,
        rotationRateRadiansPerSecond: { x: 0.1, y: 0.2, z: 2.5 },
      };
      expect(normalizeBladeRotation(sample, 'left_paddle')).toBe(2.5);
    });

    it('inverts sign for right_paddle to match left orientation', () => {
      const sample: SensorSample = {
        deviceId: 'bld-2',
        deviceFamily: 'remus_blade',
        nativeTimestamp: 1000,
        rotationRateRadiansPerSecond: { x: 0.1, y: 0.2, z: -2.5 },
      };
      expect(normalizeBladeRotation(sample, 'right_paddle')).toBe(2.5);
    });

    it('preserves sign for unknown placement', () => {
      const sample: SensorSample = {
        deviceId: 'bld-1',
        deviceFamily: 'remus_blade',
        nativeTimestamp: 1000,
        rotationRateRadiansPerSecond: { x: 0.1, y: 0.2, z: -1.8 },
      };
      expect(normalizeBladeRotation(sample, 'unknown')).toBe(-1.8);
    });
  });

  describe('calculateParityPercentage', () => {
    it('returns null when both oars are below deadzone threshold (idle)', () => {
      expect(calculateParityPercentage(0.05, 0.08, 0.2)).toBeNull();
      expect(calculateParityPercentage(-0.1, 0.05, 0.2)).toBeNull();
    });

    it('returns 100 when both oars have identical angular velocity', () => {
      expect(calculateParityPercentage(2.5, 2.5)).toBe(100);
      expect(calculateParityPercentage(-2.0, -2.0)).toBe(100);
    });

    it('returns 0 when oars move in opposite directions during active stroke', () => {
      expect(calculateParityPercentage(2.0, -1.5)).toBe(0);
      expect(calculateParityPercentage(-2.0, 1.5)).toBe(0);
    });

    it('calculates proportional parity percentage when moving in the same direction', () => {
      // 1.5 / 2.0 = 75%
      expect(calculateParityPercentage(2.0, 1.5)).toBe(75);
      expect(calculateParityPercentage(-1.5, -2.0)).toBe(75);
      // 0.8 / 1.0 = 80%
      expect(calculateParityPercentage(0.8, 1.0)).toBe(80);
    });
  });

  describe('addParityHistoryPoint', () => {
    it('appends points up to maxPoints and maintains fixed-length window', () => {
      let history: ParityHistoryPoint[] = [];
      for (let i = 0; i < 30; i++) {
        history = addParityHistoryPoint(
          history,
          { left: i, right: i, timestamp: i * 50 },
          20,
        );
      }
      expect(history).toHaveLength(20);
      expect(history[0].left).toBe(10);
      expect(history[19].left).toBe(29);
    });
  });
});
