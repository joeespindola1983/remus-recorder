import Foundation
import SQLite3

public struct WatchLocalManifest: Codable {
    public var schemaVersion: String
    public var recordingId: String
    public var activityCorrelationId: String?
    public var clockDomainId: String
    public var deviceBootId: String
    public var startCommandId: String?
    public var status: String
    public var failureMessage: String?
    public var startedAtEpochMilliseconds: Int64
    public var endedAtEpochMilliseconds: Int64?
    public var heartRateSampleCount: Int
    public var databaseFilename: String
    public var producedCount: Int
    public var locallyPersistedCount: Int
    public var liveDeliveredCount: Int
    public var recoveredCount: Int
    public var deduplicatedCount: Int
    public var unavailableGapCount: Int

    public init(
        schemaVersion: String = "1.1.0",
        recordingId: String,
        activityCorrelationId: String? = nil,
        clockDomainId: String,
        deviceBootId: String,
        startCommandId: String? = nil,
        status: String = "recording",
        failureMessage: String? = nil,
        startedAtEpochMilliseconds: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        endedAtEpochMilliseconds: Int64? = nil,
        heartRateSampleCount: Int = 0,
        databaseFilename: String = "watch-telemetry.sqlite",
        producedCount: Int = 0,
        locallyPersistedCount: Int = 0,
        liveDeliveredCount: Int = 0,
        recoveredCount: Int = 0,
        deduplicatedCount: Int = 0,
        unavailableGapCount: Int = 0
    ) {
        self.schemaVersion = schemaVersion
        self.recordingId = recordingId
        self.activityCorrelationId = activityCorrelationId
        self.clockDomainId = clockDomainId
        self.deviceBootId = deviceBootId
        self.startCommandId = startCommandId
        self.status = status
        self.failureMessage = failureMessage
        self.startedAtEpochMilliseconds = startedAtEpochMilliseconds
        self.endedAtEpochMilliseconds = endedAtEpochMilliseconds
        self.heartRateSampleCount = heartRateSampleCount
        self.databaseFilename = databaseFilename
        self.producedCount = producedCount
        self.locallyPersistedCount = locallyPersistedCount
        self.liveDeliveredCount = liveDeliveredCount
        self.recoveredCount = recoveredCount
        self.deduplicatedCount = deduplicatedCount
        self.unavailableGapCount = unavailableGapCount
    }

}

public final class WatchDatabaseWriter {
    public enum WriterError: LocalizedError {
        case database(String)
        case notStarted

        public var errorDescription: String? {
            switch self {
            case let .database(message): return "Watch database error: \(message)"
            case .notStarted: return "The Watch database is not open."
            }
        }
    }

    private let queue = DispatchQueue(label: "com.espindola.remus.watch-database", qos: .userInitiated)
    private var database: OpaquePointer?
    private var folderURL: URL?
    private var manifest: WatchLocalManifest?
    private var rowsSinceCommit = 0
    private var lastCommit = Date()
    private var hrStatement: OpaquePointer?
    private var lifecycleStatement: OpaquePointer?
    private var diagnosticStatement: OpaquePointer?
    private var knownSampleUUIDs = Set<String>()
    private var knownTimestamps = Set<Int64>()


    public init() {}

