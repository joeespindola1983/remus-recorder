import { NativeModules, Platform } from 'react-native';
import { CaptureSourceState } from '../../application/capture/ActivityCapture';
import { MeasurementIdentifier } from '../../contracts/acquisition';
import { PermissionManager, PermissionStatus } from '../permissions/PermissionManager';
import type { NativeRecordingBridge } from '../recording/RecordingService';

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
  private bridge?: NativeRecordingBridge;
  private sourceId: string;

  constructor(
    permissionManager: PermissionManager = new PermissionManager(),
    hardwareProfile?: PhoneHardwareProfile,
    bridge: NativeRecordingBridge | undefined = NativeModules.RemusRecordingBridge,
    sourceId: string = 'phone:primary',
  ) {
    this.permissionManager = permissionManager;
    this.bridge = bridge;
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

    if (this.bridge?.getPhoneHardwareProfile) {
      try {
        const detected = await this.bridge.getPhoneHardwareProfile();
        if (detected) {
          this.hardwareProfile = {
            hasGps: detected.hasGps ?? this.hardwareProfile.hasGps,
            hasAccelerometer: detected.hasAccelerometer ?? this.hardwareProfile.hasAccelerometer,
            hasGyroscope: detected.hasGyroscope ?? this.hardwareProfile.hasGyroscope,
          };
        }
      } catch {
        // Keep fallback profile on error
      }
    }

    const permissions =
      explicitPermissions ?? (await this.permissionManager.checkPermissions());

    const missingPermissions: string[] = [];
    if (permissions.location !== PermissionStatus.GRANTED) {
      missingPermissions.push('location');
    }
    if (permissions.sensors !== PermissionStatus.GRANTED) {
      missingPermissions.push('sensors');
    }
    if (permissions.bluetooth !== PermissionStatus.GRANTED) {
      missingPermissions.push('bluetooth');
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

    let batteryLevelPercent: number | undefined;
    if (this.bridge?.getBatteryLevel) {
      try {
        const level = await this.bridge.getBatteryLevel();
        if (level !== null && level !== undefined && level >= 0) {
          batteryLevelPercent = level;
        }
      } catch {
        // Leave undefined
      }
    }

    let horizontalAccuracyMeters: number | undefined;
    if (availableIds.includes('positionWgs84') && this.bridge?.getCurrentLocationAccuracy) {
      try {
        const acc = await this.bridge.getCurrentLocationAccuracy();
        if (acc !== null && acc !== undefined && acc >= 0) {
          horizontalAccuracyMeters = acc;
        }
      } catch {
        // Leave undefined
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
        batteryLevelPercent,
        horizontalAccuracyMeters,
        availableMeasurementIdentifiers: availableIds,
        liveTelemetryState,
        bluetoothState:
          permissions.bluetooth === PermissionStatus.GRANTED
            ? 'powered_on'
            : 'unauthorized',
      },
      hardwareProfile: this.hardwareProfile,
      missingPermissions,
    };
  }

  async requestPermissions(): Promise<CaptureSourceState & { hardwareProfile: PhoneHardwareProfile; missingPermissions: string[] }> {
    const report = await this.permissionManager.requestAllPermissions();
    return this.getPhoneSourceState(report);
  }

  async checkAndRequestInitialPermissions(): Promise<
    CaptureSourceState & {
      hardwareProfile: PhoneHardwareProfile;
      missingPermissions: string[];
      wasRequested: boolean;
      hasDenied: boolean;
    }
  > {
    const report = await this.permissionManager.checkPermissions();
    const hasUndetermined =
      report.location === PermissionStatus.UNDETERMINED ||
      report.bluetooth === PermissionStatus.UNDETERMINED;

    let finalReport = report;
    let wasRequested = false;

    if (hasUndetermined) {
      finalReport = await this.permissionManager.requestAllPermissions();
      wasRequested = true;
    }

    const hasDenied =
      finalReport.location === PermissionStatus.DENIED ||
      finalReport.bluetooth === PermissionStatus.DENIED;

    const sourceState = await this.getPhoneSourceState(finalReport);
    return {
      ...sourceState,
      wasRequested,
      hasDenied,
    };
  }
}
