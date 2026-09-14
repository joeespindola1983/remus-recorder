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

  it('omits sources that did not record from timeline lanes', () => {
    const state = createFinishedState();
    // Phone was participating
    state.sources['phone:primary'].recordingId = 'rec:phone:1';
    state.sources['phone:primary'].recordingState = 'finalized';

    // Watch was offline and did not participate
    state.sources['watch:apple:primary'] = {
      sourceId: 'watch:apple:primary',
      deviceFamily: 'apple_watch',
      sensorPlacement: 'left_wrist',
      placementProvenance: 'user_declared',
      required: false,
      operationalState: 'unavailable',
      coverageSegments: [],
      capabilities: {
        liveTransfer: true,
        volatileResend: false,
        standaloneCapture: false,
        storeAndForward: false,
        postSyncDeletion: false,
        relayCapture: false,
      },
      clockDomains: [],
      readiness: {
        sourceConnectionState: 'unavailable',
        availableMeasurementIdentifiers: [],
        liveTelemetryState: 'unavailable',
      },
    };

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<SummaryScreen state={state} />);
    });

    const timeline = renderer.root.findByProps({
      testID: 'source-coverage-timeline',
    });
    // The timeline lanes should only contain phone, not the offline watch!
    expect(timeline.props.lanes.map((l: any) => l.sourceId)).toEqual(['phone:primary']);
  });

  it('displays real recorded sample counts and export button when provided', () => {
    const state = createFinishedState();
    const onExport = jest.fn();
    const lastManifest = {
      activityId: 'activity:123',
      activityCorrelationId: 'corr:123',
      recordingIdsBySource: {'phone:primary': 'rec:1'},
      artifactDirectory: '/evidence/activity-123',
      status: 'finalized' as const,
      startedAtEpochMilliseconds: 1726270000000,
      endedAtEpochMilliseconds: 1726270300000,
      sampleCounts: {
        phoneMotion: 30000,
        phoneLocation: 300,
        watchHeartRate: 0,
        remusBladeLive: 0,
      },
    };

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <SummaryScreen
          lastManifest={lastManifest}
          onExport={onExport}
          state={state}
        />,
      );
    });

    const textNodes = renderer.root
      .findAllByType('Text' as any)
      .map(node => node.props.children);

    expect(textNodes).toContain('Evidências salvas em disco');
    expect(textNodes.some(t => typeof t === 'string' && t.includes('30000'))).toBe(true);
    expect(textNodes.some(t => typeof t === 'string' && t.includes('300'))).toBe(true);

    const exportBtn = renderer.root.findByProps({
      accessibilityLabel: 'Exportar evidência (.zip)',
    });
    expect(exportBtn).toBeTruthy();
    act(() => {
      exportBtn.props.onPress();
    });
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
