import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller({ path: 'chat', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('messages')
  @Roles('insured')
  postMessage() {
    return this.chat.postMessage();
  }

  @Get('history')
  @Roles('insured', 'admin_mac', 'admin_segurasist', 'supervisor')
  history() {
    return this.chat.history();
  }

  @Get('kb')
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor', 'insured')
  listKb() {
    return this.chat.listKb();
  }

  @Post('kb')
  @Roles('admin_segurasist')
  createKb() {
    return this.chat.createKb();
  }

  @Patch('kb/:id')
  @Roles('admin_segurasist')
  updateKb(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.chat.updateKb();
  }
}
