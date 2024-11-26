import fastify from 'fastify';
import proxy from './proxy.js';

const server = fastify({
  logger: false
});

const PORT = process.env.PORT || 8080;

server.get('/', proxy); // Potential issue: Route registration

try {
    server.listen({ host: '0.0.0.0', port: PORT });
    console.log(`Listening on ${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
