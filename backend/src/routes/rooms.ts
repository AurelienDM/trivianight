import { Router } from 'express';
import { listActiveRooms } from '../socket/gameManager/sessions.js';

const router = Router();

/** Public list of live host rooms for Dashboard ongoing games. */
router.get('/', (_req, res) => {
  res.json({ rooms: listActiveRooms() });
});

export default router;
