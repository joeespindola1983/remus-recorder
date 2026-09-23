package com.espindola.remus.recorder.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.os.SystemClock
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate

class HeartRateExerciseService : Service() {
  private val exerciseClient by lazy { HealthServices.getClient(this).exerciseClient }
  private val transport by lazy { HeartRateTransport(this) }
  private var started = false

  private val updateCallback = object : ExerciseUpdateCallback {
    override fun onRegistered() = Unit

    override fun onRegistrationFailed(throwable: Throwable) {
      HeartRateRuntime.update(HeartRateRuntime.snapshot.copy(status = "Erro no sensor"))
    }

    override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) {
      if (dataType == DataType.HEART_RATE_BPM) {
        HeartRateRuntime.update(HeartRateRuntime.snapshot.copy(status = availability.toString()))
      }
    }

    override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) = Unit

    override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
      val point = update.latestMetrics.getData(DataType.HEART_RATE_BPM).lastOrNull() ?: return
      val bpm = point.value
      if (!bpm.isFinite() || bpm <= 0) return
      val bootEpochMilliseconds = System.currentTimeMillis() - SystemClock.elapsedRealtime()
      val measuredAtEpochMilliseconds = bootEpochMilliseconds + point.timeDurationFromBoot.toMillis()
      HeartRateRuntime.update(
        HeartRateRuntime.Snapshot(
          isRecording = true,
          heartRateBeatsPerMinute = bpm,
          status = "Gravando",
        ),
      )
      transport.send(bpm, measuredAtEpochMilliseconds)
    }
  }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    exerciseClient.setUpdateCallback(updateCallback)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> stopExercise()
      else -> startExercise()
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    exerciseClient.clearUpdateCallbackAsync(updateCallback)
    super.onDestroy()
  }

  private fun startExercise() {
    if (started) return
    started = true
    startForeground(NOTIFICATION_ID, notification("Coletando frequência cardíaca"))
    HeartRateRuntime.update(HeartRateRuntime.Snapshot(isRecording = true, status = "Preparando sensor"))
    val config = ExerciseConfig.builder(ExerciseType.ROWING)
      .setDataTypes(setOf(DataType.HEART_RATE_BPM))
      .build()
    val future = exerciseClient.startExerciseAsync(config)
    future.addListener(
      {
        runCatching { future.get() }
          .onSuccess {
            HeartRateRuntime.update(HeartRateRuntime.snapshot.copy(isRecording = true, status = "Gravando"))
          }
          .onFailure {
            started = false
            HeartRateRuntime.update(HeartRateRuntime.Snapshot(status = "Não foi possível iniciar"))
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
          }
      },
      mainExecutor,
    )
  }

  private fun stopExercise() {
    if (!started) {
      stopSelf()
      return
    }
    started = false
    val future = exerciseClient.endExerciseAsync()
    future.addListener(
      {
        runCatching { future.get() }
        HeartRateRuntime.update(HeartRateRuntime.Snapshot(status = "Finalizado"))
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      },
      mainExecutor,
    )
  }

  private fun createNotificationChannel() {
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Remus Recorder", NotificationManager.IMPORTANCE_LOW),
    )
  }

  private fun notification(text: String): Notification = Notification.Builder(this, CHANNEL_ID)
    .setSmallIcon(android.R.drawable.ic_media_play)
    .setContentTitle("Remus Recorder")
    .setContentText(text)
    .setOngoing(true)
    .build()

  companion object {
    const val ACTION_START = "com.espindola.remus.recorder.wear.START"
    const val ACTION_STOP = "com.espindola.remus.recorder.wear.STOP"
    private const val CHANNEL_ID = "heart-rate-capture"
    private const val NOTIFICATION_ID = 42
  }
}
