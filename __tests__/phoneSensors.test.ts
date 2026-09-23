import { PhoneSensorService } from '../src/services/sensors/PhoneSensorService';
import { SensorSample } from '../src/types/wearables';

describe('PhoneSensorService (TDD)', () => {
  let service: PhoneSensorService;

  beforeEach(() => {
    service = new PhoneSensorService();
  });

  afterEach(() => {
    service.stop();
  });

  it('should initialize and start recording phone sensor samples', done => {
    service.onSample((sample: SensorSample) => {
      expect(sample.deviceId).toBe('local-phone');
      expect(sample.location?.latitude).toBeDefined();
      expect(sample.location?.longitude).toBeDefined();
      done();
    });

    service.start({
      mockLocation: {
        latitude: -23.55052,
        longitude: -46.633308,
        altitude: 760,
        groundSpeedMetersPerSecond: 12.5,
        horizontalAccuracyMeters: 3.2,
      },
    });
  });

  it('should allow updating simulated motion', done => {
    service.onSample((sample: SensorSample) => {
      if (sample.accelerationIncludingGravityG) {
        expect(sample.accelerationIncludingGravityG.x).toBe(0.15);
        expect(sample.accelerationIncludingGravityG.y).toBe(0.92);
        done();
      }
    });

    service.start();
    service.emitMotionSample({ x: 0.15, y: 0.92, z: -0.04 });
  });
});
