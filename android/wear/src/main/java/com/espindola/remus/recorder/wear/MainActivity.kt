package com.espindola.remus.recorder.wear

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
  private val transport by lazy { HeartRateTransport(this) }
  private lateinit var heartRateText: TextView
  private lateinit var statusText: TextView
  private lateinit var actionButton: Button
  private val runtimeListener: (HeartRateRuntime.Snapshot) -> Unit = { snapshot ->
    runOnUiThread { render(snapshot) }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(buildContent())
    actionButton.setOnClickListener {
      when {
        HeartRateRuntime.snapshot.isRecording -> stopCapture()
        isPermissionDenied() -> openAppSettings()
        else -> requestAndStartCapture()
      }
    }
    checkPermissionOnLaunch()
  }

  override fun onStart() {
    super.onStart()
    HeartRateRuntime.addListener(runtimeListener)
  }

  override fun onResume() {
    super.onResume()
    if (checkSelfPermission(heartRatePermission) == PackageManager.PERMISSION_GRANTED &&
      !HeartRateRuntime.snapshot.isRecording
    ) {
      HeartRateRuntime.update(HeartRateRuntime.Snapshot(status = "Pronto"))
    }
  }

  override fun onStop() {
    HeartRateRuntime.removeListener(runtimeListener)
    super.onStop()
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == SENSOR_PERMISSION_REQUEST && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
      transport.sendPermissionState("granted")
      startCapture()
    } else {
      transport.sendPermissionState("denied")
      HeartRateRuntime.update(HeartRateRuntime.Snapshot(status = "Permissão negada · abra Ajustes"))
    }
  }

  private fun checkPermissionOnLaunch() {
    if (checkSelfPermission(heartRatePermission) == PackageManager.PERMISSION_GRANTED) {
      transport.sendPermissionState("granted")
      HeartRateRuntime.update(HeartRateRuntime.Snapshot(status = "Pronto"))
      return
    }
    if (isPermissionDenied()) {
      transport.sendPermissionState("denied")
      HeartRateRuntime.update(HeartRateRuntime.Snapshot(status = "Permissão negada · abra Ajustes"))
      return
    }
    getSharedPreferences(PERMISSION_PREFERENCES, MODE_PRIVATE)
      .edit()
      .putBoolean(PERMISSION_REQUESTED_KEY, true)
      .apply()
    transport.sendPermissionState("not_determined")
    requestPermissions(arrayOf(heartRatePermission), SENSOR_PERMISSION_REQUEST)
  }

  private fun isPermissionDenied(): Boolean =
    checkSelfPermission(heartRatePermission) != PackageManager.PERMISSION_GRANTED &&
      getSharedPreferences(PERMISSION_PREFERENCES, MODE_PRIVATE)
        .getBoolean(PERMISSION_REQUESTED_KEY, false)

  private fun openAppSettings() {
    startActivity(
      Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.parse("package:$packageName"),
      ),
    )
  }

  private fun requestAndStartCapture() {
    if (checkSelfPermission(heartRatePermission) == PackageManager.PERMISSION_GRANTED) {
      startCapture()
    } else {
      requestPermissions(arrayOf(heartRatePermission), SENSOR_PERMISSION_REQUEST)
    }
  }

  private val heartRatePermission: String
    get() = if (Build.VERSION.SDK_INT >= 36) {
      "android.permission.health.READ_HEART_RATE"
    } else {
      Manifest.permission.BODY_SENSORS
    }

  private fun startCapture() {
    startForegroundService(
      Intent(this, HeartRateExerciseService::class.java).setAction(HeartRateExerciseService.ACTION_START),
    )
  }

  private fun stopCapture() {
    startService(
      Intent(this, HeartRateExerciseService::class.java).setAction(HeartRateExerciseService.ACTION_STOP),
    )
  }

  private fun render(snapshot: HeartRateRuntime.Snapshot) {
    heartRateText.text = snapshot.heartRateBeatsPerMinute?.let { "${it.toInt()} BPM" } ?: "-- BPM"
    statusText.text = snapshot.status
    actionButton.text = when {
      snapshot.isRecording -> "Parar"
      isPermissionDenied() -> "Abrir Ajustes"
      else -> "Iniciar"
    }
  }

  private fun buildContent(): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    gravity = Gravity.CENTER
    setPadding(24, 24, 24, 24)
    setBackgroundColor(Color.rgb(8, 17, 30))

    heartRateText = TextView(context).apply {
      text = "-- BPM"
      textSize = 30f
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
    }
    addView(heartRateText)

    statusText = TextView(context).apply {
      text = "Pronto"
      textSize = 13f
      setTextColor(Color.LTGRAY)
      gravity = Gravity.CENTER
    }
    addView(statusText)

    actionButton = Button(context).apply {
      text = "Iniciar"
    }
    addView(actionButton)
  }

  companion object {
    private const val SENSOR_PERMISSION_REQUEST = 100
    private const val PERMISSION_PREFERENCES = "heart-rate-permissions"
    private const val PERMISSION_REQUESTED_KEY = "body_sensors_requested"
  }
}
