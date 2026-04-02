const express = require('express');
const router = express.Router();
const multer = require('multer');
const { supabase } = require('../lib/supabase');
const { authenticate } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/products/upload-image
router.post('/upload-image', authenticate, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });

    const ext = req.file.mimetype.split('/')[1] || 'jpg';
    const fileName = `${req.branchId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { data, error } = await supabase.storage
      .from('product-images')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (error) return res.status(500).json({ error: error.message });

    const { data: urlData } = supabase.storage
      .from('product-images')
      .getPublicUrl(data.path);

    res.json({ image_url: urlData.publicUrl, path: data.path });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Image upload failed' });
  }
});

// POST /api/products - Create product
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, image_url, barcode, category, island_id, gondola_id, shelf_id, expirations } = req.body;
    const branchId = req.branchId;

    if (!name) return res.status(400).json({ error: 'Product name is required' });

    // Create product
    const { data: product, error: productError } = await supabase
      .from('products')
      .insert({ name, branch_id: branchId, image_url, barcode, category })
      .select()
      .single();

    if (productError) return res.status(500).json({ error: productError.message });

    // Create location if provided
    if (island_id || gondola_id || shelf_id) {
      await supabase.from('product_locations').insert({
        branch_id: branchId,
        product_id: product.id,
        island_id: island_id || null,
        gondola_id: gondola_id || null,
        shelf_id: shelf_id || null
      });
    }

    // Create expirations if provided
    if (expirations && expirations.length > 0) {
      const expData = expirations.map(e => ({
        branch_id: branchId,
        product_id: product.id,
        expiration_date: e.date || e.expiration_date,
        quantity: e.quantity || 1
      }));
      await supabase.from('expirations').insert(expData);
    }

    // Return full product
    const { data: full } = await supabase
      .from('products')
      .select(`
        *,
        expirations(*),
        product_locations(*, islands(*), gondolas(*), shelves(*))
      `)
      .eq('id', product.id)
      .single();

    res.status(201).json(full);
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// GET /api/products - All products with expirations
router.get('/', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        expirations(*),
        product_locations(*, islands(*), gondolas(*), shelves(*))
      `)
      .eq('branch_id', req.branchId)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET /api/products/expiring - Products expiring in N days
router.get('/expiring', authenticate, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const branchId = req.branchId;

    const today = new Date().toISOString().split('T')[0];
    const future = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('expirations')
      .select(`
        *,
        products(*, product_locations(*, islands(*), gondolas(*), shelves(*)))
      `)
      .eq('branch_id', branchId)
      .gte('expiration_date', today)
      .lte('expiration_date', future)
      .order('expiration_date', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Categorize
    const soon = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    const result = {
      expiring_soon: data.filter(e => e.expiration_date <= soon),
      expiring_later: data.filter(e => e.expiration_date > soon),
      all: data
    };

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch expiring products' });
  }
});

// GET /api/products/stats - Dashboard stats
router.get('/stats', authenticate, async (req, res) => {
  try {
    const branchId = req.branchId;
    const today = new Date().toISOString().split('T')[0];
    const soon = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    const later = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

    const { data: products } = await supabase
      .from('products')
      .select('id')
      .eq('branch_id', branchId);

    const { data: expSoon } = await supabase
      .from('expirations')
      .select('id, product_id')
      .eq('branch_id', branchId)
      .gte('expiration_date', today)
      .lte('expiration_date', soon);

    const { data: expLater } = await supabase
      .from('expirations')
      .select('id, product_id')
      .eq('branch_id', branchId)
      .gt('expiration_date', soon)
      .lte('expiration_date', later);

    const { data: withExp } = await supabase
      .from('expirations')
      .select('product_id')
      .eq('branch_id', branchId);

    const productIds = (products || []).map(p => p.id);
    const withExpIds = new Set((withExp || []).map(e => e.product_id));
    const withoutExp = productIds.filter(id => !withExpIds.has(id));

    res.json({
      total_products: products?.length || 0,
      expiring_soon: expSoon?.length || 0,
      expiring_later: expLater?.length || 0,
      without_expiration: withoutExp.length,
      far_from_expiration: (withExp?.length || 0) - (expSoon?.length || 0) - (expLater?.length || 0)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// POST /api/products/:id/expiration - Add expiration date
router.post('/:id/expiration', authenticate, async (req, res) => {
  try {
    const { expiration_date, quantity } = req.body;

    const { data, error } = await supabase
      .from('expirations')
      .insert({
        branch_id: req.branchId,
        product_id: req.params.id,
        expiration_date,
        quantity: quantity || 1
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add expiration' });
  }
});

// GET /api/products/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        expirations(*),
        product_locations(*, islands(*), gondolas(*), shelves(*))
      `)
      .eq('id', req.params.id)
      .eq('branch_id', req.branchId)
      .single();

    if (error) return res.status(404).json({ error: 'Product not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

module.exports = router;
