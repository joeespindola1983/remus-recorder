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
    private let bootId = "boot:\(UUID().uuidString.lowercased())"
    private var sequenceNumber: UInt64
    private var activeCorrelationId: String?
    private var activeRecordingId: String?
    private var activeClockDomainId: String?
    private var activeStartCommandId: String?
    private var lastProcessedStopCommandId: String?

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

    func getDeviceId() -> String { deviceId }
    func getDeviceBootId() -> String { bootId }

    func transferFile(_ url: URL, metadata: [String: Any]) {
        guard let session, session.activationState == .activated else {
            NSLog("[WatchSessionManager] Cannot transfer file: WCSession not activated")
            return
        }
        session.transferFile(url, metadata: metadata)
    }


    func sendHeartRateObservation(heartRateBeatsPerMinute: Double, measuredAt: Date) {
        guard heartRateBeatsPerMinute.isFinite, heartRateBeatsPerMinute > 0,
              let session, session.activationState == .activated else { return }

        sequenceNumber &+= 1
        UserDefaults.standard.set(String(sequenceNumber), forKey: "remus.watch.sequenceNumber")
        let messageId = "\(deviceId):\(sequenceNumber)"
        let payload: [String: Any] = [
            "protocolVersion": "1.1.0",
            "type": "HEART_RATE_OBSERVATION",
            "messageId": messageId,
            "deviceId": deviceId,
            "deviceFamily": "apple_watch",
            "recordingId": activeRecordingId ?? "rec:watch:apple:primary:001",
            "clockDomainId": activeClockDomainId ?? "clk:\(deviceId):001",
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
            "protocolVersion": "1.1.0",
            "type": "DEVICE_STATE",
            "deviceId": deviceId,
            "deviceFamily": "apple_watch",
            "heartRatePermissionState": permissionState,
        ]
        try? session.updateApplicationContext(payload)
    }

    func notifyRecordingStarted(recordingId: String, clockDomainId: String) {
        isRecording = true
        recordingCommandHandler?(true)
        guard let session, session.activationState == .activated else { return }
        let payload: [String: Any] = [
            "protocolVersion": "1.1.0",
            "type": "RECORDING_STATE",
            "deviceId": deviceId,
            "deviceFamily": "apple_watch",
            "recordingState": "recording",
            "recordingId": recordingId,
            "clockDomainId": clockDomainId,
            "activityCorrelationId": activeCorrelationId as Any
        ]
        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { [weak self] _ in
                self?.session?.transferUserInfo(payload)
            }
        } else {
            session.transferUserInfo(payload)
        }
    }

    func notifyRecordingFailed(reason: String) {
        isRecording = false
        recordingCommandHandler?(false)
        guard let session, session.activationState == .activated else { return }
        let payload: [String: Any] = [
            "protocolVersion": "1.1.0",
            "type": "RECORDING_STATE",
            "deviceId": deviceId,
            "deviceFamily": "apple_watch",
            "recordingState": "unavailable",
            "failureReason": reason
        ]
        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { [weak self] _ in
                self?.session?.transferUserInfo(payload)
            }
        } else {
            session.transferUserInfo(payload)
        }
    }

    func notifyRecordingStopped() {
        isRecording = false
        recordingCommandHandler?(false)
        guard let session, session.activationState == .activated else { return }
        let payload: [String: Any] = [
            "protocolVersion": "1.1.0",
            "type": "RECORDING_STATE",
            "deviceId": deviceId,
            "deviceFamily": "apple_watch",
            "recordingState": "stopped",
            "recordingId": activeRecordingId as Any
        ]
        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { [weak self] _ in
                self?.session?.transferUserInfo(payload)
            }
        } else {
            session.transferUserInfo(payload)
        }
    }

    @discardableResult
    func apply(_ message: [String: Any]) -> [String: Any] {
        let rawCommand = (message["command"] as? String) ?? (message["action"] as? String) ?? ""
        let command = rawCommand.uppercased()
        switch command {
        case "START_RECORD", "START_RECORDING", "START_WORKOUT":
            let startCommandId = message["startCommandId"] as? String ?? "cmd-start-\(UUID().uuidString)"
            let correlationId = message["activityCorrelationId"] as? String
            let incomingRecId = message["recordingId"] as? String

            if isRecording {
                return [
                    "status": "already_applied",
                    "recordingId": activeRecordingId ?? "",
                    "clockDomainId": activeClockDomainId ?? ""
                ]
            }

            activeStartCommandId = startCommandId
            activeCorrelationId = correlationId
            let assignedRecordingId = incomingRecId ?? "rec:watch:apple:\(UUID().uuidString.lowercased())"
            activeRecordingId = assignedRecordingId
            let assignedClockDomainId = "clk:\(deviceId):001"
            activeClockDomainId = assignedClockDomainId

            // Rule 5A.3: isRecording is reported only after beginCollection confirms success
            WatchSensorManager.shared.startHeartRateCapture(
                correlationId: correlationId,
                recordingId: assignedRecordingId,
                startCommandId: startCommandId
            )
            return [
                "status": "accepted",
                "recordingId": assignedRecordingId,
                "clockDomainId": assignedClockDomainId
            ]

        case "STOP_RECORD", "STOP_RECORDING", "STOP_WORKOUT":
            let stopCommandId = message["stopCommandId"] as? String ?? "cmd-stop-\(UUID().uuidString)"
            if !isRecording {
                return ["status": "already_applied"]
            }
            if lastProcessedStopCommandId == stopCommandId {
                return ["status": "already_applied"]
            }
            lastProcessedStopCommandId = stopCommandId
            isRecording = false
            recordingCommandHandler?(false)
            WatchSensorManager.shared.stopHeartRateCapture(reason: "completed")
            return ["status": "accepted"]

        default:
            return ["status": "rejected", "reason": "unknown_command"]
        }
    }

    func setRecording(_ shouldRecord: Bool) {
        if shouldRecord {
            guard !isRecording else { return }
            let localRecId = "rec:watch:apple:\(UUID().uuidString.lowercased())"
            let localCmdId = "cmd-local-\(UUID().uuidString)"
            activeStartCommandId = localCmdId
            activeCorrelationId = nil
            activeRecordingId = localRecId
            activeClockDomainId = "clk:\(deviceId):001"
            WatchSensorManager.shared.startHeartRateCapture(
                correlationId: nil,
                recordingId: localRecId,
                startCommandId: localCmdId
            )
        } else {
            guard isRecording else { return }
            isRecording = false
            recordingCommandHandler?(false)
            WatchSensorManager.shared.stopHeartRateCapture(reason: "completed")
        }
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

    nonisolated func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        Task { @MainActor [weak self] in
            let reply = self?.apply(message) ?? ["status": "rejected"]
            replyHandler(reply)
        }
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
