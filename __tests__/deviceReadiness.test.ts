import {
  batteryConditionFor,
  describeSourceReadiness,
} from '../src/ui/presentation/deviceReadiness';
import { CaptureSourceState } from '../src/application/capture/ActivityCapture';

const source = (
  overrides: Partial<CaptureSourceState> = {},
): CaptureSourceState => ({
  sourceId: 'source:test',
  deviceFamily: 'iphone',
  operationalState: 'available_idle',
  sensorPlacement: 'body',
  placementProvenance: 'device_metadata',
  capabilities: {
    liveTransfer: true,
    volatileResend: false,
    standaloneCapture: true,
    storeAndForward: true,
    postSyncDeletion: false,
    relayCapture: false,
  },
  clockDomains: [],
  required: true,
  coverageSegments: [],
  ...overrides,
});

describe('device readiness presentation', () => {
  it.each([
    [undefined, 'unknown'],
    [0, 'critical'],
    [10, 'critical'],
    [11, 'low'],
    [25, 'low'],
    [26, 'good'],
    [100, 'good'],
  ] as const)(
    'maps battery %s to %s without estimating duration',
    (level, condition) => {
      expect(batteryConditionFor(level)).toBe(condition);
    },
  );

  it('summarizes available measurements in plain language', () => {
    expect(
      describeSourceReadiness(
        source({
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
        }),
      ),
    ).toBe('GPS pronto · Movimento disponível');
  });

  it('keeps detected SpeedCoach telemetry explicitly unqualified', () => {
    expect(
      describeSourceReadiness(
        source({
          deviceFamily: 'speedcoach',
          readiness: {
            sourceConnectionState: 'detected',
            availableMeasurementIdentifiers: [],
            liveTelemetryState: 'evaluation_pending',
          },
        }),
      ),
    ).toBe('Detectado · Uso ao vivo em teste');
  });
});
