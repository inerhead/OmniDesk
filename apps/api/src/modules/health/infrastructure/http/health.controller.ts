import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { HealthLiveResponse, HealthResponse } from '@omnidesk/contracts';
import type { Response } from 'express';
import { APP_VERSION } from '../../../../shared/config/app-version';
import { CheckHealthUseCase } from '../../application/check-health.use-case';
import { HealthLiveResponseDto, HealthResponseDto } from './health-response.dto';
import { toHealthResponse } from './health-response.mapper';

@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly checkHealth: CheckHealthUseCase,
    @Inject(APP_VERSION) private readonly version: string,
  ) {}

  @Get()
  @ApiOkResponse({ type: HealthResponseDto.Output, description: 'API y base de datos operativas.' })
  @ApiServiceUnavailableResponse({
    type: HealthResponseDto.Output,
    description: 'La base de datos no responde.',
  })
  async get(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const report = await this.checkHealth.execute();
    res.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return toHealthResponse(report, this.version);
  }

  /**
   * Liveness (SPEC 19): el proceso atiende peticiones. No consulta la base, MinIO ni el Outbox: así el
   * healthcheck del contenedor no reinicia el API cuando la que falla es la base.
   */
  @Get('live')
  @ApiOkResponse({ type: HealthLiveResponseDto.Output, description: 'El proceso responde.' })
  live(): HealthLiveResponse {
    return { status: 'ok' };
  }
}
