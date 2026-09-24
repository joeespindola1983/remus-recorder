package com.espindola.remus.recorder

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID
import java.util.ArrayDeque
import java.util.concurrent.ConcurrentHashMap

class RemusBladeModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object { private const val TAG = "RemusBlade" }

  private val bluetoothManager: BluetoothManager? by lazy {
    reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
  }
  private val bluetoothAdapter: BluetoothAdapter? get() = bluetoothManager?.adapter
  private val discovered = ConcurrentHashMap<String, BluetoothDevice>()
  private val gatts = ConcurrentHashMap<String, BluetoothGatt>()
  private val characteristics = ConcurrentHashMap<String, ConcurrentHashMap<UUID, BluetoothGattCharacteristic>>()
  private val serialToAddress = ConcurrentHashMap<String, String>()
  private val notificationQueues = ConcurrentHashMap<String, ArrayDeque<BluetoothGattCharacteristic>>()
  private var isScanning = false
  private var listenerCount = 0

  private val serviceUuid = UUID.fromString("4fafc201-1fb5-459e-8fcc-c5c9c331914b")
  private val legacyUuid = UUID.fromString("beb5483e-36e1-4688-b7f5-ea07361b26a8")
  private val deviceInfoUuid = UUID.fromString("beb5483f-36e1-4688-b7f5-ea07361b26a8")
  private val controlUuid = UUID.fromString("beb54840-36e1-4688-b7f5-ea07361b26a8")
  private val streamUuid = UUID.fromString("beb54841-36e1-4688-b7f5-ea07361b26a8")
  private val statusUuid = UUID.fromString("beb54842-36e1-4688-b7f5-ea07361b26a8")
  private val clockUuid = UUID.fromString("beb54843-36e1-4688-b7f5-ea07361b26a8")
  private val cccdUuid = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

  override fun getName(): String = "RemusBladeBridge"

  private fun hasPermission(permission: String): Boolean =
    ContextCompat.checkSelfPermission(reactContext, permission) == PackageManager.PERMISSION_GRANTED

  private fun canScan(): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    hasPermission(Manifest.permission.BLUETOOTH_SCAN) && hasPermission(Manifest.permission.BLUETOOTH_CONNECT)
  } else hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)

  private fun canConnect(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
    hasPermission(Manifest.permission.BLUETOOTH_CONNECT)

  @ReactMethod fun isSupported(promise: Promise) {
    promise.resolve(bluetoothAdapter != null &&
      reactContext.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE))
  }

  @ReactMethod fun getBluetoothState(promise: Promise) {
    val adapter = bluetoothAdapter
    when {
      adapter == null -> promise.resolve("unsupported")
      !canScan() -> promise.resolve("unauthorized")
      adapter.isEnabled -> promise.resolve("poweredOn")
      else -> promise.resolve("poweredOff")
    }
  }

  @ReactMethod fun startScan(promise: Promise) {
    if (!canScan()) { promise.reject("PERM_ERROR", "Bluetooth scan permission not granted"); return }
    val scanner = bluetoothAdapter?.bluetoothLeScanner
    if (scanner == null || bluetoothAdapter?.isEnabled != true) { promise.resolve(false); return }
    try {
      val filters = listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(serviceUuid)).build())
      val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
      isScanning = true
      scanner.startScan(filters, settings, scanCallback)
      if (discovered.isEmpty()) sendStateEvent("scanning", null, null)
      promise.resolve(true)
    } catch (error: Exception) { promise.reject("SCAN_ERROR", error.message, error) }
  }

  @ReactMethod fun stopScan(promise: Promise) {
    if (isScanning && canScan()) try { bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback) } catch (_: Exception) {}
    isScanning = false
    promise.resolve(true)
  }

  @ReactMethod fun connectPeripheral(identifier: String, promise: Promise) {
    if (!canConnect()) { promise.reject("PERM_ERROR", "Bluetooth connect permission not granted"); return }
    val address = serialToAddress[identifier] ?: identifier
    val device = discovered[address] ?: try {
      if (address.isNotBlank()) bluetoothAdapter?.getRemoteDevice(address) else discovered.values.firstOrNull()
    } catch (_: Exception) { null }
    if (device == null) { promise.resolve(false); return }
    connect(device)
    promise.resolve(true)
  }

  @ReactMethod fun disconnectPeripheral(promise: Promise) {
    for (gatt in gatts.values) try { gatt.disconnect(); gatt.close() } catch (_: Exception) {}
    gatts.clear(); characteristics.clear(); notificationQueues.clear()
    promise.resolve(true)
  }

  @ReactMethod fun sendCommand(command: String, promise: Promise) {
    val entry = characteristics.entries.firstOrNull { it.value[legacyUuid] != null }
    if (entry == null) { promise.resolve(false); return }
    promise.resolve(write(entry.key, legacyUuid, command.toByteArray(Charsets.UTF_8)))
  }

  @ReactMethod fun sendBinaryCommand(identifier: String, base64Value: String, promise: Promise) {
    val address = serialToAddress[identifier] ?: identifier
    val bytes = try { Base64.decode(base64Value, Base64.DEFAULT) } catch (_: Exception) { null }
    if (bytes == null) { promise.resolve(false); return }
    promise.resolve(write(address, controlUuid, bytes))
  }

  @ReactMethod fun registerBlade(identifier: String, promise: Promise) {
    val preferences = reactContext.getSharedPreferences("remus_blade_registry", Context.MODE_PRIVATE)
    val existing = preferences.getString(identifier, null)
    if (existing != null) { promise.resolve(existing); return }
    val next = preferences.all.values.mapNotNull { value ->
      (value as? String)?.takeIf { it.startsWith("Blade ") }?.removePrefix("Blade ")?.toIntOrNull()
    }.maxOrNull()?.plus(1) ?: 1
    val alias = "Blade %02d".format(next)
    preferences.edit().putString(identifier, alias).apply()
    promise.resolve(alias)
  }

  private fun write(address: String, uuid: UUID, bytes: ByteArray): Boolean {
    val gatt = gatts[address] ?: return false
    val characteristic = characteristics[address]?.get(uuid) ?: return false
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        gatt.writeCharacteristic(characteristic, bytes, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) ==
          BluetoothStatusCodes.SUCCESS
      } else {
        @Suppress("DEPRECATION")
        characteristic.value = bytes
        @Suppress("DEPRECATION")
        gatt.writeCharacteristic(characteristic)
      }
    } catch (_: Exception) { false }
  }

  @ReactMethod fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) { listenerCount += 1 }
  @ReactMethod fun removeListeners(count: Double) { listenerCount = (listenerCount - count.toInt()).coerceAtLeast(0) }

  @Suppress("DEPRECATION")
  private fun connect(device: BluetoothDevice) {
    if (gatts.containsKey(device.address)) return
    sendStateEvent("connecting", device.address, safeName(device))
    val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      device.connectGatt(reactContext, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    } else device.connectGatt(reactContext, false, gattCallback)
    gatts[device.address] = gatt
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult?) {
      val device = result?.device ?: return
      discovered[device.address] = device
      sendStateEvent("detected", device.address, safeName(device))
    }
    override fun onScanFailed(errorCode: Int) {
      isScanning = false
      sendStateEvent("error", null, null)
    }
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      val address = gatt.device.address
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        gatts[address] = gatt
        try { if (!gatt.requestMtu(185)) gatt.discoverServices() } catch (_: Exception) { gatt.discoverServices() }
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        gatts.remove(address); characteristics.remove(address); notificationQueues.remove(address)
        try { gatt.close() } catch (_: Exception) {}
        sendStateEvent("disconnected", address, safeName(gatt.device))
      }
    }

    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      try { gatt.discoverServices() } catch (_: Exception) {}
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      if (status != BluetoothGatt.GATT_SUCCESS) return
      val service = gatt.getService(serviceUuid) ?: return
      val address = gatt.device.address
      val map = ConcurrentHashMap<UUID, BluetoothGattCharacteristic>()
      for (characteristic in service.characteristics) map[characteristic.uuid] = characteristic
      characteristics[address] = map
      val queue = ArrayDeque<BluetoothGattCharacteristic>()
      for (uuid in listOf(legacyUuid, controlUuid, streamUuid, statusUuid, clockUuid)) {
        map[uuid]?.let { queue.addLast(it) }
      }
      notificationQueues[address] = queue
      enableNextNotification(gatt)
      if (map[legacyUuid] != null || map[streamUuid] != null) {
        sendStateEvent("connected", address, safeName(gatt.device))
      }
    }

    @Deprecated("Deprecated in Java")
    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      @Suppress("DEPRECATION") handleFrame(gatt, characteristic, characteristic.value ?: return)
    }

    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic,
                                         value: ByteArray) { handleFrame(gatt, characteristic, value) }

    @Deprecated("Deprecated in Java")
    override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic,
                                      status: Int) {
      @Suppress("DEPRECATION") if (status == BluetoothGatt.GATT_SUCCESS) handleFrame(gatt, characteristic, characteristic.value ?: return)
    }

    override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic,
                                      value: ByteArray, status: Int) {
      if (status == BluetoothGatt.GATT_SUCCESS) handleFrame(gatt, characteristic, value)
    }

    override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      enableNextNotification(gatt)
    }
  }

  private fun enableNextNotification(gatt: BluetoothGatt) {
    val address = gatt.device.address
    val queue = notificationQueues[address] ?: return
    while (queue.isNotEmpty()) {
      val characteristic = queue.removeFirst()
      try {
      gatt.setCharacteristicNotification(characteristic, true)
      val descriptor = characteristic.getDescriptor(cccdUuid) ?: continue
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        if (gatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) ==
            BluetoothStatusCodes.SUCCESS) return
      } else {
        @Suppress("DEPRECATION")
        descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        @Suppress("DEPRECATION")
        if (gatt.writeDescriptor(descriptor)) return
      }
      } catch (error: Exception) { Log.w(TAG, "Could not enable ${characteristic.uuid}", error) }
    }
    characteristics[address]?.get(deviceInfoUuid)?.let {
      try { gatt.readCharacteristic(it) } catch (_: Exception) {}
    }
  }

  private fun handleFrame(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, bytes: ByteArray) {
    if (bytes.isEmpty()) return
    val address = gatt.device.address
    val rawBase64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
    if (characteristic.uuid == deviceInfoUuid) parseSerial(bytes)?.let { serialToAddress[it] = address }
    if (characteristic.uuid == legacyUuid) {
      val rawCsv = try { String(bytes, Charsets.UTF_8).trim() } catch (_: Exception) { "" }
      emitSnapshot(address, safeName(gatt.device), rawCsv, rawBase64)
      if (RemusEvidenceStore.instance.isRecording) {
        RemusEvidenceStore.instance.appendRemusBladeLive(rawCsv, address, System.currentTimeMillis())
      }
      return
    }
    emitFrame(address, safeName(gatt.device), characteristic.uuid, rawBase64)
    if (RemusEvidenceStore.instance.isRecording) {
      RemusEvidenceStore.instance.appendRemusBladeFrame(
        rawBase64, address, characteristic.uuid.toString(), System.currentTimeMillis()
      )
    }
  }

  private fun parseSerial(bytes: ByteArray): String? {
    if (bytes.size < 12 || bytes[0].toInt() != 1) return null
    val length = bytes[10].toInt() and 0xff
    if (11 + length >= bytes.size) return null
    return String(bytes, 11, length, Charsets.UTF_8)
  }

  private fun safeName(device: BluetoothDevice): String = try { device.name ?: "Remus Blade" }
  catch (_: SecurityException) { "Remus Blade" }

  private fun sendStateEvent(state: String, deviceId: String?, deviceName: String?) {
    if (listenerCount == 0 || !reactContext.hasActiveReactInstance()) return
    val body = Arguments.createMap().apply {
      putString("state", state); putString("deviceId", deviceId ?: ""); putString("deviceName", deviceName ?: "Remus Blade")
    }
    reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("onRemusBladeStateChanged", body)
  }

  private fun emitSnapshot(deviceId: String, deviceName: String, rawCsv: String, rawBase64: String) {
    if (listenerCount == 0 || !reactContext.hasActiveReactInstance()) return
    val body = Arguments.createMap().apply {
      putString("rawCsv", rawCsv); putString("rawBase64", rawBase64)
      putString("deviceId", deviceId); putString("deviceName", deviceName)
      putDouble("receivedAtEpochMilliseconds", System.currentTimeMillis().toDouble())
    }
    reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("onRemusBladeSnapshot", body)
  }

  private fun emitFrame(deviceId: String, deviceName: String, uuid: UUID, rawBase64: String) {
    if (listenerCount == 0 || !reactContext.hasActiveReactInstance()) return
    val body = Arguments.createMap().apply {
      putString("rawBase64", rawBase64); putString("characteristicUuid", uuid.toString())
      putString("deviceId", deviceId); putString("deviceName", deviceName)
      putDouble("receivedAtEpochMilliseconds", System.currentTimeMillis().toDouble())
    }
    reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("onRemusBladeFrame", body)
  }
}
