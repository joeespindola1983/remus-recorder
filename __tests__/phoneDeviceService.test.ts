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

      expect(sourceState.sourceId).toBe('phone:primary');
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

      expect(sourceState.sourceId).toBe('phone:primary');
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

      expect(sourceState.sourceId).toBe('phone:primary');
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
      expect(updatedState.sourceId).toBe('phone:primary');
      expect(updatedState.readiness?.liveTelemetryState).toBe('qualified');
      const ids = updatedState.readiness?.availableMeasurementIdentifiers ?? [];
      expect(ids).toContain('positionWgs84');
      expect(ids).toContain('accelerationIncludingGravityG');
    });

    it('automatically requests permissions on initial entry if undetermined', async () => {
      jest.spyOn(permissionManager, 'checkPermissions').mockResolvedValue({
        location: PermissionStatus.UNDETERMINED,
        backgroundLocation: PermissionStatus.UNDETERMINED,
        sensors: PermissionStatus.GRANTED,
        bluetooth: PermissionStatus.GRANTED,
      });
      const requestSpy = jest.spyOn(permissionManager, 'requestAllPermissions').mockResolvedValue({
        location: PermissionStatus.GRANTED,
        backgroundLocation: PermissionStatus.GRANTED,
        sensors: PermissionStatus.GRANTED,
        bluetooth: PermissionStatus.GRANTED,
      });

      const result = await service.checkAndRequestInitialPermissions();
      expect(requestSpy).toHaveBeenCalled();
      expect(result.wasRequested).toBe(true);
      expect(result.hasDenied).toBe(false);
      expect(result.readiness?.liveTelemetryState).toBe('qualified');
    });

    it('does not prompt if permissions were already determined/granted', async () => {
      jest.spyOn(permissionManager, 'checkPermissions').mockResolvedValue({
        location: PermissionStatus.GRANTED,
        backgroundLocation: PermissionStatus.GRANTED,
        sensors: PermissionStatus.GRANTED,
        bluetooth: PermissionStatus.GRANTED,
      });
      const requestSpy = jest.spyOn(permissionManager, 'requestAllPermissions');

      const result = await service.checkAndRequestInitialPermissions();
      expect(requestSpy).not.toHaveBeenCalled();
      expect(result.wasRequested).toBe(false);
      expect(result.hasDenied).toBe(false);
    });

    it('flags hasDenied when permissions were denied by the user', async () => {
      jest.spyOn(permissionManager, 'checkPermissions').mockResolvedValue({
        location: PermissionStatus.DENIED,
        backgroundLocation: PermissionStatus.DENIED,
        sensors: PermissionStatus.GRANTED,
        bluetooth: PermissionStatus.GRANTED,
      });

      const result = await service.checkAndRequestInitialPermissions();
      expect(result.hasDenied).toBe(true);
      expect(result.readiness?.liveTelemetryState).toBe('unavailable');
    });

    it('queries native bridge for hardware profile, battery level, and GPS accuracy', async () => {
      jest.spyOn(permissionManager, 'checkPermissions').mockResolvedValue({
        location: PermissionStatus.GRANTED,
        backgroundLocation: PermissionStatus.GRANTED,
        sensors: PermissionStatus.GRANTED,
        bluetooth: PermissionStatus.GRANTED,
      });

      const mockBridge = {
        getPhoneHardwareProfile: jest.fn().mockResolvedValue({
          hasGps: true,
          hasAccelerometer: true,
          hasGyroscope: false,
          hasMagnetometer: false,
          hasBarometer: false,
        }),
        getBatteryLevel: jest.fn().mockResolvedValue(67),
        getCurrentLocationAccuracy: jest.fn().mockResolvedValue(12.5),
      };

      const bridgeService = new PhoneDeviceService(permissionManager, undefined, mockBridge as any);
      const sourceState = await bridgeService.getPhoneSourceState();

      expect(mockBridge.getPhoneHardwareProfile).toHaveBeenCalled();
      expect(mockBridge.getBatteryLevel).toHaveBeenCalled();
      expect(mockBridge.getCurrentLocationAccuracy).toHaveBeenCalled();
      expect(sourceState.readiness?.batteryLevelPercent).toBe(67);
      expect(sourceState.readiness?.horizontalAccuracyMeters).toBe(12.5);
      expect(sourceState.readiness?.availableMeasurementIdentifiers).not.toContain('rotationRateRadiansPerSecond');
    });

    it('leaves batteryLevelPercent and horizontalAccuracyMeters undefined when bridge returns null without faking values', async () => {
      jest.spyOn(permissionManager, 'checkPermissions').mockResolvedValue({
        location: PermissionStatus.GRANTED,
        backgroundLocation: PermissionStatus.GRANTED,
        sensors: PermissionStatus.GRANTED,
        bluetooth: PermissionStatus.GRANTED,
      });

      const mockBridge = {
        getPhoneHardwareProfile: jest.fn().mockResolvedValue({
          hasGps: true,
          hasAccelerometer: true,
          hasGyroscope: true,
        }),
        getBatteryLevel: jest.fn().mockResolvedValue(null),
        getCurrentLocationAccuracy: jest.fn().mockResolvedValue(null),
      };

      const bridgeService = new PhoneDeviceService(permissionManager, undefined, mockBridge as any);
      const sourceState = await bridgeService.getPhoneSourceState();

      expect(sourceState.readiness?.batteryLevelPercent).toBeUndefined();
      expect(sourceState.readiness?.horizontalAccuracyMeters).toBeUndefined();
    });
  });
});
