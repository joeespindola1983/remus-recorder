import Foundation
import WatchConnectivity
import Combine
import CoreMotion

class WatchSessionManager: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSessionManager()

    @Published var isReachable = false
    @Published var isRecording = false
    @Published var lastMessageReceived = ""

    private var session: WCSession?

    override init() {
        super.init()
        if WCSession.isSupported() {
            session = WCSession.default
            session?.delegate = self
            session?.activate()
        }
    }

    func sendSensorPayload(
        heartRateBeatsPerMinute: Double? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil,
        altitude: Double? = nil,
        groundSpeedMetersPerSecond: Double? = nil,
        horizontalAccuracyMeters: Double? = nil,
        accelerationIncludingGravityG: CMAcceleration? = nil,
        rotationRateRadiansPerSecond: CMRotationRate? = nil
    ) {
        guard let session = session, session.activationState == .activated else { return }

        var payload: [String: Any] = [
            "type": "SENSOR_UPDATE",
            "nativeTimestamp": Int(Date().timeIntervalSince1970 * 1000)
        ]

        if let heartRateBeatsPerMinute { payload["heartRateBeatsPerMinute"] = heartRateBeatsPerMinute }
        if let lat = latitude { payload["lat"] = lat }
        if let lng = longitude { payload["lng"] = lng }
        if let alt = altitude { payload["alt"] = alt }
        if let groundSpeedMetersPerSecond { payload["groundSpeedMetersPerSecond"] = groundSpeedMetersPerSecond }
        if let horizontalAccuracyMeters { payload["horizontalAccuracyMeters"] = horizontalAccuracyMeters }
        if let accelerationIncludingGravityG {
            payload["accelerationIncludingGravityG"] = [
                "x": accelerationIncludingGravityG.x,
                "y": accelerationIncludingGravityG.y,
                "z": accelerationIncludingGravityG.z
            ]
        }
        if let rotationRateRadiansPerSecond {
            payload["rotationRateRadiansPerSecond"] = [
                "x": rotationRateRadiansPerSecond.x,
                "y": rotationRateRadiansPerSecond.y,
                "z": rotationRateRadiansPerSecond.z
            ]
        }

        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { error in
                print("Error sending watch message: \(error.localizedDescription)")
            }
        } else {
            session.transferUserInfo(payload)
        }
    }

    // MARK: - WCSessionDelegate
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String : Any]) {
        DispatchQueue.main.async {
            if let command = message["command"] as? String {
                if command == "START_RECORD" {
                    self.isRecording = true
                } else if command == "STOP_RECORD" {
                    self.isRecording = false
                }
                self.lastMessageReceived = command
            }
        }
    }
}
