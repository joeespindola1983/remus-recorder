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

  it('renders blade GPS badge with GPS Fix and accuracy distance when locked', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AdaptiveCaptureSurface
          metrics={metrics}
          onFinish={jest.fn()}
          onPause={jest.fn()}
          orientation="portrait"
          bladeGpsStatus={{
            hasGpsLock: true,
            satsInUse: 8,
            satsInView: 10,
            maxSnrDbHz: 35,
            accuracyMeters: 3.2,
          }}
        />,
      );
    });

    const badge = renderer.root.findByProps({ testID: 'blade-gps-badge' });
    expect(badge).toBeTruthy();
    expect(badge.props.children.props.children).toBe('GPS Fix • ±3,2m');
  });

  it('renders blade GPS badge with Buscando sinal when searching with satellites', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AdaptiveCaptureSurface
          metrics={metrics}
          onFinish={jest.fn()}
          onPause={jest.fn()}
          orientation="portrait"
          bladeGpsStatus={{
            hasGpsLock: false,
            satsInUse: 0,
            satsInView: 4,
            maxSnrDbHz: 22,
          }}
        />,
      );
    });

    const badge = renderer.root.findByProps({ testID: 'blade-gps-badge' });
    expect(badge).toBeTruthy();
    expect(badge.props.children.props.children).toBe('Buscando sinal');
  });

  it('renders blade GPS badge with Sem sinal GPS when 0 sats and 0 SNR', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AdaptiveCaptureSurface
          metrics={metrics}
          onFinish={jest.fn()}
          onPause={jest.fn()}
          orientation="portrait"
          bladeGpsStatus={{
            hasGpsLock: false,
            satsInUse: 0,
            satsInView: 0,
            maxSnrDbHz: 0,
          }}
        />,
      );
    });

    const badge = renderer.root.findByProps({ testID: 'blade-gps-badge' });
    expect(badge).toBeTruthy();
    expect(badge.props.children.props.children).toBe('Sem sinal GPS');
  });

  it('suppresses pace when pace exceeds 625 seconds (speed < 0.8 m/s)', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AdaptiveCaptureSurface
          metrics={{ ...metrics, paceSecondsPer500Meters: 700 }}
          onFinish={jest.fn()}
          onPause={jest.fn()}
          orientation="portrait"
        />,
      );
    });

    expect(
      renderer.root.findByProps({
        testID: 'metric-value-paceSecondsPer500Meters',
      }).props.children,
    ).toBe('—');
  });

  it('adapts font size for multi-character pace vs stroke rate and renders values without clipping', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AdaptiveCaptureSurface
          metrics={{
            ...metrics,
            strokeRateSpm: 28,
            paceSecondsPer500Meters: 135,
          }}
          onFinish={jest.fn()}
          onPause={jest.fn()}
          orientation="portrait"
          viewportWidth={393}
        />,
      );
    });

    const spmNode = renderer.root.findByProps({
      testID: 'metric-value-strokeRateSpm',
    });
    const paceNode = renderer.root.findByProps({
      testID: 'metric-value-paceSecondsPer500Meters',
    });

    expect(spmNode.props.children).toBe('28');
    expect(paceNode.props.children).toBe('02:15');

    // Verify adaptive scaling: pace font size is scaled down compared to spm font size
    const spmStyle = Array.isArray(spmNode.props.style)
      ? Object.assign({}, ...spmNode.props.style)
      : spmNode.props.style;
    const paceStyle = Array.isArray(paceNode.props.style)
      ? Object.assign({}, ...paceNode.props.style)
      : paceNode.props.style;

    expect(paceStyle.fontSize).toBeLessThan(spmStyle.fontSize);
    // Line height must be undefined to avoid vertical clipping in UILabel
    expect(paceStyle.lineHeight).toBeUndefined();
    expect(spmStyle.lineHeight).toBeUndefined();
  });

  it('renders LiveBladeParityCell with parity metric and waveform container', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AdaptiveCaptureSurface
          metrics={metrics}
          onFinish={jest.fn()}
          onPause={jest.fn()}
          orientation="portrait"
        />,
      );
    });

    expect(
      renderer.root.findByProps({
        testID: 'metric-value-parityPercentage',
      }),
    ).toBeTruthy();
    expect(
      renderer.root.findByProps({
        testID: 'blade-parity-graph',
      }),
    ).toBeTruthy();
  });
});

