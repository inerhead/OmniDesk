import { describe, expect, it } from 'vitest';
import { integrationEndpoint } from './integration-endpoint';

describe('integrationEndpoint', () => {
  it('reconoce los tres endpoints de integración', () => {
    expect(integrationEndpoint('/api/v1/integrations/messages/inbound')).toBe('inbound');
    expect(integrationEndpoint('/api/v1/integrations/messages/outbound/')).toBe('outbound');
    expect(integrationEndpoint('/api/v1/integrations/messages/status')).toBe('status');
  });

  it('cualquier otra ruta es null', () => {
    expect(integrationEndpoint('/api/v1/conversations')).toBeNull();
  });
});
