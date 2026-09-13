export type Locale = 'pt-BR' | 'en-US';

export const translations = {
  'pt-BR': {
    appName: 'Remus Recorder',
    'app.subtitle': 'Gravador de evidências de remo e Va\'a',
    'telemetry.title': 'Posição e telemetria',
    'sensors.gps': 'Posição GNSS',
    'sensors.heartRate': 'Frequência Cardíaca',
    'sensors.accelerationIncludingGravity': 'Aceleração com gravidade',
    'sensors.rotationRate': 'Velocidade angular',
    'sensors.groundSpeed': 'Velocidade sobre o solo',
    'sensors.altitude': 'Altitude',
    'sensors.horizontalAccuracy': 'Precisão horizontal',
    'sensors.bpm': 'BPM',
    'sensors.latitude': 'Latitude',
    'sensors.longitude': 'Longitude',
    'sensors.noData': 'Aguardando dados dos sensores...',
    'wearables.title': 'Dispositivos & Wearables',
    'wearables.statusConnected': 'Conectado',
    'wearables.statusDisconnected': 'Desconectado',
    'wearables.statusConnecting': 'Conectando...',
    'wearables.appleWatch': 'Apple Watch',
    'wearables.wearOS': 'Wear OS (Android)',
    'wearables.sendPing': 'Enviar Sinal de Teste',
    'wearables.listening': 'Ouvindo dados do dispositivo',
    'permissions.title': 'Permissões Necessárias',
    'permissions.location': 'Localização (GPS)',
    'permissions.backgroundLocation': 'Localização em Segundo Plano',
    'permissions.sensors': 'Sensores Corporais & Movimento',
    'permissions.granted': 'Concedida',
    'permissions.denied': 'Negada',
    'permissions.request': 'Solicitar Permissões',
    'actions.startRecording': 'Iniciar Gravação',
    'actions.stopRecording': 'Parar Gravação',
    'actions.recording': 'Gravando...',
    'actions.idle': 'Pronto',
  },
  'en-US': {
    appName: 'Remus Recorder',
    'app.subtitle': 'Rowing and Va\'a evidence recorder',
    'telemetry.title': 'Position and telemetry',
    'sensors.gps': 'GNSS position',
    'sensors.heartRate': 'Heart Rate',
    'sensors.accelerationIncludingGravity': 'Acceleration including gravity',
    'sensors.rotationRate': 'Rotation rate',
    'sensors.groundSpeed': 'Ground speed',
    'sensors.altitude': 'Altitude',
    'sensors.horizontalAccuracy': 'Horizontal accuracy',
    'sensors.bpm': 'BPM',
    'sensors.latitude': 'Latitude',
    'sensors.longitude': 'Longitude',
    'sensors.noData': 'Waiting for sensor data...',
    'wearables.title': 'Devices & Wearables',
    'wearables.statusConnected': 'Connected',
    'wearables.statusDisconnected': 'Disconnected',
    'wearables.statusConnecting': 'Connecting...',
    'wearables.appleWatch': 'Apple Watch',
    'wearables.wearOS': 'Wear OS (Android)',
    'wearables.sendPing': 'Send Test Ping',
    'wearables.listening': 'Listening to device data',
    'permissions.title': 'Required Permissions',
    'permissions.location': 'Location (GPS)',
    'permissions.backgroundLocation': 'Background Location',
    'permissions.sensors': 'Body & Motion Sensors',
    'permissions.granted': 'Granted',
    'permissions.denied': 'Denied',
    'permissions.request': 'Request Permissions',
    'actions.startRecording': 'Start Recording',
    'actions.stopRecording': 'Stop Recording',
    'actions.recording': 'Recording...',
    'actions.idle': 'Ready',
  },
};

export type TranslationKey = keyof typeof translations['pt-BR'];

let currentLocale: Locale = 'pt-BR';

export const setLocale = (locale: Locale): void => {
  currentLocale = locale;
};

export const getLocale = (): Locale => {
  return currentLocale;
};

export const t = (key: TranslationKey): string => {
  const dictionary = translations[currentLocale] || translations['pt-BR'];
  return (dictionary as Record<string, string>)[key] || key;
};
