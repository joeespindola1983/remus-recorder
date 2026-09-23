package com.espindola.remus.recorder

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

class WearOSMessageService : WearableListenerService() {
  override fun onMessageReceived(messageEvent: MessageEvent) {
    if (messageEvent.path != HEART_RATE_PATH) return
    val json = runCatching { JSONObject(messageEvent.data.toString(Charsets.UTF_8)) }.getOrNull() ?: return
    publish(
      nodeId = messageEvent.sourceNodeId,
      deviceId = json.optString("deviceId", messageEvent.sourceNodeId),
      messageId = json.optString("messageId", "wear:${messageEvent.sourceNodeId}:${json.optLong("sequenceNumber", 0)}"),
      nativeTimestamp = json.optLong("nativeTimestamp", 0),
      sequenceNumber = json.optString("sequenceNumber", "0"),
      heartRateBeatsPerMinute = json.optDouble("heartRateBeatsPerMinute", Double.NaN),
    )
  }

  override fun onDataChanged(dataEvents: DataEventBuffer) {
    dataEvents.forEach { event ->
      if (event.type != DataEvent.TYPE_CHANGED) return@forEach
      val map = DataMapItem.fromDataItem(event.dataItem).dataMap
      if (event.dataItem.uri.path == DEVICE_STATE_PATH) {
        WearOSMessageBus.publishState(
          WearOSMessageBus.DeviceStatePayload(
            nodeId = event.dataItem.uri.host ?: "wearos-device",
            heartRatePermissionState = map.getString("heartRatePermissionState", "unknown"),
          ),
        )
        return@forEach
      }
      if (event.dataItem.uri.path != HEART_RATE_PATH) return@forEach
      publish(
        nodeId = event.dataItem.uri.host ?: "wearos-device",
        deviceId = map.getString("deviceId", event.dataItem.uri.host ?: "wearos-device"),
        messageId = map.getString("messageId", "wear:${map.getString("sequenceNumber", "0")}"),
        nativeTimestamp = map.getLong("nativeTimestamp"),
        sequenceNumber = map.getString("sequenceNumber", "0"),
        heartRateBeatsPerMinute = map.getDouble("heartRateBeatsPerMinute", Double.NaN),
      )
    }
  }

  private fun publish(
    nodeId: String,
    deviceId: String,
    messageId: String,
    nativeTimestamp: Long,
    sequenceNumber: String,
    heartRateBeatsPerMinute: Double,
  ) {
    if (nativeTimestamp <= 0) return
    WearOSMessageBus.publish(
      WearOSMessageBus.HeartRatePayload(
        nodeId = nodeId,
        deviceId = deviceId,
        messageId = messageId,
        nativeTimestamp = nativeTimestamp,
        sequenceNumber = sequenceNumber,
        heartRateBeatsPerMinute = heartRateBeatsPerMinute,
      ),
    )
  }

  companion object {
    const val HEART_RATE_PATH = "/remus/heart-rate/v1"
    const val DEVICE_STATE_PATH = "/remus/device-state/v1"
  }
}
