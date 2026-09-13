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
  bluetooth: PermissionStatus;
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
      const bluetoothScan =
        Platform.Version >= 31 && (PermissionsAndroid.PERMISSIONS as any).BLUETOOTH_SCAN
          ? await PermissionsAndroid.check(
              (PermissionsAndroid.PERMISSIONS as any).BLUETOOTH_SCAN
            )
          : true;

      return {
        location: fineLocation ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
        backgroundLocation: bgLocation ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
        // Phone accelerometer/gyroscope access does not use BODY_SENSORS.
        // Wearable heart-rate consent is requested inside the watch app.
        sensors: PermissionStatus.GRANTED,
        bluetooth: bluetoothScan ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
      };
    }

    // On iOS, native permissions are typically requested upon sensor/location activation
    return {
      location: PermissionStatus.UNDETERMINED,
      backgroundLocation: PermissionStatus.UNDETERMINED,
      sensors: PermissionStatus.UNDETERMINED,
      bluetooth: PermissionStatus.UNDETERMINED,
    };
  }

  async requestAllPermissions(): Promise<AppPermissionsReport> {
    if (Platform.OS === 'android') {
      const permissionsToRequest = [
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
      ];

      if (Platform.Version >= 31 && (PermissionsAndroid.PERMISSIONS as any).BLUETOOTH_SCAN) {
        permissionsToRequest.push((PermissionsAndroid.PERMISSIONS as any).BLUETOOTH_SCAN);
        permissionsToRequest.push((PermissionsAndroid.PERMISSIONS as any).BLUETOOTH_CONNECT);
      }

      const statuses = await PermissionsAndroid.requestMultiple(permissionsToRequest);

      const isLocationGranted =
        statuses[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
        PermissionsAndroid.RESULTS.GRANTED;

      const isBgLocationGranted =
        statuses[PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION] ===
        PermissionsAndroid.RESULTS.GRANTED;

      const bluetoothKey = (PermissionsAndroid.PERMISSIONS as Record<string, string>).BLUETOOTH_SCAN;
      const isBluetoothGranted =
        Platform.Version >= 31 && bluetoothKey
          ? (statuses as Record<string, string>)[bluetoothKey] ===
            PermissionsAndroid.RESULTS.GRANTED
          : isLocationGranted;

      return {
        location: isLocationGranted ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
        backgroundLocation: isBgLocationGranted ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
        sensors: PermissionStatus.GRANTED,
        bluetooth: isBluetoothGranted ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
      };
    }

    // For iOS, returning GRANTED when initiated through app lifecycle
    return {
      location: PermissionStatus.GRANTED,
      backgroundLocation: PermissionStatus.GRANTED,
      sensors: PermissionStatus.GRANTED,
      bluetooth: PermissionStatus.GRANTED,
    };
  }
}
