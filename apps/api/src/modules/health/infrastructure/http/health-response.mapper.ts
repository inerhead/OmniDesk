import type { HealthResponse } from '@omnidesk/contracts';
import type { HealthReport } from '../../domain/health-report';

export function toHealthResponse(report: HealthReport, version: string): HealthResponse {
  return {
    status: report.status,
    checks: { database: report.checks.database },
    version,
    timestamp: report.checkedAt.toISOString(),
  };
}
