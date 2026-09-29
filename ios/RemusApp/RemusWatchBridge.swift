import Foundation
import WatchConnectivity
import HealthKit
import CryptoKit
import React

@objc(RemusWatchBridge)
class RemusWatchBridge: RCTEventEmitter, WCSessionDelegate {
  private let healthStore = HKHealthStore()
  private var session: WCSession?
  private var hasListeners = false
  private var latestHeartRatePayload: [String: Any]?
  private var latestPermissionState: String?
  private var deliveredMessageIds: Set<String> = []


  override init() {
    super.init()
    if WCSession.isSupported() {
      session = WCSession.default
      session?.delegate = self
      session?.activate()
    }
  }

  @objc
  override static func requiresMainQueueSetup() -> Bool {
    return true
  }

  override func supportedEvents() -> [String]! {
    return ["onWatchMessage", "onWatchStateChanged"]
  }

  override func startObserving() {
    hasListeners = true
    if let latestPermissionState {
      sendEvent(withName: "onWatchStateChanged", body: [
        "isPaired": session?.isPaired ?? false,
        "isWatchAppInstalled": session?.isWatchAppInstalled ?? false,
        "isReachable": session?.isReachable ?? false,
        "heartRatePermissionState": latestPermissionState,
      ])
    }
  }

  override func stopObserving() {
    hasListeners = false
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    guard hasListeners else { return }
    sendEvent(withName: "onWatchStateChanged", body: [
      "isPaired": session.isPaired,
      "isWatchAppInstalled": session.isWatchAppInstalled,
      "isReachable": session.isReachable,
      "heartRatePermissionState": latestPermissionState as Any,
    ])
  }

  @objc
  func isSupported(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(WCSession.isSupported())
  }

  @objc
  func isPaired(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let session = session else {
      resolve(false)
      return
    }
    resolve(session.isPaired)
  }

  @objc
  func isWatchAppInstalled(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let session = session else {
      resolve(false)
      return
    }
    resolve(session.isWatchAppInstalled)
  }

  @objc
  func isReachable(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let session = session else {
      resolve(false)
      return
    }
    resolve(session.isReachable)
  }

  @objc
  func getLatestHeartRate(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(latestHeartRatePayload)
  }

  @objc
  func sendMessage(_ message: [String: Any], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    NSLog("[RemusWatchBridge] sendMessage called with: \(message)")
    guard let session = session else {
      NSLog("[RemusWatchBridge] ERROR: session is nil")
      reject("SESSION_UNAVAILABLE", "WCSession is not supported on this device", nil)
      return
    }

    NSLog("[RemusWatchBridge] session state: isPaired=\(session.isPaired), isWatchAppInstalled=\(session.isWatchAppInstalled), isReachable=\(session.isReachable), activationState=\(session.activationState.rawValue)")

    let rawCommand = (message["command"] as? String) ?? (message["action"] as? String) ?? ""
    let upperCommand = rawCommand.uppercased()
    if ["START_RECORD", "START_RECORDING", "START_WORKOUT"].contains(upperCommand) {
      let isHealthAvailable = HKHealthStore.isHealthDataAvailable()
      NSLog("[RemusWatchBridge] START command detected. HKHealthStore.isHealthDataAvailable=\(isHealthAvailable)")
      if isHealthAvailable {
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .rowing
        configuration.locationType = .outdoor
        let shareTypes: Set<HKSampleType> = [HKObjectType.workoutType()]
        healthStore.requestAuthorization(toShare: shareTypes, read: []) { [weak self] authSuccess, authError in
          NSLog("[RemusWatchBridge] HealthKit requestAuthorization result: success=\(authSuccess), error=\(String(describing: authError))")
          self?.healthStore.startWatchApp(with: configuration) { watchSuccess, watchError in
            NSLog("[RemusWatchBridge] healthStore.startWatchApp result: success=\(watchSuccess), error=\(String(describing: watchError))")
          }
        }
      }
    }

    if session.isReachable {
      NSLog("[RemusWatchBridge] session.isReachable is TRUE, sending interactive message...")
      session.sendMessage(message, replyHandler: { reply in
        NSLog("[RemusWatchBridge] interactive message succeeded with reply: \(reply)")
        resolve(reply)
      }, errorHandler: { [weak self] error in
        NSLog("[RemusWatchBridge] interactive message failed: \(error.localizedDescription). Falling back to background transfer...")
        do {
          try session.updateApplicationContext(message)
          NSLog("[RemusWatchBridge] updateApplicationContext fallback succeeded")
          resolve(["status": "fallback_application_context"])
        } catch {
          session.transferUserInfo(message)
          NSLog("[RemusWatchBridge] transferUserInfo fallback queued")
          resolve(["status": "fallback_user_info"])
        }
      })
    } else {
      NSLog("[RemusWatchBridge] session.isReachable is FALSE, sending via background transfer...")
      do {
        try session.updateApplicationContext(message)
        NSLog("[RemusWatchBridge] updateApplicationContext succeeded")
        resolve(["status": "queued_application_context"])
      } catch {
        session.transferUserInfo(message)
        NSLog("[RemusWatchBridge] transferUserInfo queued")
        resolve(["status": "queued_user_info"])
      }
    }
  }

