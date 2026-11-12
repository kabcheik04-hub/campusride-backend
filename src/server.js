import { createServer } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { server } = createServer(config);

server.listen(config.port, () => {
  console.log(`CampusRide API démarrée sur http://localhost:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
