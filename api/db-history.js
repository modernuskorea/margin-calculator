// api/db-history.js — 히스토리 서버 저장/조회 (팀원 공유)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return res.status(500).json({ error: 'KV 환경변수 미설정' });

  const kvGet = async (key) => {
    const r = await fetch(`${url}/get/${key}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return r.json();
  };
  const kvSet = async (key, value) => {
    const r = await fetch(`${url}/set/${key}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
    return r.json();
  };

  try {
    if (req.method === 'GET') {
      const data = await kvGet('history');
      const history = data.result ? JSON.parse(data.result) : [];
      return res.status(200).json({ history });
    }

    if (req.method === 'POST') {
      const { item } = req.body;
      if (!item) return res.status(400).json({ error: '히스토리 데이터 없음' });
      const data = await kvGet('history');
      const history = data.result ? JSON.parse(data.result) : [];
      history.unshift(item);
      if (history.length > 200) history.splice(200);
      await kvSet('history', JSON.stringify(history));
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      const data = await kvGet('history');
      const history = (data.result ? JSON.parse(data.result) : []).filter(h => h.id !== id);
      await kvSet('history', JSON.stringify(history));
      return res.status(200).json({ ok: true });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
