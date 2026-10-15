import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { IdentityModule } from '../identity/identity.module';
import { MembersModule } from '../members/members.module';
import {
  AcceptInvitationUseCase,
  CreateInvitationUseCase,
  GetInvitationLogoUseCase,
  ListInvitationsUseCase,
  PreviewInvitationUseCase,
  RevokeInvitationUseCase,
} from './application/invitations.use-cases';
import { RemoveMemberUseCase, UpdateMemberRoleUseCase } from './application/members.use-cases';
import { INVITATION_REPOSITORY } from './application/ports/invitation.repository';
import { InvitationsController } from './infrastructure/http/invitations.controller';
import { TeamMembersController } from './infrastructure/http/team-members.controller';
import { PrismaInvitationRepository } from './infrastructure/prisma-invitation.repository';

/** Gestión de la empresa (SPEC 07): invitaciones por enlace, cambio de rol y baja de miembros. */
@Module({
  imports: [AttachmentsModule, IdentityModule, MembersModule, ConversationsModule],
  controllers: [InvitationsController, TeamMembersController],
  providers: [
    { provide: INVITATION_REPOSITORY, useClass: PrismaInvitationRepository },
    CreateInvitationUseCase,
    ListInvitationsUseCase,
    RevokeInvitationUseCase,
    PreviewInvitationUseCase,
    AcceptInvitationUseCase,
    GetInvitationLogoUseCase,
    UpdateMemberRoleUseCase,
    RemoveMemberUseCase,
  ],
})
export class TeamModule {}
