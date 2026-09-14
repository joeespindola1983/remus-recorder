import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { t } from '../src/i18n';
import { AppShell, NavigationTab } from '../src/ui/organisms/AppShell';

describe('AppShell Component (TDD)', () => {
  it('renders top bar, navigation items, and children content', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AppShell activeTab="home" onSelectTab={jest.fn()}>
          <Text>Mock Screen Content</Text>
        </AppShell>,
      );
    });

    const textNodes = renderer.root.findAllByType(Text);
    const textContents = textNodes.map(n => n.props.children);

    expect(textContents).toContain('Remus');
    expect(textContents).toContain('Home');
    expect(textContents).toContain('Activities');
    expect(textContents).toContain('Community');
    expect(textContents).toContain('Profile');
    expect(textContents).toContain('Mock Screen Content');
    expect(renderer.root.findByProps({ testID: 'nav-icon-home' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'nav-icon-activities' })).toBeTruthy();
  });

  it('triggers onSelectTab when a tab is pressed', async () => {
    const handleSelectTab = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AppShell activeTab="home" onSelectTab={handleSelectTab}>
          <Text>Content</Text>
        </AppShell>,
      );
    });

    const touchables = renderer.root.findAllByType(TouchableOpacity);
    const activitiesTab = touchables.find(touchable =>
      touchable.findAllByType(Text).some(n => n.props.children === 'Activities'),
    );

    expect(activitiesTab).toBeTruthy();
    await ReactTestRenderer.act(async () => {
      activitiesTab?.props.onPress();
    });
    expect(handleSelectTab).toHaveBeenCalledWith('activities' as NavigationTab);
  });

  it('does not render settings mark or light-dark icon in header', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <AppShell activeTab="home" onSelectTab={jest.fn()}>
          <Text>Content</Text>
        </AppShell>,
      );
    });

    const settingsButtons = renderer.root.findAllByProps({
      accessibilityLabel: t('nav.settings'),
    });
    expect(settingsButtons).toHaveLength(0);

    const sunIcons = renderer.root
      .findAllByType(Text)
      .filter(node => node.props.children === '☼');
    expect(sunIcons).toHaveLength(0);
  });
});
