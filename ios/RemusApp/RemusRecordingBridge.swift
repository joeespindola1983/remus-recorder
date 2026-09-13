import CoreLocation
import CoreMotion
import Foundation
import React
import UIKit

@objc(RemusRecordingBridge)
final class RemusRecordingBridge: RCTEventEmitter, CLLocationManagerDelegate {
  private let evidenceStore = RemusEvidenceStore.shared
  private let motionManager = CMMotionManager()
  private let motionQueue: OperationQueue = {
    let queue = OperationQueue()
    queue.name = "com.espindola.remus.phone-motion"
    queue.qualityOfService = .userInitiated
    queue.maxConcurrentOperationCount = 1
    return queue
  }()
  private let locationManager = CLLocationManager()
  private var projectionTimer: Timer?
  private var startedAt: Date?
  private var lastLocation: CLLocation?
  private var distanceMeters = 0.0
  private var latestSpeedMetersPerSecond: Double?
  private var latestHorizontalAccuracyMeters: Double?
  private var latestAccelerationMagnitudeG: Double?
  private var hasListeners = false

  override init() {
    super.init()
    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
    locationManager.distanceFilter = kCLDistanceFilterNone
    locationManager.activityType = .fitness
    locationManager.pausesLocationUpdatesAutomatically = false
    locationManager.allowsBackgroundLocationUpdates = true
    locationManager.showsBackgroundLocationIndicator = true
  }

  @objc override static func requiresMainQueueSetup() -> Bool { true }

