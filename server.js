import fastify from 'fastify';
import proxy from './proxy1.js';
import express from '@fastify/express';

const server = fastify({
  logger: false
});

  const PORT = process.env.PORT || 8080;
  
  async function start() {
    // Register the express plugin
    await server.register(express);
  
    // Use Express middleware for handling the proxy
    server.use('/', (req, res, next) => {
      if (req.path === '/') {
        return proxy(req, res);
      }
      next();
    });
  
    // Handle favicon.ico separately
    server.use('/favicon.ico', (req, res) => {
      res.status(204).end();
    });
  
    // Start the server
    server.listen({host: '0.0.0.0' , port: PORT }, function (err, address) {
    if (err) {
      server.log.error(err)
      process.exit(1)
    }
  });
  }
  
  start();
