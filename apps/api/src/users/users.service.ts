import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async deleteUser(userId: number): Promise<void> {
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
