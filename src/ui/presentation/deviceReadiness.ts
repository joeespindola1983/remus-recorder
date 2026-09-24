import { CaptureSourceState } from '../../application/capture/ActivityCapture';
import { MeasurementIdentifier } from '../../contracts/acquisition';
import { t } from '../../i18n';

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
  if (source.deviceFamily === 'remus_blade') {
    const side =
      source.sensorPlacement === 'left_paddle'
        ? t('blade.sideLeft')
        : source.sensorPlacement === 'right_paddle'
          ? t('blade.sideRight')
          : null;
    if (side) {
      return `Remus Blade · ${side}`;
    }
    const rawId = source.deviceSerialNumber ?? source.sourceId.replace('blade:', '');
    if (rawId && rawId !== 'rbp1:primary' && rawId !== 'primary') {
      return `Remus Blade · ${rawId}`;
    }
    return 'Remus Blade P1';
  }
  if (source.deviceFamily === 'remus_computer') {
    const rawId = source.deviceSerialNumber ?? source.sourceId.replace('computer:', '');
    if (rawId && rawId !== 'primary') {
      return `Remus Computer · ${rawId}`;
    }
    return 'Remus Computer';
  }
  const names: Record<string, string> = {
    iphone: 'Este iPhone',
    android_phone: 'Este Android',
    apple_watch: 'Apple Watch',
    wear_os: 'Wear OS',
  };
  return names[source.deviceFamily] ?? source.deviceFamily;
};

