import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { CaptureSourceState } from '../src/application/capture/ActivityCapture';
import { DeviceReadinessPanel } from '../src/ui/organisms/DeviceReadinessPanel';

describe('DeviceReadinessPanel Organism (TDD)', () => {
  const phoneSource: CaptureSourceState = {
    sourceId: 'phone:primary',
    deviceFamily: 'iphone',
    sensorPlacement: 'body',
    placementProvenance: 'device_metadata',
    required: true,
    operationalState: 'available_idle',
    coverageSegments: [],
    capabilities: {
      liveTransfer: true,
      volatileResend: false,
      standaloneCapture: true,
      storeAndForward: true,
      postSyncDeletion: false,
      relayCapture: false,
    },
    clockDomains: [
      {
        clockDomainId: 'phone:monotonic',
        clockKind: 'monotonic',
        timestampUnit: 'us',
      },
    ],
    readiness: {
      sourceConnectionState: 'connected',
      batteryLevelPercent: 90,
      availableMeasurementIdentifiers: [
        'positionWgs84',
        'accelerationIncludingGravityG',
        'rotationRateRadiansPerSecond',
      ],
      liveTelemetryState: 'qualified',
    },
  };

  const bladeSource: CaptureSourceState = {
    sourceId: 'rbp1:demo',
    deviceFamily: 'remus_blade',
    sensorPlacement: 'paddle',
    placementProvenance: 'device_metadata',
    required: false,
    operationalState: 'available_idle',
    coverageSegments: [],
    capabilities: {
      liveTransfer: true,
      volatileResend: true,
      standaloneCapture: true,
      storeAndForward: true,
      postSyncDeletion: true,
      relayCapture: true,
    },
    clockDomains: [
      {
        clockDomainId: 'rbp1:monotonic',
        clockKind: 'monotonic',
        timestampUnit: 'us',
      },
    ],
    readiness: {
      sourceConnectionState: 'connected',
      batteryLevelPercent: 82,
      availableMeasurementIdentifiers: [
        'positionWgs84',
        'accelerationIncludingGravityG',
      ],
      liveTelemetryState: 'qualified',
    },
  };

  it('renders all available sources in the panel', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <DeviceReadinessPanel sources={[phoneSource, bladeSource]} />,
      );
    });

    const textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => node.props.children);

    expect(textNodes).toContain('Dispositivos disponíveis');
    expect(textNodes).toContain('Este iPhone');
    expect(textNodes).toContain('Remus Blade P1');
  });

  it('toggles phone sensor details when row is tapped', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <DeviceReadinessPanel sources={[phoneSource]} />,
      );
    });

    // Before click, sensor details are collapsed
    let textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => node.props.children);
    expect(textNodes).not.toContain('Sensores do celular');

    // Tap phone row to expand
    const phoneButton = renderer.root.findByProps({
      accessibilityLabel: 'Este iPhone',
    });
    act(() => {
      phoneButton.props.onPress();
    });

    // After click, sensor details are visible
    textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => node.props.children);
    expect(textNodes).toContain('Sensores do celular');
    expect(textNodes).toContain('GPS (GNSS)');
  });

  it('supports controlled expandedSourceIds prop', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <DeviceReadinessPanel
          expandedSourceIds={['phone:primary']}
          sources={[phoneSource]}
        />,
      );
    });

    const textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => node.props.children);
    expect(textNodes).toContain('Sensores do celular');
  });

  it('opens only the tapped device and closes others when another device is tapped', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <DeviceReadinessPanel sources={[phoneSource, bladeSource]} />
      );
    });

    // Tap iPhone row -> iPhone opens, Blade remains collapsed
    const phoneButton = renderer.root.findByProps({
      accessibilityLabel: 'Este iPhone',
    });
    act(() => {
      phoneButton.props.onPress();
    });

    let textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children ?? '')));

    expect(textNodes).toContain('Sensores do celular');
    expect(textNodes).not.toContain('IMU (Acelerômetro + Giroscópio)');

    // Tap Remus Blade row -> iPhone closes, Blade opens
    const bladeButton = renderer.root.findByProps({
      accessibilityLabel: 'Remus Blade P1',
    });
    act(() => {
      bladeButton.props.onPress();
    });

    textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children ?? '')));

    expect(textNodes).not.toContain('Sensores do celular');
    expect(textNodes).toContain('IMU (Acelerômetro + Giroscópio)');

    // Tap Remus Blade row again -> Blade closes
    act(() => {
      bladeButton.props.onPress();
    });

    textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children ?? '')));

    expect(textNodes).not.toContain('Sensores do celular');
    expect(textNodes).not.toContain('IMU (Acelerômetro + Giroscópio)');
  });
});
