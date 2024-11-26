import fastify from 'fastify';
import proxy from './proxy.js';

const server = fastify({
  logger: false
});

server.get('/', proxy); // Potential issue: Route registration

server.listen(3000, (err, address) => {
  if (err) {
    server.log.error(err); // Potential issue: Server initialization error
    process.exit(1);
  }
  server.log.info(`Server listening at ${address}`);
});
