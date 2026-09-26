import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { LiveBladeParityCell } from '../src/ui/molecules/LiveBladeParityCell';
import { RemusBladeManager } from '../src/services/blade/RemusBladeManager';
import { SensorSample } from '../src/types/wearables';
import { SensorPlacement } from '../src/contracts/acquisition/types';

describe('LiveBladeParityCell (TDD)', () => {
  it('renders default empty parity state when no bladeManager is provided', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <LiveBladeParityCell valueFontSize={48} />,
      );
    });

    const valueNode = renderer.root.findByProps({
      testID: 'metric-value-parityPercentage',
    });
    expect(valueNode.props.children).toBe('—');
  });

  it('updates parity percentage and renders chart points when left and right blade samples arrive', () => {
    let sensorDataListener: ((sample: SensorSample, placement?: SensorPlacement) => void) | null = null;
    const mockBladeManager: Partial<RemusBladeManager> = {
      onSensorData: jest.fn((listener) => {
        sensorDataListener = listener;
        return () => {
          sensorDataListener = null;
        };
      }),
    };

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <LiveBladeParityCell
          bladeManager={mockBladeManager as RemusBladeManager}
          valueFontSize={48}
        />,
      );
    });

    expect(mockBladeManager.onSensorData).toHaveBeenCalled();

    // Emit Left sample: rotation 2.0 rad/s
    ReactTestRenderer.act(() => {
      sensorDataListener?.({
        deviceId: 'bld-l',
        deviceFamily: 'remus_blade',
        nativeTimestamp: 1000,
        rotationRateRadiansPerSecond: { x: 0, y: 0, z: 2.0 },
      }, 'left_paddle');
    });

    // Emit Right sample: inverted orientation, raw is -1.8 rad/s, normalized becomes +1.8 rad/s
    // 1.8 / 2.0 = 90% parity!
    ReactTestRenderer.act(() => {
      sensorDataListener?.({
        deviceId: 'bld-r',
        deviceFamily: 'remus_blade',
        nativeTimestamp: 1010,
        rotationRateRadiansPerSecond: { x: 0, y: 0, z: -1.8 },
      }, 'right_paddle');
    });

    const valueNode = renderer.root.findByProps({
      testID: 'metric-value-parityPercentage',
    });
    expect(valueNode.props.children).toBe('90');

    // Mini graph container exists
    const graphNode = renderer.root.findByProps({
      testID: 'blade-parity-graph',
    });
    expect(graphNode).toBeTruthy();
  });
});
