import { PermissionManager, PermissionStatus } from '../src/services/permissions/PermissionManager';
import { PermissionsAndroid, Platform } from 'react-native';

describe('PermissionManager (TDD)', () => {
  let permissionManager: PermissionManager;

  beforeEach(() => {
    permissionManager = new PermissionManager();
    jest.clearAllMocks();
  });

  describe('Android Permissions', () => {
    beforeEach(() => {
      Platform.OS = 'android';
    });

    it('requests phone permissions without asking for wearable body sensors', async () => {
      jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({
        'android.permission.ACCESS_FINE_LOCATION': 'granted',
        'android.permission.ACCESS_COARSE_LOCATION': 'granted',
        'android.permission.ACCESS_BACKGROUND_LOCATION': 'granted',
        'android.permission.ACTIVITY_RECOGNITION': 'granted',
      } as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>);

      const result = await permissionManager.requestAllPermissions();
      expect(result.location).toBe(PermissionStatus.GRANTED);
      expect(result.backgroundLocation).toBe(PermissionStatus.GRANTED);
      expect(result.sensors).toBe(PermissionStatus.GRANTED);
      expect(result.bluetooth).toBe(PermissionStatus.GRANTED);
      expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledWith(
        expect.not.arrayContaining([PermissionsAndroid.PERMISSIONS.BODY_SENSORS]),
      );
    });

    it('should handle denied permissions gracefully', async () => {
      jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({
        'android.permission.ACCESS_FINE_LOCATION': 'denied',
        'android.permission.ACCESS_COARSE_LOCATION': 'denied',
        'android.permission.ACCESS_BACKGROUND_LOCATION': 'denied',
        'android.permission.ACTIVITY_RECOGNITION': 'denied',
      } as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>);

      const result = await permissionManager.requestAllPermissions();
      expect(result.location).toBe(PermissionStatus.DENIED);
      expect(result.backgroundLocation).toBe(PermissionStatus.DENIED);
      expect(result.sensors).toBe(PermissionStatus.GRANTED);
      expect(result.bluetooth).toBe(PermissionStatus.DENIED);
    });
  });

  describe('iOS Permissions', () => {
    let mockBridge: {
      getLocationPermissionStatus: jest.Mock;
      requestLocationPermission: jest.Mock;
    };

    beforeEach(() => {
      Platform.OS = 'ios';
      mockBridge = {
        getLocationPermissionStatus: jest.fn(),
        requestLocationPermission: jest.fn(),
      };
      permissionManager = new PermissionManager(mockBridge as any);
    });

    it('checks iOS location permission using native recording bridge status', async () => {
      mockBridge.getLocationPermissionStatus.mockResolvedValue('undetermined');
      let result = await permissionManager.checkPermissions();
      expect(mockBridge.getLocationPermissionStatus).toHaveBeenCalled();
      expect(result.location).toBe(PermissionStatus.UNDETERMINED);

      mockBridge.getLocationPermissionStatus.mockResolvedValue('granted');
      result = await permissionManager.checkPermissions();
      expect(result.location).toBe(PermissionStatus.GRANTED);

      mockBridge.getLocationPermissionStatus.mockResolvedValue('denied');
      result = await permissionManager.checkPermissions();
      expect(result.location).toBe(PermissionStatus.DENIED);
    });

    it('requests iOS location permission via native recording bridge', async () => {
      mockBridge.requestLocationPermission.mockResolvedValue('granted');
      let result = await permissionManager.requestAllPermissions();
      expect(mockBridge.requestLocationPermission).toHaveBeenCalled();
      expect(result.location).toBe(PermissionStatus.GRANTED);

      mockBridge.requestLocationPermission.mockResolvedValue('denied');
      result = await permissionManager.requestAllPermissions();
      expect(result.location).toBe(PermissionStatus.DENIED);
      expect(result.backgroundLocation).toBe(PermissionStatus.DENIED);
      expect(result.sensors).toBe(PermissionStatus.GRANTED);
    });
  });
});
