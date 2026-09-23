import CryptoKit
import Foundation

final class RemusEvidenceStore {
  static let shared = RemusEvidenceStore()

  enum StoreError: LocalizedError {
    case alreadyRecording
    case notRecording
    case invalidSourceIds
    case insufficientStorage

    var errorDescription: String? {
      switch self {
      case .alreadyRecording: return "A recording is already active."
      case .notRecording: return "No recording is active."
      case .invalidSourceIds: return "At least one source is required."
      case .insufficientStorage: return "At least 512 MB of free storage is required to start recording."
      }
    }
  }

  private struct ActiveRecording {
    let activityId: String
    let activityCorrelationId: String
    let recordingIdsBySource: [String: String]
    let directory: URL
    let startedAtEpochMilliseconds: Int64
    var handles: [String: FileHandle]
    var sampleCounts: [String: Int]
    var appendCountSinceSync: Int
    var watchMessageIds: Set<String>
    var failureDescription: String?
  }

  private let queue = DispatchQueue(label: "com.espindola.remus.evidence-store", qos: .userInitiated)
  private let fileManager = FileManager.default
  private var active: ActiveRecording?
  private(set) var latestActivityId: String?

  private let streamFiles = [
    "phoneMotion": "phone-motion.ndjson",
    "phoneLocation": "phone-location.ndjson",
    "watchHeartRate": "watch-heart-rate.ndjson",
    "remusBladeLive": "remus-blade-live.ndjson",
    "lifecycle": "lifecycle.ndjson",
  ]

  private init() {
    recoverInterruptedRecordings()
  }

