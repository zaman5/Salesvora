import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRouter from './routes/api.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);

app.get('/', (_req, res) => {
  res.send({ status: 'ok', service: 'Node.js backend' });
});

app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
