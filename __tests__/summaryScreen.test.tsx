import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ActivityCaptureState } from '../src/application/capture/ActivityCapture';
import { SummaryScreen } from '../src/ui/screens/RecorderScreens';

describe('SummaryScreen Phone Evidence Declaration (TDD)', () => {
  const createFinishedState = (phoneReadinessOverrides?: any): ActivityCaptureState => ({
    activityId: 'act:summary:1',
    phase: 'completed',
    metrics: {
      elapsedSeconds: 2640,
      distanceMeters: 8000,
      strokeRateSpm: 24,
      heartRateBeatsPerMinute: 155,
      paceSecondsPer500Meters: 125,
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
          batteryLevelPercent: 80,
          availableMeasurementIdentifiers: [
            'positionWgs84',
            'accelerationIncludingGravityG',
            'rotationRateRadiansPerSecond',
          ],
          liveTelemetryState: 'qualified',
          ...phoneReadinessOverrides,
        },
      },
    },
  });

  it('declares phone sensors evidence for iPhone in the summary screen', () => {
    const state = createFinishedState();
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    act(() => {
      renderer = ReactTestRenderer.create(<SummaryScreen state={state} />);
    });

    const textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => node.props.children);

    expect(textNodes).toContain('Sensores registrados pelo celular');
    expect(textNodes).toContain('GPS (GNSS)');
    expect(textNodes).toContain('Acelerômetro');
    expect(textNodes).toContain('Giroscópio');
  });

  it('declares missing gyroscope caveat explicitly for Android without gyro in summary', () => {
    const state = createFinishedState({
      availableMeasurementIdentifiers: [
        'positionWgs84',
        'accelerationIncludingGravityG',
      ],
    });
    // Set deviceFamily to android_phone
    state.sources['phone:primary'].deviceFamily = 'android_phone';

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<SummaryScreen state={state} />);
    });

    const textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => node.props.children);

    expect(textNodes).toContain('GPS (GNSS)');
    expect(textNodes).toContain('Acelerômetro');
    expect(textNodes).not.toContain('Giroscópio');
    expect(
      textNodes.some(
        t => typeof t === 'string' && t.includes('Giroscópio não suportado'),
      ),
    ).toBe(true);
  });
});
