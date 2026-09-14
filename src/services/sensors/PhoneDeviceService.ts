import { Platform } from 'react-native';
import { CaptureSourceState } from '../../application/capture/ActivityCapture';
import { MeasurementIdentifier } from '../../contracts/acquisition';
import { PermissionManager, PermissionStatus } from '../permissions/PermissionManager';

export interface PhoneHardwareProfile {
  hasGps: boolean;
  hasAccelerometer: boolean;
  hasGyroscope: boolean;
}

export const DEFAULT_IOS_HARDWARE: PhoneHardwareProfile = {
  hasGps: true,
  hasAccelerometer: true,
  hasGyroscope: true,
};

export const DEFAULT_ANDROID_HARDWARE: PhoneHardwareProfile = {
  hasGps: true,
  hasAccelerometer: true,
  hasGyroscope: true,
};

export class PhoneDeviceService {
  private permissionManager: PermissionManager;
  private hardwareProfile: PhoneHardwareProfile;
  private sourceId: string;

  constructor(
    permissionManager: PermissionManager = new PermissionManager(),
    hardwareProfile?: PhoneHardwareProfile,
    sourceId: string = 'phone:primary',
  ) {
    this.permissionManager = permissionManager;
    this.sourceId = sourceId;
    if (hardwareProfile) {
      this.hardwareProfile = hardwareProfile;
    } else {
      this.hardwareProfile =
        Platform.OS === 'ios' ? DEFAULT_IOS_HARDWARE : DEFAULT_ANDROID_HARDWARE;
    }
  }

  getHardwareProfile(): PhoneHardwareProfile {
    return this.hardwareProfile;
  }

  setHardwareProfile(profile: PhoneHardwareProfile): void {
    this.hardwareProfile = profile;
  }

  async getPhoneSourceState(
    explicitPermissions?: import('../permissions/PermissionManager').AppPermissionsReport,
  ): Promise<CaptureSourceState & { hardwareProfile: PhoneHardwareProfile; missingPermissions: string[] }> {
    const isIos = Platform.OS === 'ios';
    const deviceFamily = isIos ? 'iphone' : 'android_phone';
    const sourceId = this.sourceId;

    const permissions =
      explicitPermissions ?? (await this.permissionManager.checkPermissions());

    const missingPermissions: string[] = [];
    if (permissions.location !== PermissionStatus.GRANTED) {
      missingPermissions.push('location');
    }
    if (permissions.sensors !== PermissionStatus.GRANTED) {
      missingPermissions.push('sensors');
    }

    const availableIds: MeasurementIdentifier[] = [];

    // GNSS / GPS streams
    if (
      this.hardwareProfile.hasGps &&
      permissions.location === PermissionStatus.GRANTED
    ) {
      availableIds.push(
        'positionWgs84',
        'horizontalAccuracyMeters',
        'groundSpeedMetersPerSecond',
      );
    }

    // Motion streams (Accelerometer and Gyroscope independent evaluation)
    if (permissions.sensors === PermissionStatus.GRANTED) {
      if (this.hardwareProfile.hasAccelerometer) {
        availableIds.push('accelerationIncludingGravityG');
      }
      if (this.hardwareProfile.hasGyroscope) {
        availableIds.push('rotationRateRadiansPerSecond');
      }
    }

    const liveTelemetryState =
      missingPermissions.length > 0
        ? 'unavailable'
        : availableIds.length > 0
        ? 'qualified'
        : 'unavailable';

    return {
      sourceId,
      deviceFamily,
      operationalState: 'available_idle',
      sensorPlacement: 'body',
      placementProvenance: 'device_metadata',
      capabilities: {
        liveTransfer: true,
        volatileResend: false,
        standaloneCapture: true,
        storeAndForward: false,
        postSyncDeletion: false,
        relayCapture: false,
      },
      clockDomains: [
        {
          clockDomainId: `${sourceId}:clock`,
          clockKind: 'monotonic',
          timestampUnit: 'us',
        },
      ],
      required: true,
      coverageSegments: [],
      readiness: {
        sourceConnectionState: 'connected',
        batteryLevelPercent: 92,
        horizontalAccuracyMeters: availableIds.includes('positionWgs84')
          ? 4.0
          : undefined,
        availableMeasurementIdentifiers: availableIds,
        liveTelemetryState,
      },
      hardwareProfile: this.hardwareProfile,
      missingPermissions,
    };
  }

  async requestPermissions(): Promise<CaptureSourceState & { hardwareProfile: PhoneHardwareProfile; missingPermissions: string[] }> {
    const report = await this.permissionManager.requestAllPermissions();
    return this.getPhoneSourceState(report);
  }
}
