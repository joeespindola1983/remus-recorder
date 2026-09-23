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
  it('guides a wearable user to settings after heart-rate permission denial', () => {
    const wearable = source({
      deviceFamily: 'wear_os',
      readiness: {
        sourceConnectionState: 'connected',
        availableMeasurementIdentifiers: [],
        liveTelemetryState: 'evaluation_pending',
        heartRatePermissionState: 'denied',
      },
    });

    expect(describeSourceReadiness(wearable)).toContain('Permissão negada');
    expect(describeSourceReadiness(wearable)).toContain('Ajustes');
  });

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

  it('declares accelerometer without gyroscope on Android devices lacking gyro', () => {
    expect(
      describeSourceReadiness(
        source({
          deviceFamily: 'android_phone',
          readiness: {
            sourceConnectionState: 'connected',
            batteryLevelPercent: 88,
            availableMeasurementIdentifiers: [
              'positionWgs84',
              'horizontalAccuracyMeters',
              'accelerationIncludingGravityG',
            ],
            liveTelemetryState: 'qualified',
          },
        }),
      ),
    ).toBe('GPS pronto · Acelerômetro pronto (sem giroscópio)');
  });

  it('declares GPS permission missing when motion is available', () => {
    expect(
      describeSourceReadiness(
        source({
          readiness: {
            sourceConnectionState: 'connected',
            batteryLevelPercent: 92,
            availableMeasurementIdentifiers: [
              'accelerationIncludingGravityG',
              'rotationRateRadiansPerSecond',
            ],
            liveTelemetryState: 'unavailable',
          },
        }),
      ),
    ).toBe('GPS necessário · Movimento disponível');
  });

  it('provides structured phone sensor streams breakdown', () => {
    const { describePhoneSensorStreams } = require('../src/ui/presentation/deviceReadiness');
    const streams = describePhoneSensorStreams(
      source({
        readiness: {
          sourceConnectionState: 'connected',
          horizontalAccuracyMeters: 3.8,
          availableMeasurementIdentifiers: [
            'positionWgs84',
            'accelerationIncludingGravityG',
          ],
          liveTelemetryState: 'qualified',
        },
      }),
    );

    expect(streams.gps).toBe('Pronto (±4 m)');
    expect(streams.gpsAccuracyMeters).toBe(3.8);
    expect(streams.accelerometer).toBe('Disponível');
    expect(streams.gyroscope).toBe('Não suportado');
  });

  it('computes dynamic overall readiness summary when all sensors are ready and formats GPS accuracy', () => {
    const { overallReadinessSummary } = require('../src/ui/presentation/deviceReadiness');
    const phone = source({
      deviceFamily: 'iphone',
      readiness: {
        sourceConnectionState: 'connected',
        horizontalAccuracyMeters: 4,
        availableMeasurementIdentifiers: [
          'positionWgs84',
          'accelerationIncludingGravityG',
          'rotationRateRadiansPerSecond',
        ],
        liveTelemetryState: 'qualified',
      },
    });

    const summary = overallReadinessSummary([phone]);
    expect(summary.isReady).toBe(true);
    expect(summary.hasMissingPermissions).toBe(false);
    expect(summary.summary).toBe('GPS pronto (±4 m) · Movimento disponível');

    expect(describeSourceReadiness(phone)).toBe('GPS pronto (±4 m) · Movimento disponível');
  });

  it('computes dynamic overall readiness summary when phone lacks gyroscope', () => {
    const { overallReadinessSummary } = require('../src/ui/presentation/deviceReadiness');
    const phone = source({
      deviceFamily: 'android_phone',
      readiness: {
        sourceConnectionState: 'connected',
        availableMeasurementIdentifiers: [
          'positionWgs84',
          'accelerationIncludingGravityG',
        ],
        liveTelemetryState: 'qualified',
      },
    });

    const summary = overallReadinessSummary([phone]);
    expect(summary.isReady).toBe(true);
    expect(summary.hasMissingPermissions).toBe(false);
    expect(summary.summary).toBe('GPS pronto · Acelerômetro pronto (sem giroscópio)');
  });

  it('computes dynamic overall readiness summary when permissions are missing', () => {
    const { overallReadinessSummary } = require('../src/ui/presentation/deviceReadiness');
    const phone = source({
      deviceFamily: 'iphone',
      readiness: {
        sourceConnectionState: 'connected',
        availableMeasurementIdentifiers: [
          'accelerationIncludingGravityG',
          'rotationRateRadiansPerSecond',
        ],
        liveTelemetryState: 'unavailable',
      },
    });

    const summary = overallReadinessSummary([phone]);
    expect(summary.isReady).toBe(false);
    expect(summary.hasMissingPermissions).toBe(true);
    expect(summary.summary).toContain('GPS necessário');
  });

  it('generates phone summary evidence declarations and notes missing gyro without zero-padding', () => {
    const { describePhoneSummaryEvidence } = require('../src/ui/presentation/deviceReadiness');
    const iphone = source({
      deviceFamily: 'iphone',
      readiness: {
        sourceConnectionState: 'connected',
        availableMeasurementIdentifiers: [
          'positionWgs84',
          'accelerationIncludingGravityG',
          'rotationRateRadiansPerSecond',
        ],
        liveTelemetryState: 'qualified',
      },
    });

    const iphoneEvidence = describePhoneSummaryEvidence(iphone);
    expect(iphoneEvidence.sensorBadges).toEqual(['GPS (GNSS)', 'Acelerômetro', 'Giroscópio']);
    expect(iphoneEvidence.caveat).toBeUndefined();

    const androidNoGyro = source({
      deviceFamily: 'android_phone',
      readiness: {
        sourceConnectionState: 'connected',
        availableMeasurementIdentifiers: [
          'positionWgs84',
          'accelerationIncludingGravityG',
        ],
        liveTelemetryState: 'qualified',
      },
    });

    const androidEvidence = describePhoneSummaryEvidence(androidNoGyro);
    expect(androidEvidence.sensorBadges).toEqual(['GPS (GNSS)', 'Acelerômetro']);
    expect(androidEvidence.caveat).toContain('Giroscópio não suportado');
  });

  it('declares Remus Blade explicitly as Buscando automaticamente... when unavailable', () => {
    const blade = source({
      sourceId: 'rbp1:primary',
      deviceFamily: 'remus_blade',
      deviceModel: 'rbp1',
      operationalState: 'unavailable',
      readiness: {
        sourceConnectionState: 'unavailable',
        availableMeasurementIdentifiers: [],
        liveTelemetryState: 'unavailable',
      },
    });

    expect(describeSourceReadiness(blade)).toBe('Buscando automaticamente...');
  });

  it('describes Remus Blade as Conectando... when connecting (evaluation_pending)', () => {
    const blade = source({
      sourceId: 'rbp1:primary',
      deviceFamily: 'remus_blade',
      deviceModel: 'rbp1',
      operationalState: 'unavailable',
      readiness: {
        sourceConnectionState: 'detected',
        availableMeasurementIdentifiers: [],
        liveTelemetryState: 'evaluation_pending',
      },
    });

    expect(describeSourceReadiness(blade)).toBe('Conectando...');
  });

  it('warns that Remus Blade is offline in overall readiness summary when paired blade disconnects', () => {
    const { overallReadinessSummary } = require('../src/ui/presentation/deviceReadiness');
    const phone = source({
      deviceFamily: 'iphone',
      readiness: {
        sourceConnectionState: 'connected',
        availableMeasurementIdentifiers: [
          'positionWgs84',
          'accelerationIncludingGravityG',
          'rotationRateRadiansPerSecond',
        ],
        liveTelemetryState: 'qualified',
      },
    });

    const bladeOffline = source({
      sourceId: 'rbp1:primary',
      deviceFamily: 'remus_blade',
      deviceModel: 'rbp1',
      operationalState: 'unavailable',
      readiness: {
        sourceConnectionState: 'unavailable',
        availableMeasurementIdentifiers: [],
        liveTelemetryState: 'unavailable',
      },
    });

    const summary = overallReadinessSummary([phone, bladeOffline]);
    expect(summary.isReady).toBe(true);
    expect(summary.summary).toBe('GPS pronto · Movimento disponível · Remus Blade offline');
  });

  it('describes phone sensor streams including Bluetooth status', () => {
    const { describePhoneSensorStreams } = require('../src/ui/presentation/deviceReadiness');
    const phone = source({
      deviceFamily: 'iphone',
      readiness: {
        sourceConnectionState: 'connected',
        availableMeasurementIdentifiers: [
          'positionWgs84',
          'accelerationIncludingGravityG',
          'rotationRateRadiansPerSecond',
        ],
        liveTelemetryState: 'qualified',
        bluetoothState: 'powered_on',
      },
    });

    const streams = describePhoneSensorStreams(phone);
    expect(streams.bluetooth).toBe('Disponível');

    const phoneBtOff = source({
      deviceFamily: 'iphone',
      readiness: {
        sourceConnectionState: 'connected',
        availableMeasurementIdentifiers: ['positionWgs84'],
        liveTelemetryState: 'qualified',
        bluetoothState: 'powered_off',
      },
    });

    const streamsBtOff = describePhoneSensorStreams(phoneBtOff);
    expect(streamsBtOff.bluetooth).toBe('Desligado');
  });
});
