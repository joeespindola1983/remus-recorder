import Foundation
import WatchConnectivity
import React

@objc(RemusWatchBridge)
class RemusWatchBridge: RCTEventEmitter, WCSessionDelegate {
  private var session: WCSession?
  private var hasListeners = false

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
    if hasListeners {
      sendEvent(withName: "onWatchMessage", body: message)
    }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    if hasListeners {
      sendEvent(withName: "onWatchMessage", body: message)
    }
    replyHandler(["status": "received"])
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    if hasListeners {
      sendEvent(withName: "onWatchMessage", body: userInfo)
    }
  }
}
