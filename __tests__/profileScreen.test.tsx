import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Alert} from 'react-native';
import {ProfileScreen} from '../src/ui/screens/ProfileScreen';

describe('ProfileScreen', () => {
  it('lists, exports and deletes recorded workouts', async () => {
    const service = {
      listRecordings: jest.fn().mockResolvedValue([{activityId: 'activity:1', status: 'finalized', startedAtEpochMilliseconds: 1726270000000, endedAtEpochMilliseconds: 1726270300000, durationSeconds: 300, sourceIds: ['phone:primary', 'rbp1:primary'], sampleCounts: {phoneMotion: 30}}]),
      exportRecording: jest.fn().mockResolvedValue({zipPath: '/tmp/a.zip', shared: true}),
      deleteRecording: jest.fn().mockResolvedValue(true),
    } as any;
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { renderer = ReactTestRenderer.create(<ProfileScreen service={service} />); });
    expect(renderer.root.findByProps({testID: 'workout-activity:1'})).toBeTruthy();
    await act(async () => renderer.root.findByProps({accessibilityLabel: 'Exportar'}).props.onPress());
    expect(service.exportRecording).toHaveBeenCalledWith('activity:1');
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => buttons?.[1]?.onPress?.());
    await act(async () => renderer.root.findByProps({accessibilityLabel: 'Excluir'}).props.onPress());
    expect(service.deleteRecording).toHaveBeenCalledWith('activity:1');
  });
});
