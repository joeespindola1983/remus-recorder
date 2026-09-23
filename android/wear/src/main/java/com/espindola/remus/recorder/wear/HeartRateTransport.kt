package com.espindola.remus.recorder.wear

import android.content.Context
import android.provider.Settings
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable

class HeartRateTransport(private val context: Context) {
  private val preferences = context.getSharedPreferences("heart-rate-transport", Context.MODE_PRIVATE)
  private val deviceId = "wear:${Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)}"

  @Synchronized
  fun send(heartRateBeatsPerMinute: Double, nativeTimestamp: Long) {
    if (!heartRateBeatsPerMinute.isFinite() || heartRateBeatsPerMinute <= 0 || nativeTimestamp <= 0) return
    val sequenceNumber = preferences.getLong(SEQUENCE_KEY, 0) + 1
    preferences.edit().putLong(SEQUENCE_KEY, sequenceNumber).apply()

    val request = PutDataMapRequest.create(HEART_RATE_PATH).apply {
      dataMap.putString("protocolVersion", "1.0.0")
      dataMap.putString("type", "HEART_RATE_OBSERVATION")
      dataMap.putString("messageId", "$deviceId:$sequenceNumber")
      dataMap.putString("deviceId", deviceId)
      dataMap.putString("deviceFamily", "wear_os")
      dataMap.putLong("nativeTimestamp", nativeTimestamp)
      dataMap.putString("sequenceNumber", sequenceNumber.toString())
      dataMap.putDouble("heartRateBeatsPerMinute", heartRateBeatsPerMinute)
    }.asPutDataRequest().setUrgent()

    Wearable.getDataClient(context).putDataItem(request)
  }

  fun sendPermissionState(permissionState: String) {
    val request = PutDataMapRequest.create(DEVICE_STATE_PATH).apply {
      dataMap.putString("protocolVersion", "1.0.0")
      dataMap.putString("type", "DEVICE_STATE")
      dataMap.putString("deviceId", deviceId)
      dataMap.putString("deviceFamily", "wear_os")
      dataMap.putString("heartRatePermissionState", permissionState)
      dataMap.putLong("updatedAtEpochMilliseconds", System.currentTimeMillis())
    }.asPutDataRequest().setUrgent()
    Wearable.getDataClient(context).putDataItem(request)
  }

  companion object {
    const val HEART_RATE_PATH = "/remus/heart-rate/v1"
    const val DEVICE_STATE_PATH = "/remus/device-state/v1"
    private const val SEQUENCE_KEY = "last_sequence_number"
  }
}
