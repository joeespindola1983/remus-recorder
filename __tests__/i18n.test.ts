import { t, setLocale, getLocale, translations } from '../src/i18n';

describe('i18n Module (TDD)', () => {
  beforeEach(() => {
    setLocale('pt-BR');
  });

  it('should default to pt-BR locale', () => {
    expect(getLocale()).toBe('pt-BR');
  });

  it('should translate keys correctly in pt-BR', () => {
    expect(t('appName')).toBe('Remus Recorder');
    expect(t('sensors.gps')).toBe('Posição GNSS');
    expect(t('sensors.heartRate')).toBe('Frequência Cardíaca');
    expect(t('wearables.statusConnected')).toBe('Conectado');
  });

  it('should allow switching locale to en-US', () => {
    setLocale('en-US');
    expect(getLocale()).toBe('en-US');
    expect(t('appName')).toBe('Remus Recorder');
    expect(t('sensors.gps')).toBe('GNSS position');
    expect(t('sensors.heartRate')).toBe('Heart Rate');
    expect(t('wearables.statusConnected')).toBe('Connected');
  });

  it('should fallback gracefully for unknown keys', () => {
    expect(t('unknown.key' as any)).toBe('unknown.key');
  });

  it('should have parity between pt-BR and en-US keys', () => {
    const ptKeys = Object.keys(translations['pt-BR']).sort();
    const enKeys = Object.keys(translations['en-US']).sort();
    expect(ptKeys).toEqual(enKeys);
  });
});
