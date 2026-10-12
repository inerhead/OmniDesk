/** Conversaciones de ejemplo: cada turno es un mensaje del cliente seguido de la respuesta de la IA. */
export interface ScenarioTurn {
  /** `externalMessageId` del mensaje del cliente e `idempotencyKey` de la respuesta de IA. */
  id: string;
  customer: string;
  ai: string;
}

export interface Scenario {
  slug: string;
  name: string;
  phone: string;
  turns: ScenarioTurn[];
}

const script: Array<Omit<Scenario, 'turns'> & { turns: Array<[string, string]> }> = [
  {
    slug: 'ana',
    name: 'Ana Gómez',
    phone: '+573001110001',
    turns: [
      [
        'Hola, ¿tienen disponibilidad para una cita mañana?',
        '¡Hola Ana! Sí, mañana tenemos espacios a las 10:00, 12:30 y 16:00. ¿Cuál prefieres?',
      ],
      [
        'A las 12:30, por favor.',
        'Listo, quedó agendada tu cita mañana a las 12:30. Te enviaremos un recordatorio.',
      ],
      ['¡Gracias!', 'Con gusto. ¿Te ayudo con algo más?'],
    ],
  },
  {
    slug: 'carlos',
    name: 'Carlos Pérez',
    phone: '+573001110002',
    turns: [
      [
        'Buenas, ¿cómo va mi pedido 4821?',
        'Hola Carlos. Tu pedido 4821 está en camino y llega hoy entre 3 y 5 p. m.',
      ],
      [
        '¿Puedo cambiar la dirección de entrega?',
        'Puedo ayudarte con eso. ¿Cuál es la nueva dirección?',
      ],
    ],
  },
  {
    slug: 'lucia',
    name: 'Lucía Martínez',
    phone: '+573001110003',
    turns: [
      [
        '¿Cuánto cuesta el plan mensual?',
        'Hola Lucía. El plan mensual cuesta $49.900 e incluye soporte prioritario.',
      ],
      [
        '¿Y el anual tiene descuento?',
        'Sí: el plan anual cuesta $499.000, equivalente a dos meses gratis.',
      ],
      ['Perfecto, lo pienso y les escribo.', '¡Claro! Aquí estaremos cuando lo decidas.'],
      [
        'Una última pregunta: ¿se puede pagar con tarjeta?',
        'Sí, aceptamos tarjetas de crédito y débito, y también transferencias.',
      ],
    ],
  },
  {
    slug: 'jorge',
    name: 'Jorge Ramírez',
    phone: '+573001110004',
    turns: [
      [
        '¿A qué hora abren los sábados?',
        'Hola Jorge. Los sábados abrimos de 9:00 a. m. a 2:00 p. m.',
      ],
      ['¿Y los domingos?', 'Los domingos permanecemos cerrados. ¡Te esperamos el sábado!'],
    ],
  },
  {
    slug: 'sofia',
    name: 'Sofía Torres',
    phone: '+573001110005',
    turns: [
      [
        'Me llegó el producto dañado 😞',
        'Lamento mucho lo ocurrido, Sofía. ¿Me compartes una foto del producto y tu número de pedido?',
      ],
      [
        'Pedido 5532, ahora mando la foto.',
        'Gracias. En cuanto la recibamos gestionamos el cambio sin costo.',
      ],
      [
        '¿Cuánto tarda el cambio?',
        'El cambio tarda de 2 a 3 días hábiles desde que recibimos la foto.',
      ],
    ],
  },
];

/** Escenario fijo: los ids son deterministas, así que repetirlo no duplica nada. */
export function buildScenarios(): Scenario[] {
  return script.map(({ turns, ...contact }) => ({
    ...contact,
    turns: turns.map(([customer, ai], index) => ({
      id: `sim-${contact.slug}-${index + 1}`,
      customer,
      ai,
    })),
  }));
}

/** Frases para el modo `--live`. */
export const LIVE_CUSTOMER_MESSAGES = [
  '¿Siguen atendiendo?',
  'Quisiera más información, por favor.',
  '¿Tienen envío a domicilio?',
  'Necesito cambiar mi cita.',
  '¿Cuál es el horario de hoy?',
  'Gracias por la ayuda 🙌',
];

export const LIVE_AI_MESSAGES = [
  '¡Hola! Sí, aquí estamos. ¿En qué te ayudo?',
  'Claro, cuéntame qué necesitas y te ayudo enseguida.',
  'Sí, hacemos envíos a domicilio en toda la ciudad.',
  'Con gusto. ¿Para qué día y hora la quieres?',
  'Hoy atendemos hasta las 7:00 p. m.',
  '¡Con gusto! Que tengas un excelente día.',
];
