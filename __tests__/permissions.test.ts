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

    it('should request and return Android location & sensor permissions', async () => {
      jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({
        'android.permission.ACCESS_FINE_LOCATION': 'granted',
        'android.permission.ACCESS_COARSE_LOCATION': 'granted',
        'android.permission.ACCESS_BACKGROUND_LOCATION': 'granted',
        'android.permission.BODY_SENSORS': 'granted',
        'android.permission.ACTIVITY_RECOGNITION': 'granted',
      } as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>);

      const result = await permissionManager.requestAllPermissions();
      expect(result.location).toBe(PermissionStatus.GRANTED);
      expect(result.backgroundLocation).toBe(PermissionStatus.GRANTED);
      expect(result.sensors).toBe(PermissionStatus.GRANTED);
    });

    it('should handle denied permissions gracefully', async () => {
      jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({
        'android.permission.ACCESS_FINE_LOCATION': 'denied',
        'android.permission.ACCESS_COARSE_LOCATION': 'denied',
        'android.permission.ACCESS_BACKGROUND_LOCATION': 'denied',
        'android.permission.BODY_SENSORS': 'denied',
        'android.permission.ACTIVITY_RECOGNITION': 'denied',
      } as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>);

      const result = await permissionManager.requestAllPermissions();
      expect(result.location).toBe(PermissionStatus.DENIED);
      expect(result.backgroundLocation).toBe(PermissionStatus.DENIED);
      expect(result.sensors).toBe(PermissionStatus.DENIED);
    });
  });

  describe('iOS Permissions', () => {
    beforeEach(() => {
      Platform.OS = 'ios';
    });

    it('should provide default status for iOS', async () => {
      const result = await permissionManager.checkPermissions();
      expect(result).toHaveProperty('location');
      expect(result).toHaveProperty('backgroundLocation');
      expect(result).toHaveProperty('sensors');
    });
  });
});
