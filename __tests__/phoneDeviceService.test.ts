import { Platform } from 'react-native';
import { PermissionManager, PermissionStatus } from '../src/services/permissions/PermissionManager';
import { PhoneDeviceService, PhoneHardwareProfile } from '../src/services/sensors/PhoneDeviceService';

describe('PhoneDeviceService (TDD)', () => {
  let permissionManager: PermissionManager;
  let service: PhoneDeviceService;

  beforeEach(() => {
    permissionManager = new PermissionManager();
    service = new PhoneDeviceService(permissionManager);
    jest.clearAllMocks();
  });

  describe('iPhone (Standard iOS Hardware)', () => {
    beforeEach(() => {
      Platform.OS = 'ios';
    });

    it('declares full GPS, accelerometer and gyroscope capabilities when permissions are granted', async () => {
      jest.spyOn(permissionManager, 'checkPermissions').mockResolvedValue({
        location: PermissionStatus.GRANTED,
        backgroundLocation: PermissionStatus.GRANTED,
        sensors: PermissionStatus.GRANTED,
        bluetooth: PermissionStatus.GRANTED,
      });

      const sourceState = await service.getPhoneSourceState();

      expect(sourceState.deviceFamily).toBe('iphone');
      expect(sourceState.operationalState).toBe('available_idle');
      expect(sourceState.sensorPlacement).toBe('body');

      const ids = sourceState.readiness?.availableMeasurementIdentifiers ?? [];
      expect(ids).toContain('positionWgs84');
      expect(ids).toContain('horizontalAccuracyMeters');
      expect(ids).toContain('accelerationIncludingGravityG');
      expect(ids).toContain('rotationRateRadiansPerSecond');
      expect(sourceState.readiness?.liveTelemetryState).toBe('qualified');
    });

    it('reports degraded readiness when location permission is denied on iPhone', async () => {
      jest.spyOn(permissionManager, 'checkPermissions').mockResolvedValue({
        location: PermissionStatus.DENIED,
        backgroundLocation: PermissionStatus.DENIED,
        sensors: PermissionStatus.GRANTED,
        bluetooth: PermissionStatus.GRANTED,
      });

      const sourceState = await service.getPhoneSourceState();

      const ids = sourceState.readiness?.availableMeasurementIdentifiers ?? [];
      expect(ids).not.toContain('positionWgs84');
      expect(ids).toContain('accelerationIncludingGravityG');
      expect(ids).toContain('rotationRateRadiansPerSecond');
      expect(sourceState.readiness?.liveTelemetryState).toBe('unavailable');
    });
  });

  describe('Android Phone with Variable Hardware Sensors', () => {
    beforeEach(() => {
      Platform.OS = 'android';
    });

    it('omits gyroscope measurement identifier on Android devices without a physical gyro', async () => {
      jest.spyOn(permissionManager, 'checkPermissions').mockResolvedValue({
        location: PermissionStatus.GRANTED,
        backgroundLocation: PermissionStatus.GRANTED,
        sensors: PermissionStatus.GRANTED,
        bluetooth: PermissionStatus.GRANTED,
      });

      const noGyroProfile: PhoneHardwareProfile = {
        hasGps: true,
        hasAccelerometer: true,
        hasGyroscope: false, // Phone without gyro hardware
      };

      const androidService = new PhoneDeviceService(permissionManager, noGyroProfile);
      const sourceState = await androidService.getPhoneSourceState();

      expect(sourceState.deviceFamily).toBe('android_phone');
      const ids = sourceState.readiness?.availableMeasurementIdentifiers ?? [];
      expect(ids).toContain('positionWgs84');
      expect(ids).toContain('accelerationIncludingGravityG');
      // Must NOT contain rotation rate when hardware gyro is absent
      expect(ids).not.toContain('rotationRateRadiansPerSecond');
    });

    it('omits accelerometer when device lacks accelerometer hardware', async () => {
      jest.spyOn(permissionManager, 'checkPermissions').mockResolvedValue({
        location: PermissionStatus.GRANTED,
        backgroundLocation: PermissionStatus.GRANTED,
        sensors: PermissionStatus.GRANTED,
        bluetooth: PermissionStatus.GRANTED,
      });

      const noAccProfile: PhoneHardwareProfile = {
        hasGps: true,
        hasAccelerometer: false,
        hasGyroscope: false,
      };

      const androidService = new PhoneDeviceService(permissionManager, noAccProfile);
      const sourceState = await androidService.getPhoneSourceState();

      const ids = sourceState.readiness?.availableMeasurementIdentifiers ?? [];
      expect(ids).toContain('positionWgs84');
      expect(ids).not.toContain('accelerationIncludingGravityG');
      expect(ids).not.toContain('rotationRateRadiansPerSecond');
    });

    it('requests permissions and updates readiness accordingly', async () => {
      jest.spyOn(permissionManager, 'requestAllPermissions').mockResolvedValue({
        location: PermissionStatus.GRANTED,
        backgroundLocation: PermissionStatus.GRANTED,
        sensors: PermissionStatus.GRANTED,
        bluetooth: PermissionStatus.GRANTED,
      });

      const updatedState = await service.requestPermissions();
      expect(updatedState.readiness?.liveTelemetryState).toBe('qualified');
      const ids = updatedState.readiness?.availableMeasurementIdentifiers ?? [];
      expect(ids).toContain('positionWgs84');
      expect(ids).toContain('accelerationIncludingGravityG');
    });
  });
});
