import { useEffect, useState, useCallback, useRef } from 'react';
import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { WearableHub } from './WearableHub';
import { AppleWatchAdapter } from './AppleWatchAdapter';
import { WearOSAdapter } from './WearOSAdapter';
import {
  SensorSample,
  WearableDevice,
} from '../../types/wearables';

const { RemusWatchBridge, RemusWearOSBridge } = NativeModules;

export const wearableHub = new WearableHub();

// Setup platform adapter
if (Platform.OS === 'ios') {
  let nativeBridgeWithEvents = RemusWatchBridge;
  if (RemusWatchBridge) {
    const emitter = new NativeEventEmitter(RemusWatchBridge);
    nativeBridgeWithEvents = {
      isSupported: () => RemusWatchBridge.isSupported(),
      isPaired: () => RemusWatchBridge.isPaired(),
      isWatchAppInstalled: () => RemusWatchBridge.isWatchAppInstalled(),
      isReachable: () => RemusWatchBridge.isReachable(),
      getLatestHeartRate: () => RemusWatchBridge.getLatestHeartRate(),
      sendMessage: (payload: Record<string, unknown>) =>
        RemusWatchBridge.sendMessage(payload),
      addListener: (event: string, cb: (data: unknown) => void) =>
        emitter.addListener(event, cb),
      removeListeners: (_count: number) => emitter.removeAllListeners('onWatchMessage'),
    };
  }

  const appleWatchAdapter = new AppleWatchAdapter(nativeBridgeWithEvents);
  wearableHub.registerAdapter(appleWatchAdapter);
} else if (Platform.OS === 'android') {
  let nativeBridgeWithEvents = RemusWearOSBridge;
  if (RemusWearOSBridge) {
    const emitter = new NativeEventEmitter(RemusWearOSBridge);
    nativeBridgeWithEvents = {
      isAvailable: () => RemusWearOSBridge.isAvailable(),
      getConnectedNodes: () => RemusWearOSBridge.getConnectedNodes(),
      getLatestHeartRate: () => RemusWearOSBridge.getLatestHeartRate(),
      sendMessage: (nodeId: string, payload: Record<string, unknown>) =>
        RemusWearOSBridge.sendMessage(nodeId, payload),
      addListener: (event: string, cb: (data: unknown) => void) =>
        emitter.addListener(event, cb),
      removeListeners: (_count: number) =>
        ['onWearOSMessage', 'onWearOSStateChanged'].forEach(event =>
          emitter.removeAllListeners(event),
        ),
    };
  }
  const wearOSAdapter = new WearOSAdapter(nativeBridgeWithEvents);
  wearableHub.registerAdapter(wearOSAdapter);
}

export function useWearables() {
  const [devices, setDevices] = useState<WearableDevice[]>([]);
  const [currentSample, setCurrentSample] = useState<SensorSample | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const sampleCount = useRef(0);

  useEffect(() => {
    let mounted = true;

    wearableHub.initialize().then(() => {
      if (!mounted) return;
      setIsInitialized(true);
      wearableHub.getAllConnectedDevices().then(devs => {
        if (mounted) setDevices(devs);
      });
    });

    const unsubSensor = wearableHub.onSensorData(sample => {
      sampleCount.current += 1;
      setCurrentSample(sample);
    });

    const unsubState = wearableHub.onDeviceStateChanged(() => {
      wearableHub.getAllConnectedDevices().then(devs => {
        if (mounted) setDevices(devs);
      });
    });

    return () => {
      mounted = false;
      unsubSensor();
      unsubState();
    };
  }, []);

  const startRecording = useCallback(async () => {
    setIsRecording(true);
    await wearableHub.startRecording();
  }, []);

  const stopRecording = useCallback(async () => {
    setIsRecording(false);
    await wearableHub.stopRecording();
  }, []);

  const sendPing = useCallback(async (deviceId?: string) => {
    const targetId = deviceId || devices[0]?.id;
    if (targetId) {
      return wearableHub.sendDataToDevice(targetId, { command: 'PING', timestamp: Date.now() });
    }
    return false;
  }, [devices]);

  return {
    isInitialized,
    devices,
    currentSample,
    isRecording,
    startRecording,
    stopRecording,
    sendPing,
  };
}

export * from '../../types/wearables';
export { WearableHub } from './WearableHub';
export { AppleWatchAdapter } from './AppleWatchAdapter';
export { WearOSAdapter } from './WearOSAdapter';