  // MARK: - WCSessionDelegate
  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    if hasListeners {
      sendEvent(withName: "onWatchStateChanged", body: [
        "activationState": activationState.rawValue,
        "isPaired": session.isPaired,
        "isWatchAppInstalled": session.isWatchAppInstalled,
      ])
    }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    WCSession.default.activate()
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    if hasListeners {
      sendEvent(withName: "onWatchStateChanged", body: [
        "isPaired": session.isPaired,
        "isWatchAppInstalled": session.isWatchAppInstalled,
      ])
    }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    receive(message)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    receive(message)
    replyHandler(["status": "received"])
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    receive(userInfo)
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    receive(applicationContext)
  }

  func session(_ session: WCSession, didReceive file: WCSessionFile) {
    let sourceURL = file.fileURL
    let metadata = file.metadata ?? [:]
    guard let fileData = try? Data(contentsOf: sourceURL) else { return }
    let sha256 = SHA256.hash(data: fileData).compactMap { String(format: "%02x", $0) }.joined()
    RemusEvidenceStore.shared.importWatchArchive(
      fileURL: sourceURL,
      metadata: metadata,
      sha256: sha256
    )
  }

  private func receive(_ payload: [String: Any]) {
    if payload["type"] as? String == "DEVICE_STATE" {
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        self.latestPermissionState = payload["heartRatePermissionState"] as? String
        if self.hasListeners {
          self.sendEvent(withName: "onWatchStateChanged", body: [
            "isPaired": self.session?.isPaired ?? false,
            "isWatchAppInstalled": self.session?.isWatchAppInstalled ?? false,
            "heartRatePermissionState": self.latestPermissionState ?? "unknown",
          ])
        }
      }
      return
    }

    if payload["type"] as? String == "RECORDING_STATE" {
      RemusEvidenceStore.shared.appendWatchRecordingState(payload)
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        if self.hasListeners {
          self.sendEvent(withName: "onWatchMessage", body: payload)
          let recordingState = payload["recordingState"] as? String
          self.sendEvent(withName: "onWatchStateChanged", body: [
            "isPaired": self.session?.isPaired ?? false,
            "isWatchAppInstalled": self.session?.isWatchAppInstalled ?? false,
            "isReachable": self.session?.isReachable ?? false,
            "heartRatePermissionState": self.latestPermissionState ?? "unknown",
            "recordingState": recordingState as Any,
            "recordingId": payload["recordingId"] as Any,
            "clockDomainId": payload["clockDomainId"] as Any,
          ])
        }
      }
      return
    }

    guard payload["type"] as? String == "HEART_RATE_OBSERVATION",
          let bpm = payload["heartRateBeatsPerMinute"] as? NSNumber,
          bpm.doubleValue.isFinite,
          bpm.doubleValue > 0 else { return }

    // Rule 5D.4: Live preview isolation
    if let activeCorrId = RemusEvidenceStore.shared.activeCorrelationId() {
      if let msgCorrId = payload["activityCorrelationId"] as? String, !msgCorrId.isEmpty {
        guard msgCorrId == activeCorrId else {
          NSLog("[RemusWatchBridge] Live preview isolated: watch msg correlation \(msgCorrId) != active session \(activeCorrId)")
          return
        }
      }
    }

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if let messageId = payload["messageId"] as? String {
        guard !self.deliveredMessageIds.contains(messageId) else { return }
        self.deliveredMessageIds.insert(messageId)
      }
      var enriched = payload
      enriched["receivedAtEpochMilliseconds"] = Int64(Date().timeIntervalSince1970 * 1_000)
      RemusEvidenceStore.shared.appendWatchHeartRate(enriched)
      self.latestHeartRatePayload = enriched
      if self.hasListeners {
        self.sendEvent(withName: "onWatchMessage", body: enriched)
      }
    }
  }
}