    public static func sessionsDirectory() throws -> URL {
        let docs = try FileManager.default.url(
            for: .documentDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let dir = docs.appendingPathComponent("watch-sessions", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    public func startSession(manifest initialManifest: WatchLocalManifest) throws -> URL {
        try queue.sync {
            let root = try Self.sessionsDirectory()
            let safeRecId = initialManifest.recordingId.replacingOccurrences(of: ":", with: "_")
            let folder = root.appendingPathComponent(
                "watch-session-\(initialManifest.startedAtEpochMilliseconds)-\(safeRecId)",
                isDirectory: true
            )
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let databaseURL = folder.appendingPathComponent(initialManifest.databaseFilename)

            var opened: OpaquePointer?
            guard sqlite3_open_v2(databaseURL.path, &opened, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
                  let opened else {
                throw WriterError.database("Could not create watch-telemetry.sqlite")
            }
            database = opened
            folderURL = folder
            manifest = initialManifest

            do {
                try execute("PRAGMA journal_mode=WAL")
                try execute("PRAGMA synchronous=NORMAL")
                try execute("PRAGMA temp_store=MEMORY")
                try createSchema()
                try prepareStatements()
                try execute("BEGIN IMMEDIATE")
                rowsSinceCommit = 0
                lastCommit = Date()
                try writeManifestOnQueue()
                return folder
            } catch {
                closeDatabase()
                throw error
            }
        }
    }

    public func appendHeartRate(
        bpm: Double,
        measuredAt: Date,
        sampleUUID: String? = nil,
        deliveryState: String = "persisted"
    ) {
        queue.async { [weak self] in
            guard let self, self.database != nil, var manifest = self.manifest else { return }
            manifest.producedCount += 1

            if let sampleUUID, self.knownSampleUUIDs.contains(sampleUUID) {
                manifest.deduplicatedCount += 1
                self.manifest = manifest
                return
            }
            let wallTimeMs = Int64(measuredAt.timeIntervalSince1970 * 1000)
            if self.knownTimestamps.contains(wallTimeMs) {
                manifest.deduplicatedCount += 1
                self.manifest = manifest
                return
            }
            if let sampleUUID { self.knownSampleUUIDs.insert(sampleUUID) }
            self.knownTimestamps.insert(wallTimeMs)

            let elapsedSec = max(0, Double(wallTimeMs - manifest.startedAtEpochMilliseconds) / 1000.0)

            guard let stmt = self.hrStatement else { return }
            sqlite3_reset(stmt)
            sqlite3_clear_bindings(stmt)

            sqlite3_bind_int64(stmt, 1, wallTimeMs)
            sqlite3_bind_double(stmt, 2, elapsedSec)
            sqlite3_bind_double(stmt, 3, bpm)
            if let sampleUUID {
                sqlite3_bind_text(stmt, 4, (sampleUUID as NSString).utf8String, -1, nil)
            } else {
                sqlite3_bind_null(stmt, 4)
            }
            sqlite3_bind_text(stmt, 5, (deliveryState as NSString).utf8String, -1, nil)

            if sqlite3_step(stmt) == SQLITE_DONE {
                manifest.heartRateSampleCount += 1
                manifest.locallyPersistedCount += 1
                if deliveryState == "live" || deliveryState == "persisted" {
                    manifest.liveDeliveredCount += 1
                } else if deliveryState == "post_workout_recovery" {
                    manifest.recoveredCount += 1
                }
                self.manifest = manifest
                self.rowsSinceCommit += 1
                self.checkPeriodicCommit()
            }
        }
    }

    public func appendLifecycle(
        event: String,
        commandId: String? = nil,
        details: String? = nil
    ) {
        queue.async { [weak self] in
            guard let self, self.database != nil, let manifest = self.manifest else { return }
            let wallTimeMs = Int64(Date().timeIntervalSince1970 * 1000)
            let elapsedSec = max(0, Double(wallTimeMs - manifest.startedAtEpochMilliseconds) / 1000.0)

            guard let stmt = self.lifecycleStatement else { return }
            sqlite3_reset(stmt)
            sqlite3_clear_bindings(stmt)

            sqlite3_bind_int64(stmt, 1, wallTimeMs)
            sqlite3_bind_double(stmt, 2, elapsedSec)
            sqlite3_bind_text(stmt, 3, (event as NSString).utf8String, -1, nil)
            if let commandId {
                sqlite3_bind_text(stmt, 4, (commandId as NSString).utf8String, -1, nil)
            } else {
                sqlite3_bind_null(stmt, 4)
            }
            if let details {
                sqlite3_bind_text(stmt, 5, (details as NSString).utf8String, -1, nil)
            } else {
                sqlite3_bind_null(stmt, 5)
            }

            if sqlite3_step(stmt) == SQLITE_DONE {
                self.rowsSinceCommit += 1
                self.checkPeriodicCommit()
            }
        }
    }

    public func recordGap(gapDurationSeconds: Double) {
        queue.async { [weak self] in
            guard let self, self.database != nil, var manifest = self.manifest else { return }
            manifest.unavailableGapCount += 1
            self.manifest = manifest
            self.appendDiagnosticInternal(type: "producer_availability_gap", message: "Duration: \(gapDurationSeconds)s")
        }
    }

    public func appendDiagnostic(type: String, message: String) {
        queue.async { [weak self] in
            guard let self, self.database != nil else { return }
            self.appendDiagnosticInternal(type: type, message: message)
        }
    }

    private func appendDiagnosticInternal(type: String, message: String) {
        guard let manifest else { return }
        let wallTimeMs = Int64(Date().timeIntervalSince1970 * 1000)
        let elapsedSec = max(0, Double(wallTimeMs - manifest.startedAtEpochMilliseconds) / 1000.0)

        guard let stmt = self.diagnosticStatement else { return }
        sqlite3_reset(stmt)
        sqlite3_clear_bindings(stmt)

        sqlite3_bind_int64(stmt, 1, wallTimeMs)
        sqlite3_bind_double(stmt, 2, elapsedSec)
        sqlite3_bind_text(stmt, 3, (type as NSString).utf8String, -1, nil)
        sqlite3_bind_text(stmt, 4, (message as NSString).utf8String, -1, nil)

        if sqlite3_step(stmt) == SQLITE_DONE {
            self.rowsSinceCommit += 1
            self.checkPeriodicCommit()
        }
    }


    public func stopSession(
        at date: Date = Date(),
        status: String = "completed",
        failureMessage: String? = nil
    ) -> URL? {
        queue.sync {
            guard database != nil, let folderURL else { return nil }
            do {
                try execute("COMMIT")
                sqlite3_wal_checkpoint_v2(database, nil, SQLITE_CHECKPOINT_TRUNCATE, nil, nil)
                manifest?.endedAtEpochMilliseconds = Int64(date.timeIntervalSince1970 * 1000)
                manifest?.status = status
                manifest?.failureMessage = failureMessage
                try writeManifestOnQueue()
            } catch {
                NSLog("[WatchDatabaseWriter] Error during stop: %@", error.localizedDescription)
            }
            closeDatabase()
            return folderURL
        }
    }

    public func currentManifest() -> WatchLocalManifest? {
        queue.sync { manifest }
    }

    public static func createArchive(folderURL: URL) throws -> URL {
        var coordinatorError: NSError?
        var innerError: Error?
        var tempZipURL: URL?
        let coordinator = NSFileCoordinator()
        let zipURL = folderURL.deletingLastPathComponent().appendingPathComponent("\(folderURL.lastPathComponent).zip")
        if FileManager.default.fileExists(atPath: zipURL.path) {
            try? FileManager.default.removeItem(at: zipURL)
        }
        coordinator.coordinate(readingItemAt: folderURL, options: .forUploading, error: &coordinatorError) { zipUrl in
            do {
                try FileManager.default.copyItem(at: zipUrl, to: zipURL)
                tempZipURL = zipURL
            } catch {
                innerError = error
            }
        }
        if let coordinatorError { throw coordinatorError }
        if let innerError { throw innerError }
        guard let finalZipURL = tempZipURL, FileManager.default.fileExists(atPath: finalZipURL.path) else {
            throw WriterError.database("Failed to create zip archive")
        }
        return finalZipURL
    }


    private func checkPeriodicCommit() {
        if rowsSinceCommit >= 50 || Date().timeIntervalSince(lastCommit) >= 5.0 {
            do {
                try execute("COMMIT")
                try writeManifestOnQueue()
                try execute("BEGIN IMMEDIATE")
                rowsSinceCommit = 0
                lastCommit = Date()
            } catch {
                NSLog("[WatchDatabaseWriter] Commit error: %@", error.localizedDescription)
            }
        }
    }

    private func createSchema() throws {
        try execute("""
        CREATE TABLE IF NOT EXISTS watch_heart_rate (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wall_time_ms INTEGER NOT NULL,
            elapsed_seconds REAL NOT NULL,
            beats_per_minute REAL NOT NULL,
            sample_uuid TEXT,
            delivery_state TEXT NOT NULL DEFAULT 'persisted'
        );
        """)
        try execute("""
        CREATE TABLE IF NOT EXISTS watch_lifecycle (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wall_time_ms INTEGER NOT NULL,
            elapsed_seconds REAL NOT NULL,
            event_type TEXT NOT NULL,
            command_id TEXT,
            details TEXT
        );
        """)
        try execute("""
        CREATE TABLE IF NOT EXISTS watch_diagnostics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wall_time_ms INTEGER NOT NULL,
            elapsed_seconds REAL NOT NULL,
            diagnostic_type TEXT NOT NULL,
            message TEXT NOT NULL
        );
        """)
    }

    private func prepareStatements() throws {
        let hrSql = "INSERT INTO watch_heart_rate (wall_time_ms, elapsed_seconds, beats_per_minute, sample_uuid, delivery_state) VALUES (?, ?, ?, ?, ?);"
        if sqlite3_prepare_v2(database, hrSql, -1, &hrStatement, nil) != SQLITE_OK {
            throw WriterError.database("Could not prepare watch_heart_rate statement")
        }

        let lifecycleSql = "INSERT INTO watch_lifecycle (wall_time_ms, elapsed_seconds, event_type, command_id, details) VALUES (?, ?, ?, ?, ?);"
        if sqlite3_prepare_v2(database, lifecycleSql, -1, &lifecycleStatement, nil) != SQLITE_OK {
            throw WriterError.database("Could not prepare watch_lifecycle statement")
        }

        let diagSql = "INSERT INTO watch_diagnostics (wall_time_ms, elapsed_seconds, diagnostic_type, message) VALUES (?, ?, ?, ?);"
        if sqlite3_prepare_v2(database, diagSql, -1, &diagnosticStatement, nil) != SQLITE_OK {
            throw WriterError.database("Could not prepare watch_diagnostics statement")
        }
    }

    private func writeManifestOnQueue() throws {
        guard let manifest, let folderURL else { return }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(manifest)
        let fileURL = folderURL.appendingPathComponent("watch-manifest.json")
        try data.write(to: fileURL, options: .atomic)
    }

    private func execute(_ sql: String) throws {
        guard let database else { throw WriterError.notStarted }
        var errorMessage: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(database, sql, nil, nil, &errorMessage) != SQLITE_OK {
            let message = errorMessage.flatMap { String(cString: $0) } ?? "Unknown error"
            sqlite3_free(errorMessage)
            throw WriterError.database(message)
        }
    }

    private func closeDatabase() {
        if let stmt = hrStatement { sqlite3_finalize(stmt); hrStatement = nil }
        if let stmt = lifecycleStatement { sqlite3_finalize(stmt); lifecycleStatement = nil }
        if let stmt = diagnosticStatement { sqlite3_finalize(stmt); diagnosticStatement = nil }
        if let database { sqlite3_close_v2(database); self.database = nil }
    }

    deinit {
        closeDatabase()
    }
}
