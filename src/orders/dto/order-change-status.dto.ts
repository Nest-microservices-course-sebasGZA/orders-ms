import { OrderStatus } from '@prisma/client';
import { IsEnum, IsUUID } from 'class-validator';

export class OrderChangeStatusDto {
  @IsUUID()
  id: string;

  @IsEnum(OrderStatus)
  status: OrderStatus;
}
