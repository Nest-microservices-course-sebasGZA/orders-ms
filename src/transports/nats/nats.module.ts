import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { envs, NATS_SERVICE } from '../../config';

const clientModule = ClientsModule.register([
  {
    name: NATS_SERVICE,
    transport: Transport.NATS,
    options: {
      servers: envs.natsServers,
    },
  },
]);

@Module({
  imports: [clientModule],
  exports: [clientModule],
})
export class NatsModule {}
