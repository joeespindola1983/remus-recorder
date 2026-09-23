import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { createDemoActivityCapture } from '../src/application/capture/demoSources';
import {
  SourceCoverageLane,
  SourceCoverageTimeline,
} from '../src/ui/organisms/SourceCoverageTimeline';
import { SummaryScreen } from '../src/ui/screens/RecorderScreens';

describe('Flow 07: Source Coverage Timeline and Summary Enhancement (TDD)', () => {
  const mockLanes: SourceCoverageLane[] = [
    {
      sourceId: 'remus_blade_p1',
      sourceName: 'RBP1',
      coverageSegments: [{ startRatio: 0, endRatio: 1 }],
      isInterrupted: false,
    },
    {
      sourceId: 'iphone',
      sourceName: 'iPhone',
      coverageSegments: [
        { startRatio: 0, endRatio: 0.4 },
        { startRatio: 0.5, endRatio: 1 },
      ],
      isInterrupted: false,
    },
    {
      sourceId: 'apple_watch',
      sourceName: 'Watch',
      coverageSegments: [{ startRatio: 0, endRatio: 0.65 }],
      isInterrupted: true,
    },
  ];

  describe('SourceCoverageTimeline Organism', () => {
    it('renders timeline header, time bounds, lanes, and gap notice', async () => {
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SourceCoverageTimeline
            startTimeText="06:18"
            endTimeText="07:02"
            lanes={mockLanes}
          />,
        );
      });

      const textNodes = renderer.root.findAllByType(Text);
      const textContents = textNodes.map(n => n.props.children);

      expect(textContents).toContain('Cobertura das fontes');
      expect(textContents).toContain('06:18');
      expect(textContents).toContain('07:02');
      expect(textContents).toContain('RBP1');
      expect(textContents).toContain('iPhone');
      expect(textContents).toContain('Watch');
      expect(textContents).toContain(
        'Lacunas continuam visíveis; ausência não é zero.',
      );
    });
  });

  describe('SummaryScreen with SourceCoverageTimeline', () => {
    it('renders summary screen with timeline, analysis card, and view analysis action', async () => {
      const handleViewAnalysis = jest.fn();
      const state = createDemoActivityCapture();

      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SummaryScreen
            state={state}
            onViewAnalysis={handleViewAnalysis}
          />,
        );
      });

      const textNodes = renderer.root.findAllByType(Text);
      const textContents = textNodes.map(n => n.props.children);

      expect(textContents).toContain('ATIVIDADE FINALIZADA');
      expect(textContents).toContain('Atividade preservada');
      expect(textContents).toContain('Cobertura das fontes');
      expect(textContents).toContain('Análise pronta');
      expect(textContents).toContain(
        'RBP1 + iPhone · relógios alinhados com incerteza declarada',
      );

      const viewAnalysisButton = renderer.root.findByProps({
        accessibilityLabel: 'Ver análise',
      });
      expect(viewAnalysisButton).toBeTruthy();
      await ReactTestRenderer.act(async () => {
        viewAnalysisButton.props.onPress();
      });
      expect(handleViewAnalysis).toHaveBeenCalled();
    });
  });
});
