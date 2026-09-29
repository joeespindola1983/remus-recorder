import Foundation
import HealthKit
import CryptoKit

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
    private var databaseWriter: WatchDatabaseWriter?
    private var sessionStartedAt: Date?
    private var gapWatchdogTimer: Timer?
    private var lastSampleDate: Date?
    private var isInGap = false
    private let gapThresholdSeconds: TimeInterval = 5.0

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

    func startHeartRateCapture(
        correlationId: String? = nil,
        recordingId: String = "rec:watch:apple:primary:001",
        startCommandId: String? = nil
    ) {
        guard workoutSession == nil else { return }
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .rowing
        configuration.locationType = .outdoor

        do {
            let writer = WatchDatabaseWriter()
            let bootId = WatchSessionManager.shared.getDeviceBootId()
            let clockDomainId = "clk:\(WatchSessionManager.shared.getDeviceId()):001"
            let manifest = WatchLocalManifest(
                schemaVersion: "1.1.0",
                recordingId: recordingId,
                activityCorrelationId: correlationId,
                clockDomainId: clockDomainId,
                deviceBootId: bootId,
                startCommandId: startCommandId,
                status: "recording",
                startedAtEpochMilliseconds: Int64(Date().timeIntervalSince1970 * 1000)
            )
            _ = try writer.startSession(manifest: manifest)
            writer.appendLifecycle(event: "start_requested", commandId: startCommandId, details: "recordingId=\(recordingId)")
            self.databaseWriter = writer

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
            self.sessionStartedAt = startedAt
            session.startActivity(with: startedAt)
            builder.beginCollection(withStart: startedAt) { [weak self] success, error in
                Task { @MainActor in
                    if success {
                        self?.state = .recording
                        self?.lastSampleDate = Date()
                        self?.startGapWatchdog()
                        self?.databaseWriter?.appendLifecycle(event: "collection_begun", details: nil)
                        WatchSessionManager.shared.notifyRecordingStarted(
                            recordingId: recordingId,
                            clockDomainId: clockDomainId
                        )
                    } else {
                        self?.state = .unavailable(error?.localizedDescription ?? "Falha ao iniciar")
                        self?.databaseWriter?.appendLifecycle(event: "collection_failed", details: error?.localizedDescription)
                        _ = self?.databaseWriter?.stopSession(status: "failed", failureMessage: error?.localizedDescription)
                        self?.databaseWriter = nil
                        self?.workoutSession = nil
                        self?.workoutBuilder = nil
                        WatchSessionManager.shared.notifyRecordingFailed(reason: error?.localizedDescription ?? "Collection failed")
                    }
                }
            }
        } catch {
            databaseWriter?.appendLifecycle(event: "session_failed", details: error.localizedDescription)
            _ = databaseWriter?.stopSession(status: "failed", failureMessage: error.localizedDescription)
            databaseWriter = nil
            state = .unavailable(error.localizedDescription)
            WatchSessionManager.shared.notifyRecordingFailed(reason: error.localizedDescription)
        }
    }

    private func startGapWatchdog() {
        gapWatchdogTimer?.invalidate()
        gapWatchdogTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            guard let self, self.state == .recording else { return }
            let now = Date()
            let lastDate = self.lastSampleDate ?? now
            let elapsed = now.timeIntervalSince(lastDate)
            if elapsed >= self.gapThresholdSeconds {
                if !self.isInGap {
                    self.isInGap = true
                    self.databaseWriter?.recordGap(gapDurationSeconds: elapsed)
                }
            } else {
                self.isInGap = false
            }
        }
    }

    func stopHeartRateCapture(reason: String = "completed") {
        gapWatchdogTimer?.invalidate()
        gapWatchdogTimer = nil
        isInGap = false
        guard let session = workoutSession, let builder = workoutBuilder else {
            if let writer = databaseWriter {
                _ = writer.stopSession(status: reason)
                databaseWriter = nil
            }
            return
        }
        databaseWriter?.appendLifecycle(event: "stop_requested", details: reason)
        let endedAt = Date()
        session.end()
        builder.endCollection(withEnd: endedAt) { [weak self] _, _ in
            builder.finishWorkout { [weak self] _, _ in
                guard let self else { return }
                self.recoverHealthKitHeartRate(endedAt: endedAt, reason: reason)
            }
        }
    }

    private func recoverHealthKitHeartRate(endedAt: Date, reason: String) {
        guard let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate) else {
            finalizeAndTransferSession(endedAt: endedAt, reason: reason)
            return
        }
        let startDate = sessionStartedAt ?? endedAt.addingTimeInterval(-3600)
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endedAt, options: .strictStartDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let query = HKSampleQuery(
            sampleType: heartRateType,
            predicate: predicate,
            limit: HKObjectQueryNoLimit,
            sortDescriptors: [sortDescriptor]
        ) { [weak self] _, samples, _ in
            if let quantitySamples = samples as? [HKQuantitySample] {
                for sample in quantitySamples {
                    let bpm = sample.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
                    guard bpm.isFinite, bpm > 0 else { continue }
                    self?.databaseWriter?.appendHeartRate(
                        bpm: bpm,
                        measuredAt: sample.startDate,
                        sampleUUID: sample.uuid.uuidString,
                        deliveryState: "post_workout_recovery"
                    )
                }
            }
            Task { @MainActor [weak self] in
                self?.finalizeAndTransferSession(endedAt: endedAt, reason: reason)
            }
        }
        healthStore.execute(query)
    }

    private func finalizeAndTransferSession(endedAt: Date, reason: String) {
        let folderURL = databaseWriter?.stopSession(at: endedAt, status: reason)
        if let folderURL, let manifest = databaseWriter?.currentManifest() {
            transferSessionArchive(folderURL: folderURL, manifest: manifest)
        }
        databaseWriter = nil
        workoutSession = nil
        workoutBuilder = nil
        sessionStartedAt = nil
        state = .idle
        WatchSessionManager.shared.notifyRecordingStopped()
    }

    private func transferSessionArchive(folderURL: URL, manifest: WatchLocalManifest) {
        do {
            let archiveURL = try WatchDatabaseWriter.createArchive(folderURL: folderURL)
            let fileData = (try? Data(contentsOf: archiveURL)) ?? Data()
            let sha256 = SHA256.hash(data: fileData).compactMap { String(format: "%02x", $0) }.joined()
            let metadata: [String: Any] = [
                "schemaVersion": manifest.schemaVersion,
                "type": "WATCH_ARCHIVE_TRANSFER",
                "recordingId": manifest.recordingId,
                "activityCorrelationId": manifest.activityCorrelationId as Any,
                "clockDomainId": manifest.clockDomainId,
                "deviceBootId": manifest.deviceBootId,
                "startedAtEpochMilliseconds": manifest.startedAtEpochMilliseconds,
                "endedAtEpochMilliseconds": manifest.endedAtEpochMilliseconds as Any,
                "heartRateSampleCount": manifest.heartRateSampleCount,
                "status": manifest.status,
                "sha256": sha256
            ]
            WatchSessionManager.shared.transferFile(archiveURL, metadata: metadata)
        } catch {
            NSLog("[WatchSensorManager] Failed to create or transfer archive: %@", error.localizedDescription)
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
            guard let self else { return }
            self.lastSampleDate = Date()
            self.isInGap = false
            self.heartRateBeatsPerMinute = bpm
            self.databaseWriter?.appendHeartRate(bpm: bpm, measuredAt: measuredAt, sampleUUID: nil, deliveryState: "persisted")
            WatchSessionManager.shared.sendPermissionState("granted")

            WatchSessionManager.shared.sendHeartRateObservation(
                heartRateBeatsPerMinute: bpm,
                measuredAt: measuredAt
            )
        }
    }
}
