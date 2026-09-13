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
    expect(t('ready.title')).toBe('Tudo pronto para remar?');
    expect(t('active.recording')).toBe('GRAVANDO');
    expect(t('sync.title')).toBe('Transferência e verificação');
    expect(t('association.title')).toBe('Onde entra esta gravação?');
    expect(t('summary.title')).toBe('Atividade preservada');
    expect(t('phone.sensor.gps')).toBe('GPS (GNSS)');
    expect(t('phone.sensor.gyroscopeMissing')).toBe('Giroscópio não suportado');
    expect(t('blade.title')).toBe('Remus Blade P1');
    expect(t('blade.connected')).toBe('Conectado via BLE');
  });

  it('should allow switching locale to en-US', () => {
    setLocale('en-US');
    expect(getLocale()).toBe('en-US');
    expect(t('appName')).toBe('Remus Recorder');
    expect(t('sensors.gps')).toBe('GNSS position');
    expect(t('sensors.heartRate')).toBe('Heart Rate');
    expect(t('wearables.statusConnected')).toBe('Connected');
    expect(t('ready.title')).toBe('Ready to row?');
    expect(t('active.recording')).toBe('RECORDING');
    expect(t('sync.title')).toBe('Transfer and verification');
    expect(t('association.title')).toBe('Where does this recording belong?');
    expect(t('summary.title')).toBe('Activity preserved');
    expect(t('phone.sensor.gps')).toBe('GPS (GNSS)');
    expect(t('phone.sensor.gyroscopeMissing')).toBe('Gyroscope not supported');
    expect(t('blade.title')).toBe('Remus Blade P1');
    expect(t('blade.connected')).toBe('Connected via BLE');
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
