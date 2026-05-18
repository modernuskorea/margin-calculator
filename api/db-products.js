// api/db-products.js — 이카운트 상품 DB 서버 저장/조회
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return res.status(500).json({ error: 'KV 환경변수 미설정' });

  const kv = async (cmd, ...args) => {
    const r = await fetch(`${url}/${[cmd, ...args].join('/')}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return r.json();
  };

  try {
    if (req.method === 'GET') {
      const data = await kv('get', 'products');
      const products = data.result ? JSON.parse(data.result) : [];
      return res.status(200).json({ products });
    }

    if (req.method === 'POST') {
      const { products } = req.body;
      if (!Array.isArray(products)) return res.status(400).json({ error: '잘못된 데이터' });
      // 5MB 제한 대비 청크 저장
      await kv('set', 'products', JSON.stringify(products));
      await kv('set', 'products_updated', new Date().toLocaleString('ko-KR'));
      return res.status(200).json({ ok: true, count: products.length });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