export const describeSourceReadiness = (source: CaptureSourceState): string => {
  const readiness = source.readiness;
  if (!readiness || readiness.sourceConnectionState === 'unavailable') {
    if (source.deviceFamily === 'remus_blade') {
      return t('blade.disconnected');
    }
    return 'Indisponível';
  }
  if (source.deviceFamily === 'apple_watch' || source.deviceFamily === 'wear_os') {
    if (readiness.heartRatePermissionState === 'denied') {
      return 'Permissão negada · abra o app no relógio e revise os Ajustes';
    }
    if (readiness.heartRatePermissionState === 'not_determined') {
      return 'Permissão necessária · confirme no relógio';
    }
    if (readiness.heartRatePermissionState === 'unknown') {
      return 'Conectado · aguardando acesso aos batimentos';
    }
  }
  if (readiness.liveTelemetryState === 'evaluation_pending') {
    if (source.deviceFamily === 'remus_blade') {
      return t('blade.connecting');
    }
    return `${
      readiness.sourceConnectionState === 'detected' ? 'Detectado' : 'Conectado'
    } · Uso ao vivo em teste`;
  }

  const ids = readiness.availableMeasurementIdentifiers ?? [];
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
    const hasAcc =
      ids.includes('accelerationIncludingGravityG') ||
      ids.includes('linearAccelerationG');
    const hasGyro = ids.includes('rotationRateRadiansPerSecond');

    const accuracy = readiness.horizontalAccuracyMeters;
    let gpsText = 'GPS pronto';
    if (!hasGps) {
      gpsText = 'GPS necessário';
    } else if (accuracy !== undefined) {
      gpsText = `GPS pronto (±${Math.round(accuracy)} m)`;
    }

    let motionText: string | null = null;
    if (hasAcc && hasGyro) {
      motionText = 'Movimento disponível';
    } else if (hasAcc && !hasGyro) {
      motionText = 'Acelerômetro pronto (sem giroscópio)';
    } else if (!hasAcc && hasGyro) {
      motionText = 'Giroscópio pronto';
    }

    const capabilities = [gpsText, motionText].filter(Boolean);
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

export interface PhoneSensorStreamsBreakdown {
  gps: string;
  gpsAccuracyMeters?: number;
  accelerometer: string;
  gyroscope: string;
  bluetooth: string;
}

export const describePhoneSensorStreams = (
  source: CaptureSourceState,
): PhoneSensorStreamsBreakdown => {
  const ids = source.readiness?.availableMeasurementIdentifiers ?? [];
  const accuracy = source.readiness?.horizontalAccuracyMeters;
  const hasGps = ids.includes('positionWgs84');
  const hasAcc =
    ids.includes('accelerationIncludingGravityG') ||
    ids.includes('linearAccelerationG');
  const hasGyro = ids.includes('rotationRateRadiansPerSecond');

  let gpsText = 'Pronto';
  if (!hasGps) {
    gpsText = 'Permissão necessária';
  } else if (accuracy !== undefined) {
    gpsText = `Pronto (±${Math.round(accuracy)} m)`;
  }

  const bluetoothState = source.readiness?.bluetoothState;
  let bluetoothText = 'Disponível';
  if (bluetoothState === 'powered_off') {
    bluetoothText = 'Desligado';
  } else if (bluetoothState === 'unauthorized') {
    bluetoothText = 'Permissão necessária';
  } else if (bluetoothState === 'unsupported') {
    bluetoothText = 'Não suportado';
  } else if (bluetoothState === 'powered_on') {
    bluetoothText = 'Disponível';
  }

  return {
    gps: gpsText,
    gpsAccuracyMeters: accuracy,
    accelerometer: hasAcc ? 'Disponível' : 'Ausente',
    gyroscope: hasGyro ? 'Disponível' : 'Não suportado',
    bluetooth: bluetoothText,
  };
};

export interface OverallReadiness {
  title: string;
  summary: string;
  isReady: boolean;
  hasMissingPermissions: boolean;
}

export const overallReadinessSummary = (
  sources: CaptureSourceState[],
): OverallReadiness => {
  const phone = sources.find(
    s => s.deviceFamily === 'iphone' || s.deviceFamily === 'android_phone',
  );

  if (!phone || !phone.readiness) {
    return {
      title: 'Aguardando dispositivo',
      summary: 'Nenhum celular conectado',
      isReady: false,
      hasMissingPermissions: false,
    };
  }

  const ids = phone.readiness.availableMeasurementIdentifiers ?? [];
  const accuracy = phone.readiness.horizontalAccuracyMeters;
  const gpsSuffix = accuracy !== undefined ? ` (±${Math.round(accuracy)} m)` : '';
  const hasGps = ids.includes('positionWgs84');
  const hasAcc =
    ids.includes('accelerationIncludingGravityG') ||
    ids.includes('linearAccelerationG');
  const hasGyro = ids.includes('rotationRateRadiansPerSecond');

  if (!hasGps) {
    return {
      title: 'Permissões necessárias',
      summary: 'GPS necessário · Movimento disponível',
      isReady: false,
      hasMissingPermissions: true,
    };
  }

  const blade = sources.find(s => s.deviceFamily === 'remus_blade');
  const bladeOffline =
    blade &&
    (blade.readiness?.sourceConnectionState !== 'connected' ||
      blade.operationalState === 'unavailable');
  const bladeSuffix = bladeOffline ? ' · Remus Blade offline' : '';

  if (hasGps && hasAcc && !hasGyro) {
    return {
      title: 'Pronto para começar',
      summary: `GPS pronto${gpsSuffix} · Acelerômetro pronto (sem giroscópio)${bladeSuffix}`,
      isReady: true,
      hasMissingPermissions: false,
    };
  }

  return {
    title: 'Pronto para começar',
    summary: `GPS pronto${gpsSuffix} · Movimento disponível${bladeSuffix}`,
    isReady: true,
    hasMissingPermissions: false,
  };
};

export interface PhoneSummaryEvidence {
  title: string;
  sensorBadges: string[];
  caveat?: string;
}

export const describePhoneSummaryEvidence = (
  source: CaptureSourceState,
): PhoneSummaryEvidence => {
  const ids = source.readiness?.availableMeasurementIdentifiers ?? [];
  const hasGps = ids.includes('positionWgs84');
  const hasAcc =
    ids.includes('accelerationIncludingGravityG') ||
    ids.includes('linearAccelerationG');
  const hasGyro = ids.includes('rotationRateRadiansPerSecond');

  const badges: string[] = [];
  if (hasGps) {
    badges.push('GPS (GNSS)');
  }
  if (hasAcc) {
    badges.push('Acelerômetro');
  }
  if (hasGyro) {
    badges.push('Giroscópio');
  }

  const isAndroid = source.deviceFamily === 'android_phone';
  let caveat: string | undefined;
  if (!hasGyro) {
    caveat = isAndroid
      ? 'Giroscópio não suportado · ausência preservada'
      : 'Giroscópio não disponível · ausência preservada';
  }

  return {
    title: sourceDisplayName(source),
    sensorBadges: badges,
    caveat,
  };
};
