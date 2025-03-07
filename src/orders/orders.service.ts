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
import { NATS_SERVICE } from '../config';
import { IOrdersWithProducts } from './interfaces/order-with-products.interface';
import { PaidOrderDto } from './dto';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(NATS_SERVICE)
    private readonly client: ClientProxy,
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

      const orderResponse = {
        ...order,
        orderItem: this.#transformOrderItems(products, order.orderItem),
      };

      const paymentSession = await this.#createPaymentSession(orderResponse);
      return { ...orderResponse, paymentSession };
    } catch (error) {
      throw new RpcException({
        sttus: HttpStatus.BAD_REQUEST,
        message: error.message,
      });
    }
  }

  async #createPaymentSession({ id, orderItem }: IOrdersWithProducts) {
    const paymentSession = await firstValueFrom(
      this.client.send('create.payment.session', {
        orderId: id,
        currency: 'usd',
        items: orderItem.map(({ name, price, quantity }) => ({
          name,
          price,
          quantity,
        })),
      }),
    );
    return paymentSession;
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

  async paidOrder(paidOrderDto: PaidOrderDto) {
    this.logger.log('Paid order');
    this.logger.log({ paidOrderDto });

    const order = await this.order.update({
      where: {
        id: paidOrderDto.orderId,
      },
      data: {
        status: 'PAID',
        paid: true,
        paidAt: new Date(),
        stripeChargeId: paidOrderDto.stripePaymentId,
        orderReceip: {
          create: {
            receipUrl: paidOrderDto.receipUrl,
          },
        },
      },
    });

    return order;
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
    return firstValueFrom(this.client.send('validate_products', ids));
  }
}
