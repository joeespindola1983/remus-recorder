import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { CaptureSourceState } from '../src/application/capture/ActivityCapture';
import { PhoneSensorBreakdown } from '../src/ui/molecules/PhoneSensorBreakdown';

describe('PhoneSensorBreakdown Molecule (TDD)', () => {
  const createPhoneSource = (overrides?: Partial<CaptureSourceState>): CaptureSourceState => ({
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
      batteryLevelPercent: 88,
      availableMeasurementIdentifiers: [
        'positionWgs84',
        'horizontalAccuracyMeters',
        'accelerationIncludingGravityG',
        'rotationRateRadiansPerSecond',
      ],
      liveTelemetryState: 'qualified',
    },
    ...overrides,
  });

  it('renders all three sensors as ready/available on a full iPhone with GPS accuracy', () => {
    const source = createPhoneSource({
      readiness: {
        sourceConnectionState: 'connected',
        batteryLevelPercent: 88,
        horizontalAccuracyMeters: 4,
        availableMeasurementIdentifiers: [
          'positionWgs84',
          'horizontalAccuracyMeters',
          'accelerationIncludingGravityG',
          'rotationRateRadiansPerSecond',
        ],
        liveTelemetryState: 'qualified',
      },
    });
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    act(() => {
      renderer = ReactTestRenderer.create(
        <PhoneSensorBreakdown source={source} />,
      );
    });

    const textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => node.props.children);

    expect(textNodes).toContain('Sensores do celular');
    expect(textNodes).toContain('GPS (GNSS)');
    expect(textNodes).toContain('Pronto (±4 m)');
    expect(textNodes).toContain('Acelerômetro');
    expect(textNodes).toContain('Disponível');
    expect(textNodes).toContain('Giroscópio');
  });

  it('explicitly displays non-supported gyroscope status on Android lacking gyro', () => {
    const source = createPhoneSource({
      deviceFamily: 'android_phone',
      readiness: {
        sourceConnectionState: 'connected',
        batteryLevelPercent: 75,
        availableMeasurementIdentifiers: [
          'positionWgs84',
          'accelerationIncludingGravityG',
        ],
        liveTelemetryState: 'qualified',
      },
    });

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <PhoneSensorBreakdown source={source} />,
      );
    });

    const textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => node.props.children);

    expect(textNodes).toContain('Não suportado');
    expect(
      textNodes.some(
        text =>
          typeof text === 'string' &&
          text.includes('Giroscópio não suportado no dispositivo'),
      ),
    ).toBe(true);
  });

  it('renders permission required notice and call to action when permissions are missing', () => {
    const onRequestPermissions = jest.fn();
    const source = createPhoneSource({
      readiness: {
        sourceConnectionState: 'connected',
        availableMeasurementIdentifiers: [
          'accelerationIncludingGravityG',
          'rotationRateRadiansPerSecond',
        ],
        liveTelemetryState: 'unavailable',
      },
    });

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <PhoneSensorBreakdown
          onRequestPermissions={onRequestPermissions}
          source={source}
        />,
      );
    });

    const textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => node.props.children);

    expect(textNodes).toContain('Permissão necessária');

    const button = renderer.root.findByProps({
      accessibilityLabel: 'Conceder permissões',
    });
    expect(button).toBeTruthy();

    act(() => {
      button.props.onPress();
    });
    expect(onRequestPermissions).toHaveBeenCalledTimes(1);
  });
});
