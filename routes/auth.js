const express = require('express');
const router = express.Router();
const { supabase, supabaseAnon } = require('../lib/supabase');
const { authenticate } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, full_name, branch_id } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Email, password, and full name are required' });
    }

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name }
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    // Use default branch if not provided
    const targetBranchId = branch_id || '00000000-0000-0000-0000-000000000001';

    // Create user profile
    const { error: profileError } = await supabase
      .from('users')
      .insert({
        id: authData.user.id,
        email,
        full_name,
        branch_id: targetBranchId,
        role: 'staff'
      });

    if (profileError) {
      console.error('Profile creation error:', profileError);
    }

    // Sign in to get token
    const { data: signInData, error: signInError } = await supabaseAnon.auth.signInWithPassword({
      email,
      password
    });

    if (signInError) {
      return res.status(400).json({ error: signInError.message });
    }

    const { data: profile } = await supabase
      .from('users')
      .select('*, branches(*)')
      .eq('id', authData.user.id)
      .single();

    res.status(201).json({
      user: profile,
      session: signInData.session
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });

    if (error) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { data: profile } = await supabase
      .from('users')
      .select('*, branches(*)')
      .eq('id', data.user.id)
      .single();

    res.json({
      user: profile,
      session: data.session
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/google - exchange Google OAuth token
router.post('/google', async (req, res) => {
  try {
    const { access_token, branch_id } = req.body;

    const { data, error } = await supabaseAnon.auth.signInWithIdToken({
      provider: 'google',
      token: access_token
    });

    if (error) {
      return res.status(401).json({ error: error.message });
    }

    // Upsert user profile
    const targetBranchId = branch_id || '00000000-0000-0000-0000-000000000001';
    const { data: profile } = await supabase
      .from('users')
      .upsert({
        id: data.user.id,
        email: data.user.email,
        full_name: data.user.user_metadata?.full_name || data.user.email,
        branch_id: targetBranchId,
        avatar_url: data.user.user_metadata?.avatar_url
      }, { onConflict: 'id' })
      .select('*, branches(*)')
      .single();

    res.json({ user: profile, session: data.session });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(500).json({ error: 'Google authentication failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  const token = req.headers.authorization.split(' ')[1];
  await supabaseAnon.auth.admin?.signOut(token);
  res.json({ message: 'Logged out successfully' });
});

// GET /api/auth/branches - list all branches for registration
router.get('/branches', async (req, res) => {
  try {
    const { data, error } = await supabase.from('branches').select('id, name');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
});

module.exports = router;
