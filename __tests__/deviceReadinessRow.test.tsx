import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { CaptureSourceState } from '../src/application/capture/ActivityCapture';
import { DeviceReadinessRow } from '../src/ui/molecules/DeviceReadinessRow';

describe('DeviceReadinessRow Molecule (TDD)', () => {
  const createSource = (overrides?: Partial<CaptureSourceState>): CaptureSourceState => ({
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
    ...overrides,
  });

  it('renders standard source information when collapsed', () => {
    const source = createSource();
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    act(() => {
      renderer = ReactTestRenderer.create(
        <DeviceReadinessRow isExpanded={false} source={source} />,
      );
    });

    const textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => node.props.children);

    expect(textNodes).toContain('Este iPhone');
    expect(textNodes).toContain('GPS pronto · Movimento disponível');
    expect(textNodes).toContain('90%');
  });

  it('renders PhoneSensorBreakdown when expanded', () => {
    const source = createSource();
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    act(() => {
      renderer = ReactTestRenderer.create(
        <DeviceReadinessRow isExpanded={true} source={source} />,
      );
    });

    const textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => node.props.children);

    expect(textNodes).toContain('Sensores do celular');
    expect(textNodes).toContain('GPS (GNSS)');
    expect(textNodes).toContain('Acelerômetro');
    expect(textNodes).toContain('Giroscópio');
  });

  it('calls onToggleExpand when the phone row header is tapped', () => {
    const onToggleExpand = jest.fn();
    const source = createSource();
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    act(() => {
      renderer = ReactTestRenderer.create(
        <DeviceReadinessRow
          isExpanded={false}
          onToggleExpand={onToggleExpand}
          source={source}
        />,
      );
    });

    const touchable = renderer.root.findByProps({
      accessibilityRole: 'button',
    });
    expect(touchable).toBeTruthy();

    act(() => {
      touchable.props.onPress();
    });
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it('renders RemusBladeBreakdown when a remus_blade source is expanded', () => {
    const bladeSource: CaptureSourceState = {
      sourceId: 'rbp1:primary',
      deviceFamily: 'remus_blade',
      deviceModel: 'rbp1',
      operationalState: 'available_idle',
      sensorPlacement: 'paddle',
      placementProvenance: 'device_metadata',
      capabilities: {
        liveTransfer: true,
        volatileResend: true,
        standaloneCapture: true,
        storeAndForward: true,
        postSyncDeletion: false,
        relayCapture: false,
      },
      clockDomains: [],
      required: false,
      coverageSegments: [],
      readiness: {
        sourceConnectionState: 'connected',
        availableMeasurementIdentifiers: [
          'accelerationIncludingGravityG',
          'rotationRateRadiansPerSecond',
          'positionWgs84',
          'horizontalAccuracyMeters',
        ],
        horizontalAccuracyMeters: 3.2,
        liveTelemetryState: 'qualified',
      },
    };

    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <DeviceReadinessRow
          source={bladeSource}
          isExpanded={true}
          onToggleExpand={jest.fn()}
        />
      );
    });

    const textNodes = renderer!.root
      .findAllByType('Text' as any)
      .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children ?? '')));

    expect(textNodes).toContain('Remus Blade P1');
    expect(textNodes).toContain('IMU (Acelerômetro + Giroscópio)');
    expect(textNodes).toContain('GPS Multi-Constelação');
  });

  it('renders Remus Blade row in disconnected/offline state with grey indicator and offline detail text', () => {
    const bladeSource: CaptureSourceState = {
      sourceId: 'rbp1:primary',
      deviceFamily: 'remus_blade',
      deviceModel: 'rbp1',
      operationalState: 'unavailable',
      sensorPlacement: 'paddle',
      placementProvenance: 'device_metadata',
      capabilities: {
        liveTransfer: true,
        volatileResend: true,
        standaloneCapture: true,
        storeAndForward: true,
        postSyncDeletion: false,
        relayCapture: false,
      },
      clockDomains: [],
      required: false,
      coverageSegments: [],
      readiness: {
        sourceConnectionState: 'unavailable',
        availableMeasurementIdentifiers: [],
        liveTelemetryState: 'unavailable',
      },
    };

    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <DeviceReadinessRow
          source={bladeSource}
          isExpanded={false}
        />
      );
    });

    const textNodes = renderer!.root
      .findAllByType('Text' as any)
      .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children ?? '')));

    expect(textNodes).toContain('Remus Blade P1');
    expect(textNodes).toContain('Buscando automaticamente...');

    const statusView = renderer!.root.findByProps({
      accessibilityLabel: 'Indisponível',
    });
    expect(statusView).toBeTruthy();
  });

  it('does not present a detected Blade as connected', () => {
    const bladeSource = createSource({
      deviceFamily: 'remus_blade',
      operationalState: 'unavailable',
      readiness: {
        sourceConnectionState: 'detected',
        availableMeasurementIdentifiers: [],
        liveTelemetryState: 'evaluation_pending',
      },
    });
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    act(() => {
      renderer = ReactTestRenderer.create(
        <DeviceReadinessRow source={bladeSource} />,
      );
    });

    expect(renderer.root.findByProps({accessibilityLabel: 'Indisponível'})).toBeTruthy();
    expect(renderer.root.findAllByProps({accessibilityLabel: 'Disponível'})).toHaveLength(0);
  });
});
