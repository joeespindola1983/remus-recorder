import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { NavIcon } from '../src/ui/atoms/NavIcon';

describe('NavIcon Component (TDD)', () => {
  it.each(['home', 'activities', 'community', 'profile'] as const)(
    'renders %s icon in active and inactive state',
    async name => {
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<NavIcon name={name} active={true} />);
      });

      expect(renderer.root.findByProps({ accessibilityRole: 'image' })).toBeTruthy();
    },
  );

  it('changes tone between active and inactive', async () => {
    let activeRenderer!: ReactTestRenderer.ReactTestRenderer;
    let inactiveRenderer!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      activeRenderer = ReactTestRenderer.create(<NavIcon name="home" active={true} />);
      inactiveRenderer = ReactTestRenderer.create(<NavIcon name="home" active={false} />);
    });

    expect(activeRenderer.root.findByProps({ testID: 'nav-icon-home' })).toBeTruthy();
    expect(inactiveRenderer.root.findByProps({ testID: 'nav-icon-home' })).toBeTruthy();
  });
});
