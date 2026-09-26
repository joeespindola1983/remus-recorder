import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { RemusBladeBreakdown } from '../src/ui/molecules/RemusBladeBreakdown';
import { RemusBladeSnapshot } from '../src/services/blade/RemusBladeAdapter';
import { SourceReadinessSnapshot } from '../src/application/capture/ActivityCapture';

describe('RemusBladeBreakdown (TDD)', () => {
  const mockReadiness: SourceReadinessSnapshot = {
    sourceConnectionState: 'connected',
    availableMeasurementIdentifiers: [
      'accelerationIncludingGravityG',
      'rotationRateRadiansPerSecond',
      'positionWgs84',
      'horizontalAccuracyMeters',
    ],
    horizontalAccuracyMeters: 3.2,
    liveTelemetryState: 'qualified',
  };

  const mockSnapshot: RemusBladeSnapshot = {
    timestampMs: 124456,
    accelG: { x: 0.012, y: -0.045, z: 0.982 },
    gyroDps: { x: 1.2, y: -0.4, z: 0.15 },
    location: {
      latitude: -23.55052,
      longitude: -46.633308,
      groundSpeedMetersPerSecond: 2.36,
      horizontalAccuracyMeters: 3.2,
    },
    satsInUse: 6,
    satsInView: 10,
    maxSnrDbHz: 32,
    horizontalAccuracyMeters: 3.2,
    linesWritten: 120,
    charsRx: 480,
    liveSpm: 24.5,
  };

  it('renders all hardware channels with design system tokens', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <RemusBladeBreakdown
          readiness={mockReadiness}
          snapshot={mockSnapshot}
          connectionState="connected"
        />
      );
    });

    const textNodes = renderer!.root
      .findAllByType('Text' as any)
      .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children ?? '')));

    // IMU
    expect(textNodes).toContain('IMU (Acelerômetro + Giroscópio)');
    expect(textNodes).toContain('MPU-6050 a 200 Hz (±8g, ±500°/s)');

    // GPS
    expect(textNodes).toContain('GPS Multi-Constelação');
    expect(textNodes).toContain('Realtek REB-4126 (Fix 3D)');
    expect(textNodes).toContain('Precisão: ±3.2 m');
    expect(textNodes).toContain('6/10 satélites · SNR: 32 dB-Hz');

    // Edge SPM
    expect(textNodes).toContain('Taxa de remada (Edge SPM)');
    expect(textNodes).toContain('24.5 SPM (processado no sensor)');

    // MicroSD
    expect(textNodes).toContain('Cartão MicroSD');
    expect(textNodes).toContain('120 linhas gravadas (/remus_session.csv)');
  });

  it('renders waiting state when GPS fix and SPM are not ready', () => {
    const searchingSnapshot: RemusBladeSnapshot = {
      ...mockSnapshot,
      location: undefined,
      satsInUse: 0,
      satsInView: 4,
      maxSnrDbHz: 18,
      horizontalAccuracyMeters: undefined,
      liveSpm: undefined,
      linesWritten: 0,
    };

    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <RemusBladeBreakdown
          readiness={{
            ...mockReadiness,
            availableMeasurementIdentifiers: [
              'accelerationIncludingGravityG',
              'rotationRateRadiansPerSecond',
            ],
            horizontalAccuracyMeters: undefined,
          }}
          snapshot={searchingSnapshot}
          connectionState="connected"
        />
      );
    });

    const textNodes = renderer!.root
      .findAllByType('Text' as any)
      .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children ?? '')));

    expect(textNodes).toContain('Realtek REB-4126 (Buscando sinal)');
    expect(textNodes).toContain('0/4 satélites · SNR: 18 dB-Hz');
    expect(textNodes.some(t => t.includes('Precisão: ±'))).toBe(false);
    expect(textNodes).toContain('Aguardando remadas');
    expect(textNodes).toContain('Standby (pronto para gravar)');
  });

  it('renders disconnected state with offline warning badge', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <RemusBladeBreakdown
          readiness={{
            sourceConnectionState: 'unavailable',
            liveTelemetryState: 'unavailable',
            availableMeasurementIdentifiers: [],
          }}
          snapshot={null}
          connectionState="disconnected"
        />
      );
    });

    const textNodes = renderer!.root
      .findAllByType('Text' as any)
      .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children ?? '')));

    expect(textNodes).toContain('Buscando automaticamente...');
    expect(textNodes).not.toContain('Reconectar');

    const reconnectBtn = renderer!.root.findAllByProps({ testID: 'blade-reconnect-button' });
    expect(reconnectBtn.length).toBe(0);
  });

  it('renders disconnect button when connected and fires onDisconnect callback', () => {
    const onDisconnect = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <RemusBladeBreakdown
          readiness={mockReadiness}
          snapshot={mockSnapshot}
          connectionState="connected"
          onDisconnect={onDisconnect}
        />
      );
    });

    const disconnectBtn = renderer!.root.findByProps({ testID: 'blade-disconnect-button' });
    expect(disconnectBtn).toBeTruthy();
    const btnText = disconnectBtn.findByType('Text' as any).props.children;
    expect(btnText).toBe('Desconectar pá');

    act(() => {
      disconnectBtn.props.onPress();
    });
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps the connection action available after a Blade becomes unavailable', () => {
    const onConnect = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <RemusBladeBreakdown
          readiness={{
            sourceConnectionState: 'unavailable',
            liveTelemetryState: 'unavailable',
            availableMeasurementIdentifiers: [],
          }}
          snapshot={null}
          connectionState="disconnected"
          onConnect={onConnect}
        />
      );
    });

    const connectBtn = renderer!.root.findByProps({testID: 'blade-connect-button'});
    act(() => {
      connectBtn.props.onPress();
    });
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('renders detected state and connects only after an explicit tap', () => {
    const onConnect = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <RemusBladeBreakdown
          readiness={{sourceConnectionState: 'detected', liveTelemetryState: 'evaluation_pending', availableMeasurementIdentifiers: []}}
          snapshot={null}
          connectionState="detected"
          onConnect={onConnect}
        />,
      );
    });
    const labels = renderer!.root.findAllByType('Text' as any).map(node => node.props.children);
    expect(labels).toContain('Pá detectada');
    const connectBtn = renderer!.root.findByProps({testID: 'blade-connect-button'});

    act(() => {
      connectBtn.props.onPress();
    });
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('renders blade placement options and calls onSelectPlacement when tapped', () => {
    const onSelectPlacement = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <RemusBladeBreakdown
          readiness={mockReadiness}
          snapshot={mockSnapshot}
          connectionState="connected"
          placement="paddle"
          onSelectPlacement={onSelectPlacement}
        />,
      );
    });

    const leftPaddleBtn = renderer!.root.findByProps({testID: 'blade-placement-left'});
    const rightPaddleBtn = renderer!.root.findByProps({testID: 'blade-placement-right'});

    expect(leftPaddleBtn).toBeTruthy();
    expect(rightPaddleBtn).toBeTruthy();

    act(() => {
      leftPaddleBtn.props.onPress();
    });
    expect(onSelectPlacement).toHaveBeenCalledWith('left_paddle');

    act(() => {
      rightPaddleBtn.props.onPress();
    });
    expect(onSelectPlacement).toHaveBeenCalledWith('right_paddle');
  });

  it('does not render blade placement options when placement is hull (Remus Computer)', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <RemusBladeBreakdown
          readiness={mockReadiness}
          snapshot={mockSnapshot}
          connectionState="connected"
          placement="hull"
        />,
      );
    });

    expect(renderer!.root.findAllByProps({testID: 'blade-placement-left'})).toHaveLength(0);
    expect(renderer!.root.findAllByProps({testID: 'blade-placement-right'})).toHaveLength(0);
  });
});
