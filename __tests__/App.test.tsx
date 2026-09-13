/**
 * @format
 */

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders a source-agnostic ready state', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  expect(
    renderer.root.findByProps({ accessibilityLabel: 'Iniciar atividade' }),
  ).toBeTruthy();
  expect(
    renderer.root.findAll(
      node =>
        node.type === Text && node.props.children === 'Tudo pronto para remar?',
    ),
  ).toHaveLength(1);
  expect(
    renderer.root.findAll(
      node =>
        node.type === Text &&
        node.props.children === 'Dispositivos disponíveis',
    ),
  ).toHaveLength(1);
  expect(
    renderer.root.findAll(
      node => node.type === Text && node.props.children === 'Remus Blade P1',
    ),
  ).toHaveLength(1);
  expect(
    renderer.root.findByProps({
      accessibilityLabel: 'Bateria 84%, nível normal',
    }),
  ).toBeTruthy();
  expect(
    renderer.root.findAll(
      node =>
        node.type === Text &&
        typeof node.props.children === 'string' &&
        node.props.children.includes('+1 h'),
    ),
  ).toHaveLength(0);
});

test('moves from ready through recording to a preserved summary', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: 'Iniciar atividade' })
      .props.onPress();
  });
  expect(
    renderer.root.findAll(
      node => node.type === Text && node.props.children === 'Atividade livre',
    ),
  ).toHaveLength(1);

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: 'Finalizar atividade' })
      .props.onPress();
  });
  expect(
    renderer.root.findAll(
      node =>
        node.type === Text && node.props.children === 'Atividade preservada',
    ),
  ).toHaveLength(1);
});

test('keeps recording without asking for a recovery decision when a source stops sending', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: 'Iniciar atividade' })
      .props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: 'Simular relógio sem bateria' })
      .props.onPress();
  });

  expect(
    renderer.root.findByProps({ accessibilityRole: 'alert' }),
  ).toBeTruthy();
  expect(
    renderer.root.findAll(
      node =>
        node.type === Text &&
        node.props.children === 'Conexão com Apple Watch perdida',
    ),
  ).toHaveLength(1);
  expect(
    renderer.root.findAll(
      node =>
        node.type === Text && node.props.children === 'Continuar treino',
    ),
  ).toHaveLength(0);
  expect(
    renderer.root.findByProps({ accessibilityLabel: 'Finalizar atividade' }),
  ).toBeTruthy();
});
