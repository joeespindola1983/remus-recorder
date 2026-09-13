import Foundation
import WatchConnectivity
import React

@objc(RemusWatchBridge)
class RemusWatchBridge: RCTEventEmitter, WCSessionDelegate {
  private var session: WCSession?
  private var hasListeners = false
  private var latestHeartRatePayload: [String: Any]?
  private var latestPermissionState: String?
  private var deliveredMessageIds: [String] = []

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
        "heartRatePermissionState": latestPermissionState,
      ])
    }
  }

  override func stopObserving() {
    hasListeners = false
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
  func getLatestHeartRate(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(latestHeartRatePayload)
  }

  @objc
  func sendMessage(_ message: [String: Any], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let session = session else {
      reject("SESSION_UNAVAILABLE", "WCSession is not supported on this device", nil)
      return
    }

    if session.isReachable {
      session.sendMessage(message, replyHandler: { reply in
        resolve(reply)
      }, errorHandler: { error in
        reject("SEND_ERROR", error.localizedDescription, error)
      })
    } else {
      do {
        try session.updateApplicationContext(message)
        resolve(["status": "queued_application_context"])
      } catch {
        session.transferUserInfo(message)
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

    guard payload["type"] as? String == "HEART_RATE_OBSERVATION",
          let bpm = payload["heartRateBeatsPerMinute"] as? NSNumber,
          bpm.doubleValue.isFinite,
          bpm.doubleValue > 0 else { return }

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if let messageId = payload["messageId"] as? String {
        guard !self.deliveredMessageIds.contains(messageId) else { return }
        self.deliveredMessageIds.append(messageId)
        if self.deliveredMessageIds.count > 256 {
          self.deliveredMessageIds.removeFirst(self.deliveredMessageIds.count - 256)
        }
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
