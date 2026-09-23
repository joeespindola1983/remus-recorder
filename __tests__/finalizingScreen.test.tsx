import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { createActivityCapture } from '../src/application/capture/demoSources';
import { FinalizingScreen } from '../src/ui/screens/RecorderScreens';

describe('FinalizingScreen (TDD)', () => {
  it('renders standard finalizing state when no blade download is active', () => {
    const capture = createActivityCapture();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <FinalizingScreen capture={capture} />,
      );
    });

    const textNodes = renderer!.root
      .findAllByType(Text)
      .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children ?? '')));

    expect(textNodes).toContain('Finalizando gravações');
  });

  it('renders blade high-frequency download progress when download is active', () => {
    const capture = createActivityCapture();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <FinalizingScreen
          capture={capture}
          bladeDownloadStatus={{
            isDownloading: true,
            progress: 45,
            receivedBytes: 90000,
            totalBytes: 200000,
          }}
        />,
      );
    });

    const textNodes = renderer!.root
      .findAllByType(Text)
      .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children ?? '')));

    expect(textNodes).toContain('Baixando dados de alta frequência da pá...');
    expect(textNodes.some(t => t.includes('45%'))).toBe(true);
  });
});
