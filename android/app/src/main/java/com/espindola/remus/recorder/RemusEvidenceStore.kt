package com.espindola.remus.recorder

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedWriter
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.FileWriter
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class RemusEvidenceStore private constructor() {
  companion object {
    val instance = RemusEvidenceStore()
  }

  private val executor = Executors.newSingleThreadExecutor()
  private val streamFiles = mapOf(
    "phoneMotion" to "phone-motion.ndjson",
    "phoneLocation" to "phone-location.ndjson",
    "watchHeartRate" to "watch-heart-rate.ndjson",
    "remusBladeLive" to "remus-blade-live.ndjson",
    "lifecycle" to "lifecycle.ndjson"
  )

  @Volatile var isRecording: Boolean = false
    private set

  var currentActivityId: String? = null
    private set

  var currentDirectory: File? = null
    private set

  private var currentCorrelationId: String? = null
  private var currentRecordingIdsBySource = mutableMapOf<String, String>()
  private var startedAtEpochMs: Long = 0
  private val writers = mutableMapOf<String, BufferedWriter>()
  private val sampleCounts = mutableMapOf<String, Long>()

  fun start(context: Context, sourceIds: List<String>): Map<String, Any> {
    synchronized(this) {
      if (isRecording) {
        stop(context)
      }

      val activityId = "activity:" + UUID.randomUUID().toString().lowercase()
      val correlationId = "correlation:" + UUID.randomUUID().toString().lowercase()
      val now = System.currentTimeMillis()

      val evidenceRoot = File(context.filesDir, "evidence")
      val activityDir = File(evidenceRoot, activityId.replace(":", "-"))
      if (!activityDir.exists()) {
        activityDir.mkdirs()
      }

      val recordingIds = mutableMapOf<String, String>()
      for (sourceId in sourceIds) {
        recordingIds[sourceId] = "recording:" + UUID.randomUUID().toString().lowercase()
      }
      if (!recordingIds.containsKey("phone:primary")) {
        recordingIds["phone:primary"] = "recording:" + UUID.randomUUID().toString().lowercase()
      }
      currentActivityId = activityId
      currentCorrelationId = correlationId
      currentDirectory = activityDir
      currentRecordingIdsBySource = recordingIds
      startedAtEpochMs = now
      sampleCounts.clear()
      writers.clear()

      for ((stream, filename) in streamFiles) {
        val file = File(activityDir, filename)
        writers[stream] = BufferedWriter(FileWriter(file, false))
        sampleCounts[stream] = 0L
      }

      isRecording = true

      // Write initial lifecycle event
      appendLifecycleEvent("recording_started", now)
      writeManifest("recording", null, null)

      return mapOf(
        "activityId" to activityId,
        "activityCorrelationId" to correlationId,
        "recordingIdsBySource" to recordingIds,
        "directoryPath" to activityDir.absolutePath
      )
    }
  }

  fun appendPhoneMotion(payload: Map<String, Any?>) {
    append("phoneMotion", "phone:primary", payload)
  }

  fun appendPhoneLocation(payload: Map<String, Any?>) {
    append("phoneLocation", "phone:primary", payload)
  }

  fun appendWatchHeartRate(payload: Map<String, Any?>) {
    append("watchHeartRate", "watch:wear-os:primary", payload)
  }

  fun appendRemusBladeLive(rawCsv: String, deviceId: String, receivedAt: Long) {
    append("remusBladeLive", "rbp1:primary", mapOf(
      "rawCsv" to rawCsv,
      "deviceId" to deviceId,
      "receivedAtEpochMilliseconds" to receivedAt
    ))
  }

  fun appendLifecycleEvent(event: String, timestamp: Long = System.currentTimeMillis()) {
    if (!isRecording) return
    val json = JSONObject()
      .put("schemaVersion", "1.0.0")
      .put("activityId", currentActivityId)
      .put("type", event)
      .put("timestampEpochMilliseconds", timestamp)
    if (event == "recording_started") {
      json.put("activityCorrelationId", currentCorrelationId)
    }
    val writer = writers["lifecycle"] ?: return
    writer.write(json.toString())
    writer.newLine()
    sampleCounts["lifecycle"] = (sampleCounts["lifecycle"] ?: 0L) + 1L
  }

  fun elapsedSeconds(timestampEpochMilliseconds: Long): Double =
    (timestampEpochMilliseconds - startedAtEpochMs) / 1_000.0

  private fun wrapValue(v: Any?): Any {
    return when (v) {
      null -> JSONObject.NULL
      is Map<*, *> -> {
        val obj = JSONObject()
        for ((mk, mv) in v) {
          obj.put(mk.toString(), wrapValue(mv))
        }
        obj
      }
      is List<*> -> {
        val arr = JSONArray()
        for (item in v) {
          arr.put(wrapValue(item))
        }
        arr
      }
      else -> v
    }
  }

  private fun append(stream: String, sourceId: String?, payload: Map<String, Any?>) {
    if (!isRecording) return
    if (sourceId != null && currentRecordingIdsBySource[sourceId] == null) return

    val json = JSONObject()
    json.put("schemaVersion", "1.0.0")
    json.put("activityId", currentActivityId)
    if (sourceId != null) {
      json.put("sourceId", sourceId)
      json.put("recordingId", currentRecordingIdsBySource[sourceId])
    }
    for ((k, v) in payload) {
      json.put(k, wrapValue(v))
    }
    val line = json.toString()

    executor.execute {
      synchronized(this) {
        if (!isRecording) return@execute
        val writer = writers[stream] ?: return@execute
        try {
          writer.write(line)
          writer.newLine()
          sampleCounts[stream] = (sampleCounts[stream] ?: 0L) + 1L
        } catch (_: Exception) {}
      }
    }
  }

  fun stop(context: Context): Map<String, Any> {
    synchronized(this) {
      if (!isRecording) {
        return emptyMap()
      }

      val endedAt = System.currentTimeMillis()
      appendLifecycleEvent("recording_stopped", endedAt)

      isRecording = false

      // Flush and close all writers
      for (writer in writers.values) {
        try {
          writer.flush()
          writer.close()
        } catch (_: Exception) {}
      }
      writers.clear()

      val dir = currentDirectory ?: File(context.filesDir, "evidence")
      val parts = mutableListOf<Map<String, Any>>()

      for ((stream, filename) in streamFiles) {
        val file = File(dir, filename)
        if (file.exists()) {
          val sha = computeSha256(file)
          parts.add(mapOf(
            "stream" to stream,
            "filename" to filename,
            "sampleCount" to (sampleCounts[stream] ?: 0L),
            "byteLength" to file.length(),
            "sha256" to sha
          ))
        }
      }

      writeManifest("finalized", endedAt, parts)

      val manifestMap = mapOf<String, Any>(
        "schemaVersion" to "1.0.0",
        "producer" to "remus-recorder-android",
        "activityId" to (currentActivityId ?: ""),
        "activityCorrelationId" to (currentCorrelationId ?: ""),
        "recordingIdsBySource" to currentRecordingIdsBySource,
        "startedAtEpochMilliseconds" to startedAtEpochMs,
        "endedAtEpochMilliseconds" to endedAt,
        "status" to "finalized",
        "sampleCounts" to sampleCounts.toMap(),
        "parts" to parts
      )

      return manifestMap
    }
  }

  private fun writeManifest(status: String, endedAt: Long?, parts: List<Map<String, Any>>?) {
    val dir = currentDirectory ?: return
    try {
      val manifest = JSONObject()
      manifest.put("schemaVersion", "1.0.0")
      manifest.put("producer", "remus-recorder-android")
      manifest.put("activityId", currentActivityId)
      manifest.put("activityCorrelationId", currentCorrelationId)

      val recObj = JSONObject()
      for ((k, v) in currentRecordingIdsBySource) {
        recObj.put(k, v)
      }
      manifest.put("recordingIdsBySource", recObj)
      manifest.put("startedAtEpochMilliseconds", startedAtEpochMs)
      manifest.put("status", status)

      val countsObj = JSONObject()
      for ((k, v) in sampleCounts) {
        countsObj.put(k, v)
      }
      manifest.put("sampleCounts", countsObj)

      if (endedAt != null) {
        manifest.put("endedAtEpochMilliseconds", endedAt)
      }

      if (parts != null) {
        val partsArr = JSONArray()
        for (part in parts) {
          val pObj = JSONObject()
          for ((pk, pv) in part) {
            pObj.put(pk, pv)
          }
          partsArr.put(pObj)
        }
        manifest.put("parts", partsArr)
      }

      val manifestFile = File(dir, "manifest.json")
      manifestFile.writeText(manifest.toString(2))
    } catch (_: Exception) {}
  }

  fun exportActivity(context: Context, activityId: String?): File {
    val evidenceRoot = File(context.filesDir, "evidence")
    val targetDir: File = if (!activityId.isNullOrEmpty()) {
      val candidate = File(evidenceRoot, activityId.replace(":", "-"))
      if (candidate.exists()) candidate else currentDirectory ?: evidenceRoot
    } else {
      currentDirectory ?: evidenceRoot
    }

    val exportsDir = File(context.cacheDir, "exports")
    if (!exportsDir.exists()) {
      exportsDir.mkdirs()
    }

    val zipFile = File(exportsDir, "${targetDir.name}.zip")
    if (zipFile.exists()) {
      zipFile.delete()
    }

    ZipOutputStream(FileOutputStream(zipFile)).use { zos ->
      val files = targetDir.listFiles() ?: arrayOf()
      for (file in files) {
        if (file.isFile) {
          val entry = ZipEntry("${targetDir.name}/${file.name}")
          zos.putNextEntry(entry)
          FileInputStream(file).use { fis ->
            fis.copyTo(zos)
          }
          zos.closeEntry()
        }
      }
    }

    return zipFile
  }

  fun listRecordings(context: Context): List<Map<String, Any>> {
    val evidenceRoot = File(context.filesDir, "evidence")
    return (evidenceRoot.listFiles() ?: emptyArray())
      .mapNotNull { directory ->
        val manifestFile = File(directory, "manifest.json")
        if (!directory.isDirectory || !manifestFile.isFile) return@mapNotNull null
        try {
          val manifest = JSONObject(manifestFile.readText())
          val status = manifest.optString("status")
          if (status != "finalized" && status != "interrupted") return@mapNotNull null
          val startedAt = manifest.optLong("startedAtEpochMilliseconds")
          val endedAt = if (manifest.has("endedAtEpochMilliseconds")) manifest.optLong("endedAtEpochMilliseconds") else null
          val recordingIds = manifest.optJSONObject("recordingIdsBySource") ?: JSONObject()
          val sourceIds = mutableListOf<String>()
          recordingIds.keys().forEach { sourceIds.add(it) }
          val countsJson = manifest.optJSONObject("sampleCounts") ?: JSONObject()
          val counts = mutableMapOf<String, Long>()
          countsJson.keys().forEach { key -> counts[key] = countsJson.optLong(key) }
          mapOf(
            "activityId" to manifest.getString("activityId"),
            "status" to status,
            "startedAtEpochMilliseconds" to startedAt,
            "endedAtEpochMilliseconds" to (endedAt ?: 0L),
            "durationSeconds" to if (endedAt == null) 0.0 else ((endedAt - startedAt).coerceAtLeast(0) / 1000.0),
            "sourceIds" to sourceIds.sorted(),
            "sampleCounts" to counts
          )
        } catch (_: Exception) { null }
      }
      .sortedByDescending { (it["startedAtEpochMilliseconds"] as Number).toLong() }
  }

  fun deleteRecording(context: Context, activityId: String): Boolean {
    synchronized(this) {
      if (isRecording && currentActivityId == activityId) return false
      if (!activityId.startsWith("activity:") || activityId.contains('/') || activityId.contains("..")) return false
      val dirName = activityId.replace(":", "-")
      val directory = File(File(context.filesDir, "evidence"), dirName)
      if (!directory.isDirectory) return false
      if (!directory.deleteRecursively()) return false
      File(File(context.cacheDir, "exports"), "$dirName.zip").delete()
      if (currentActivityId == activityId) {
        currentActivityId = null
        currentDirectory = null
      }
      return true
    }
  }

  private fun computeSha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(8192)
    FileInputStream(file).use { fis ->
      var bytesRead = fis.read(buffer)
      while (bytesRead != -1) {
        digest.update(buffer, 0, bytesRead)
        bytesRead = fis.read(buffer)
      }
    }
    val hash = digest.digest()
    return hash.joinToString("") { "%02x".format(it) }
  }
}
