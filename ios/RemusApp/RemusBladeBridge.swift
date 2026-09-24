import Foundation
import CoreBluetooth
import React

@objc(RemusBladeBridge)
class RemusBladeBridge: RCTEventEmitter, CBCentralManagerDelegate, CBPeripheralDelegate {
  private var centralManager: CBCentralManager?
  private var discovered: [UUID: CBPeripheral] = [:]
  private var connected: [UUID: CBPeripheral] = [:]
  private var lastAdvertisementAt: [UUID: Date] = [:]
  private var characteristics: [UUID: [CBUUID: CBCharacteristic]] = [:]
  private var serialToPeripheral: [String: UUID] = [:]
  private var discoveryExpiryTimer: Timer?
  private var hasListeners = false

  private let serviceUUID = CBUUID(string: "4fafc201-1fb5-459e-8fcc-c5c9c331914b")
  private let legacyUUID = CBUUID(string: "beb5483e-36e1-4688-b7f5-ea07361b26a8")
  private let deviceInfoUUID = CBUUID(string: "beb5483f-36e1-4688-b7f5-ea07361b26a8")
  private let controlUUID = CBUUID(string: "beb54840-36e1-4688-b7f5-ea07361b26a8")
  private let streamUUID = CBUUID(string: "beb54841-36e1-4688-b7f5-ea07361b26a8")
  private let statusUUID = CBUUID(string: "beb54842-36e1-4688-b7f5-ea07361b26a8")
  private let clockUUID = CBUUID(string: "beb54843-36e1-4688-b7f5-ea07361b26a8")

  override init() {
    super.init()
    centralManager = CBCentralManager(delegate: self, queue: nil)
  }

