import Foundation
import WatchConnectivity

@MainActor
final class WatchSessionManager: NSObject, ObservableObject {
    static let shared = WatchSessionManager()

    @Published private(set) var isReachable = false
    @Published private(set) var isRecording = false
    var recordingCommandHandler: ((Bool) -> Void)?

    private let session: WCSession?
    private let deviceId: String
    private var sequenceNumber: UInt64

    override init() {
        let defaults = UserDefaults.standard
        if let storedDeviceId = defaults.string(forKey: "remus.watch.deviceId") {
            deviceId = storedDeviceId
        } else {
            let generatedDeviceId = "apple-watch:\(UUID().uuidString.lowercased())"
            defaults.set(generatedDeviceId, forKey: "remus.watch.deviceId")
            deviceId = generatedDeviceId
        }
        sequenceNumber = UInt64(defaults.string(forKey: "remus.watch.sequenceNumber") ?? "0") ?? 0
        session = WCSession.isSupported() ? WCSession.default : nil
        super.init()
        session?.delegate = self
        session?.activate()
    }

    func sendHeartRateObservation(heartRateBeatsPerMinute: Double, measuredAt: Date) {
        guard heartRateBeatsPerMinute.isFinite, heartRateBeatsPerMinute > 0,
              let session, session.activationState == .activated else { return }

        sequenceNumber &+= 1
        UserDefaults.standard.set(String(sequenceNumber), forKey: "remus.watch.sequenceNumber")
        let messageId = "\(deviceId):\(sequenceNumber)"
        let payload: [String: Any] = [
            "protocolVersion": "1.0.0",
            "type": "HEART_RATE_OBSERVATION",
            "messageId": messageId,
            "deviceId": deviceId,
            "deviceFamily": "apple_watch",
            "clockDomainId": "\(deviceId):healthkit",
            "nativeTimestamp": Int64(measuredAt.timeIntervalSince1970 * 1_000),
            "sequenceNumber": String(sequenceNumber),
            "heartRateBeatsPerMinute": heartRateBeatsPerMinute,
        ]

        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { [weak self] _ in
                self?.session?.transferUserInfo(payload)
            }
        } else {
            session.transferUserInfo(payload)
        }
    }

    func sendPermissionState(_ permissionState: String) {
        guard let session, session.activationState == .activated else { return }
        let payload: [String: Any] = [
            "protocolVersion": "1.0.0",
            "type": "DEVICE_STATE",
            "deviceId": deviceId,
            "deviceFamily": "apple_watch",
            "heartRatePermissionState": permissionState,
        ]
        try? session.updateApplicationContext(payload)
    }

    private func apply(_ message: [String: Any]) {
        guard let command = message["command"] as? String else { return }
        switch command {
        case "START_RECORD":
            isRecording = true
            recordingCommandHandler?(true)
        case "STOP_RECORD":
            isRecording = false
            recordingCommandHandler?(false)
        default:
            break
        }
    }

    func setRecording(_ shouldRecord: Bool) {
        isRecording = shouldRecord
        recordingCommandHandler?(shouldRecord)
    }
}

extension WatchSessionManager: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        Task { @MainActor [weak self] in self?.isReachable = session.isReachable }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor [weak self] in self?.isReachable = session.isReachable }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor [weak self] in self?.apply(message) }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor [weak self] in self?.apply(applicationContext) }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        Task { @MainActor [weak self] in self?.apply(userInfo) }
    }
}
