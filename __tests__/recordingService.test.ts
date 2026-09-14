import {NativeEventEmitter} from 'react-native';
import {
  NativeRecordingBridge,
  RecordingService,
} from '../src/services/recording/RecordingService';

jest.mock('react-native', () => ({
  NativeModules: {},
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn(() => ({remove: jest.fn()})),
  })),
}));

describe('RecordingService', () => {
  it('starts one central activity with distinct source recording identities', async () => {
    const bridge: NativeRecordingBridge = {
      startRecording: jest.fn().mockResolvedValue({
        activityId: 'activity:1',
        activityCorrelationId: 'correlation:1',
        recordingIdsBySource: {
          'phone:primary': 'recording:phone:1',
          'watch:apple:primary': 'recording:watch:1',
          'rbp1:primary': 'recording:blade:1',
        },
        artifactDirectory: '/evidence/activity-1',
      }),
      stopRecording: jest.fn(),
      getRecordingState: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    const service = new RecordingService(bridge);

    const started = await service.start([
      'phone:primary',
      'watch:apple:primary',
      'rbp1:primary',
    ]);

    expect(bridge.startRecording).toHaveBeenCalledWith({
      sourceIds: ['phone:primary', 'watch:apple:primary', 'rbp1:primary'],
    });
    expect(new Set(Object.values(started.recordingIdsBySource)).size).toBe(3);
  });

  it('fails honestly when the native durable recorder is unavailable', async () => {
    const service = new RecordingService();
    await expect(service.start(['phone:primary'])).rejects.toThrow(
      'Native recording is unavailable',
    );
  });

  it('forwards bounded native recording projections', () => {
    const addListener = jest.fn(() => ({remove: jest.fn()}));
    const bridge: NativeRecordingBridge = {
      startRecording: jest.fn(),
      stopRecording: jest.fn(),
      getRecordingState: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    (NativeEventEmitter as jest.Mock).mockImplementationOnce(() => ({addListener}));
    const service = new RecordingService(bridge);
    const listener = jest.fn();

    service.onUpdate(listener);

    expect(addListener).toHaveBeenCalledWith(
      'onRecordingUpdate',
      expect.any(Function),
    );
  });

  it('exports recording activity as a zip archive', async () => {
    const bridge: NativeRecordingBridge = {
      startRecording: jest.fn(),
      stopRecording: jest.fn(),
      getRecordingState: jest.fn(),
      exportRecording: jest.fn().mockResolvedValue({
        zipPath: '/Documents/RemusExport/activity-1.zip',
        shared: true,
      }),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    const service = new RecordingService(bridge);

    const result = await service.exportRecording('activity:1');
    expect(bridge.exportRecording).toHaveBeenCalledWith({activityId: 'activity:1'});
    expect(result.zipPath).toContain('activity-1.zip');
    expect(result.shared).toBe(true);
  });
});
