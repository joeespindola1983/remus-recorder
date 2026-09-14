package com.espindola.remus.recorder

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import kotlin.math.sqrt

class RemusRecordingModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), SensorEventListener, LocationListener {

  companion object {
    const val NAME = "RemusRecordingBridge"
    private const val GRAVITY_STANDARD = 9.80665f
  }

  override fun getName(): String = NAME

  private val evidenceStore = RemusEvidenceStore.instance
  private val sensorManager by lazy {
    reactContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  }
  private val locationManager by lazy {
    reactContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
  }

  private var lastLocation: Location? = null
  private var accumulatedDistanceMeters: Double = 0.0
  private var lastSpeedMetersPerSecond: Float? = null
  private var projectionHandler: Handler? = null
  private var projectionRunnable: Runnable? = null
  private var listenerCount = 0

  private val latestGyro = FloatArray(3)
  private var hasReceivedGyro = false

  @ReactMethod
  fun startRecording(options: ReadableMap, promise: Promise) {
    try {
      val sourceIdsList = mutableListOf<String>()
      if (options.hasKey("sourceIds")) {
        val array = options.getArray("sourceIds")
        if (array != null) {
          for (i in 0 until array.size()) {
            array.getString(i)?.let { sourceIdsList.add(it) }
          }
        }
      }

      val result = evidenceStore.start(reactContext, sourceIdsList)

      accumulatedDistanceMeters = 0.0
      lastLocation = null
      lastSpeedMetersPerSecond = null
      hasReceivedGyro = false

      startSensors()
      startLocation()
      startProjectionTimer()

      val map = Arguments.createMap()
      map.putString("activityId", result["activityId"] as String)
      map.putString("activityCorrelationId", result["activityCorrelationId"] as String)
      map.putString("directoryPath", result["directoryPath"] as String)

      val recMap = Arguments.createMap()
      val ids = result["recordingIdsBySource"] as Map<*, *>
      for ((k, v) in ids) {
        recMap.putString(k.toString(), v.toString())
      }
      map.putMap("recordingIdsBySource", recMap)

      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("START_RECORDING_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun stopRecording(promise: Promise) {
    try {
      stopSensors()
      stopLocation()
      stopProjectionTimer()

      val manifest = evidenceStore.stop(reactContext)

      val map = Arguments.createMap()
      map.putString("schemaVersion", manifest["schemaVersion"] as? String ?: "1.0.0")
      map.putString("producer", manifest["producer"] as? String ?: "remus-recorder-android")
      map.putString("activityId", manifest["activityId"] as? String ?: "")
      map.putString("activityCorrelationId", manifest["activityCorrelationId"] as? String ?: "")
      map.putString("status", manifest["status"] as? String ?: "finalized")

      (manifest["startedAtEpochMilliseconds"] as? Long)?.let {
        map.putDouble("startedAtEpochMilliseconds", it.toDouble())
      }
      (manifest["endedAtEpochMilliseconds"] as? Long)?.let {
        map.putDouble("endedAtEpochMilliseconds", it.toDouble())
      }

      val countsObj = manifest["sampleCounts"] as? Map<*, *>
      val countsMap = Arguments.createMap()
      if (countsObj != null) {
        for ((k, v) in countsObj) {
          countsMap.putDouble(k.toString(), (v as? Number)?.toDouble() ?: 0.0)
        }
      }
      map.putMap("sampleCounts", countsMap)

      val partsList = manifest["parts"] as? List<*>
      if (partsList != null) {
        val partsArr = Arguments.createArray()
        for (item in partsList) {
          if (item is Map<*, *>) {
            val partMap = Arguments.createMap()
            partMap.putString("stream", item["stream"]?.toString() ?: "")
            partMap.putString("filename", item["filename"]?.toString() ?: "")
            partMap.putDouble("sampleCount", (item["sampleCount"] as? Number)?.toDouble() ?: 0.0)
            partMap.putDouble("byteLength", (item["byteLength"] as? Number)?.toDouble() ?: 0.0)
            partMap.putString("sha256", item["sha256"]?.toString() ?: "")
            partsArr.pushMap(partMap)
          }
        }
        map.putArray("parts", partsArr)
      }

      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("STOP_RECORDING_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun getRecordingState(promise: Promise) {
    val map = Arguments.createMap()
    map.putBoolean("isRecording", evidenceStore.isRecording)
    map.putString("activityId", evidenceStore.currentActivityId)
    map.putString("artifactDirectory", evidenceStore.currentDirectory?.absolutePath)
    promise.resolve(map)
  }

  @ReactMethod
  fun exportRecording(options: ReadableMap, promise: Promise) {
    try {
      val activityId = if (options.hasKey("activityId")) options.getString("activityId") else null
      val zipFile = evidenceStore.exportActivity(reactContext, activityId)

      val authority = "${reactContext.packageName}.fileprovider"
      val uri = FileProvider.getUriForFile(reactContext, authority, zipFile)

      val shareIntent = Intent(Intent.ACTION_SEND).apply {
        type = "application/zip"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_SUBJECT, "Gravação Remus: ${zipFile.name}")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }

      val chooser = Intent.createChooser(shareIntent, "Exportar atividade Remus").apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }

      reactContext.startActivity(chooser)

      val map = Arguments.createMap()
      map.putString("zipPath", zipFile.absolutePath)
      map.putBoolean("shared", true)
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("EXPORT_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun listRecordings(promise: Promise) {
    try {
      val result = Arguments.createArray()
      for (workout in evidenceStore.listRecordings(reactContext)) {
        val item = Arguments.createMap()
        item.putString("activityId", workout["activityId"] as String)
        item.putString("status", workout["status"] as String)
        item.putDouble("startedAtEpochMilliseconds", (workout["startedAtEpochMilliseconds"] as Number).toDouble())
        item.putDouble("endedAtEpochMilliseconds", (workout["endedAtEpochMilliseconds"] as Number).toDouble())
        item.putDouble("durationSeconds", (workout["durationSeconds"] as Number).toDouble())
        val sources = Arguments.createArray()
        @Suppress("UNCHECKED_CAST")
        for (sourceId in workout["sourceIds"] as List<String>) sources.pushString(sourceId)
        item.putArray("sourceIds", sources)
        val counts = Arguments.createMap()
        @Suppress("UNCHECKED_CAST")
        for ((stream, count) in workout["sampleCounts"] as Map<String, Long>) counts.putDouble(stream, count.toDouble())
        item.putMap("sampleCounts", counts)
        result.pushMap(item)
      }
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("LIST_RECORDINGS_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun deleteRecording(activityId: String, promise: Promise) {
    try { promise.resolve(evidenceStore.deleteRecording(reactContext, activityId)) }
    catch (e: Exception) { promise.reject("DELETE_RECORDING_ERROR", e.message, e) }
  }

  @ReactMethod
  fun getPhoneHardwareProfile(promise: Promise) {
    try {
      val hasGps = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
      val hasAccel = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null
      val hasGyro = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null
      val hasMag = sensorManager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD) != null
      val hasBaro = sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE) != null

      val map = Arguments.createMap()
      map.putBoolean("hasGps", hasGps)
      map.putBoolean("hasAccelerometer", hasAccel)
      map.putBoolean("hasGyroscope", hasGyro)
      map.putBoolean("hasMagnetometer", hasMag)
      map.putBoolean("hasBarometer", hasBaro)
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("HARDWARE_PROFILE_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun getBatteryLevel(promise: Promise) {
    try {
      val bm = reactContext.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
      val level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
      if (level in 0..100) {
        promise.resolve(level)
      } else {
        promise.resolve(null)
      }
    } catch (e: Exception) {
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun getCurrentLocationAccuracy(promise: Promise) {
    try {
      val hasPermission = ContextCompat.checkSelfPermission(
        reactContext,
        Manifest.permission.ACCESS_FINE_LOCATION
      ) == PackageManager.PERMISSION_GRANTED

      if (!hasPermission) {
        promise.resolve(null)
        return
      }

      var bestLocation: Location? = null
      val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
      for (provider in providers) {
        if (locationManager.isProviderEnabled(provider)) {
          try {
            val loc = locationManager.getLastKnownLocation(provider)
            if (loc != null) {
              if (bestLocation == null || loc.time > bestLocation.time) {
                bestLocation = loc
              }
            }
          } catch (_: SecurityException) {}
        }
      }

      if (bestLocation != null && bestLocation.hasAccuracy()) {
        val ageMs = System.currentTimeMillis() - bestLocation.time
        if (ageMs < 120_000) { // Fresh within 2 minutes
          promise.resolve(bestLocation.accuracy.toDouble())
          return
        }
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun requestLocationPermission(promise: Promise) {
    val status = ContextCompat.checkSelfPermission(
      reactContext,
      Manifest.permission.ACCESS_FINE_LOCATION
    )
    if (status == PackageManager.PERMISSION_GRANTED) {
      promise.resolve("granted")
    } else {
      promise.resolve("denied")
    }
  }

  @ReactMethod
  fun getLocationPermissionStatus(promise: Promise) {
    val status = ContextCompat.checkSelfPermission(
      reactContext,
      Manifest.permission.ACCESS_FINE_LOCATION
    )
    if (status == PackageManager.PERMISSION_GRANTED) {
      promise.resolve("granted")
    } else {
      promise.resolve("denied")
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    listenerCount++
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    listenerCount = (listenerCount - count).coerceAtLeast(0)
  }

  private fun startSensors() {
    val accel = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    if (accel != null) {
      sensorManager.registerListener(this, accel, SensorManager.SENSOR_DELAY_GAME)
    }
    val gyro = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    if (gyro != null) {
      sensorManager.registerListener(this, gyro, SensorManager.SENSOR_DELAY_GAME)
    }
  }

  private fun stopSensors() {
    sensorManager.unregisterListener(this)
  }

  private fun startLocation() {
    val hasPermission = ContextCompat.checkSelfPermission(
      reactContext,
      Manifest.permission.ACCESS_FINE_LOCATION
    ) == PackageManager.PERMISSION_GRANTED

    if (!hasPermission) return

    val handler = Handler(Looper.getMainLooper())
    handler.post {
      try {
        if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
          locationManager.requestLocationUpdates(
            LocationManager.GPS_PROVIDER,
            1000L,
            0f,
            this,
            Looper.getMainLooper()
          )
        }
        if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
          locationManager.requestLocationUpdates(
            LocationManager.NETWORK_PROVIDER,
            2000L,
            0f,
            this,
            Looper.getMainLooper()
          )
        }
      } catch (_: SecurityException) {}
    }
  }

  private fun stopLocation() {
    try {
      locationManager.removeUpdates(this)
    } catch (_: SecurityException) {}
  }

  private fun startProjectionTimer() {
    val handler = Handler(Looper.getMainLooper())
    projectionHandler = handler
    val runnable = object : Runnable {
      override fun run() {
        emitProjection()
        handler.postDelayed(this, 1000L)
      }
    }
    projectionRunnable = runnable
    handler.postDelayed(runnable, 1000L)
  }

  private fun stopProjectionTimer() {
    projectionRunnable?.let { projectionHandler?.removeCallbacks(it) }
    projectionHandler = null
    projectionRunnable = null
  }

  private fun emitProjection() {
    if (!evidenceStore.isRecording || listenerCount <= 0) return
    val map = Arguments.createMap()
    lastSpeedMetersPerSecond?.let {
      map.putDouble("groundSpeedMetersPerSecond", it.toDouble())
    }
    map.putDouble("distanceMeters", accumulatedDistanceMeters)
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("onRecordingUpdate", map)
  }

  // SensorEventListener
  override fun onSensorChanged(event: SensorEvent?) {
    if (event == null || !evidenceStore.isRecording) return

    when (event.sensor.type) {
      Sensor.TYPE_GYROSCOPE -> {
        latestGyro[0] = event.values[0]
        latestGyro[1] = event.values[1]
        latestGyro[2] = event.values[2]
        hasReceivedGyro = true
      }
      Sensor.TYPE_ACCELEROMETER -> {
        val axG = event.values[0] / GRAVITY_STANDARD
        val ayG = event.values[1] / GRAVITY_STANDARD
        val azG = event.values[2] / GRAVITY_STANDARD

        val nowMs = System.currentTimeMillis()
        val payload = mutableMapOf<String, Any?>(
          "nativeTimestampSeconds" to event.timestamp / 1_000_000_000.0,
          "receivedAtEpochMilliseconds" to nowMs,
          "elapsedSeconds" to evidenceStore.elapsedSeconds(nowMs),
          "accelerationIncludingGravityG" to mapOf(
            "x" to axG,
            "y" to ayG,
            "z" to azG
          )
        )

        if (hasReceivedGyro) {
          payload["rotationRateRadiansPerSecond"] = mapOf(
            "x" to latestGyro[0],
            "y" to latestGyro[1],
            "z" to latestGyro[2]
          )
        }

        evidenceStore.appendPhoneMotion(payload)
      }
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

  // LocationListener
  override fun onLocationChanged(location: Location) {
    if (!evidenceStore.isRecording) return
    val elapsedSeconds = evidenceStore.elapsedSeconds(location.time)
    if (elapsedSeconds < 0) return

    val previous = lastLocation
    if (previous != null) {
      val delta = location.distanceTo(previous)
      if (delta in 0.5f..150f) {
        accumulatedDistanceMeters += delta
      }
    }
    lastLocation = location

    if (location.hasSpeed() && location.speed >= 0f) {
      lastSpeedMetersPerSecond = location.speed
    }

    val nowMs = System.currentTimeMillis()
    val payload = mutableMapOf<String, Any?>(
      "positionWgs84" to mapOf(
        "latitude" to location.latitude,
        "longitude" to location.longitude
      ),
      "receivedAtEpochMilliseconds" to nowMs,
      "nativeTimestampEpochMilliseconds" to location.time,
      "elapsedSeconds" to elapsedSeconds
    )
    if (location.hasAccuracy()) {
      payload["horizontalAccuracyMeters"] = location.accuracy
    }
    if (location.hasAltitude()) {
      payload["altitudeMeters"] = location.altitude
    }
    if (location.hasSpeed()) {
      payload["groundSpeedMetersPerSecond"] = location.speed
    }
    if (location.hasBearing()) {
      payload["courseDegrees"] = location.bearing
    }

    evidenceStore.appendPhoneLocation(payload)
  }

  @Deprecated("Deprecated in Java")
  override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
  override fun onProviderEnabled(provider: String) {}
  override fun onProviderDisabled(provider: String) {}
}
