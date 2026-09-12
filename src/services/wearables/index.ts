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
      ...RemusWatchBridge,
      addListener: (event: string, cb: (data: unknown) => void) =>
        emitter.addListener(event, cb),
      removeListeners: (_count: number) => emitter.removeAllListeners('onWatchMessage'),
    };
  }

  const appleWatchAdapter = new AppleWatchAdapter(nativeBridgeWithEvents);
  wearableHub.registerAdapter(appleWatchAdapter);
} else if (Platform.OS === 'android') {
  const wearOSAdapter = new WearOSAdapter(RemusWearOSBridge);
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
    for (const dev of devices) {
      await wearableHub.sendDataToDevice(dev.id, { command: 'START_RECORD' });
    }
  }, [devices]);

  const stopRecording = useCallback(async () => {
    setIsRecording(false);
    for (const dev of devices) {
      await wearableHub.sendDataToDevice(dev.id, { command: 'STOP_RECORD' });
    }
  }, [devices]);

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
