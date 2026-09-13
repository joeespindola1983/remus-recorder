import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import {
  ActivityCandidate,
  ActivityMatchCard,
} from '../src/ui/molecules/ActivityMatchCard';
import { RecordingRangeControl } from '../src/ui/molecules/RecordingRangeControl';
import { RecordingReconciliationPanel } from '../src/ui/organisms/RecordingReconciliationPanel';
import { RecordingAssociationScreen } from '../src/ui/screens/RecordingAssociationScreen';

describe('Flow 06: Recording Association and Reconciliation (TDD)', () => {
  const mockCandidate: ActivityCandidate = {
    id: 'activity-today-01',
    title: 'Atividade de remo · Hoje, 06:14',
    matchDetail: 'Sobreposição de 42 min · mesma rota',
    isSuggested: true,
  };

  describe('ActivityMatchCard Molecule', () => {
    it('renders candidate details, suggested badge, and caveat', async () => {
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <ActivityMatchCard
            candidate={mockCandidate}
            selected={true}
            onSelect={jest.fn()}
          />,
        );
      });

      const textNodes = renderer.root.findAllByType(Text);
      const textContents = textNodes.map(n => n.props.children);
      expect(textContents).toContain('Atividade de remo · Hoje, 06:14');
      expect(textContents).toContain('Sugerido');
      expect(textContents).toContain('Sobreposição de 42 min · mesma rota');
      expect(textContents).toContain('A sugestão não confirma a associação.');
    });

    it('handles press to select', async () => {
      const handleSelect = jest.fn();
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <ActivityMatchCard
            candidate={mockCandidate}
            selected={false}
            onSelect={handleSelect}
          />,
        );
      });

      const cardTouchable = renderer.root.findByType(TouchableOpacity);
      await ReactTestRenderer.act(async () => {
        cardTouchable.props.onPress();
      });
      expect(handleSelect).toHaveBeenCalledWith('activity-today-01');
    });
  });

  describe('RecordingRangeControl Molecule', () => {
    it('renders range header, recommended badge, and interval text', async () => {
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <RecordingRangeControl
            label="A partir do início no celular"
            intervalText="06:18–07:02 · 44 min"
            isRecommended={true}
          />,
        );
      });

      const textNodes = renderer.root.findAllByType(Text);
      const textContents = textNodes.map(n => n.props.children);
      expect(textContents).toContain('A partir do início no celular');
      expect(textContents).toContain('Recomendado');
      expect(textContents).toContain('06:18–07:02 · 44 min');
    });
  });

  describe('RecordingReconciliationPanel Organism', () => {
    it('renders reconciliation panel with candidate and range controls', async () => {
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <RecordingReconciliationPanel
            recordingTitle="Associar gravação do RBP1"
            recordingBoundsText="Gravação local · 05:58–07:02"
            rangeLabel="A partir do início no celular"
            rangeIntervalText="06:18–07:02 · 44 min"
            candidate={mockCandidate}
            selectedCandidateId="activity-today-01"
            onSelectCandidate={jest.fn()}
          />,
        );
      });

      const textNodes = renderer.root.findAllByType(Text);
      const textContents = textNodes.map(n => n.props.children);
      expect(textContents).toContain('Associar gravação do RBP1');
      expect(textContents).toContain('Gravação local · 05:58–07:02');
      expect(textContents).toContain('Atividade de remo · Hoje, 06:14');
    });
  });

  describe('RecordingAssociationScreen', () => {
    it('renders full screen with actions and handles confirm / defer', async () => {
      const handleConfirm = jest.fn();
      const handleDefer = jest.fn();

      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <RecordingAssociationScreen
            candidate={mockCandidate}
            onConfirm={handleConfirm}
            onDefer={handleDefer}
          />,
        );
      });

      const textNodes = renderer.root.findAllByType(Text);
      const textContents = textNodes.map(n => n.props.children);
      expect(textContents).toContain('RECONCILIAÇÃO');
      expect(textContents).toContain('Onde entra esta gravação?');
      expect(textContents).toContain(
        'O RBP1 começou antes do celular. Nada será mesclado sem confirmação.',
      );
      expect(textContents).toContain('Confirmar associação');
      expect(textContents).toContain('Decidir depois');

      const confirmButton = renderer.root.findByProps({
        accessibilityLabel: 'Confirmar associação',
      });
      expect(confirmButton).toBeTruthy();
      await ReactTestRenderer.act(async () => {
        confirmButton.props.onPress();
      });
      expect(handleConfirm).toHaveBeenCalled();

      // Find defer button and click
      const deferButton = renderer.root
        .findAllByType(TouchableOpacity)
        .find(t =>
          t
            .findAllByType(Text)
            .some(n => n.props.children === 'Decidir depois'),
        );
      expect(deferButton).toBeTruthy();
      await ReactTestRenderer.act(async () => {
        deferButton?.props.onPress();
      });
      expect(handleDefer).toHaveBeenCalled();
    });
  });
});
