import Foundation
import CoreBluetooth
import React

@objc(RemusBladeBridge)
class RemusBladeBridge: RCTEventEmitter, CBCentralManagerDelegate, CBPeripheralDelegate {
  private var centralManager: CBCentralManager?
  private var connectedPeripherals: [UUID: CBPeripheral] = [:]
  private var discoveredPeripherals: [UUID: CBPeripheral] = [:]
  private var lastAdvertisementAt: [UUID: Date] = [:]
  private var discoveryExpiryTimer: Timer?
  private var targetCharacteristics: [UUID: CBCharacteristic] = [:]
  private var hasListeners = false

  private let remusServiceUUID = CBUUID(string: "4fafc201-1fb5-459e-8fcc-c5c9c331914b")
  private let remusCharacteristicUUID = CBUUID(string: "beb5483e-36e1-4688-b7f5-ea07361b26a8")

  override init() {
    super.init()
    centralManager = CBCentralManager(delegate: self, queue: nil)
  }

  @objc
  override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return ["onRemusBladeSnapshot", "onRemusBladeStateChanged"]
  }

  override func startObserving() {
    hasListeners = true
    startDiscoveryExpiryTimer()
    if let firstConnected = connectedPeripherals.values.first, targetCharacteristics[firstConnected.identifier] != nil {
      sendStateEvent("connected", peripheral: firstConnected)
    } else if let firstDiscovered = discoveredPeripherals.values.first,
              let lastSeen = lastAdvertisementAt[firstDiscovered.identifier],
              Date().timeIntervalSince(lastSeen) <= 6 {
      sendStateEvent("detected", peripheral: firstDiscovered)
    } else if centralManager?.state == .poweredOn {
      sendStateEvent("scanning")
    } else {
      discoveredPeripherals.removeAll()
      connectedPeripherals.removeAll()
      targetCharacteristics.removeAll()
      lastAdvertisementAt.removeAll()
      sendStateEvent("disconnected")
    }
  }

  override func stopObserving() {
    hasListeners = false
    discoveryExpiryTimer?.invalidate()
    discoveryExpiryTimer = nil
  }

  @objc
  func isSupported(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let supported = centralManager?.state != .unsupported
    resolve(supported)
  }

  @objc
  func getBluetoothState(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let central = centralManager else {
      resolve("unsupported")
      return
    }
    switch central.state {
    case .poweredOn:
      resolve("poweredOn")
    case .poweredOff:
      resolve("poweredOff")
    case .unauthorized:
      resolve("unauthorized")
    case .unsupported:
      resolve("unsupported")
    case .resetting:
      resolve("resetting")
    case .unknown:
      resolve("unknown")
    @unknown default:
      resolve("unknown")
    }
  }

  @objc
  func startScan(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let central = centralManager, central.state == .poweredOn else {
      resolve(false)
      return
    }

    sendStateEvent("scanning")
    central.scanForPeripherals(
      withServices: [remusServiceUUID],
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
    )
    resolve(true)
  }

  @objc
  func stopScan(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    centralManager?.stopScan()
    resolve(true)
  }

  @objc
  func connectPeripheral(_ identifier: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let requested = UUID(uuidString: identifier)
    let peripheral = requested != nil ? discoveredPeripherals[requested!] : discoveredPeripherals.values.first
    guard let target = peripheral else {
      resolve(false)
      return
    }
    centralManager?.connect(target, options: nil)
    sendStateEvent("connecting", peripheral: target)
    resolve(true)
  }

  @objc
  func disconnectPeripheral(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    for peripheral in connectedPeripherals.values {
      centralManager?.cancelPeripheralConnection(peripheral)
    }
    connectedPeripherals.removeAll()
    targetCharacteristics.removeAll()
    sendStateEvent(discoveredPeripherals.isEmpty ? "disconnected" : "detected")
    resolve(true)
  }

  @objc
  func sendBinaryCommand(_ identifier: String, base64Command: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let requested = UUID(uuidString: identifier),
          let peripheral = connectedPeripherals[requested],
          let characteristic = targetCharacteristics[requested],
          let data = Data(base64Encoded: base64Command) else {
      resolve(false)
      return
    }

    let writeType: CBCharacteristicWriteType = characteristic.properties.contains(.writeWithoutResponse)
      ? .withoutResponse
      : .withResponse
    peripheral.writeValue(data, for: characteristic, type: writeType)
    resolve(true)
  }

  @objc
  func sendCommand(_ identifier: String, command: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let requested = UUID(uuidString: identifier),
          let peripheral = connectedPeripherals[requested],
          let characteristic = targetCharacteristics[requested],
          let data = command.data(using: .utf8) else {
      resolve(false)
      return
    }

    let writeType: CBCharacteristicWriteType = characteristic.properties.contains(.writeWithoutResponse)
      ? .withoutResponse
      : .withResponse
    peripheral.writeValue(data, for: characteristic, type: writeType)
    resolve(true)
  }

  private func sendStateEvent(_ state: String, peripheral: CBPeripheral? = nil, customName: String? = nil) {
    guard hasListeners else { return }
    let target = peripheral ?? connectedPeripherals.values.first ?? discoveredPeripherals.values.first
    let name = customName ?? target?.name
    let isComputer = name?.contains("REMUS-P") == true || name?.contains("CMP") == true || name?.contains("Computer") == true || name?.contains("PR1") == true
    let fallback = isComputer ? "Remus Computer" : "Remus Blade"
    
    let deviceId = target?.identifier.uuidString ?? "remus-blade:p1"
    let deviceName = (name?.isEmpty == false ? name : nil) ?? fallback
    
    print("[BLE] Bridge sending state '\(state)' for device \(deviceName) (\(deviceId))")
    
    sendEvent(withName: "onRemusBladeStateChanged", body: [
      "state": state,
      "deviceId": deviceId,
      "deviceName": deviceName,
    ])
  }

  // MARK: - CBCentralManagerDelegate
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state == .poweredOn {
      print("[BLE] Central Manager Powered On. Scanning...")
      // Automatically scan for Remus Blade and Computer when Bluetooth is powered on
      central.scanForPeripherals(
        withServices: [remusServiceUUID],
        options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
      )
      sendStateEvent("scanning")
    } else {
      print("[BLE] Central Manager Powered Off or Unavailable (state: \(central.state.rawValue)).")
      sendStateEvent("disconnected")
    }
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    let isFirstDiscovery = discoveredPeripherals[peripheral.identifier] == nil
    discoveredPeripherals[peripheral.identifier] = peripheral
    lastAdvertisementAt[peripheral.identifier] = Date()
    peripheral.delegate = self

    let advertisedName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
    let effectiveName = advertisedName ?? peripheral.name

    if isFirstDiscovery {
      print("[BLE] Discovered new peripheral: \(effectiveName ?? "Unknown") (\(peripheral.identifier.uuidString)) at RSSI \(RSSI)")
      sendStateEvent("detected", peripheral: peripheral, customName: effectiveName)
    }

    // Auto-connect ONLY if peripheral is disconnected (prevents repeated connect spam on duplicate advertisement packets)
    if connectedPeripherals[peripheral.identifier] == nil && peripheral.state == .disconnected {
      print("[BLE] Auto-connecting to peripheral: \(peripheral.identifier.uuidString)")
      central.connect(peripheral, options: nil)
    }
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    print("[BLE] Successfully connected to peripheral: \(peripheral.name ?? peripheral.identifier.uuidString)")
    connectedPeripherals[peripheral.identifier] = peripheral
    peripheral.discoverServices([remusServiceUUID])
    sendStateEvent("connecting", peripheral: peripheral)
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    if let error = error {
      print("[BLE] Failed to connect to \(peripheral.name ?? peripheral.identifier.uuidString): \(error.localizedDescription)")
    }
    connectedPeripherals.removeValue(forKey: peripheral.identifier)
    targetCharacteristics.removeValue(forKey: peripheral.identifier)
    sendStateEvent("error", peripheral: peripheral)
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    if let error = error {
      print("[BLE] Disconnected from \(peripheral.name ?? peripheral.identifier.uuidString): \(error.localizedDescription)")
    }
    connectedPeripherals.removeValue(forKey: peripheral.identifier)
    targetCharacteristics.removeValue(forKey: peripheral.identifier)
    sendStateEvent("disconnected", peripheral: peripheral)
  }

  private func startDiscoveryExpiryTimer() {
    discoveryExpiryTimer?.invalidate()
    discoveryExpiryTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
      guard let self else { return }
      let now = Date()
      var expired: [UUID] = []
      for (uuid, date) in self.lastAdvertisementAt {
        if self.connectedPeripherals[uuid] == nil && now.timeIntervalSince(date) > 6 {
          expired.append(uuid)
        }
      }
      for uuid in expired {
        self.discoveredPeripherals.removeValue(forKey: uuid)
        self.lastAdvertisementAt.removeValue(forKey: uuid)
      }
      if self.connectedPeripherals.isEmpty && self.discoveredPeripherals.isEmpty {
        self.sendStateEvent("scanning")
      }
    }
  }

  // MARK: - CBPeripheralDelegate
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard let services = peripheral.services else { return }
    for service in services where service.uuid == remusServiceUUID {
      peripheral.discoverCharacteristics(nil, for: service)
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard let characteristics = service.characteristics else { return }
    var hasNotify = false
    for characteristic in characteristics {
      if characteristic.properties.contains(.notify) {
        peripheral.setNotifyValue(true, for: characteristic)
        hasNotify = true
      }
      
      let uuid = characteristic.uuid.uuidString.lowercased()
      let isPrimaryWrite = uuid == "beb5483e-36e1-4688-b7f5-ea07361b26a8" || uuid == "beb54840-36e1-4688-b7f5-ea07361b26a8"
      
      if characteristic.properties.contains(.write) || characteristic.properties.contains(.writeWithoutResponse) {
        if targetCharacteristics[peripheral.identifier] == nil || isPrimaryWrite {
          targetCharacteristics[peripheral.identifier] = characteristic
        }
      }
    }
    if hasNotify {
      sendStateEvent("connected", peripheral: peripheral)
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard let data = characteristic.value else { return }
    let rawCsv = String(data: data, encoding: .utf8) ?? ""
    let rawBase64 = data.base64EncodedString()

    let receivedAt = Int64(Date().timeIntervalSince1970 * 1_000)
    let deviceId = peripheral.identifier.uuidString
    let deviceName = peripheral.name ?? "Remus Blade"

    RemusEvidenceStore.shared.appendRemusBladeLive(
      rawCsv: rawCsv,
      rawBase64: rawBase64,
      deviceId: deviceId,
      receivedAt: receivedAt
    )

    if hasListeners {
      sendEvent(withName: "onRemusBladeSnapshot", body: [
        "rawCsv": rawCsv,
        "rawBase64": rawBase64,
        "deviceId": deviceId,
        "deviceName": deviceName,
        "receivedAtEpochMilliseconds": receivedAt,
      ])
    }
  }
}
