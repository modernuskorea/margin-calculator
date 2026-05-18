// api/db-actions.js — 광고 액션 로그 서버 저장/조회 (팀원 공유)
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
      const data = await kvGet('actions');
      const actions = data.result ? JSON.parse(data.result) : [];
      return res.status(200).json({ actions });
    }

    if (req.method === 'POST') {
      const { action } = req.body;
      if (!action) return res.status(400).json({ error: '액션 데이터 없음' });
      const data = await kvGet('actions');
      const actions = data.result ? JSON.parse(data.result) : [];
      actions.unshift(action); // 최신순
      if (actions.length > 500) actions.splice(500); // 최대 500개
      await kvSet('actions', JSON.stringify(actions));
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      const data = await kvGet('actions');
      const actions = (data.result ? JSON.parse(data.result) : []).filter(a => a.id !== id);
      await kvSet('actions', JSON.stringify(actions));
      return res.status(200).json({ ok: true });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
