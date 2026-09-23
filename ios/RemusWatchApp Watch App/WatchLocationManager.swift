import Foundation
import CoreLocation
import Combine

class WatchLocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let locationManager = CLLocationManager()

    @Published var lastLocation: CLLocation?
    @Published var authorizationStatus: CLAuthorizationStatus = .notDetermined

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 1.0
        locationManager.allowsBackgroundLocationUpdates = true
    }

    func requestPermissions() {
        locationManager.requestWhenInUseAuthorization()
        locationManager.requestAlwaysAuthorization()
    }

    func startTracking() {
        locationManager.startUpdatingLocation()
    }

    func stopTracking() {
        locationManager.stopUpdatingLocation()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        DispatchQueue.main.async {
            self.authorizationStatus = manager.authorizationStatus
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        DispatchQueue.main.async {
            self.lastLocation = location
        }

        WatchSessionManager.shared.sendSensorPayload(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            altitude: location.altitude,
            groundSpeedMetersPerSecond: location.speed >= 0 ? location.speed : nil,
            horizontalAccuracyMeters: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil
        )
    }
}
