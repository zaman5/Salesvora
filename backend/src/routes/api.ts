import { Router, Request, Response } from 'express';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy' });
});

router.get('/hello', (_req: Request, res: Response) => {
  res.json({ message: 'Hello from Node.js backend' });
});

export default router;
