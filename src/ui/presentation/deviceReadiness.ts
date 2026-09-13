import { CaptureSourceState } from '../../application/capture/ActivityCapture';
import { MeasurementIdentifier } from '../../contracts/acquisition';

export type BatteryCondition = 'good' | 'low' | 'critical' | 'unknown';

export const batteryConditionFor = (
  batteryLevelPercent?: number,
): BatteryCondition => {
  if (batteryLevelPercent === undefined) return 'unknown';
  if (batteryLevelPercent <= 10) return 'critical';
  if (batteryLevelPercent <= 25) return 'low';
  return 'good';
};

const hasAny = (
  identifiers: MeasurementIdentifier[],
  candidates: MeasurementIdentifier[],
): boolean => candidates.some(identifier => identifiers.includes(identifier));

export const sourceDisplayName = (source: CaptureSourceState): string => {
  const names: Record<string, string> = {
    iphone: 'Este iPhone',
    android_phone: 'Este Android',
    remus_blade: 'Remus Blade P1',
    apple_watch: 'Apple Watch',
    wear_os: 'Wear OS',
    speedcoach: 'SpeedCoach',
  };
  return names[source.deviceFamily] ?? source.deviceFamily;
};

export const describeSourceReadiness = (source: CaptureSourceState): string => {
  const readiness = source.readiness;
  if (!readiness || readiness.sourceConnectionState === 'unavailable')
    return 'Indisponível';
  if (readiness.liveTelemetryState === 'evaluation_pending') {
    return `${
      readiness.sourceConnectionState === 'detected' ? 'Detectado' : 'Conectado'
    } · Uso ao vivo em teste`;
  }

  const ids = readiness.availableMeasurementIdentifiers;
  const hasGps = hasAny(ids, ['positionWgs84', 'horizontalAccuracyMeters']);
  const hasMotion = hasAny(ids, [
    'accelerationIncludingGravityG',
    'linearAccelerationG',
    'rotationRateRadiansPerSecond',
  ]);
  const hasHeartRate = ids.includes('heartRateBeatsPerMinute');

  if (
    source.deviceFamily === 'iphone' ||
    source.deviceFamily === 'android_phone'
  ) {
    const capabilities = [
      hasGps ? 'GPS pronto' : null,
      hasMotion ? 'Movimento disponível' : null,
    ].filter(Boolean);
    return capabilities.length > 0 ? capabilities.join(' · ') : 'Pronto';
  }

  const capabilities = [
    hasGps ? 'GPS' : null,
    hasMotion ? 'movimento' : null,
    hasHeartRate ? 'Batimentos' : null,
  ].filter(Boolean);
  return capabilities.length > 0
    ? `Conectado · ${capabilities.join(' e ')}`
    : 'Conectado';
};
