import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import {
  SyncPartProgress,
  SyncTransferItem,
} from '../src/ui/molecules/SyncPartProgress';
import { PendingArtifactTransferQueue } from '../src/ui/organisms/PendingArtifactTransferQueue';
import { ArtifactTransferCenterScreen } from '../src/ui/screens/ArtifactTransferCenterScreen';

describe('Flow 05: Artifact Transfer and Verification (TDD)', () => {
  const mockTransfers: SyncTransferItem[] = [
    {
      id: 'artifact-rbp1-001',
      sourceName: 'RBP1',
      status: 'transferring',
      progressPercent: 68,
      detail: 'IMU 3/5 · 68%',
    },
    {
      id: 'artifact-watch-002',
      sourceName: 'Apple Watch',
      status: 'paused',
      progressPercent: 52,
      detail: 'Faltam 2 blocos · tentar novamente',
    },
  ];

  describe('SyncPartProgress Molecule', () => {
    it('renders transferring state with progress and details', async () => {
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SyncPartProgress item={mockTransfers[0]} />,
        );
      });

      const textNodes = renderer.root.findAllByType(Text);
      const textContents = textNodes.map(n => n.props.children);
      expect(textContents).toContain('Transferindo');
      expect(textContents).toContain('68%');
      expect(textContents).toContain('IMU 3/5 · 68%');
    });

    it('renders paused state and fires retry on press', async () => {
      const handleRetry = jest.fn();
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SyncPartProgress item={mockTransfers[1]} onRetry={handleRetry} />,
        );
      });

      const textNodes = renderer.root.findAllByType(Text);
      const textContents = textNodes.map(n => n.props.children);
      expect(textContents).toContain('Transferência pausada');
      expect(textContents).toContain('52%');

      const retryBtn = renderer.root.findByType(TouchableOpacity);
      await ReactTestRenderer.act(async () => {
        retryBtn.props.onPress();
      });
      expect(handleRetry).toHaveBeenCalledWith('artifact-watch-002');
    });
  });

  describe('PendingArtifactTransferQueue Organism', () => {
    it('renders queue header, count, and items', async () => {
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <PendingArtifactTransferQueue transfers={mockTransfers} />,
        );
      });

      const textNodes = renderer.root.findAllByType(Text);
      const textContents = textNodes.map(n => n.props.children);
      expect(textContents).toContain('Transferências de gravações');
      expect(textContents).toContain('2 pendentes');
      expect(textContents).toContain('IMU 3/5 · 68%');
    });
  });

  describe('ArtifactTransferCenterScreen', () => {
    it('renders full screen with header, queue, and deletion safety rule', async () => {
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <ArtifactTransferCenterScreen transfers={mockTransfers} />,
        );
      });

      const textNodes = renderer.root.findAllByType(Text);
      const textContents = textNodes.map(n => n.props.children);
      expect(textContents).toContain('STORE & FORWARD');
      expect(textContents).toContain('Transferência e verificação');
      expect(textContents).toContain(
        'Transferência, verificação e exclusão são estados separados.',
      );
      expect(textContents).toContain('No RBP1 após verificar');
      expect(textContents).toContain(
        'Excluir somente o artefato confirmado por ID, tamanho e SHA-256.',
      );
    });
  });
});
