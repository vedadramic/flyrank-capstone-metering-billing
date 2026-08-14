const express = require('express');
const db = require('./db');

const app = express();

app.use('/webhooks', require('./routes/webhooks'));
app.use(express.json());

app.use('/auth', require('./routes/auth'));
app.use('/generate', require('./routes/generate'));
app.use('/usage', require('./routes/usage'));
app.use('/checkout', require('./routes/checkout'));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;