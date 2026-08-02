
import express from 'express';
const router = express.Router();

router.get('/', async (req, res) => {
    try {
        // Récupérer les moods depuis la base de données
        const moods = []; // Remplacer par la vraie logique
        res.json(moods);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

export default router;