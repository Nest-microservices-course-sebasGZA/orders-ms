import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { OrderItem, PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { CreateOrderDto } from './dto/create-order.dto';
import { OrderPaginationDto } from './dto/order-pagination';
import { OrderChangeStatusDto } from './dto/order-change-status.dto';
import { PRODUCTS_SERVICE } from '../config';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(PRODUCTS_SERVICE)
    private readonly productsClient: ClientProxy,
  ) {
    super();
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async create({ items }: CreateOrderDto) {
    try {
      const ids = items.map((item) => item.productId);
      const products: any[] = await this.#validateProductsByIds(ids);
      const totalAmount: number = items.reduce((_, orderItem: OrderItem) => {
        const price: number = products.find(
          (product) => product.id === orderItem.productId,
        ).price;

        return price * orderItem.quantity;
      }, 0);

      const totalItems = items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity;
      }, 0);

      const order = await this.order.create({
        data: {
          totalAmount,
          totalItems,
          orderItem: {
            createMany: {
              data: items.map(({ productId, quantity }: OrderItem) => ({
                price: products.find((product) => product.id === productId)
                  .price,
                productId,
                quantity,
              })),
            },
          },
        },
        include: {
          orderItem: {
            select: {
              price: true,
              quantity: true,
              productId: true,
            },
          },
        },
      });

      return {
        ...order,
        orderItem: this.#transformOrderItems(products, order.orderItem),
      };
    } catch {
      throw new RpcException({
        sttus: HttpStatus.BAD_REQUEST,
        message: 'Chech logs',
      });
    }
  }

  async findAll(paginationDto: OrderPaginationDto) {
    const totalPages = await this.order.count({
      where: {
        status: paginationDto.status,
      },
    });

    const { page: currentPage, limit: perPage } = paginationDto;

    return {
      data: await this.order.findMany({
        where: {
          status: paginationDto.status,
        },
        skip: (currentPage - 1) * perPage,
        take: perPage,
      }),
      total: totalPages,
    };
  }

  async findOne(id: string) {
    const order = await this.order.findFirst({
      where: {
        id,
      },
      include: {
        orderItem: {
          select: {
            productId: true,
            quantity: true,
            price: true,
          },
        },
      },
    });
    if (!order)
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with id ${id} not found`,
      });
    const productIds = order.orderItem.map((items) => items.productId);
    const products: any[] = await this.#validateProductsByIds(productIds);
    return {
      ...order,
      orderItem: this.#transformOrderItems(products, order.orderItem),
    };
  }

  async changeStatus({ id, status }: OrderChangeStatusDto) {
    const order = await this.findOne(id);
    if (order.status === status) return order;
    return this.order.update({
      where: {
        id,
      },
      data: { status },
    });
  }

  #transformOrderItems(products: any[], orderItem: Partial<OrderItem>[]) {
    return orderItem.map(({ productId, price, quantity }: OrderItem) => ({
      productId,
      price,
      quantity,
      name: products.find((product) => product.id === productId).name,
    }));
  }

  #validateProductsByIds(ids: number[]) {
    return firstValueFrom(
      this.productsClient.send(
        {
          cmd: 'validate_products',
        },
        ids,
      ),
    );
  }
}
