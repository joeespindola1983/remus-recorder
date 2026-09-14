package com.espindola.remus.recorder

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject

class RemusWearOSModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  private var listenerCount = 0
  private val busListener: (WearOSMessageBus.HeartRatePayload) -> Unit = { emit(it) }
  private val stateListener: (WearOSMessageBus.DeviceStatePayload) -> Unit = { emitState(it) }

  override fun getName(): String = "RemusWearOSBridge"

  override fun initialize() {
    super.initialize()
    WearOSMessageBus.addListener(busListener)
    WearOSMessageBus.addStateListener(stateListener)
  }

  override fun invalidate() {
    WearOSMessageBus.removeListener(busListener)
    WearOSMessageBus.removeStateListener(stateListener)
    super.invalidate()
  }

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == 0)
  }

  @ReactMethod
  fun getConnectedNodes(promise: Promise) {
    Wearable.getNodeClient(context).connectedNodes
      .addOnSuccessListener { nodes ->
        val result = Arguments.createArray()
        nodes.forEach { node ->
          result.pushMap(Arguments.createMap().apply {
            putString("id", node.id)
            putString("name", node.displayName)
          })
        }
        promise.resolve(result)
      }
      .addOnFailureListener { promise.reject("WEAR_NODES_ERROR", it) }
  }

  @ReactMethod
  fun sendMessage(nodeId: String, payload: ReadableMap, promise: Promise) {
    val bytes = JSONObject(payload.toHashMap()).toString().toByteArray(Charsets.UTF_8)
    val messageClient = Wearable.getMessageClient(reactApplicationContext)
    if (nodeId == "broadcast" || nodeId.isBlank()) {
      Wearable.getNodeClient(reactApplicationContext).connectedNodes
        .addOnSuccessListener { nodes ->
          nodes.forEach { node ->
            messageClient.sendMessage(node.id, COMMAND_PATH, bytes)
          }
          promise.resolve(nodes.size)
        }
        .addOnFailureListener { promise.reject("WEAR_SEND_ERROR", it) }
      return
    }
    messageClient
      .sendMessage(nodeId, COMMAND_PATH, bytes)
      .addOnSuccessListener { requestId -> promise.resolve(requestId) }
      .addOnFailureListener { promise.reject("WEAR_SEND_ERROR", it) }
  }

  @ReactMethod
  fun getLatestHeartRate(promise: Promise) {
    promise.resolve(WearOSMessageBus.latest?.let(::toMap))
  }

  @ReactMethod
  fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {
    listenerCount += 1
    if (listenerCount == 1) {
      WearOSMessageBus.latest?.let(::emit)
      WearOSMessageBus.latestState?.let(::emitState)
    }
  }

  @ReactMethod
  fun removeListeners(count: Double) {
    listenerCount = (listenerCount - count.toInt()).coerceAtLeast(0)
  }

  private fun emit(payload: WearOSMessageBus.HeartRatePayload) {
    if (RemusEvidenceStore.instance.isRecording) {
      val now = System.currentTimeMillis()
      RemusEvidenceStore.instance.appendWatchHeartRate(mapOf(
        "type" to "HEART_RATE_OBSERVATION",
        "protocolVersion" to "1.0.0",
        "messageId" to payload.messageId,
        "nodeId" to payload.nodeId,
        "deviceId" to payload.deviceId,
        "deviceFamily" to "wear_os",
        "nativeTimestamp" to payload.nativeTimestamp,
        "sequenceNumber" to payload.sequenceNumber,
        "heartRateBeatsPerMinute" to payload.heartRateBeatsPerMinute,
        "receivedAtEpochMilliseconds" to now
      ))
    }
    if (listenerCount == 0 || !context.hasActiveReactInstance()) return
    context
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("onWearOSMessage", toMap(payload))
  }

  private fun emitState(payload: WearOSMessageBus.DeviceStatePayload) {
    if (listenerCount == 0 || !context.hasActiveReactInstance()) return
    context
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("onWearOSStateChanged", Arguments.createMap().apply {
        putString("nodeId", payload.nodeId)
        putString("heartRatePermissionState", payload.heartRatePermissionState)
      })
  }

  private fun toMap(payload: WearOSMessageBus.HeartRatePayload) = Arguments.createMap().apply {
    putString("type", "HEART_RATE_OBSERVATION")
    putString("protocolVersion", "1.0.0")
    putString("messageId", payload.messageId)
    putString("nodeId", payload.nodeId)
    putString("deviceId", payload.deviceId)
    putString("deviceFamily", "wear_os")
    putDouble("nativeTimestamp", payload.nativeTimestamp.toDouble())
    putString("sequenceNumber", payload.sequenceNumber)
    putDouble("heartRateBeatsPerMinute", payload.heartRateBeatsPerMinute)
    putDouble("receivedAtEpochMilliseconds", System.currentTimeMillis().toDouble())
  }

  companion object {
    private const val COMMAND_PATH = "/remus/command/v1"
  }
}
