package com.espindola.remus.recorder.wear

import android.content.Intent
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

class WearCommandService : WearableListenerService() {
  override fun onMessageReceived(messageEvent: MessageEvent) {
    if (messageEvent.path != COMMAND_PATH) return
    val payload = runCatching { JSONObject(messageEvent.data.toString(Charsets.UTF_8)) }.getOrNull() ?: return
    val action = when (payload.optString("command")) {
      "START_RECORD" -> HeartRateExerciseService.ACTION_START
      "STOP_RECORD" -> HeartRateExerciseService.ACTION_STOP
      else -> return
    }
    startForegroundService(Intent(this, HeartRateExerciseService::class.java).setAction(action))
  }

  companion object {
    private const val COMMAND_PATH = "/remus/command/v1"
  }
}
