const express = require('express');
const router = express.Router();
const axios = require('axios');
const { supabase } = require('../lib/supabase');
const { authenticate } = require('../middleware/auth');

// Call Gemini AI with deterministic settings
async function callGeminiAI(prompt) {
  const apiKey = process.env.AI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,        // Deterministic output
      topP: 1,
      topK: 1,
      maxOutputTokens: 4096
    }
  };

  const response = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json' }
  });

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  // Strip markdown fences if present
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

// POST /api/planogram/generate - Generate full island planogram
router.post('/generate', authenticate, async (req, res) => {
  try {
    const { island_id } = req.body;
    const branchId = req.branchId;

    // Fetch island full structure with products and expirations
    const { data: island, error } = await supabase
      .from('islands')
      .select(`
        *,
        gondolas (
          *,
          shelves (*),
          product_locations (
            *,
            products (
              *,
              expirations (*)
            )
          )
        )
      `)
      .eq('id', island_id)
      .eq('branch_id', branchId)
      .single();

    if (error || !island) return res.status(404).json({ error: 'Island not found' });

    // Sort gondolas
    island.gondolas = (island.gondolas || []).sort((a, b) => a.position - b.position);

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const prompt = `You are a retail planogram expert. Generate a planogram for this store island.

RULES:
- Gondola positions 1 and 2 = FRONT of island
- All other gondola positions = BACK of island
- Products expiring soonest go to front gondolas and top shelves
- Arrange products right-to-left within each shelf
- Return ONLY valid JSON, no text before or after

ISLAND DATA:
${JSON.stringify({
  island_name: island.name,
  total_gondolas: island.gondolas.length,
  today: todayStr,
  gondolas: island.gondolas.map(g => ({
    id: g.id,
    name: g.name,
    position: g.position,
    location: g.position <= 2 ? 'FRONT' : 'BACK',
    shelves: (g.shelves || []).sort((a,b) => a.position - b.position).map(s => ({
      id: s.id,
      name: s.name,
      position: s.position
    })),
    current_products: (g.product_locations || []).map(pl => ({
      product_id: pl.product_id,
      product_name: pl.products?.name,
      image_url: pl.products?.image_url,
      expirations: (pl.products?.expirations || []).map(e => ({
        date: e.expiration_date,
        quantity: e.quantity,
        days_until: Math.ceil((new Date(e.expiration_date) - today) / 86400000)
      }))
    }))
  }))
}, null, 2)}

Return JSON in this exact format:
{
  "island_id": "${island_id}",
  "island_name": "${island.name}",
  "generated_at": "${todayStr}",
  "layout": {
    "front_gondolas": [
      {
        "gondola_id": "...",
        "gondola_name": "...",
        "position": 1,
        "shelves": [
          {
            "shelf_id": "...",
            "shelf_name": "...",
            "position": 1,
            "products": [
              {
                "product_id": "...",
                "product_name": "...",
                "image_url": "...",
                "placement_reason": "...",
                "urgency": "high|medium|low",
                "nearest_expiry": "...",
                "position_in_shelf": 1
              }
            ]
          }
        ]
      }
    ],
    "back_gondolas": []
  },
  "summary": {
    "total_products_placed": 0,
    "high_urgency_count": 0,
    "placement_notes": "..."
  }
}`;

    let planogramData;
    try {
      planogramData = await callGeminiAI(prompt);
    } catch (aiErr) {
      console.error('AI error, using fallback:', aiErr.message);
      // Fallback: generate basic planogram without AI
      planogramData = generateFallbackPlanogram(island, todayStr);
    }

    // Save planogram
    const { data: saved, error: saveError } = await supabase
      .from('island_planograms')
      .upsert({
        branch_id: branchId,
        island_id,
        planogram_data: planogramData,
        generated_at: new Date().toISOString()
      }, { onConflict: 'island_id' })
      .select()
      .single();

    if (saveError) console.error('Save planogram error:', saveError);

    res.json({ planogram: planogramData, saved_id: saved?.id });
  } catch (err) {
    console.error('Generate planogram error:', err);
    res.status(500).json({ error: 'Failed to generate planogram' });
  }
});

