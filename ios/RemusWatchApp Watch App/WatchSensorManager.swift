import Foundation
import CoreMotion
import HealthKit
import Combine

class WatchSensorManager: NSObject, ObservableObject {
    private let motionManager = CMMotionManager()
    private let healthStore = HKHealthStore()

    @Published var heartRateBeatsPerMinute: Double?
    @Published var accelerationIncludingGravityG: CMAcceleration?
    @Published var rotationRateRadiansPerSecond: CMRotationRate?

    func requestPermissions() {
        if HKHealthStore.isHealthDataAvailable() {
            let typesToRead: Set = [
                HKObjectType.quantityType(forIdentifier: .heartRate)!
            ]
            healthStore.requestAuthorization(toShare: nil, read: typesToRead) { success, error in
                if success {
                    self.startHeartRateQuery()
                }
            }
        }
    }

    func startMotionTracking() {
        if motionManager.isAccelerometerAvailable {
            motionManager.accelerometerUpdateInterval = 0.2
            motionManager.startAccelerometerUpdates(to: .main) { [weak self] data, _ in
                guard let data = data else { return }
                self?.accelerationIncludingGravityG = data.acceleration
                WatchSessionManager.shared.sendSensorPayload(
                    accelerationIncludingGravityG: data.acceleration
                )
            }
        }

        if motionManager.isGyroAvailable {
            motionManager.gyroUpdateInterval = 0.2
            motionManager.startGyroUpdates(to: .main) { [weak self] data, _ in
                guard let data = data else { return }
                self?.rotationRateRadiansPerSecond = data.rotationRate
                WatchSessionManager.shared.sendSensorPayload(
                    rotationRateRadiansPerSecond: data.rotationRate
                )
            }
        }
    }

    func stopMotionTracking() {
        motionManager.stopAccelerometerUpdates()
        motionManager.stopGyroUpdates()
    }

    private func startHeartRateQuery() {
        guard let sampleType = HKObjectType.quantityType(forIdentifier: .heartRate) else { return }

        let query = HKObserverQuery(sampleType: sampleType, predicate: nil) { [weak self] _, _, error in
            guard error == nil else { return }
            self?.fetchLatestHeartRate()
        }
        healthStore.execute(query)
    }

    private func fetchLatestHeartRate() {
        guard let sampleType = HKObjectType.quantityType(forIdentifier: .heartRate) else { return }
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        let query = HKSampleQuery(sampleType: sampleType, predicate: nil, limit: 1, sortDescriptors: [sortDescriptor]) { [weak self] _, results, _ in
            guard let sample = results?.first as? HKQuantitySample else { return }
            let hr = sample.quantity.doubleValue(for: HKUnit.count().unitDivided(by: HKUnit.minute()))
            DispatchQueue.main.async {
                self?.heartRateBeatsPerMinute = hr
                WatchSessionManager.shared.sendSensorPayload(heartRateBeatsPerMinute: hr)
            }
        }
        healthStore.execute(query)
    }
}
