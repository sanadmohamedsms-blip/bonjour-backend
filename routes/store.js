const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const { authenticate } = require('../middleware/auth');

// POST /api/store/island - Create island with full structure
router.post('/island', authenticate, async (req, res) => {
  try {
    const { name, gondolas } = req.body;
    const branchId = req.branchId;

    if (!name || !gondolas || !Array.isArray(gondolas)) {
      return res.status(400).json({ error: 'Name and gondolas array are required' });
    }

    // Create island
    const { data: island, error: islandError } = await supabase
      .from('islands')
      .insert({ name, branch_id: branchId, number_of_gondolas: gondolas.length })
      .select()
      .single();

    if (islandError) return res.status(500).json({ error: islandError.message });

    const createdGondolas = [];

    // Create gondolas and shelves
    for (let gi = 0; gi < gondolas.length; gi++) {
      const gondolaData = gondolas[gi];
      const { data: gondola, error: gondolaError } = await supabase
        .from('gondolas')
        .insert({
          branch_id: branchId,
          island_id: island.id,
          name: gondolaData.name || `Gondola ${gi + 1}`,
          position: gi + 1,
          number_of_shelves: gondolaData.shelves || gondolaData.number_of_shelves || 1
        })
        .select()
        .single();

      if (gondolaError) continue;

      const shelves = [];
      const shelfCount = gondolaData.shelves || gondolaData.number_of_shelves || 1;

      for (let si = 0; si < shelfCount; si++) {
        const { data: shelf } = await supabase
          .from('shelves')
          .insert({
            branch_id: branchId,
            gondola_id: gondola.id,
            name: `Shelf ${si + 1}`,
            position: si + 1
          })
          .select()
          .single();
        if (shelf) shelves.push(shelf);
      }

      createdGondolas.push({ ...gondola, shelves });
    }

    res.status(201).json({ island: { ...island, gondolas: createdGondolas } });
  } catch (err) {
    console.error('Create island error:', err);
    res.status(500).json({ error: 'Failed to create island' });
  }
});

// GET /api/store/structure - Full store structure
router.get('/structure', authenticate, async (req, res) => {
  try {
    const branchId = req.branchId;

    const { data: islands, error } = await supabase
      .from('islands')
      .select(`
        *,
        gondolas (
          *,
          shelves (*)
        )
      `)
      .eq('branch_id', branchId)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Sort gondolas and shelves by position
    const sorted = (islands || []).map(island => ({
      ...island,
      gondolas: (island.gondolas || [])
        .sort((a, b) => a.position - b.position)
        .map(g => ({
          ...g,
          shelves: (g.shelves || []).sort((a, b) => a.position - b.position)
        }))
    }));

    res.json(sorted);
  } catch (err) {
    console.error('Get structure error:', err);
    res.status(500).json({ error: 'Failed to fetch store structure' });
  }
});

// GET /api/store/island/:id - Single island with full details
router.get('/island/:id', authenticate, async (req, res) => {
  try {
    const { data: island, error } = await supabase
      .from('islands')
      .select(`
        *,
        gondolas (
          *,
          shelves (*),
          product_locations (
            *,
            products (*, expirations(*))
          )
        )
      `)
      .eq('id', req.params.id)
      .eq('branch_id', req.branchId)
      .single();

    if (error) return res.status(404).json({ error: 'Island not found' });
    res.json(island);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch island' });
  }
});

// DELETE /api/store/island/:id
router.delete('/island/:id', authenticate, async (req, res) => {
  try {
    const { error } = await supabase
      .from('islands')
      .delete()
      .eq('id', req.params.id)
      .eq('branch_id', req.branchId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Island deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete island' });
  }
});

module.exports = router;
