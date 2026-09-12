import { PermissionsAndroid, Platform } from 'react-native';

export enum PermissionStatus {
  GRANTED = 'granted',
  DENIED = 'denied',
  NEVER_ASK_AGAIN = 'never_ask_again',
  UNDETERMINED = 'undetermined',
}

export interface AppPermissionsReport {
  location: PermissionStatus;
  backgroundLocation: PermissionStatus;
  sensors: PermissionStatus;
}

export class PermissionManager {
  async checkPermissions(): Promise<AppPermissionsReport> {
    if (Platform.OS === 'android') {
      const fineLocation = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      const bgLocation =
        Platform.Version >= 29
          ? await PermissionsAndroid.check(
              PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION
            )
          : fineLocation;
      const bodySensors = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.BODY_SENSORS
      );

      return {
        location: fineLocation ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
        backgroundLocation: bgLocation ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
        sensors: bodySensors ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
      };
    }

    // On iOS, native permissions are typically requested upon sensor/location activation
    return {
      location: PermissionStatus.UNDETERMINED,
      backgroundLocation: PermissionStatus.UNDETERMINED,
      sensors: PermissionStatus.UNDETERMINED,
    };
  }

  async requestAllPermissions(): Promise<AppPermissionsReport> {
    if (Platform.OS === 'android') {
      const permissionsToRequest = [
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
        PermissionsAndroid.PERMISSIONS.BODY_SENSORS,
        PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
      ];

      const statuses = await PermissionsAndroid.requestMultiple(permissionsToRequest);

      const isLocationGranted =
        statuses[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
        PermissionsAndroid.RESULTS.GRANTED;

      const isBgLocationGranted =
        statuses[PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION] ===
        PermissionsAndroid.RESULTS.GRANTED;

      const isSensorsGranted =
        statuses[PermissionsAndroid.PERMISSIONS.BODY_SENSORS] ===
        PermissionsAndroid.RESULTS.GRANTED;

      return {
        location: isLocationGranted ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
        backgroundLocation: isBgLocationGranted ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
        sensors: isSensorsGranted ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
      };
    }

    // For iOS, returning GRANTED when initiated through app lifecycle
    return {
      location: PermissionStatus.GRANTED,
      backgroundLocation: PermissionStatus.GRANTED,
      sensors: PermissionStatus.GRANTED,
    };
  }
}
