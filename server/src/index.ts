import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './db.js';
import { router } from './routes.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(currentDir, '..', '.env') });

const app = express();
const port = Number(process.env.PORT) || 3847;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(router);

const clientDist = path.join(currentDir, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }

  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) {
      next();
    }
  });
});

await initDb();

app.listen(port, () => {
  console.log(`X to Bluesky 服务已启动: http://localhost:${port}`);
});
