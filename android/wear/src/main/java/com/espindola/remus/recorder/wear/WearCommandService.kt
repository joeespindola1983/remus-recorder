package com.espindola.remus.recorder.wear

import android.content.Intent
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

class WearCommandService : WearableListenerService() {
  override fun onMessageReceived(messageEvent: MessageEvent) {
    if (messageEvent.path != COMMAND_PATH) return
    val payload = runCatching { JSONObject(messageEvent.data.toString(Charsets.UTF_8)) }.getOrNull() ?: return
    val command = payload.optString("command").ifEmpty { payload.optString("action") }.uppercase()
    val action = when (command) {
      "START_RECORD", "START_RECORDING", "START_WORKOUT" -> HeartRateExerciseService.ACTION_START
      "STOP_RECORD", "STOP_RECORDING", "STOP_WORKOUT" -> HeartRateExerciseService.ACTION_STOP
      else -> return
    }
    startForegroundService(Intent(this, HeartRateExerciseService::class.java).setAction(action))
    if (action == HeartRateExerciseService.ACTION_START) {
      val activityIntent = Intent(this, MainActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
      startActivity(activityIntent)
    }
  }

  companion object {
    private const val COMMAND_PATH = "/remus/command/v1"
  }
}
