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
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID

class RemusBladeModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val TAG = "RemusBlade"
  }

  private val bluetoothManager: BluetoothManager? by lazy {
    reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
  }
  private val bluetoothAdapter: BluetoothAdapter?
    get() = bluetoothManager?.adapter

  private var bluetoothGatt: BluetoothGatt? = null
  private var targetCharacteristic: BluetoothGattCharacteristic? = null
  private var isScanning = false
  private var listenerCount = 0

  private val remusServiceUuid = UUID.fromString("4fafc201-1fb5-459e-8fcc-c5c9c331914b")
  private val remusCharUuid = UUID.fromString("beb5483e-36e1-4688-b7f5-ea07361b26a8")
  private val clientCharConfigUuid = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

  override fun getName(): String = "RemusBladeBridge"

  private fun hasPermission(permission: String): Boolean {
    return ContextCompat.checkSelfPermission(
      reactContext,
      permission
    ) == PackageManager.PERMISSION_GRANTED
  }

  private fun canScan(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      hasPermission(Manifest.permission.BLUETOOTH_SCAN) &&
        hasPermission(Manifest.permission.BLUETOOTH_CONNECT)
    } else {
      hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    }
  }

  private fun canConnect(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      hasPermission(Manifest.permission.BLUETOOTH_CONNECT)
    } else {
      true
    }
  }

  @ReactMethod
  fun isSupported(promise: Promise) {
    val supported = bluetoothAdapter != null &&
      reactContext.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)
    promise.resolve(supported)
  }

  @ReactMethod
  fun getBluetoothState(promise: Promise) {
    val adapter = bluetoothAdapter
    if (adapter == null) {
      promise.resolve("unsupported")
      return
    }
    if (!canScan()) {
      promise.resolve("unauthorized")
      return
    }
    if (adapter.isEnabled) {
      promise.resolve("poweredOn")
    } else {
      promise.resolve("poweredOff")
    }
  }

  @ReactMethod
  fun startScan(promise: Promise) {
    if (!canScan()) {
      promise.reject("PERM_ERROR", "Bluetooth scan permission not granted")
      return
    }
    val scanner = bluetoothAdapter?.bluetoothLeScanner
    if (scanner == null || bluetoothAdapter?.isEnabled != true) {
      promise.resolve(false)
      return
    }

    try {
      val filters = listOf(
        ScanFilter.Builder().setServiceUuid(ParcelUuid(remusServiceUuid)).build()
      )
      val settings = ScanSettings.Builder()
        .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
        .build()

      isScanning = true
      sendStateEvent("scanning", null, null)
      scanner.startScan(filters, settings, scanCallback)
      Log.i(TAG, "startScan initiated")
      promise.resolve(true)
    } catch (e: SecurityException) {
      promise.reject("SECURITY_EXCEPTION", e.message, e)
    } catch (e: Exception) {
      promise.reject("SCAN_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun stopScan(promise: Promise) {
    stopInternalScan()
    promise.resolve(true)
  }

  private fun stopInternalScan() {
    if (!isScanning) return
    if (!canScan()) return
    try {
      bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
    } catch (_: Exception) {}
    isScanning = false
  }

  @ReactMethod
  fun connectPeripheral(identifier: String, promise: Promise) {
    if (!canConnect()) {
      promise.reject("PERM_ERROR", "Bluetooth connect permission not granted")
      return
    }
    try {
      val device = bluetoothAdapter?.getRemoteDevice(identifier)
      if (device == null) {
        promise.resolve(false)
        return
      }
      connectToDevice(device)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("CONNECT_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun disconnectPeripheral(promise: Promise) {
    disconnectCurrentGatt()
    sendStateEvent("disconnected", null, null)
    promise.resolve(true)
  }

  private fun disconnectCurrentGatt() {
    if (!canConnect()) return
    try {
      bluetoothGatt?.disconnect()
      bluetoothGatt?.close()
    } catch (_: Exception) {}
    bluetoothGatt = null
    targetCharacteristic = null
  }

  @ReactMethod
  fun sendCommand(command: String, promise: Promise) {
    val gatt = bluetoothGatt
    val char = targetCharacteristic
    if (gatt == null || char == null || !canConnect()) {
      promise.resolve(false)
      return
    }

    try {
      val data = command.toByteArray(Charsets.UTF_8)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val res = gatt.writeCharacteristic(char, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
        promise.resolve(res == BluetoothStatusCodes.SUCCESS)
      } else {
        @Suppress("DEPRECATION")
        char.value = data
        @Suppress("DEPRECATION")
        promise.resolve(gatt.writeCharacteristic(char))
      }
    } catch (e: Exception) {
      promise.reject("SEND_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {
    listenerCount += 1
    if (listenerCount == 1) {
      if (canScan() && bluetoothAdapter?.isEnabled == true && bluetoothGatt == null && !isScanning) {
        try {
          val scanner = bluetoothAdapter?.bluetoothLeScanner
          if (scanner != null) {
            val filters = listOf(
              ScanFilter.Builder().setServiceUuid(ParcelUuid(remusServiceUuid)).build()
            )
            val settings = ScanSettings.Builder()
              .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
              .build()
            isScanning = true
            sendStateEvent("scanning", null, null)
            scanner.startScan(filters, settings, scanCallback)
            Log.i(TAG, "Auto-startScan on addListener")
          }
        } catch (_: Exception) {}
      }
    }
  }

  @ReactMethod
  fun removeListeners(count: Double) {
    listenerCount = (listenerCount - count.toInt()).coerceAtLeast(0)
    if (listenerCount == 0) {
      stopInternalScan()
    }
  }

  @Suppress("DEPRECATION")
  private fun connectToDevice(device: BluetoothDevice) {
    stopInternalScan()
    val name = try { device.name ?: "Remus Blade P1" } catch (_: SecurityException) { "Remus Blade P1" }
    Log.i(TAG, "Connecting to device: ${device.address}, name: $name")
    sendStateEvent("connecting", device.address, name)
    if (!canConnect()) return
    try {
      disconnectCurrentGatt()
      bluetoothGatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        device.connectGatt(reactContext, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
      } else {
        device.connectGatt(reactContext, false, gattCallback)
      }
    } catch (e: Exception) {
      Log.e(TAG, "connectGatt failed", e)
      sendStateEvent("error", device.address, name)
    }
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult?) {
      val device = result?.device ?: return
      if (!canConnect()) return
      val name = try { device.name } catch (_: SecurityException) { null }
      val serviceUuids = result.scanRecord?.serviceUuids
      val matchesUuid = serviceUuids?.any { it.uuid == remusServiceUuid } == true
      val matchesName = name?.contains("Remus", ignoreCase = true) == true
      Log.d(TAG, "ScanResult: ${device.address}, name: $name, matchesUuid: $matchesUuid, matchesName: $matchesName")
      if (matchesUuid || matchesName) {
        connectToDevice(device)
      }
    }

    override fun onScanFailed(errorCode: Int) {
      Log.e(TAG, "Scan failed with error code: $errorCode")
      isScanning = false
      sendStateEvent("disconnected", null, null)
    }
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      if (!canConnect()) return
      val deviceName = try { gatt.device.name ?: "Remus Blade P1" } catch (_: SecurityException) { "Remus Blade P1" }
      val deviceId = gatt.device.address
      Log.i(TAG, "onConnectionStateChange: status=$status, newState=$newState (connected=${BluetoothProfile.STATE_CONNECTED})")

      if (newState == BluetoothProfile.STATE_CONNECTED) {
        try {
          val requested = gatt.requestMtu(512)
          Log.i(TAG, "requestMtu(512) returned $requested")
          if (!requested) {
            gatt.discoverServices()
          }
        } catch (_: SecurityException) {
          try { gatt.discoverServices() } catch (_: SecurityException) {}
        }
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        disconnectCurrentGatt()
        sendStateEvent("disconnected", deviceId, deviceName)
        if (canScan() && bluetoothAdapter?.isEnabled == true && listenerCount > 0 && !isScanning) {
          try {
            val scanner = bluetoothAdapter?.bluetoothLeScanner
            if (scanner != null) {
              val filters = listOf(
                ScanFilter.Builder().setServiceUuid(ParcelUuid(remusServiceUuid)).build()
              )
              val settings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build()
              isScanning = true
              sendStateEvent("scanning", null, null)
              scanner.startScan(filters, settings, scanCallback)
            }
          } catch (_: Exception) {}
        }
      }
    }

    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      Log.i(TAG, "onMtuChanged: mtu=$mtu, status=$status")
      if (!canConnect()) return
      try {
        gatt.discoverServices()
      } catch (_: SecurityException) {}
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      Log.i(TAG, "onServicesDiscovered: status=$status")
      if (status != BluetoothGatt.GATT_SUCCESS) return
      if (!canConnect()) return
      val service = gatt.getService(remusServiceUuid)
      if (service == null) {
        Log.e(TAG, "Service $remusServiceUuid not found! Available services: ${gatt.services.map { it.uuid }}")
        return
      }
      val characteristic = service.getCharacteristic(remusCharUuid)
      if (characteristic == null) {
        Log.e(TAG, "Characteristic $remusCharUuid not found! Available chars: ${service.characteristics.map { it.uuid }}")
        return
      }
      targetCharacteristic = characteristic

      try {
        val notifySet = gatt.setCharacteristicNotification(characteristic, true)
        Log.i(TAG, "setCharacteristicNotification returned $notifySet")
        val descriptor = characteristic.getDescriptor(clientCharConfigUuid)
          ?: characteristic.descriptors.firstOrNull()
        Log.i(TAG, "Found descriptor: ${descriptor?.uuid}, total descriptors: ${characteristic.descriptors.size}")

        if (descriptor != null) {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val res = gatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
            Log.i(TAG, "writeDescriptor (Tiramisu) result code: $res")
          } else {
            @Suppress("DEPRECATION")
            descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            @Suppress("DEPRECATION")
            val res = gatt.writeDescriptor(descriptor)
            Log.i(TAG, "writeDescriptor result: $res")
          }
        }
        val deviceName = try { gatt.device.name ?: "Remus Blade P1" } catch (_: SecurityException) { "Remus Blade P1" }
        sendStateEvent("connected", gatt.device.address, deviceName)
      } catch (e: Exception) {
        Log.e(TAG, "Exception in onServicesDiscovered setup", e)
      }
    }

    override fun onDescriptorWrite(
      gatt: BluetoothGatt,
      descriptor: BluetoothGattDescriptor,
      status: Int
    ) {
      Log.i(TAG, "onDescriptorWrite: ${descriptor.uuid}, status: $status")
    }

    @Deprecated("Deprecated in Java")
    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
    ) {
      @Suppress("DEPRECATION")
      val bytes = characteristic.value ?: return
      handleSnapshotBytes(bytes)
    }

    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray,
    ) {
      handleSnapshotBytes(value)
    }

    private fun handleSnapshotBytes(bytes: ByteArray) {
      val rawCsv = String(bytes, Charsets.UTF_8).trim()
      Log.d(TAG, "handleSnapshotBytes (${bytes.size} bytes): $rawCsv")
      if (rawCsv.isNotEmpty()) {
        emitSnapshot(rawCsv)
        if (RemusEvidenceStore.instance.isRecording) {
          RemusEvidenceStore.instance.appendRemusBladeLive(
            rawCsv,
            bluetoothGatt?.device?.address ?: "remus-blade:p1",
            System.currentTimeMillis()
          )
        }
      }
    }
  }

  private fun sendStateEvent(state: String, deviceId: String?, deviceName: String?) {
    if (listenerCount == 0 || !reactContext.hasActiveReactInstance()) return
    Log.i(TAG, "sendStateEvent: $state, id=$deviceId, name=$deviceName")
    val body = Arguments.createMap().apply {
      putString("state", state)
      putString("deviceId", deviceId ?: "remus-blade:p1")
      putString("deviceName", deviceName ?: "Remus Blade P1")
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("onRemusBladeStateChanged", body)
  }

  private fun emitSnapshot(rawCsv: String) {
    if (listenerCount == 0 || !reactContext.hasActiveReactInstance()) return
    val body = Arguments.createMap().apply {
      putString("rawCsv", rawCsv)
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("onRemusBladeSnapshot", body)
  }
}
