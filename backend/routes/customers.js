const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

// Normalize Vietnamese diacritics for Latin search
const normalize = (str) => (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const SEARCH_MAX_ROWS = 20;
const MAX_PAGE_SIZE = 100;

// GET all customers
//  - Không có ?page → trả MẢNG như cũ (ô gợi ý khách ở trang Lịch hẹn, tra "Khách lạ"...).
//  - Có ?page (&page_size) → trả { data, total, page, page_size, limited } và phân trang ở DB
//    (trang Khách hàng không còn tải cả bảng; cũng tránh bị Supabase cắt ở 1.000 dòng mặc định).
router.get('/', async (req, res) => {
  try {
    const paged = req.query.page !== undefined;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.page_size, 10) || 10));
    const sendPage = (rows, total, limited = false) => res.json({ data: rows, total, page, page_size: pageSize, limited });
    const slicePage = (rows) => rows.slice((page - 1) * pageSize, page * pageSize);

    // Tìm kiếm ngay trong DB (không dấu, tối đa 20 kết quả) — hàm search_customers ở SQL Bước 5.
    // Cách cũ tải cả bảng rồi lọc: vượt 1000 khách là không tìm ra khách cũ.
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    if (search) {
      const { data: found, error: rpcErr } = await supabase.rpc('search_customers', { q: search, max_rows: SEARCH_MAX_ROWS });
      if (!rpcErr) {
        const rows = found || [];
        if (!paged) return res.json(rows);
        return sendPage(slicePage(rows), rows.length, rows.length >= SEARCH_MAX_ROWS);
      }
      // Chưa tạo hàm SQL → dùng cách cũ bên dưới
    }

    // Phân trang ngay trong DB khi không tìm kiếm
    if (paged && !search) {
      const from = (page - 1) * pageSize;
      const { data, count, error } = await supabase
        .from('customers')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      return sendPage(data || [], count ?? 0);
    }

    let query = supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    // Client-side filtering with Latin/diacritics normalization
    if (search) {
      const searchNorm = normalize(search);
      const filtered = data.filter(c => {
        const nameNorm = normalize(c.name);
        const phone = (c.phone || '').toLowerCase();
        const id = (c.id || '').toString().toLowerCase();
        return nameNorm.includes(searchNorm) || phone.includes(searchNorm) || id.includes(searchNorm);
      });
      if (paged) return sendPage(slicePage(filtered), filtered.length);
      return res.json(filtered);
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET customer by id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create customer
router.post('/', async (req, res) => {
  try {
    const { name, phone, email, habits } = req.body;
    const { data, error } = await supabase
      .from('customers')
      .insert([{ name, phone, email, habits: habits || null }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update customer
router.put('/:id', async (req, res) => {
  try {
    const { name, phone, email, habits } = req.body;
    const { data, error } = await supabase
      .from('customers')
      .update({ name, phone, email, habits: habits || null })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE customer
router.delete('/:id', async (req, res) => {
  try {
    // 1. Check if customer has bookings
    const { count, error: countErr } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('customer_id', req.params.id);

    if (countErr) throw countErr;

    if (count > 0) {
      return res.status(400).json({ 
        // Lịch hủy cũng giữ lại (hủy = status cancelled) → khách có lịch sử thì giữ hồ sơ
        error: 'Không thể xóa khách hàng này vì đã có lịch sử đặt lịch (kể cả lịch đã hủy).'
      });
    }

    // 2. Delete customer if no bookings
    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Customer deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;