  @objc override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["onRemusBladeSnapshot", "onRemusBladeStateChanged", "onRemusBladeFrame"]
  }

  override func startObserving() {
    hasListeners = true
    startDiscoveryExpiryTimer()
    if centralManager?.state == .poweredOn { startScanning() }
    else { sendStateEvent("disconnected", peripheral: nil) }
  }

  override func stopObserving() {
    hasListeners = false
    discoveryExpiryTimer?.invalidate()
    discoveryExpiryTimer = nil
  }

  @objc func isSupported(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(centralManager?.state != .unsupported)
  }

  @objc func getBluetoothState(_ resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let state = centralManager?.state else { resolve("unsupported"); return }
    switch state {
    case .poweredOn: resolve("poweredOn")
    case .poweredOff: resolve("poweredOff")
    case .unauthorized: resolve("unauthorized")
    case .unsupported: resolve("unsupported")
    case .resetting: resolve("resetting")
    case .unknown: resolve("unknown")
    @unknown default: resolve("unknown")
    }
  }

  @objc func startScan(_ resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard centralManager?.state == .poweredOn else { resolve(false); return }
    startScanning()
    resolve(true)
  }

  @objc func stopScan(_ resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
    centralManager?.stopScan()
    resolve(true)
  }

  @objc func connectPeripheral(_ identifier: String,
                               resolver resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
    let uuid = UUID(uuidString: identifier) ?? serialToPeripheral[identifier]
    guard let id = uuid, let peripheral = discovered[id] else { resolve(false); return }
    peripheral.delegate = self
    centralManager?.connect(peripheral, options: nil)
    sendStateEvent("connecting", peripheral: peripheral)
    resolve(true)
  }

  @objc func disconnectPeripheral(_ resolve: @escaping RCTPromiseResolveBlock,
                                  rejecter reject: @escaping RCTPromiseRejectBlock) {
    for peripheral in connected.values { centralManager?.cancelPeripheralConnection(peripheral) }
    resolve(true)
  }

  @objc func sendCommand(_ command: String,
                         resolver resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let peripheral = connected.values.first,
          let characteristic = characteristics[peripheral.identifier]?[legacyUUID],
          let data = command.data(using: .utf8) else { resolve(false); return }
    write(data, to: characteristic, peripheral: peripheral)
    resolve(true)
  }

  @objc func sendBinaryCommand(_ identifier: String,
                               base64Value: String,
                               resolver resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
    let uuid = UUID(uuidString: identifier) ?? serialToPeripheral[identifier]
    guard let id = uuid, let peripheral = connected[id],
          let characteristic = characteristics[id]?[controlUUID],
          let data = Data(base64Encoded: base64Value) else { resolve(false); return }
    write(data, to: characteristic, peripheral: peripheral)
    resolve(true)
  }

  @objc func registerBlade(_ identifier: String,
                           resolver resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
    let defaults = UserDefaults.standard
    let key = "remus.blade.aliases"
    var aliases = defaults.dictionary(forKey: key) as? [String: String] ?? [:]
    if let existing = aliases[identifier] { resolve(existing); return }
    let next = aliases.values.compactMap { value -> Int? in
      guard value.hasPrefix("Blade ") else { return nil }
      return Int(value.dropFirst(6))
    }.max().map { $0 + 1 } ?? 1
    let alias = String(format: "Blade %02d", next)
    aliases[identifier] = alias
    defaults.set(aliases, forKey: key)
    resolve(alias)
  }

  private func write(_ data: Data, to characteristic: CBCharacteristic,
                     peripheral: CBPeripheral) {
    let type: CBCharacteristicWriteType = characteristic.properties.contains(.writeWithoutResponse)
      ? .withoutResponse : .withResponse
    peripheral.writeValue(data, for: characteristic, type: type)
  }

  private func startScanning() {
    centralManager?.scanForPeripherals(
      withServices: [serviceUUID],
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
    )
    if discovered.isEmpty { sendStateEvent("scanning", peripheral: nil) }
  }

  private func sendStateEvent(_ state: String, peripheral: CBPeripheral?) {
    guard hasListeners else { return }
    sendEvent(withName: "onRemusBladeStateChanged", body: [
      "state": state,
      "deviceId": peripheral?.identifier.uuidString ?? "",
      "deviceName": peripheral?.name ?? "Remus Blade",
    ])
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state == .poweredOn { startScanning() }
    else { sendStateEvent("disconnected", peripheral: nil) }
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                      advertisementData: [String: Any], rssi RSSI: NSNumber) {
    discovered[peripheral.identifier] = peripheral
    lastAdvertisementAt[peripheral.identifier] = Date()
    peripheral.delegate = self
    if connected[peripheral.identifier] == nil { sendStateEvent("detected", peripheral: peripheral) }
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    connected[peripheral.identifier] = peripheral
    peripheral.delegate = self
    peripheral.discoverServices([serviceUUID])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral,
                      error: Error?) {
    connected.removeValue(forKey: peripheral.identifier)
    characteristics.removeValue(forKey: peripheral.identifier)
    sendStateEvent("error", peripheral: peripheral)
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
                      error: Error?) {
    connected.removeValue(forKey: peripheral.identifier)
    characteristics.removeValue(forKey: peripheral.identifier)
    sendStateEvent("disconnected", peripheral: peripheral)
    startScanning()
  }

  private func startDiscoveryExpiryTimer() {
    discoveryExpiryTimer?.invalidate()
    discoveryExpiryTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
      guard let self else { return }
      let cutoff = Date().addingTimeInterval(-6)
      for (id, seenAt) in self.lastAdvertisementAt where seenAt < cutoff && self.connected[id] == nil {
        self.discovered.removeValue(forKey: id)
        self.lastAdvertisementAt.removeValue(forKey: id)
      }
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard error == nil, let services = peripheral.services else { return }
    for service in services where service.uuid == serviceUUID {
      peripheral.discoverCharacteristics(
        [legacyUUID, deviceInfoUUID, controlUUID, streamUUID, statusUUID, clockUUID], for: service
      )
    }
  }

  func peripheral(_ peripheral: CBPeripheral,
                  didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard error == nil, let values = service.characteristics else { return }
    var map = characteristics[peripheral.identifier] ?? [:]
    for characteristic in values {
      map[characteristic.uuid] = characteristic
      if characteristic.uuid == deviceInfoUUID { peripheral.readValue(for: characteristic) }
      if [legacyUUID, controlUUID, streamUUID, statusUUID, clockUUID].contains(characteristic.uuid) {
        peripheral.setNotifyValue(true, for: characteristic)
      }
    }
    characteristics[peripheral.identifier] = map
    if map[legacyUUID] != nil || map[streamUUID] != nil { sendStateEvent("connected", peripheral: peripheral) }
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic,
                  error: Error?) {
    guard error == nil, let data = characteristic.value else { return }
    let receivedAt = Int64(Date().timeIntervalSince1970 * 1_000)
    let rawBase64 = data.base64EncodedString()
    if characteristic.uuid == deviceInfoUUID, let serial = parseSerial(data) {
      serialToPeripheral[serial] = peripheral.identifier
    }

    if characteristic.uuid == legacyUUID {
      let rawCsv = String(data: data, encoding: .utf8) ?? ""
      RemusEvidenceStore.shared.appendRemusBladeLive(
        rawCsv: rawCsv, deviceId: peripheral.identifier.uuidString, receivedAt: receivedAt
      )
      if hasListeners {
        sendEvent(withName: "onRemusBladeSnapshot", body: [
          "rawCsv": rawCsv, "rawBase64": rawBase64,
          "deviceId": peripheral.identifier.uuidString,
          "deviceName": peripheral.name ?? "Remus Computer",
          "receivedAtEpochMilliseconds": receivedAt,
        ])
      }
      return
    }

    RemusEvidenceStore.shared.appendRemusBladeFrame(
      rawBase64: rawBase64, deviceId: peripheral.identifier.uuidString,
      characteristicUuid: characteristic.uuid.uuidString.lowercased(), receivedAt: receivedAt
    )
    if hasListeners {
      sendEvent(withName: "onRemusBladeFrame", body: [
        "rawBase64": rawBase64,
        "characteristicUuid": characteristic.uuid.uuidString.lowercased(),
        "deviceId": peripheral.identifier.uuidString,
        "deviceName": peripheral.name ?? "Remus Blade",
        "receivedAtEpochMilliseconds": receivedAt,
      ])
    }
  }

  private func parseSerial(_ data: Data) -> String? {
    let bytes = [UInt8](data)
    guard bytes.count >= 12, bytes[0] == 1 else { return nil }
    let length = Int(bytes[10])
    guard 11 + length < bytes.count else { return nil }
    return String(bytes: bytes[11..<(11 + length)], encoding: .utf8)
  }
}
