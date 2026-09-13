import Foundation
import CoreBluetooth
import React

@objc(RemusBladeBridge)
class RemusBladeBridge: RCTEventEmitter, CBCentralManagerDelegate, CBPeripheralDelegate {
  private var centralManager: CBCentralManager?
  private var connectedPeripheral: CBPeripheral?
  private var targetCharacteristic: CBCharacteristic?
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
    if connectedPeripheral?.state == .connected, targetCharacteristic != nil {
      sendStateEvent("connected")
    } else if centralManager?.state == .poweredOn {
      sendStateEvent("scanning")
    } else {
      sendStateEvent("disconnected")
    }
  }

  override func stopObserving() {
    hasListeners = false
  }

  @objc
  func isSupported(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let supported = centralManager?.state != .unsupported
    resolve(supported)
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
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
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
    guard let peripheral = connectedPeripheral else {
      resolve(false)
      return
    }
    centralManager?.connect(peripheral, options: nil)
    resolve(true)
  }

  @objc
  func disconnectPeripheral(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    if let peripheral = connectedPeripheral {
      centralManager?.cancelPeripheralConnection(peripheral)
      connectedPeripheral = nil
      targetCharacteristic = nil
    }
    sendStateEvent("disconnected")
    resolve(true)
  }

  @objc
  func sendCommand(_ command: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let peripheral = connectedPeripheral,
          let characteristic = targetCharacteristic,
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

  private func sendStateEvent(_ state: String) {
    guard hasListeners else { return }
    sendEvent(withName: "onRemusBladeStateChanged", body: [
      "state": state,
      "deviceId": connectedPeripheral?.identifier.uuidString ?? "remus-blade:p1",
      "deviceName": connectedPeripheral?.name ?? "Remus Blade P1",
    ])
  }

  // MARK: - CBCentralManagerDelegate
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state == .poweredOn {
      // Automatically scan for Remus Blade when Bluetooth is powered on
      central.scanForPeripherals(
        withServices: [remusServiceUUID],
        options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
      )
      sendStateEvent("scanning")
    } else {
      sendStateEvent("disconnected")
    }
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    central.stopScan()
    connectedPeripheral = peripheral
    peripheral.delegate = self
    sendStateEvent("connecting")
    central.connect(peripheral, options: nil)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.discoverServices([remusServiceUUID])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    if connectedPeripheral?.identifier == peripheral.identifier {
      connectedPeripheral = nil
      targetCharacteristic = nil
    }
    sendStateEvent("error")
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    connectedPeripheral = nil
    targetCharacteristic = nil
    sendStateEvent("disconnected")
    if central.state == .poweredOn {
      central.scanForPeripherals(
        withServices: [remusServiceUUID],
        options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
      )
    }
  }

  // MARK: - CBPeripheralDelegate
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard let services = peripheral.services else { return }
    for service in services where service.uuid == remusServiceUUID {
      peripheral.discoverCharacteristics([remusCharacteristicUUID], for: service)
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard let characteristics = service.characteristics else { return }
    for characteristic in characteristics where characteristic.uuid == remusCharacteristicUUID {
      targetCharacteristic = characteristic
      peripheral.setNotifyValue(true, for: characteristic)
      sendStateEvent("connected")
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard let data = characteristic.value,
          let rawCsv = String(data: data, encoding: .utf8),
          hasListeners else { return }

    sendEvent(withName: "onRemusBladeSnapshot", body: [
      "rawCsv": rawCsv,
      "deviceId": peripheral.identifier.uuidString,
      "deviceName": peripheral.name ?? "Remus Blade P1",
    ])
  }
}
