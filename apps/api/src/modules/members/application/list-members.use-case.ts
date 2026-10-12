import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '../../../shared/application/request-context';
import type { Member } from '../domain/member';
import { MEMBER_REPOSITORY, type MemberRepository } from './ports/member.repository';

@Injectable()
export class ListMembersUseCase {
  constructor(@Inject(MEMBER_REPOSITORY) private readonly members: MemberRepository) {}

  execute(tenant: TenantContext): Promise<Member[]> {
    return this.members.list(tenant.tenantId);
  }
}
