const app = require('./app');
const { startWorker, stopWorker } = require('./services/WebhookJobService');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Billing engine running on http://localhost:${PORT}`);
  startWorker();
});

process.on('SIGINT', () => {
  stopWorker();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopWorker();
  process.exit(0);
});
