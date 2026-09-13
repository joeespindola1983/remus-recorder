import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { LiveCaptureMetrics } from '../src/application/capture/ActivityCapture';
import {
  AdaptiveCaptureSurface,
  captureOrientationFor,
} from '../src/ui/organisms/AdaptiveCaptureSurface';

const metrics: LiveCaptureMetrics = {
  elapsedSeconds: 2538,
  strokeRateSpm: 28,
  paceSecondsPer500Meters: 119,
  heartRateBeatsPerMinute: 154,
  distanceMeters: 8400,
};

describe('adaptive active capture surface', () => {
  it('chooses layout from the available viewport', () => {
    expect(captureOrientationFor(393, 852)).toBe('portrait');
    expect(captureOrientationFor(852, 393)).toBe('landscape');
    expect(captureOrientationFor(600, 600)).toBe('portrait');
  });

  it.each([
    ['portrait', 'row'],
    ['landscape', 'column'],
  ] as const)(
    'renders canonical metrics and %s controls',
    async (orientation, direction) => {
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <AdaptiveCaptureSurface
            metrics={metrics}
            onFinish={jest.fn()}
            onPause={jest.fn()}
            orientation={orientation}
          />,
        );
      });

      expect(
        renderer.root.findByProps({ accessibilityLabel: 'Pausar atividade' }),
      ).toBeTruthy();
      expect(
        renderer.root.findByProps({
          accessibilityLabel: 'Finalizar atividade',
        }),
      ).toBeTruthy();
      expect(
        StyleSheet.flatten(
          renderer.root.findByProps({ testID: 'capture-controls' }).props.style,
        ).flexDirection,
      ).toBe(direction);
      expect(
        renderer.root.findByProps({
          testID: 'metric-value-paceSecondsPer500Meters',
        }).props.children,
      ).toBe('01:59');
      expect(
        renderer.root.findByProps({ testID: 'metric-value-strokeRateSpm' })
          .props.adjustsFontSizeToFit,
      ).toBe(true);
      expect(
        renderer.root.findByProps({ testID: 'metric-value-strokeRateSpm' })
          .props.numberOfLines,
      ).toBe(1);
    },
  );

  it('renders unavailable observations without inventing zero', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AdaptiveCaptureSurface
          metrics={{ elapsedSeconds: 0 }}
          onFinish={jest.fn()}
          onPause={jest.fn()}
          orientation="portrait"
        />,
      );
    });

    expect(
      renderer.root.findByProps({ testID: 'metric-value-strokeRateSpm' }).props
        .children,
    ).toBe('—');
    expect(
      renderer.root.findByProps({ testID: 'metric-value-distanceMeters' }).props
        .children,
    ).toBe('—');
  });
});