  override func supportedEvents() -> [String]! { ["onRecordingUpdate"] }
  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  @objc
  func startRecording(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      do {
        let sourceIds = options["sourceIds"] as? [String] ?? []
        let result = try self.evidenceStore.start(sourceIds: sourceIds)
        self.startedAt = Date()
        self.lastLocation = nil
        self.distanceMeters = 0
        self.latestSpeedMetersPerSecond = nil
        self.latestHorizontalAccuracyMeters = nil
        self.latestAccelerationMagnitudeG = nil
        self.startPhoneSensors()
        self.startProjectionTimer()
        UIApplication.shared.isIdleTimerDisabled = true
        resolve(result)
      } catch {
        reject("RECORDING_START_FAILED", error.localizedDescription, error)
      }
    }
  }

  @objc
  func stopRecording(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.stopPhoneSensors()
      do {
        let manifest = try self.evidenceStore.stop()
        self.startedAt = nil
        UIApplication.shared.isIdleTimerDisabled = false
        resolve(manifest)
      } catch {
        reject("RECORDING_STOP_FAILED", error.localizedDescription, error)
      }
    }
  }

  @objc
  func getRecordingState(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(evidenceStore.snapshot())
  }

  private func startPhoneSensors() {
    switch locationManager.authorizationStatus {
    case .notDetermined:
      locationManager.requestWhenInUseAuthorization()
    case .authorizedAlways, .authorizedWhenInUse:
      locationManager.startUpdatingLocation()
    default:
      break
    }

    guard motionManager.isDeviceMotionAvailable, let recordingStartedAt = startedAt else { return }
    motionManager.deviceMotionUpdateInterval = 1.0 / 100.0
    motionManager.startDeviceMotionUpdates(
      using: .xArbitraryCorrectedZVertical,
      to: motionQueue
    ) { [weak self] motion, _ in
      guard let self, let motion else { return }
      let acceleration = [
        "x": motion.userAcceleration.x + motion.gravity.x,
        "y": motion.userAcceleration.y + motion.gravity.y,
        "z": motion.userAcceleration.z + motion.gravity.z,
      ]
      let magnitude = sqrt(
        pow(acceleration["x"]!, 2) +
        pow(acceleration["y"]!, 2) +
        pow(acceleration["z"]!, 2)
      )
      DispatchQueue.main.async { [weak self] in
        self?.latestAccelerationMagnitudeG = magnitude
      }
      self.evidenceStore.appendPhoneMotion([
        "nativeTimestampSeconds": motion.timestamp,
        "receivedAtEpochMilliseconds": Int64(Date().timeIntervalSince1970 * 1_000),
        "elapsedSeconds": Date().timeIntervalSince(recordingStartedAt),
        "accelerationIncludingGravityG": acceleration,
        "userAccelerationG": [
          "x": motion.userAcceleration.x,
          "y": motion.userAcceleration.y,
          "z": motion.userAcceleration.z,
        ],
        "gravityG": ["x": motion.gravity.x, "y": motion.gravity.y, "z": motion.gravity.z],
        "rotationRateRadiansPerSecond": [
          "x": motion.rotationRate.x,
          "y": motion.rotationRate.y,
          "z": motion.rotationRate.z,
        ],
        "attitudeRadians": [
          "roll": motion.attitude.roll,
          "pitch": motion.attitude.pitch,
          "yaw": motion.attitude.yaw,
        ],
        "attitudeQuaternion": [
          "x": motion.attitude.quaternion.x,
          "y": motion.attitude.quaternion.y,
          "z": motion.attitude.quaternion.z,
          "w": motion.attitude.quaternion.w,
        ],
      ])
    }
  }

  private func stopPhoneSensors() {
    projectionTimer?.invalidate()
    projectionTimer = nil
    motionManager.stopDeviceMotionUpdates()
    locationManager.stopUpdatingLocation()
  }

  private func startProjectionTimer() {
    projectionTimer?.invalidate()
    projectionTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) {
      [weak self] _ in self?.publishProjection()
    }
  }

  private func publishProjection() {
    guard hasListeners, let startedAt else { return }
    let state = evidenceStore.snapshot()
    let counts = state["sampleCounts"] as? [String: Int] ?? [:]
    var projection: [String: Any] = [
      "elapsedSeconds": Int(Date().timeIntervalSince(startedAt)),
      "motionSampleCount": counts["phoneMotion", default: 0],
      "locationSampleCount": counts["phoneLocation", default: 0],
      "watchHeartRateSampleCount": counts["watchHeartRate", default: 0],
      "remusBladeLiveSampleCount": counts["remusBladeLive", default: 0],
      "distanceMeters": distanceMeters,
    ]
    if let value = latestSpeedMetersPerSecond { projection["groundSpeedMetersPerSecond"] = value }
    if let value = latestHorizontalAccuracyMeters { projection["horizontalAccuracyMeters"] = value }
    if let value = latestAccelerationMagnitudeG { projection["accelerationIncludingGravityG"] = value }
    sendEvent(withName: "onRecordingUpdate", body: projection)
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    if manager.authorizationStatus == .authorizedAlways ||
       manager.authorizationStatus == .authorizedWhenInUse {
      manager.startUpdatingLocation()
    }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let startedAt else { return }
    for location in locations where location.horizontalAccuracy >= 0 {
      if let previous = lastLocation,
         location.timestamp > previous.timestamp,
         location.distance(from: previous) >= 0 {
        distanceMeters += location.distance(from: previous)
      }
      lastLocation = location
      latestHorizontalAccuracyMeters = location.horizontalAccuracy
      latestSpeedMetersPerSecond = location.speed >= 0 ? location.speed : nil
      var payload: [String: Any] = [
        "nativeTimestampEpochMilliseconds": Int64(location.timestamp.timeIntervalSince1970 * 1_000),
        "receivedAtEpochMilliseconds": Int64(Date().timeIntervalSince1970 * 1_000),
        "elapsedSeconds": location.timestamp.timeIntervalSince(startedAt),
        "positionWgs84": [
          "latitude": location.coordinate.latitude,
          "longitude": location.coordinate.longitude,
        ],
        "horizontalAccuracyMeters": location.horizontalAccuracy,
        "altitudeMeters": location.altitude,
      ]
      if location.speed >= 0 { payload["groundSpeedMetersPerSecond"] = location.speed }
      if location.course >= 0 { payload["courseDegrees"] = location.course }
      evidenceStore.appendPhoneLocation(payload)
    }
  }
}
