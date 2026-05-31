import express from 'express';
import { createPost, getPosts } from '../database.js';

const router = express.Router();

router.post('/api/posts', async (req, res) => {
  try {
    const post = await createPost({
      user_id: req.user.id,
      content: req.body.content,
      mood_color: req.body.moodColor,
      emoji: req.body.emoji
    });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
