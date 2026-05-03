const express = require('express');
const { asyncHandler } = require('./request-utils');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
  const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'crm-files';

  res.json({
    success: true,
    supabaseUrl,
    supabaseAnonKey,
    storageBucket
  });
}));

module.exports = router;
