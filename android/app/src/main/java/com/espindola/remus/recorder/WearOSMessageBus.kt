package com.espindola.remus.recorder

import java.util.concurrent.CopyOnWriteArraySet

object WearOSMessageBus {
  data class HeartRatePayload(
    val nodeId: String,
    val deviceId: String,
    val messageId: String,
    val nativeTimestamp: Long,
    val sequenceNumber: String,
    val heartRateBeatsPerMinute: Double,
  )

  data class DeviceStatePayload(
    val nodeId: String,
    val heartRatePermissionState: String,
  )

  private val listeners = CopyOnWriteArraySet<(HeartRatePayload) -> Unit>()
  private val stateListeners = CopyOnWriteArraySet<(DeviceStatePayload) -> Unit>()

  @Volatile
  var latest: HeartRatePayload? = null
    private set

  @Volatile
  var latestState: DeviceStatePayload? = null
    private set

  fun publish(payload: HeartRatePayload) {
    if (!payload.heartRateBeatsPerMinute.isFinite() || payload.heartRateBeatsPerMinute <= 0) return
    latest = payload
    listeners.forEach { it(payload) }
  }

  fun addListener(listener: (HeartRatePayload) -> Unit) {
    listeners.add(listener)
  }

  fun removeListener(listener: (HeartRatePayload) -> Unit) {
    listeners.remove(listener)
  }

  fun publishState(payload: DeviceStatePayload) {
    latestState = payload
    stateListeners.forEach { it(payload) }
  }

  fun addStateListener(listener: (DeviceStatePayload) -> Unit) {
    stateListeners.add(listener)
  }

  fun removeStateListener(listener: (DeviceStatePayload) -> Unit) {
    stateListeners.remove(listener)
  }
}
