import type { HealthResponse } from '@omnidesk/contracts';

export type ComponentState = 'up' | 'degraded' | 'down' | 'unknown';
export type Overall = 'operational' | 'degraded' | 'down' | 'offline' | 'checking';
export type RealtimeState = 'live' | 'reconnecting' | 'connecting';

/** Por encima de esto el API responde, pero lento. */
export const SLOW_LATENCY_MS = 1_000;

export interface ComponentStatus {
  id: 'network' | 'api' | 'database' | 'realtime';
  name: string;
  description: string;
  state: ComponentState;
  /** Texto corto del estado ("Operativo", "Lento", "Caído"…). */
  stateLabel: string;
  /** Dato extra a la derecha (latencia, versión…). */
  detail: string | null;
}

export interface SystemStatus {
  overall: Overall;
  title: string;
  description: string;
  components: ComponentStatus[];
}

export interface SystemInput {
  online: boolean;
  /** `undefined` = primera comprobación en curso; `null` = el API no respondió. */
  check: { health: HealthResponse; latencyMs: number } | null | undefined;
  realtime: RealtimeState;
}

const STATE_LABEL: Record<ComponentState, string> = {
  up: 'Operativo',
  degraded: 'Lento',
  down: 'Caído',
  unknown: 'Sin datos',
};

const component = (
  base: Omit<ComponentStatus, 'stateLabel'>,
  stateLabel = STATE_LABEL[base.state],
): ComponentStatus => ({ ...base, stateLabel });

/** Estado de cada pieza y el resumen general, a partir de lo que ve este dispositivo. */
export function toSystemStatus({ online, check, realtime }: SystemInput): SystemStatus {
  const network = component(
    {
      id: 'network',
      name: 'Este dispositivo',
      description: 'Conexión a internet del navegador.',
      state: online ? 'up' : 'down',
      detail: null,
    },
    online ? 'En línea' : 'Sin conexión',
  );

  const apiState: ComponentState = !online
    ? 'unknown'
    : check === undefined
      ? 'unknown'
      : check === null
        ? 'down'
        : check.latencyMs > SLOW_LATENCY_MS
          ? 'degraded'
          : 'up';
  const api = component({
    id: 'api',
    name: 'API',
    description: 'Servidor de OmniDesk: bandeja, comandos e integraciones.',
    state: apiState,
    detail: check ? `${check.latencyMs} ms · ${formatVersion(check.health.version)}` : null,
  });

  const database = component({
    id: 'database',
    name: 'Base de datos',
    description: 'Conversaciones, mensajes y usuarios.',
    state: !check ? 'unknown' : check.health.checks.database === 'up' ? 'up' : 'down',
    detail: null,
  });

  const realtimeComponent = component(
    {
      id: 'realtime',
      name: 'Tiempo real',
      description: 'Actualizaciones al instante de la bandeja y el chat.',
      state: realtime === 'live' ? 'up' : realtime === 'reconnecting' ? 'degraded' : 'unknown',
      detail: realtime === 'live' ? null : 'Respaldo cada 15 s',
    },
    realtime === 'live' ? 'En vivo' : realtime === 'reconnecting' ? 'Reconectando' : 'Conectando',
  );

  const components = [network, api, database, realtimeComponent];

  if (!online) {
    return {
      overall: 'offline',
      title: 'Sin conexión a internet',
      description: 'Este dispositivo no tiene red. Los datos se actualizarán al recuperarla.',
      components,
    };
  }
  if (check === undefined) {
    return {
      overall: 'checking',
      title: 'Comprobando…',
      description: 'Consultando el estado del API y de la base de datos.',
      components,
    };
  }
  if (check === null) {
    return {
      overall: 'down',
      title: 'El API no responde',
      description: 'La bandeja no puede cargar datos. Se reintenta automáticamente.',
      components,
    };
  }
  if (database.state === 'down') {
    return {
      overall: 'down',
      title: 'La base de datos no responde',
      description: 'El API está en línea pero no puede leer ni guardar conversaciones.',
      components,
    };
  }
  if (api.state === 'degraded' || realtimeComponent.state === 'degraded') {
    return {
      overall: 'degraded',
      title: 'Servicio degradado',
      description:
        api.state === 'degraded'
          ? 'El API responde más lento de lo normal.'
          : 'Sin tiempo real: la bandeja se actualiza cada 15 s mientras se reconecta.',
      components,
    };
  }
  return {
    overall: 'operational',
    title: 'Todos los sistemas operativos',
    description: 'El API, la base de datos y el tiempo real funcionan con normalidad.',
    components,
  };
}

/** Versión desplegada para mostrar: `1.2.3` → `v1.2.3`; una etiqueta `v0.1.0` o un commit `abc1234`, tal cual. */
export function formatVersion(version: string): string {
  return /^\d/.test(version) ? `v${version}` : version;
}
