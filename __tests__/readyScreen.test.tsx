import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ActivityCaptureState, CaptureSourceState } from '../src/application/capture/ActivityCapture';
import { rbp1Source } from '../src/application/capture/demoSources';
import { ReadyScreen } from '../src/ui/screens/RecorderScreens';

describe('ReadyScreen (TDD)', () => {
  const createCaptureState = (phoneReadinessOverrides?: any): ActivityCaptureState => ({
    activityId: 'act:1',
    phase: 'ready',
    metrics: {
      elapsedSeconds: 0,
      distanceMeters: 0,
      strokeRateSpm: 0,
      heartRateBeatsPerMinute: 0,
      paceSecondsPer500Meters: 0,
    },
    sources: {
      'phone:primary': {
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
            'horizontalAccuracyMeters',
            'accelerationIncludingGravityG',
            'rotationRateRadiansPerSecond',
          ],
          liveTelemetryState: 'qualified',
          ...phoneReadinessOverrides,
        },
      },
    },
  });

  it('renders dynamic readiness summary card for full iPhone', () => {
    const onStart = jest.fn();
    const state = createCaptureState();
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    act(() => {
      renderer = ReactTestRenderer.create(
        <ReadyScreen onStart={onStart} state={state} />,
      );
    });

    const textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => node.props.children);

    expect(textNodes).toContain('Tudo pronto para remar?');
    expect(textNodes).toContain('GPS pronto · Movimento disponível');
  });

  it('displays degraded permissions warning when GPS is denied', () => {
    const onStart = jest.fn();
    const state = createCaptureState({
      sourceConnectionState: 'connected',
      availableMeasurementIdentifiers: [
        'accelerationIncludingGravityG',
        'rotationRateRadiansPerSecond',
      ],
      liveTelemetryState: 'unavailable',
    });

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <ReadyScreen onStart={onStart} state={state} />,
      );
    });

    const textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => node.props.children);

    expect(textNodes).toContain('Permissões necessárias');
    expect(textNodes).toContain('GPS necessário · Movimento disponível');
  });

  it('toggles device details when phone row is pressed and does not render details button', () => {
    const onStart = jest.fn();
    const state = createCaptureState();
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    act(() => {
      renderer = ReactTestRenderer.create(
        <ReadyScreen onStart={onStart} state={state} />,
      );
    });

    const legacyDetailsButtons = renderer.root.findAllByProps({
      accessibilityLabel: 'Ver detalhes dos dispositivos',
    });
    expect(legacyDetailsButtons).toHaveLength(0);

    const phoneButton = renderer.root.findByProps({
      accessibilityLabel: 'Este iPhone',
    });
    expect(phoneButton).toBeTruthy();

    act(() => {
      phoneButton.props.onPress();
    });

    const textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => node.props.children);

    expect(textNodes).toContain('Sensores do celular');
  });

  it('triggers onRequestPermissions when permission request is tapped', () => {
    const onStart = jest.fn();
    const onRequestPermissions = jest.fn();
    const state = createCaptureState({
      sourceConnectionState: 'connected',
      availableMeasurementIdentifiers: [
        'accelerationIncludingGravityG',
      ],
      liveTelemetryState: 'unavailable',
    });

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <ReadyScreen
          onRequestPermissions={onRequestPermissions}
          onStart={onStart}
          state={state}
        />,
      );
    });

    // Expand details via phone row
    const phoneButton = renderer.root.findByProps({
      accessibilityLabel: 'Este iPhone',
    });
    act(() => {
      phoneButton.props.onPress();
    });

    const grantButton = renderer.root.findByProps({
      accessibilityLabel: 'Conceder permissões',
    });
    expect(grantButton).toBeTruthy();

    act(() => {
      grantButton.props.onPress();
    });
    expect(onRequestPermissions).toHaveBeenCalledTimes(1);
  });

  it('renders Remus Blade P1 device in available devices list', () => {
    const baseState = createCaptureState();
    const bladeSource: CaptureSourceState = {
      ...rbp1Source,
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
    const customState: ActivityCaptureState = {
      ...baseState,
      sources: {
        ...baseState.sources,
        [rbp1Source.sourceId]: bladeSource,
      },
    };

    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <ReadyScreen state={customState} onStart={jest.fn()} />
      );
    });

    const textNodes = renderer!.root
      .findAllByType('Text' as any)
      .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children ?? '')));

    expect(textNodes).toContain('Remus Blade P1');
  });

  it('toggles only the selected device item and closes previously open item when another item is selected', () => {
    const baseState = createCaptureState();
    const bladeSource: CaptureSourceState = {
      ...rbp1Source,
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
    const customState: ActivityCaptureState = {
      ...baseState,
      sources: {
        ...baseState.sources,
        [rbp1Source.sourceId]: bladeSource,
      },
    };

    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <ReadyScreen state={customState} onStart={jest.fn()} />
      );
    });

    // Tap iPhone -> only iPhone opens
    const phoneButton = renderer!.root.findByProps({
      accessibilityLabel: 'Este iPhone',
    });
    act(() => {
      phoneButton.props.onPress();
    });

    let textNodes = renderer!.root
      .findAllByType('Text' as any)
      .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children ?? '')));

    expect(textNodes).toContain('Sensores do celular');
    expect(textNodes).not.toContain('IMU (Acelerômetro + Giroscópio)');

    // Tap Blade -> iPhone closes, Blade opens
    const bladeButton = renderer!.root.findByProps({
      accessibilityLabel: 'Remus Blade P1',
    });
    act(() => {
      bladeButton.props.onPress();
    });

    textNodes = renderer!.root
      .findAllByType('Text' as any)
      .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children ?? '')));

    expect(textNodes).not.toContain('Sensores do celular');
    expect(textNodes).toContain('IMU (Acelerômetro + Giroscópio)');

    // Tap Blade again -> Blade closes
    act(() => {
      bladeButton.props.onPress();
    });

    textNodes = renderer!.root
      .findAllByType('Text' as any)
      .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children ?? '')));

    expect(textNodes).not.toContain('Sensores do celular');
    expect(textNodes).not.toContain('IMU (Acelerômetro + Giroscópio)');
  });

  it('displays offline status in readiness card and device list when Remus Blade goes offline', () => {
    const baseState = createCaptureState();
    const bladeOfflineSource: CaptureSourceState = {
      ...rbp1Source,
      required: false,
      operationalState: 'unavailable',
      coverageSegments: [],
      readiness: {
        sourceConnectionState: 'unavailable',
        availableMeasurementIdentifiers: [],
        liveTelemetryState: 'unavailable',
      },
    };
    const offlineState: ActivityCaptureState = {
      ...baseState,
      sources: {
        ...baseState.sources,
        [rbp1Source.sourceId]: bladeOfflineSource,
      },
    };

    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <ReadyScreen
          state={offlineState}
          onStart={jest.fn()}
        />
      );
    });

    const textNodes = renderer!.root
      .findAllByType('Text' as any)
      .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children ?? '')));

    expect(textNodes).toContain('GPS pronto · Movimento disponível · Remus Blade offline');
    expect(textNodes).toContain('Buscando automaticamente...');
  });

  it('triggers onDisconnectBlade from blade breakdown inside ReadyScreen', () => {
    const onDisconnectBlade = jest.fn();
    const bladeSource: CaptureSourceState = {
      ...rbp1Source,
      required: false,
      coverageSegments: [],
      operationalState: 'available_idle',
      readiness: {
        sourceConnectionState: 'connected',
        liveTelemetryState: 'qualified',
        availableMeasurementIdentifiers: ['accelerationIncludingGravityG'],
      },
    };
    const base = createCaptureState();
    const customState: ActivityCaptureState = {
      ...base,
      sources: {
        ...base.sources,
        [rbp1Source.sourceId]: bladeSource,
      },
    };

    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <ReadyScreen
          onStart={jest.fn()}
          onRequestPermissions={jest.fn()}
          state={customState}
          onDisconnectBlade={onDisconnectBlade}
        />
      );
    });

    const bladeRow = renderer!.root.findByProps({ accessibilityLabel: 'Remus Blade P1' });
    act(() => {
      bladeRow.props.onPress();
    });

    const disconnectBtn = renderer!.root.findByProps({ testID: 'blade-disconnect-button' });
    expect(disconnectBtn).toBeTruthy();
    act(() => {
      disconnectBtn.props.onPress();
    });
    expect(onDisconnectBlade).toHaveBeenCalledTimes(1);
  });
});
