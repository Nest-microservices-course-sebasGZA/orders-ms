import { OrderStatus } from '@prisma/client';

import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/dtos/pagination.dto';

export class OrderPaginationDto extends PaginationDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status: OrderStatus;
}