// POST /api/planogram/suggest - Smart suggestion (does NOT change layout)
router.post('/suggest', authenticate, async (req, res) => {
  try {
    const { island_id } = req.body;
    const branchId = req.branchId;

    const { data: island } = await supabase
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
      .eq('id', island_id)
      .eq('branch_id', branchId)
      .single();

    if (!island) return res.status(404).json({ error: 'Island not found' });

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const prompt = `You are a retail optimization expert. Analyze this store island and suggest product placement improvements WITHOUT changing the existing layout structure.

IMPORTANT: You are ONLY suggesting changes, not implementing them. The layout stays as-is.

RULES:
- Gondola 1 & 2 = FRONT, others = BACK
- Expiring products should be moved to front/top
- Arrange suggestions right-to-left
- Same input = same output (be deterministic)
- Return ONLY valid JSON

TODAY: ${todayStr}

ISLAND: ${JSON.stringify({
  name: island.name,
  gondolas: (island.gondolas || []).sort((a,b) => a.position - b.position).map(g => ({
    id: g.id,
    name: g.name,
    position: g.position,
    products: (g.product_locations || []).map(pl => ({
      product_id: pl.product_id,
      name: pl.products?.name,
      expirations: (pl.products?.expirations || []).map(e => ({
        date: e.expiration_date,
        days_until: Math.ceil((new Date(e.expiration_date) - today) / 86400000)
      }))
    }))
  }))
}, null, 2)}

Return JSON:
{
  "island_id": "${island_id}",
  "suggestion_type": "placement_optimization",
  "suggestions": [
    {
      "product_id": "...",
      "product_name": "...",
      "current_gondola": "...",
      "suggested_gondola": "...",
      "suggested_shelf": "...",
      "reason": "...",
      "priority": "high|medium|low",
      "days_until_expiry": 0
    }
  ],
  "summary": "...",
  "total_suggestions": 0
}`;

    let suggestionData;
    try {
      suggestionData = await callGeminiAI(prompt);
    } catch (aiErr) {
      suggestionData = {
        island_id,
        suggestion_type: 'placement_optimization',
        suggestions: [],
        summary: 'AI service unavailable. Please check your AI_API_KEY.',
        total_suggestions: 0
      };
    }

    // Save suggestion to planogram record
    await supabase
      .from('island_planograms')
      .upsert({
        branch_id: branchId,
        island_id,
        planogram_data: {},
        suggestion_data: suggestionData
      }, { onConflict: 'island_id' });

    res.json(suggestionData);
  } catch (err) {
    console.error('Suggestion error:', err);
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});

// GET /api/planogram/:island_id - Get saved planogram
router.get('/:island_id', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('island_planograms')
      .select('*')
      .eq('island_id', req.params.island_id)
      .eq('branch_id', req.branchId)
      .single();

    if (error) return res.status(404).json({ error: 'No planogram found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch planogram' });
  }
});

// Fallback planogram without AI
function generateFallbackPlanogram(island, todayStr) {
  const frontGondolas = island.gondolas.filter(g => g.position <= 2);
  const backGondolas = island.gondolas.filter(g => g.position > 2);

  const mapGondola = (g) => ({
    gondola_id: g.id,
    gondola_name: g.name,
    position: g.position,
    shelves: (g.shelves || []).sort((a,b) => a.position - b.position).map(s => ({
      shelf_id: s.id,
      shelf_name: s.name,
      position: s.position,
      products: (g.product_locations || []).map((pl, idx) => ({
        product_id: pl.product_id,
        product_name: pl.products?.name,
        image_url: pl.products?.image_url,
        placement_reason: 'Current location',
        urgency: 'low',
        position_in_shelf: idx + 1
      }))
    }))
  });

  return {
    island_id: island.id,
    island_name: island.name,
    generated_at: todayStr,
    layout: {
      front_gondolas: frontGondolas.map(mapGondola),
      back_gondolas: backGondolas.map(mapGondola)
    },
    summary: {
      total_products_placed: island.gondolas.reduce((sum, g) => sum + (g.product_locations?.length || 0), 0),
      placement_notes: 'Basic layout generated without AI'
    }
  };
}

module.exports = router;
