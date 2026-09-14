import Foundation
import HealthKit

@MainActor
final class WatchSensorManager: NSObject, ObservableObject {
    static let shared = WatchSensorManager()

    enum SensorState: Equatable {
        case idle
        case requestingPermission
        case recording
        case unavailable(String)
    }

    private let healthStore = HKHealthStore()
    private var workoutSession: HKWorkoutSession?
    private var workoutBuilder: HKLiveWorkoutBuilder?

    @Published private(set) var heartRateBeatsPerMinute: Double?
    @Published private(set) var state: SensorState = .idle

    func requestPermissions() {
        guard HKHealthStore.isHealthDataAvailable(),
              let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate) else {
            state = .unavailable("HealthKit indisponível")
            return
        }

        state = .requestingPermission
        WatchSessionManager.shared.sendPermissionState("not_determined")
        let shareTypes: Set<HKSampleType> = [HKObjectType.workoutType()]
        healthStore.requestAuthorization(toShare: shareTypes, read: [heartRateType]) { [weak self] success, error in
            Task { @MainActor in
                if success && self?.healthStore.authorizationStatus(for: .workoutType()) != .sharingDenied {
                    self?.state = .idle
                    WatchSessionManager.shared.sendPermissionState("unknown")
                } else {
                    self?.state = .unavailable(error?.localizedDescription ?? "Revise a permissão no app Saúde")
                    WatchSessionManager.shared.sendPermissionState("denied")
                }
            }
        }
    }

    func startHeartRateCapture() {
        guard workoutSession == nil else { return }
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .rowing
        configuration.locationType = .outdoor

        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(
                healthStore: healthStore,
                workoutConfiguration: configuration
            )
            session.delegate = self
            builder.delegate = self
            workoutSession = session
            workoutBuilder = builder

            let startedAt = Date()
            session.startActivity(with: startedAt)
            builder.beginCollection(withStart: startedAt) { [weak self] success, error in
                Task { @MainActor in
                    if success {
                        self?.state = .recording
                    } else {
                        self?.state = .unavailable(error?.localizedDescription ?? "Falha ao iniciar")
                        self?.workoutSession = nil
                        self?.workoutBuilder = nil
                    }
                }
            }
        } catch {
            state = .unavailable(error.localizedDescription)
        }
    }

    func stopHeartRateCapture() {
        guard let session = workoutSession, let builder = workoutBuilder else { return }
        let endedAt = Date()
        session.end()
        builder.endCollection(withEnd: endedAt) { [weak self] _, _ in
            builder.finishWorkout { [weak self] _, _ in
                Task { @MainActor [weak self] in
                    self?.workoutSession = nil
                    self?.workoutBuilder = nil
                    self?.state = .idle
                }
            }
        }
    }
}

extension WatchSensorManager: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {}

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor [weak self] in
            self?.state = .unavailable(error.localizedDescription)
            self?.workoutSession = nil
            self?.workoutBuilder = nil
        }
    }
}

extension WatchSensorManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(
        _ workoutBuilder: HKLiveWorkoutBuilder,
        didCollectDataOf collectedTypes: Set<HKSampleType>
    ) {
        guard let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate),
              collectedTypes.contains(heartRateType),
              let statistics = workoutBuilder.statistics(for: heartRateType),
              let quantity = statistics.mostRecentQuantity() else { return }

        let bpm = quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        let measuredAt = statistics.endDate
        guard bpm.isFinite, bpm > 0 else { return }

        Task { @MainActor [weak self] in
            self?.heartRateBeatsPerMinute = bpm
            WatchSessionManager.shared.sendPermissionState("granted")
            WatchSessionManager.shared.sendHeartRateObservation(
                heartRateBeatsPerMinute: bpm,
                measuredAt: measuredAt
            )
        }
    }
}
