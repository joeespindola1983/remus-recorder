package com.espindola.remus.recorder.wear

import java.util.concurrent.CopyOnWriteArraySet

object HeartRateRuntime {
  data class Snapshot(
    val isRecording: Boolean = false,
    val heartRateBeatsPerMinute: Double? = null,
    val status: String = "Pronto",
  )

  @Volatile
  var snapshot = Snapshot()
    private set

  private val listeners = CopyOnWriteArraySet<(Snapshot) -> Unit>()

  fun update(next: Snapshot) {
    snapshot = next
    listeners.forEach { it(next) }
  }

  fun addListener(listener: (Snapshot) -> Unit) {
    listeners.add(listener)
    listener(snapshot)
  }

  fun removeListener(listener: (Snapshot) -> Unit) {
    listeners.remove(listener)
  }
}