  func start(sourceIds: [String]) throws -> [String: Any] {
    try queue.sync {
      guard active == nil else { throw StoreError.alreadyRecording }
      let uniqueSourceIds = Array(Set(sourceIds)).sorted()
      guard !uniqueSourceIds.isEmpty else { throw StoreError.invalidSourceIds }

      let activityId = "activity:\(UUID().uuidString.lowercased())"
      let correlationId = "correlation:\(UUID().uuidString.lowercased())"
      let recordings = Dictionary(uniqueKeysWithValues: uniqueSourceIds.map {
        ($0, "recording:\(UUID().uuidString.lowercased())")
      })
      let startedAt = epochMilliseconds()
      let root = try evidenceRoot()
      guard hasMinimumFreeStorage(at: root) else { throw StoreError.insufficientStorage }
      let directory = root.appendingPathComponent(
        activityId.replacingOccurrences(of: ":", with: "-"),
        isDirectory: true
      )
      try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)

      var handles: [String: FileHandle] = [:]
      for (stream, filename) in streamFiles {
        let url = directory.appendingPathComponent(filename)
        guard fileManager.createFile(atPath: url.path, contents: nil) else {
          throw CocoaError(.fileWriteUnknown)
        }
        handles[stream] = try FileHandle(forWritingTo: url)
      }

      active = ActiveRecording(
        activityId: activityId,
        activityCorrelationId: correlationId,
        recordingIdsBySource: recordings,
        directory: directory,
        startedAtEpochMilliseconds: startedAt,
        handles: handles,
        sampleCounts: Dictionary(uniqueKeysWithValues: streamFiles.keys.map {($0, 0)}),
        appendCountSinceSync: 0,
        watchMessageIds: [],
        failureDescription: nil
      )
      latestActivityId = activityId
      try appendOnQueue(stream: "lifecycle", payload: [
        "type": "recording_started",
        "activityId": activityId,
        "activityCorrelationId": correlationId,
        "timestampEpochMilliseconds": startedAt,
      ])
      try writeManifestOnQueue(status: "recording", endedAt: nil, parts: nil)
      return startResult(active!)
    }
  }

  func appendPhoneMotion(_ payload: [String: Any]) {
    append(stream: "phoneMotion", sourceId: "phone:primary", payload: payload)
  }

  func appendPhoneLocation(_ payload: [String: Any]) {
    append(stream: "phoneLocation", sourceId: "phone:primary", payload: payload)
  }

  func appendWatchHeartRate(_ payload: [String: Any]) {
    queue.async { [weak self] in
      guard let self, var recording = self.active else { return }
      if let messageId = payload["messageId"] as? String {
        guard !recording.watchMessageIds.contains(messageId) else { return }
        recording.watchMessageIds.insert(messageId)
        self.active = recording
      }
      do {
        try self.appendOnQueue(
          stream: "watchHeartRate",
          sourceId: "watch:apple:primary",
          payload: payload
        )
      } catch {
        self.recordFailureOnQueue(error)
      }
    }
  }

  func appendRemusBladeLive(rawCsv: String, deviceId: String, receivedAt: Int64) {
    append(stream: "remusBladeLive", sourceId: "rbp1:primary", payload: [
      "rawCsv": rawCsv,
      "deviceId": deviceId,
      "receivedAtEpochMilliseconds": receivedAt,
    ])
  }

  func snapshot() -> [String: Any] {
    queue.sync {
      guard let active else { return ["isRecording": false] }
      return [
        "isRecording": true,
        "activityId": active.activityId,
        "artifactDirectory": active.directory.path,
        "startedAtEpochMilliseconds": active.startedAtEpochMilliseconds,
        "sampleCounts": active.sampleCounts,
        "hasWriteFailure": active.failureDescription != nil,
      ]
    }
  }

  func stop() throws -> [String: Any] {
    try queue.sync {
      guard active != nil else { throw StoreError.notRecording }
      let endedAt = epochMilliseconds()
      try appendOnQueue(stream: "lifecycle", payload: [
        "type": "recording_stopped",
        "timestampEpochMilliseconds": endedAt,
      ])
      try synchronizeOnQueue()

      guard let recording = active else { throw StoreError.notRecording }
      for handle in recording.handles.values { try? handle.close() }
      let parts = try partManifests(directory: recording.directory, counts: recording.sampleCounts)
      let status = recording.failureDescription == nil ? "finalized" : "interrupted"
      try writeManifestOnQueue(status: status, endedAt: endedAt, parts: parts)
      var result: [String: Any] = [
        "activityId": recording.activityId,
        "activityCorrelationId": recording.activityCorrelationId,
        "recordingIdsBySource": recording.recordingIdsBySource,
        "artifactDirectory": recording.directory.path,
        "status": status,
        "startedAtEpochMilliseconds": recording.startedAtEpochMilliseconds,
        "endedAtEpochMilliseconds": endedAt,
        "sampleCounts": recording.sampleCounts,
      ]
      if let failureDescription = recording.failureDescription {
        result["failureMessage"] = failureDescription
      }
      active = nil
      return result
    }
  }

  func evidenceRootURL() throws -> URL {
    try evidenceRoot()
  }

  func listRecordings() throws -> [[String: Any]] {
    try queue.sync {
      let directories = try fileManager.contentsOfDirectory(
        at: evidenceRoot(),
        includingPropertiesForKeys: [.isDirectoryKey],
        options: [.skipsHiddenFiles]
      )
      return directories.compactMap { directory in
        let manifestURL = directory.appendingPathComponent("manifest.json")
        guard let data = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let status = manifest["status"] as? String,
              status == "finalized" || status == "interrupted",
              let activityId = manifest["activityId"] as? String,
              let startedAt = manifest["startedAtEpochMilliseconds"] as? NSNumber else { return nil }
        let endedAt = manifest["endedAtEpochMilliseconds"] as? NSNumber
        let recordings = manifest["recordingIdsBySource"] as? [String: Any] ?? [:]
        return [
          "activityId": activityId,
          "status": status,
          "startedAtEpochMilliseconds": startedAt,
          "endedAtEpochMilliseconds": endedAt ?? NSNull(),
          "durationSeconds": endedAt.map { max(0, ($0.doubleValue - startedAt.doubleValue) / 1_000) } ?? 0,
          "sourceIds": Array(recordings.keys).sorted(),
          "sampleCounts": manifest["sampleCounts"] as? [String: Any] ?? [:],
        ]
      }.sorted {
        ($0["startedAtEpochMilliseconds"] as? NSNumber)?.int64Value ?? 0 >
          ($1["startedAtEpochMilliseconds"] as? NSNumber)?.int64Value ?? 0
      }
    }
  }

  func deleteRecording(activityId: String) throws -> Bool {
    try queue.sync {
      guard active?.activityId != activityId,
            activityId.hasPrefix("activity:"),
            !activityId.contains("/"),
            !activityId.contains("..") else { return false }
      let dirName = activityId.replacingOccurrences(of: ":", with: "-")
      let directory = try evidenceRoot().appendingPathComponent(dirName, isDirectory: true)
      guard fileManager.fileExists(atPath: directory.path) else { return false }
      try fileManager.removeItem(at: directory)
      let documentsURL = try fileManager.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      let zipURL = documentsURL.appendingPathComponent("RemusExport/\(dirName).zip")
      if fileManager.fileExists(atPath: zipURL.path) { try fileManager.removeItem(at: zipURL) }
      if latestActivityId == activityId { latestActivityId = nil }
      return true
    }
  }

  func saveBladeRawBinary(activityId: String, base64Data: String, rawCsv: String? = nil) throws {
    guard let data = Data(base64Encoded: base64Data) else {
      throw NSError(domain: "RemusEvidenceStore", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 data"])
    }
    let root = try evidenceRoot()
    let dirName = activityId.replacingOccurrences(of: ":", with: "-")
    let activityDir = root.appendingPathComponent(dirName, isDirectory: true)

    if !fileManager.fileExists(atPath: activityDir.path) {
      try fileManager.createDirectory(at: activityDir, withIntermediateDirectories: true)
    }

    let binURL = activityDir.appendingPathComponent("blade_200hz.bin")
    try data.write(to: binURL)

    if let csv = rawCsv, !csv.isEmpty {
      let csvURL = activityDir.appendingPathComponent("blade_200hz.csv")
      try csv.write(to: csvURL, atomically: true, encoding: .utf8)
    }

    let manifestURL = activityDir.appendingPathComponent("manifest.json")
    if let manifestData = try? Data(contentsOf: manifestURL),
       var manifest = (try? JSONSerialization.jsonObject(with: manifestData)) as? [String: Any] {
      var parts = manifest["parts"] as? [[String: Any]] ?? []
      parts.removeAll { ($0["filename"] as? String) == "blade_200hz.bin" || ($0["filename"] as? String) == "blade_200hz.csv" }

      if let binValues = try? binURL.resourceValues(forKeys: [.fileSizeKey]), let binSize = binValues.fileSize {
        parts.append([
          "stream": "remusBladeRawBinary",
          "filename": "blade_200hz.bin",
          "byteLength": binSize,
          "sha256": (try? sha256(binURL)) ?? "",
        ])
      }
      if let csv = rawCsv, !csv.isEmpty {
        let csvURL = activityDir.appendingPathComponent("blade_200hz.csv")
        if let csvValues = try? csvURL.resourceValues(forKeys: [.fileSizeKey]), let csvSize = csvValues.fileSize {
          parts.append([
            "stream": "remusBladeRawCsv",
            "filename": "blade_200hz.csv",
            "byteLength": csvSize,
            "sha256": (try? sha256(csvURL)) ?? "",
          ])
        }
      }
      manifest["parts"] = parts.sorted { ($0["stream"] as? String ?? "") < ($1["stream"] as? String ?? "") }
      if let updatedData = try? JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys]) {
        try? updatedData.write(to: manifestURL, options: [.atomic])
      }
    }
  }

  func exportActivity(activityId: String? = nil) throws -> URL {
    let targetActivityId = activityId ?? latestActivityId
    guard let targetActivityId else {
      throw NSError(
        domain: "RemusEvidenceStore",
        code: 404,
        userInfo: [NSLocalizedDescriptionKey: "No activity found to export."]
      )
    }
    let root = try evidenceRoot()
    let dirName = targetActivityId.replacingOccurrences(of: ":", with: "-")
    let activityDir = root.appendingPathComponent(dirName, isDirectory: true)
    guard fileManager.fileExists(atPath: activityDir.path) else {
      throw NSError(
        domain: "RemusEvidenceStore",
        code: 404,
        userInfo: [NSLocalizedDescriptionKey: "Activity directory does not exist: \(dirName)"]
      )
    }

    let documentsURL = try fileManager.url(
      for: .documentDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let exportDir = documentsURL.appendingPathComponent("RemusExport", isDirectory: true)
    try fileManager.createDirectory(at: exportDir, withIntermediateDirectories: true)
    let zipURL = exportDir.appendingPathComponent("\(dirName).zip")

    if fileManager.fileExists(atPath: zipURL.path) {
      try? fileManager.removeItem(at: zipURL)
    }

    var coordinatorError: NSError?
    var innerError: Error?
    var tempZipURL: URL?
    let coordinator = NSFileCoordinator()
    coordinator.coordinate(readingItemAt: activityDir, options: .forUploading, error: &coordinatorError) { zipUrl in
      do {
        try self.fileManager.copyItem(at: zipUrl, to: zipURL)
        tempZipURL = zipURL
      } catch {
        innerError = error
      }
    }

    if let coordinatorError {
      throw coordinatorError
    }
    if let innerError {
      throw innerError
    }

    guard let finalZipURL = tempZipURL, fileManager.fileExists(atPath: finalZipURL.path) else {
      throw NSError(
        domain: "RemusEvidenceStore",
        code: 500,
        userInfo: [NSLocalizedDescriptionKey: "Failed to generate zip archive"]
      )
    }

    return finalZipURL
  }

  private func append(stream: String, sourceId: String, payload: [String: Any]) {
    queue.async { [weak self] in
      guard let self else { return }
      do {
        try self.appendOnQueue(stream: stream, sourceId: sourceId, payload: payload)
      } catch {
        self.recordFailureOnQueue(error)
      }
    }
  }

  private func recordFailureOnQueue(_ error: Error) {
    guard var recording = active, recording.failureDescription == nil else { return }
    recording.failureDescription = error.localizedDescription
    active = recording
  }

  private func appendOnQueue(
    stream: String,
    sourceId: String? = nil,
    payload: [String: Any]
  ) throws {
    guard var recording = active, let handle = recording.handles[stream] else { return }
    var envelope = payload
    envelope["schemaVersion"] = "1.0.0"
    envelope["activityId"] = recording.activityId
    if let sourceId {
      envelope["sourceId"] = sourceId
      envelope["recordingId"] = recording.recordingIdsBySource[sourceId]
    }
    let data = try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys])
    try handle.write(contentsOf: data)
    try handle.write(contentsOf: Data([0x0A]))
    recording.sampleCounts[stream, default: 0] += 1
    recording.appendCountSinceSync += 1
    active = recording
    if recording.appendCountSinceSync >= 500 {
      try synchronizeOnQueue()
    }
  }

  private func synchronizeOnQueue() throws {
    guard var recording = active else { return }
    for handle in recording.handles.values { try handle.synchronize() }
    recording.appendCountSinceSync = 0
    active = recording
    try writeManifestOnQueue(status: "recording", endedAt: nil, parts: nil)
  }

  private func writeManifestOnQueue(
    status: String,
    endedAt: Int64?,
    parts: [[String: Any]]?
  ) throws {
    guard let recording = active else { return }
    var manifest: [String: Any] = [
      "schemaVersion": "1.0.0",
      "producer": "remus-recorder-ios",
      "activityId": recording.activityId,
      "activityCorrelationId": recording.activityCorrelationId,
      "recordingIdsBySource": recording.recordingIdsBySource,
      "startedAtEpochMilliseconds": recording.startedAtEpochMilliseconds,
      "status": status,
      "sampleCounts": recording.sampleCounts,
    ]
    if let endedAt { manifest["endedAtEpochMilliseconds"] = endedAt }
    if let parts { manifest["parts"] = parts }
    if let failureDescription = recording.failureDescription {
      manifest["failureMessage"] = failureDescription
    }
    let data = try JSONSerialization.data(
      withJSONObject: manifest,
      options: [.prettyPrinted, .sortedKeys]
    )
    try data.write(
      to: recording.directory.appendingPathComponent("manifest.json"),
      options: [.atomic]
    )
  }

  private func startResult(_ recording: ActiveRecording) -> [String: Any] {
    [
      "activityId": recording.activityId,
      "activityCorrelationId": recording.activityCorrelationId,
      "recordingIdsBySource": recording.recordingIdsBySource,
      "artifactDirectory": recording.directory.path,
    ]
  }

  private func partManifests(
    directory: URL,
    counts: [String: Int]
  ) throws -> [[String: Any]] {
    var parts = try streamFiles.map { stream, filename in
      let url = directory.appendingPathComponent(filename)
      let values = try url.resourceValues(forKeys: [.fileSizeKey])
      return [
        "stream": stream,
        "filename": filename,
        "sampleCount": counts[stream, default: 0],
        "byteLength": values.fileSize ?? 0,
        "sha256": try sha256(url),
      ]
    }
    let binURL = directory.appendingPathComponent("blade_200hz.bin")
    if fileManager.fileExists(atPath: binURL.path),
       let binValues = try? binURL.resourceValues(forKeys: [.fileSizeKey]),
       let binSize = binValues.fileSize {
      parts.append([
        "stream": "remusBladeRawBinary",
        "filename": "blade_200hz.bin",
        "byteLength": binSize,
        "sha256": try sha256(binURL),
      ])
    }
    let csvURL = directory.appendingPathComponent("blade_200hz.csv")
    if fileManager.fileExists(atPath: csvURL.path),
       let csvValues = try? csvURL.resourceValues(forKeys: [.fileSizeKey]),
       let csvSize = csvValues.fileSize {
      parts.append([
        "stream": "remusBladeRawCsv",
        "filename": "blade_200hz.csv",
        "byteLength": csvSize,
        "sha256": try sha256(csvURL),
      ])
    }
    return parts.sorted { ($0["stream"] as? String ?? "") < ($1["stream"] as? String ?? "") }
  }

  private func sha256(_ url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var hasher = SHA256()
    while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
      hasher.update(data: chunk)
    }
    return hasher.finalize().map {String(format: "%02x", $0)}.joined()
  }

  private func evidenceRoot() throws -> URL {
    let support = try fileManager.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let root = support.appendingPathComponent("remus-recorder/evidence", isDirectory: true)
    try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
    return root
  }

  private func hasMinimumFreeStorage(at url: URL) -> Bool {
    guard let attributes = try? fileManager.attributesOfFileSystem(forPath: url.path),
          let freeBytes = attributes[.systemFreeSize] as? NSNumber else { return false }
    return freeBytes.int64Value >= 512 * 1_024 * 1_024
  }

  private func epochMilliseconds() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1_000)
  }

  private func recoverInterruptedRecordings() {
    guard let root = try? evidenceRoot(),
          let directories = try? fileManager.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
          ) else { return }
    for directory in directories {
      let manifestURL = directory.appendingPathComponent("manifest.json")
      guard let data = try? Data(contentsOf: manifestURL),
            var manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            manifest["status"] as? String == "recording" else { continue }
      manifest["status"] = "interrupted"
      manifest["interruptionReason"] = "process_terminated"
      manifest["recoveredAtEpochMilliseconds"] = epochMilliseconds()
      if let recovered = try? JSONSerialization.data(
        withJSONObject: manifest,
        options: [.prettyPrinted, .sortedKeys]
      ) {
        try? recovered.write(to: manifestURL, options: [.atomic])
      }
    }
  }
}
