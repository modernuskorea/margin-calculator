import { useState, useCallback, useEffect, useRef } from "react";

const DEFAULT_SETTINGS = {
  fees: {
    naver:      { rate: 8.0,   label: "네이버 스마트스토어" },
    coupang:    { rate: 11.88, label: "쿠팡 (10.8%+VAT)" },
    openmarket: { rate: 15.0,  label: "오픈마켓 (옥션/G마켓/11번가)" },
  },
  shippingFeeCommission: 3.3,
  defaultShippingCost: 2700,
  defaultPaidFee: 3000,
  freeShippingThreshold: 50000,
  incomeTaxRate: 15.0,
  reserveRate: 0.0,
  bundleDiscountRate: 4.0,
  boxDiscountRate: 7.0,
  maxItemsPerBox: 10,
  boxes: [
    { id: "b1", name: "소형박스", cost: 350 },
    { id: "b2", name: "중형박스", cost: 550 },
    { id: "b3", name: "대형박스", cost: 800 },
  ],
  subMaterials: [
    { id: "m1", name: "에어캡", cost: 150 },
    { id: "m2", name: "완충재", cost: 200 },
  ],
};

// price = 묶음 전체 판매가, qty = 원가 곱산에만 사용
function calcMargin({ price, qty = 1, costPerUnit, platformKey,
  shippingType, paidFee = 3000, shippingCost = 0,
  packagingCost = 0, otherCost = 0, reserveRate = 0,
  settings = DEFAULT_SETTINGS }) {
  if (!price || !costPerUnit || price <= 0 || costPerUnit <= 0)
    return { empty: true, finalProfit: 0, roi: 0, breakEvenRoas: null, profitBeforeTax: 0, profitAfterVat: 0 };
  const { fees, incomeTaxRate, shippingFeeCommission } = settings;
  const feeRate = (fees[platformKey]?.rate ?? fees.naver.rate) / 100;
  const 상품매출 = price;
  const 배송수입 = shippingType === "free" ? 0 : paidFee;
  const 총매출   = 상품매출 + 배송수입;
  const 원가합계 = costPerUnit * qty;
  const 배송원가 = shippingCost;
  const 포장합계 = packagingCost + (otherCost || 0);
  const 예비비   = 상품매출 * (reserveRate / 100);
  const 수수료   = 상품매출 * feeRate + 배송수입 * (shippingFeeCommission / 100);
  const 세전이익 = (총매출 - 원가합계 - 배송원가 - 수수료 - 포장합계 - 예비비) / 1.1;
  const vat매출  = (총매출 / 1.1) * 0.1;
  const vat공제  = ((원가합계 + 배송원가 + 수수료 + 포장합계 + 예비비) / 1.1) * 0.1;
  const 부가세   = vat매출 - vat공제;
  const 세후이익 = 세전이익 - 부가세;
  const 소득세이후 = 세후이익 > 0 ? 세후이익 * (1 - incomeTaxRate / 100) : 세후이익;
  const 수익률   = 상품매출 > 0 ? (소득세이후 / 상품매출) * 100 : 0;
  return {
    empty: false,
    totalSales: 상품매출, shippingInflow: 배송수입, totalCost: 원가합계,
    shippingCost: 배송원가, totalPlatformFee: Math.round(수수료),
    vatPayable: Math.round(부가세),
    profitBeforeTax: Math.round(세전이익),
    profitAfterVat: Math.round(세후이익),
    finalProfit: Math.round(소득세이후),
    roi: parseFloat(수익률.toFixed(1)),
    unitProfit: qty > 0 ? Math.round(소득세이후 / qty) : Math.round(소득세이후),
    breakEvenRoas: 소득세이후 > 0 ? parseFloat((상품매출 / 소득세이후 * 100).toFixed(0)) : null,
  };
}

function suggestPrice({ targetProfit, qty = 1, costPerUnit, platformKey,
  shippingType, paidFee, shippingCost, packagingCost, otherCost, reserveRate, settings }) {
  const target = targetProfit || 0;
  const start = Math.ceil((costPerUnit * qty * 1.02) / 100) * 100;
  for (let p = start; p <= 50000000; p += 100) {
    const r = calcMargin({ price: p, qty, costPerUnit, platformKey, shippingType,
      paidFee, shippingCost, packagingCost, otherCost, reserveRate, settings });
    if (!r.empty && r.finalProfit >= target) return p;
  }
  return 0;
}

const fmt = (n) => {
  if (n === null || n === undefined || isNaN(Number(n))) return "0";
  return Math.round(Number(n)).toLocaleString("ko-KR");
};
const parse = (v) => Number(String(v).replace(/[^0-9.-]/g, "")) || 0;
const pColor = (v) => v > 0 ? "#1a6b3a" : v < 0 ? "#c53030" : "#666";

function newProduct(s) {
  return {
    id: Date.now() + Math.random(),
    name: "", costPerUnit: 0,
    shippingType: "paid",
    paidFee: s.defaultPaidFee,
    shippingCost: s.defaultShippingCost,
    selectedBoxId: s.boxes[0]?.id || null,
    selectedMaterialIds: [],
    otherCost: 0,
    maxItemsPerBox: s.maxItemsPerBox,
    naverPrice: 0, coupangPrice: 0, openmarketPrice: 0,
    bundles: [{ id: 1, qty: 2, price: 0, isBox: false }, { id: 2, qty: s.maxItemsPerBox, price: 0, isBox: true }],
  };
}

export default function App() {
  const [tab, setTab] = useState("calc");
  const [saveNotice, setSaveNotice] = useState("");

  const [settings, setSettings] = useState(() => {
    try { const s = localStorage.getItem("mc_settings_v3"); if (s) return JSON.parse(s); } catch {}
    return DEFAULT_SETTINGS;
  });
  const [products, setProducts] = useState(() => {
    try { const s = localStorage.getItem("mc_products_v3"); if (s) return JSON.parse(s); } catch {}
    return [newProduct(DEFAULT_SETTINGS)];
  });
  const [history, setHistory] = useState(() => {
    try { const s = localStorage.getItem("mc_history_v3"); if (s) return JSON.parse(s); } catch {}
    return [];
  });

  useEffect(() => { try { localStorage.setItem("mc_products_v3", JSON.stringify(products)); } catch {} }, [products]);
  useEffect(() => { try { localStorage.setItem("mc_history_v3", JSON.stringify(history.slice(0,50))); } catch {} }, [history]);

  const saveSettings = () => {
    try { localStorage.setItem("mc_settings_v3", JSON.stringify(settings)); setSaveNotice("saved"); setTimeout(() => setSaveNotice(""), 2500); } catch {}
  };
  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
    try { localStorage.removeItem("mc_settings_v3"); } catch {}
    setSaveNotice("reset"); setTimeout(() => setSaveNotice(""), 2500);
  };

  const getPkgCost = useCallback((p, s) => {
    const box = s.boxes.find(b => b.id === p.selectedBoxId);
    const mats = s.subMaterials.filter(m => (p.selectedMaterialIds || []).includes(m.id));
    return (box?.cost || 0) + mats.reduce((a, m) => a + m.cost, 0);
  }, []);

  const buildParams = useCallback((p, platformKey, price, qty = 1, overrideShipping = null) => ({
    price, qty,
    costPerUnit: p.costPerUnit,
    platformKey,
    shippingType: overrideShipping ?? p.shippingType,
    paidFee: p.paidFee,
    shippingCost: p.shippingCost,
    packagingCost: getPkgCost(p, settings),
    otherCost: p.otherCost || 0,
    reserveRate: settings.reserveRate,
    settings,
  }), [settings, getPkgCost]);

  const updateProduct = useCallback((idx, field, value) => {
    setProducts(prev => {
      const next = [...prev];
      const p = { ...next[idx], [field]: value };
      if (["naverPrice","costPerUnit","shippingType","paidFee","shippingCost",
           "selectedBoxId","selectedMaterialIds","otherCost"].includes(field)) {
        const price = field === "naverPrice" ? value : p.naverPrice;
        const cost  = field === "costPerUnit" ? value : p.costPerUnit;
        if (price > 0 && cost > 0) {
          const pkgCost = getPkgCost(p, settings);
          const base = { qty:1, costPerUnit:cost, shippingType:p.shippingType,
            paidFee:p.paidFee, shippingCost:p.shippingCost, packagingCost:pkgCost,
            otherCost:p.otherCost||0, reserveRate:settings.reserveRate, settings };
          const nr = calcMargin({ ...base, price, platformKey:"naver" });
          if (!nr.empty) {
            p.coupangPrice    = suggestPrice({ ...base, targetProfit:nr.finalProfit, platformKey:"coupang" });
            p.openmarketPrice = suggestPrice({ ...base, targetProfit:nr.finalProfit, platformKey:"openmarket" });
            p.bundles = p.bundles.map(b => ({
              ...b,
              price: Math.round(price * b.qty * (1 - (b.isBox ? settings.boxDiscountRate : settings.bundleDiscountRate) / 100) / 100) * 100,
            }));
          }
        }
      }
      next[idx] = p;
      return next;
    });
  }, [settings, getPkgCost]);

  const addProduct = () => setProducts(prev => [...prev, newProduct(settings)]);
  const removeProduct = (idx) => setProducts(prev => prev.filter((_,i) => i !== idx));
  const resetProducts = () => { if (window.confirm("상품 목록을 모두 초기화하시겠습니까?")) setProducts([newProduct(settings)]); };

  const saveHistory = (p) => {
    const r = calcMargin(buildParams(p, "naver", p.naverPrice));
    setHistory(prev => [{ ...JSON.parse(JSON.stringify(p)), id:Date.now(), savedAt:new Date().toLocaleString("ko-KR"), result:r }, ...prev]);
  };
  const deleteHistory = (id) => setHistory(prev => prev.filter(h => h.id !== id));
  const clearHistory = () => { if (window.confirm("히스토리를 모두 삭제하시겠습니까?")) setHistory([]); };

  const TABS = [
    { id:"calc", label:"마진 계산" },
    { id:"budget", label:"예산 플래너" },
    { id:"history", label:"히스토리" },
    { id:"settings", label:"환경설정" },
  ];

  return (
    <div style={{minHeight:"100vh",background:"#f7f6f3",fontFamily:"'DM Sans','Pretendard',-apple-system,sans-serif",color:"#1a1a1a"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;}
        input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none;}
        input[type=number]{-moz-appearance:textfield;}
        .inp{border:1.5px solid #e0ddd6;border-radius:9px;padding:8px 11px;font-size:14px;font-family:inherit;background:#fff;width:100%;outline:none;transition:border-color .15s;}
        .inp:focus{border-color:#1a365d;}
        .inp:disabled{opacity:.4;cursor:not-allowed;}
        .inp-price{border:2px solid #2c5282;background:#eef2ff;font-weight:600;font-size:16px;font-family:'DM Mono',monospace;color:#1a365d;border-radius:9px;padding:10px 13px;width:100%;outline:none;}
        .inp-price:focus{background:#fff;}
        .btn{border:none;border-radius:9px;cursor:pointer;font-family:inherit;font-weight:600;transition:all .15s;}
        .btn-primary{background:#1a365d;color:#fff;padding:9px 20px;font-size:14px;}
        .btn-primary:hover{background:#2c5282;}
        .btn-danger{background:#fff;color:#c53030;border:1.5px solid #fca5a5;padding:7px 14px;font-size:13px;}
        .btn-danger:hover{background:#fff5f5;}
        .btn-ghost{background:transparent;color:#666;padding:7px 14px;font-size:13px;border:1.5px solid #e0ddd6;}
        .btn-ghost:hover{border-color:#1a365d;color:#1a365d;}
        .card{background:#fff;border-radius:18px;border:1.5px solid #eae7df;padding:22px;}
        .sl{font-size:11px;font-weight:600;color:#999;letter-spacing:.7px;text-transform:uppercase;margin-bottom:6px;}
        .mono{font-family:'DM Mono',monospace;}
        .chip{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;}
        select.inp{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M0 0l6 8 6-8z' fill='%23999'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 11px center;padding-right:30px;}
        .sc-card{border:1.5px solid #eae7df;border-radius:13px;padding:14px;background:#fff;}
        .sc-card.best{border-color:#1a6b3a;background:#f0fff4;}
        .roas-pill{background:#1a365d;color:#fff;border-radius:9px;padding:8px 12px;}
      `}</style>

      <div style={{background:"#1a365d",color:"#fff",padding:"0 28px"}}>
        <div style={{maxWidth:1440,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:60}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:32,height:32,background:"#ebf8ff",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#1a365d",fontSize:16}}>₩</div>
            <div>
              <div style={{fontWeight:700,fontSize:15}}>마진 계산기</div>
              <div style={{fontSize:10,color:"#90cdf4"}}>온라인 쇼핑몰 수익 분석 시스템</div>
            </div>
          </div>
          <nav style={{display:"flex",gap:2}}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding:"7px 18px",fontSize:13,fontFamily:"inherit",
                background:tab===t.id?"rgba(255,255,255,.15)":"transparent",
                color:tab===t.id?"#fff":"#90cdf4",
                border:"none",borderRadius:7,cursor:"pointer",
                fontWeight:tab===t.id?600:400,
              }}>{t.label}</button>
            ))}
          </nav>
        </div>
      </div>

      <div style={{maxWidth:1440,margin:"0 auto",padding:"24px 28px 80px"}}>

        {tab === "calc" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
              <div>
                <h2 style={{margin:0,fontWeight:700,fontSize:20}}>상품 마진 계산</h2>
                <p style={{margin:"3px 0 0",color:"#666",fontSize:13}}>네이버 판매가 입력 → 쿠팡·오픈마켓 자동 역산 | 무배기준·박스 시나리오 비교</p>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-ghost" onClick={resetProducts} style={{fontSize:12}}>↺ 전체 초기화</button>
                <button className="btn btn-primary" onClick={addProduct}>+ 상품 추가</button>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:18}}>
              {products.map((p,idx) => (
                <ProductCard key={p.id} p={p} idx={idx} settings={settings}
                  getPkgCost={getPkgCost} buildParams={buildParams}
                  updateProduct={updateProduct} removeProduct={removeProduct}
                  saveHistory={saveHistory} setProducts={setProducts} />
              ))}
            </div>
          </div>
        )}

        {tab === "budget" && (
          <BudgetPlanner products={products} settings={settings} buildParams={buildParams} />
        )}

        {tab === "history" && (
          <HistoryTab history={history} deleteHistory={deleteHistory} clearHistory={clearHistory} />
        )}

        {tab === "settings" && (
          <SettingsPanel settings={settings} setSettings={setSettings}
            saveSettings={saveSettings} resetSettings={resetSettings} saveNotice={saveNotice} />
        )}
      </div>
    </div>
  );
}

// ── 수익 행 컴포넌트 ──
function ProfitRows({ res, settings, compact }) {
  return (
    <div style={{fontSize:12}}>
      {[
        {label:"세전이익",  v:res.profitBeforeTax, bold:false},
        {label:"세후이익",  v:res.profitAfterVat,  bold:false},
        {label:"소득세이후",v:res.finalProfit,      bold:true },
      ].map((r,i) => (
        <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderTop:i>0?"1px solid #f0ede6":"none"}}>
          <span style={{color:r.bold?"#333":"#999",fontWeight:r.bold?600:400}}>{r.label}</span>
          <span className="mono" style={{fontWeight:r.bold?700:400,color:pColor(r.v),fontSize:r.bold?14:12}}>₩{fmt(r.v)}</span>
        </div>
      ))}
      <div style={{display:"flex",justifyContent:"space-between",paddingTop:4,borderTop:"1px solid #e0ddd6",marginTop:2}}>
        <span style={{color:"#999"}}>수익률</span>
        <span style={{fontWeight:600,color:pColor(res.roi)}}>{res.roi}%</span>
      </div>
      {!compact && res.breakEvenRoas && (
        <div className="roas-pill" style={{marginTop:8}}>
          <div style={{fontSize:10,opacity:.75,marginBottom:2}}>최소 ROAS</div>
          <div style={{fontWeight:700,fontSize:20}}>{res.breakEvenRoas}%</div>
        </div>
      )}
    </div>
  );
}

// ── 상품 카드 ──
function ProductCard({ p, idx, settings, getPkgCost, buildParams, updateProduct, removeProduct, saveHistory, setProducts }) {
  const [open, setOpen] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const pkgCost = getPkgCost(p, settings);
  const boxQty  = p.maxItemsPerBox || settings.maxItemsPerBox;
  const threshold = settings.freeShippingThreshold || 50000;

  // 단품 유배
  const unitRes = calcMargin(buildParams(p,"naver",p.naverPrice));
  const coupRes = calcMargin(buildParams(p,"coupang",p.coupangPrice));
  const openRes = calcMargin(buildParams(p,"openmarket",p.openmarketPrice));

  // 무배기준: 단품가 × 무배 충족 수량, 배송판매자부담
  const freeQty        = p.naverPrice > 0 ? Math.ceil(threshold / p.naverPrice) : 0;
  const freeTotalPrice = freeQty > 0 ? p.naverPrice * freeQty : 0;
  const freeRes = freeTotalPrice > 0 ? calcMargin({
    price:freeTotalPrice, qty:freeQty, costPerUnit:p.costPerUnit,
    platformKey:"naver", shippingType:"free",
    paidFee:0, shippingCost:p.shippingCost,
    packagingCost:pkgCost, otherCost:p.otherCost||0,
    reserveRate:settings.reserveRate, settings,
  }) : null;

  // 박스 유배
  const boxPrice = p.naverPrice > 0
    ? Math.round(p.naverPrice * boxQty * (1-settings.boxDiscountRate/100) / 100) * 100 : 0;
  const boxRes = boxPrice > 0 ? calcMargin({
    price:boxPrice, qty:boxQty, costPerUnit:p.costPerUnit,
    platformKey:"naver", shippingType:p.shippingType,
    paidFee:p.paidFee, shippingCost:p.shippingCost,
    packagingCost:pkgCost, otherCost:p.otherCost||0,
    reserveRate:settings.reserveRate, settings,
  }) : null;

  // 박스 무배
  const boxFreeRes = boxPrice > 0 ? calcMargin({
    price:boxPrice, qty:boxQty, costPerUnit:p.costPerUnit,
    platformKey:"naver", shippingType:"free",
    paidFee:0, shippingCost:p.shippingCost,
    packagingCost:pkgCost, otherCost:p.otherCost||0,
    reserveRate:settings.reserveRate, settings,
  }) : null;

  // 시나리오 목록
  const scenarios = [
    { id:"unit",    label:"단품 유배",          sub:`₩${fmt(p.naverPrice)} × 1개`,                    res:unitRes },
    { id:"free",    label:`무배기준 (${freeQty}개)`, sub:`₩${fmt(freeTotalPrice)} / 무배기준 ₩${fmt(threshold)}`, res:freeRes },
    { id:"box",     label:`박스 ${boxQty}개 유배`, sub:`₩${fmt(boxPrice)}`,                           res:boxRes },
    { id:"boxfree", label:`박스 ${boxQty}개 무배`, sub:`₩${fmt(boxPrice)} (판매자배송비부담)`,          res:boxFreeRes },
  ].filter(s => s.res && !s.res.empty);

  const bestId = scenarios.length > 0
    ? scenarios.reduce((a,b) => b.res.finalProfit > a.res.finalProfit ? b : a).id
    : null;

  const runAI = async () => {
    setAiLoading(true); setAiOpen(true); setAiText("");
    const prompt = `당신은 한국 온라인 쇼핑몰(네이버 스마트스토어) 마케팅 전략 전문가입니다.

상품 정보:
- 상품명: ${p.name || "미지정"}
- 단위 매입원가: ${fmt(p.costPerUnit)}원
- 네이버 단품 판매가: ${fmt(p.naverPrice)}원
- 실 택배비: ${fmt(p.shippingCost)}원
- 무료배송 기준금액: ${fmt(threshold)}원 (${freeQty}개 구매시 충족)

판매 구성별 수익:
${scenarios.map(s=>`- ${s.label}: 소득세이후 ₩${fmt(s.res.finalProfit)} / 수익률 ${s.res.roi}% / 최소ROAS ${s.res.breakEvenRoas?s.res.breakEvenRoas+"%":"적자"}`).join("\n")}

다음을 분석해주세요 (간결·실용적으로):
1. 수익성 기준 최적 판매 방식
2. 고객 구매전환율·선호도 관점 (온라인 쇼핑 패턴)
3. 검색광고 집행 전략 (ROAS 기준)
4. 최종 추천 판매 전략`;

    try {
      const res = await fetch("/api/analyze", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ prompt }),
      });
      const data = await res.json();
      setAiText(data.result || data.content?.map(c=>c.text||"").join("") || "분석 결과를 가져올 수 없습니다.");
    } catch { setAiText("AI 분석 요청에 실패했습니다."); }
    finally { setAiLoading(false); }
  };

  return (
    <div className="card">
      {/* 헤더 */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:open?20:0}}>
        <input className="inp" placeholder="상품명 입력" value={p.name}
          onChange={e=>updateProduct(idx,"name",e.target.value)}
          style={{maxWidth:220,fontWeight:600,fontSize:15}} />
        {p.costPerUnit>0 && <span className="chip" style={{background:"#f0f4ff",color:"#2c5282"}}>원가 ₩{fmt(p.costPerUnit)}</span>}
        {unitRes.finalProfit>0 && <span className="chip" style={{background:"#f0fff4",color:"#166534"}}>수익률 {unitRes.roi}%</span>}
        <div style={{marginLeft:"auto",display:"flex",gap:7}}>
          <button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>saveHistory(p)}>저장</button>
          <button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>setOpen(v=>!v)}>{open?"접기":"펼치기"}</button>
          <button className="btn btn-danger" style={{fontSize:12}} onClick={()=>removeProduct(idx)}>삭제</button>
        </div>
      </div>

      {open && (
        <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:20}}>

          {/* 입력 */}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div>
              <div className="sl">매입 원가 (VAT 포함)</div>
              <input className="inp inp-price" value={p.costPerUnit||""} type="text" inputMode="numeric"
                onChange={e=>updateProduct(idx,"costPerUnit",parse(e.target.value))}
                onFocus={e=>e.target.select()} placeholder="0" />
            </div>
            <div>
              <div className="sl">네이버 판매가</div>
              <input className="inp inp-price" value={p.naverPrice||""} type="text" inputMode="numeric"
                style={{borderColor:"#276749",background:"#f0fff4",color:"#1a6b3a"}}
                onChange={e=>updateProduct(idx,"naverPrice",parse(e.target.value))}
                onFocus={e=>e.target.select()} placeholder="0" />
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
              <div>
                <div className="sl">배송 방식</div>
                <select className="inp" value={p.shippingType} onChange={e=>updateProduct(idx,"shippingType",e.target.value)}>
                  <option value="paid">유료배송</option>
                  <option value="free">무료배송</option>
                </select>
              </div>
              <div>
                <div className="sl">소비자 배송비</div>
                <input className="inp" value={p.paidFee||""} type="text" inputMode="numeric"
                  disabled={p.shippingType==="free"}
                  onChange={e=>updateProduct(idx,"paidFee",parse(e.target.value))}
                  onFocus={e=>e.target.select()} />
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
              <div>
                <div className="sl">실 택배비 (원가)</div>
                <input className="inp" value={p.shippingCost||""} type="text" inputMode="numeric"
                  onChange={e=>updateProduct(idx,"shippingCost",parse(e.target.value))}
                  onFocus={e=>e.target.select()} />
              </div>
              <div>
                <div className="sl">박스 입수량</div>
                <input className="inp" value={p.maxItemsPerBox||""} type="number" min="1"
                  onChange={e=>updateProduct(idx,"maxItemsPerBox",parseInt(e.target.value)||1)} />
              </div>
            </div>
            <div>
              <div className="sl">박스 선택</div>
              <select className="inp" value={p.selectedBoxId||""} style={{marginBottom:7}}
                onChange={e=>updateProduct(idx,"selectedBoxId",e.target.value)}>
                <option value="">박스 없음</option>
                {settings.boxes.map(b=><option key={b.id} value={b.id}>{b.name} (₩{fmt(b.cost)})</option>)}
              </select>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {settings.subMaterials.map(m=>(
                  <label key={m.id} style={{display:"flex",alignItems:"center",gap:4,fontSize:12,cursor:"pointer"}}>
                    <input type="checkbox"
                      checked={(p.selectedMaterialIds||[]).includes(m.id)}
                      onChange={e=>{
                        const curr=p.selectedMaterialIds||[];
                        updateProduct(idx,"selectedMaterialIds",e.target.checked?[...curr,m.id]:curr.filter(id=>id!==m.id));
                      }} />
                    {m.name} ₩{fmt(m.cost)}
                  </label>
                ))}
              </div>
              {pkgCost>0 && <div style={{fontSize:12,color:"#666",marginTop:5}}>포장재: ₩{fmt(pkgCost)}</div>}
            </div>
            <div>
              <div className="sl">기타비용</div>
              <input className="inp" value={p.otherCost||""} type="text" inputMode="numeric"
                onChange={e=>updateProduct(idx,"otherCost",parse(e.target.value))}
                onFocus={e=>e.target.select()} />
            </div>
          </div>

          {/* 결과 */}
          <div style={{display:"flex",flexDirection:"column",gap:14}}>

            {/* 플랫폼 3개 */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:11}}>
              {[
                {key:"naver",      label:"네이버",  price:p.naverPrice,      field:"naverPrice",      res:unitRes, c:"#276749",bg:"#f0fff4"},
                {key:"coupang",    label:"쿠팡",    price:p.coupangPrice,    field:"coupangPrice",    res:coupRes, c:"#9c4221",bg:"#fffaf0"},
                {key:"openmarket", label:"오픈마켓", price:p.openmarketPrice, field:"openmarketPrice", res:openRes, c:"#1e4e8c",bg:"#ebf8ff"},
              ].map(({key,label,price,field,res,c,bg})=>(
                <div key={key} style={{border:`1.5px solid ${c}30`,borderRadius:13,padding:13,background:bg}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <span className="chip" style={{background:`${c}18`,color:c,border:`1px solid ${c}40`}}>{label}</span>
                    <span style={{fontSize:11,color:"#999"}}>{settings.fees[key].rate}%</span>
                  </div>
                  <div className="sl">판매가</div>
                  <input className="inp mono" value={price||""} type="text" inputMode="numeric"
                    style={{fontWeight:700,fontSize:17,color:c,borderColor:`${c}60`,marginBottom:9}}
                    onChange={e=>updateProduct(idx,field,parse(e.target.value))}
                    onFocus={e=>e.target.select()} />
                  {key!=="naver"&&price>0&&p.naverPrice>0&&
                    <div style={{fontSize:11,color:"#999",marginBottom:8}}>네이버 대비 +{fmt(price-p.naverPrice)}원</div>}
                  {!res.empty ? <ProfitRows res={res} settings={settings} />
                    : <div style={{color:"#bbb",fontSize:12,textAlign:"center",padding:"16px 0"}}>원가·판매가 입력</div>}
                </div>
              ))}
            </div>

            {/* 번들 + 박스단위 */}
            <div style={{border:"1.5px solid #eae7df",borderRadius:13,padding:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div>
                  <div style={{fontWeight:600,fontSize:14}}>번들 · 박스단위 구성</div>
                  <div style={{fontSize:11,color:"#999",marginTop:2}}>판매가 직접 수정 가능 · 수익은 입력 즉시 재계산</div>
                </div>
                <button className="btn btn-ghost" style={{fontSize:11,padding:"4px 10px"}}
                  onClick={()=>setProducts(prev=>{
                    const n=[...prev];
                    const lastQty=n[idx].bundles.filter(b=>!b.isBox).slice(-1)[0]?.qty||2;
                    const qty=lastQty+1;
                    const price=n[idx].naverPrice>0?Math.round(n[idx].naverPrice*qty*(1-settings.bundleDiscountRate/100)/100)*100:0;
                    n[idx]={...n[idx],bundles:[...n[idx].bundles,{id:Date.now(),qty,price,isBox:false}]};
                    return n;
                  })}>+ 번들 추가</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
                {p.bundles.map((b,bi)=>{
                  const bRes=b.price>0?calcMargin({
                    price:b.price,qty:b.qty,costPerUnit:p.costPerUnit,
                    platformKey:"naver",shippingType:p.shippingType,
                    paidFee:p.paidFee,shippingCost:p.shippingCost,
                    packagingCost:pkgCost,otherCost:p.otherCost||0,
                    reserveRate:settings.reserveRate,settings,
                  }):null;
                  const discRate = b.isBox ? settings.boxDiscountRate : settings.bundleDiscountRate;
                  const autoPrice = p.naverPrice > 0
                    ? Math.round(p.naverPrice * b.qty * (1 - discRate/100) / 100) * 100 : 0;
                  return (
                    <div key={b.id} style={{
                      background: b.isBox ? "#f0f9ff" : "#f8f7f4",
                      border: b.isBox ? "1.5px solid #bae6fd" : "1.5px solid #eae7df",
                      borderRadius:11,padding:12,position:"relative"
                    }}>
                      {/* 헤더 */}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <span style={{
                          fontSize:11,fontWeight:600,
                          color: b.isBox ? "#0369a1" : "#666",
                          background: b.isBox ? "#e0f2fe" : "#ede9e3",
                          padding:"2px 8px",borderRadius:20
                        }}>{b.isBox ? "📦 박스단위" : "🔗 번들"}</span>
                        <button style={{background:"none",border:"none",cursor:"pointer",color:"#bbb",fontSize:15,lineHeight:1,padding:"2px 4px"}}
                          onClick={()=>setProducts(prev=>{const n=[...prev];n[idx].bundles=n[idx].bundles.filter((_,i)=>i!==bi);return n;})}>×</button>
                      </div>

                      {/* 수량 */}
                      <div style={{display:"flex",gap:7,alignItems:"center",marginBottom:6}}>
                        <span style={{fontSize:12,color:"#666",whiteSpace:"nowrap"}}>수량</span>
                        <input className="inp" style={{width:54,textAlign:"center",fontSize:13}}
                          value={b.qty} type="number" min="2"
                          onChange={e=>{
                            const qty=Math.max(2,parseInt(e.target.value)||2);
                            const price=p.naverPrice>0?Math.round(p.naverPrice*qty*(1-discRate/100)/100)*100:b.price;
                            setProducts(prev=>{const n=[...prev];n[idx].bundles[bi]={...b,qty,price};return n;});
                          }} />
                        <span style={{fontSize:11,color:"#888"}}>EA</span>
                        {/* 박스단위 토글 */}
                        <label style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#888",cursor:"pointer"}}>
                          <input type="checkbox" checked={!!b.isBox}
                            onChange={e=>{
                              const isBox=e.target.checked;
                              const dr=isBox?settings.boxDiscountRate:settings.bundleDiscountRate;
                              const price=p.naverPrice>0?Math.round(p.naverPrice*b.qty*(1-dr/100)/100)*100:b.price;
                              setProducts(prev=>{const n=[...prev];n[idx].bundles[bi]={...b,isBox,price};return n;});
                            }} />
                          박스
                        </label>
                      </div>

                      {/* 원가 + 할인율 표시 */}
                      <div style={{fontSize:11,color:"#999",marginBottom:6,display:"flex",justifyContent:"space-between"}}>
                        <span>원가 ₩{fmt(p.costPerUnit*b.qty)}</span>
                        <span>{discRate}% 할인 기준 ₩{fmt(autoPrice)}</span>
                      </div>

                      {/* 판매가 — 직접 수정 가능 */}
                      <div className="sl">판매가 (직접 수정 가능)</div>
                      <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:8}}>
                        <input className="inp mono" style={{fontWeight:600,fontSize:15,
                          borderColor: b.isBox ? "#7dd3fc" : "#c8c4bc",
                          background: b.isBox ? "#fff" : "#fff"
                        }}
                          value={b.price||""} type="text" inputMode="numeric"
                          onFocus={e=>e.target.select()}
                          onChange={e=>setProducts(prev=>{const n=[...prev];n[idx].bundles[bi]={...b,price:parse(e.target.value)};return n;})} />
                        {/* 자동계산 복원 버튼 */}
                        {b.price !== autoPrice && autoPrice > 0 && (
                          <button title="할인율 자동계산으로 복원" style={{
                            background:"none",border:"1px solid #e0ddd6",borderRadius:7,
                            cursor:"pointer",fontSize:11,color:"#999",padding:"4px 7px",whiteSpace:"nowrap"
                          }}
                            onClick={()=>setProducts(prev=>{const n=[...prev];n[idx].bundles[bi]={...b,price:autoPrice};return n;})}>
                            ↺ 자동
                          </button>
                        )}
                      </div>

                      {/* 개당 단가 */}
                      {b.price>0 && <div style={{fontSize:11,color:"#888",marginBottom:6}}>개당 ₩{fmt(Math.round(b.price/b.qty))}</div>}

                      {/* 수익 */}
                      {bRes&&!bRes.empty&&<ProfitRows res={bRes} settings={settings} compact />}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 시나리오 비교 + AI */}
            {scenarios.length>0 && (
              <div style={{border:"1.5px solid #eae7df",borderRadius:13,padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={{fontWeight:600,fontSize:14}}>시나리오 비교</div>
                    <div style={{fontSize:11,color:"#999"}}>단품 무배기준 vs 박스 유배/무배 수익 비교</div>
                  </div>
                  <button className="btn btn-primary" style={{fontSize:12,padding:"7px 14px",background:"#312e81"}}
                    onClick={runAI} disabled={aiLoading}>
                    {aiLoading?"분석 중...":"🤖 AI 전략 분석"}
                  </button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>
                  {scenarios.map(s=>(
                    <div key={s.id} className={`sc-card${s.id===bestId?" best":""}`}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                        <div>
                          <div style={{fontWeight:600,fontSize:13}}>{s.label}</div>
                          <div style={{fontSize:11,color:"#999"}}>{s.sub}</div>
                        </div>
                        {s.id===bestId&&<span className="chip" style={{background:"#dcfce7",color:"#166534",fontSize:10}}>최고수익</span>}
                      </div>
                      <div style={{fontSize:12}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                          <span style={{color:"#888"}}>세후이익</span>
                          <span className="mono" style={{color:pColor(s.res.profitAfterVat)}}>₩{fmt(s.res.profitAfterVat)}</span>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                          <span style={{color:"#555",fontWeight:600}}>소득세이후</span>
                          <span className="mono" style={{color:pColor(s.res.finalProfit),fontWeight:700,fontSize:14}}>₩{fmt(s.res.finalProfit)}</span>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between"}}>
                          <span style={{color:"#888"}}>수익률</span>
                          <span style={{fontWeight:600,color:pColor(s.res.roi)}}>{s.res.roi}%</span>
                        </div>
                        {s.res.breakEvenRoas&&(
                          <div style={{marginTop:7,background:"#1a365d",color:"#fff",borderRadius:7,padding:"6px 9px",fontSize:11}}>
                            최소 ROAS <span className="mono" style={{fontWeight:700}}>{s.res.breakEvenRoas}%</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI 결과 */}
            {aiOpen&&(
              <div style={{border:"1.5px solid #c7d2fe",borderRadius:13,padding:16,background:"#eef2ff"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{fontWeight:600,fontSize:14,color:"#312e81"}}>🤖 AI 판매 전략 분석</div>
                  <button className="btn btn-ghost" style={{fontSize:11,padding:"3px 10px"}} onClick={()=>setAiOpen(false)}>닫기</button>
                </div>
                {aiLoading
                  ? <div style={{color:"#666",fontSize:13}}>분석 중입니다...</div>
                  : <div style={{fontSize:13,color:"#1e1b4b",lineHeight:1.8,whiteSpace:"pre-wrap"}}>{aiText}</div>}
              </div>
            )}

            {/* 수익 구조 상세 */}
            {!unitRes.empty&&(
              <div style={{border:"1.5px solid #eae7df",borderRadius:13,padding:14}}>
                <div style={{fontWeight:600,fontSize:14,marginBottom:12}}>수익 구조 상세 (네이버·단품 기준)</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
                  <div style={{fontSize:12}}>
                    {[
                      {label:"판매 매출",   value:unitRes.totalSales,           sign:"+",c:"#1a6b3a"},
                      {label:"배송수입",    value:unitRes.shippingInflow||0,     sign:"+",c:"#1a6b3a"},
                      {label:"매입 원가",   value:-unitRes.totalCost,            sign:"−",c:"#c53030"},
                      {label:"실 택배비",   value:-(unitRes.shippingCost||0),    sign:"−",c:"#c53030"},
                      {label:"플랫폼 수수료",value:-unitRes.totalPlatformFee,   sign:"−",c:"#c53030"},
                      {label:"포장재",      value:-pkgCost,                      sign:"−",c:"#c53030"},
                      {label:"예비비",      value:-(unitRes.totalSales*(settings.reserveRate||0)/100), sign:"−",c:"#c53030"},
                      {label:"부가세",      value:-unitRes.vatPayable,           sign:"−",c:"#d97706"},
                    ].filter(r=>r.value!==0).map((r,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #f5f3ef"}}>
                        <span style={{color:"#555"}}><span style={{color:r.c,marginRight:5,fontFamily:"DM Mono"}}>{r.sign}</span>{r.label}</span>
                        <span className="mono" style={{color:r.c,fontSize:12}}>{r.value>=0?`₩${fmt(r.value)}`:`₩${fmt(Math.abs(r.value))}`}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {[
                      {label:"① 세전이익",   sub:"(총수입−비용)÷1.1",           value:unitRes.profitBeforeTax, bg:"#f8f7f4",bc:"#e0ddd6",tc:"#444"},
                      {label:"② 세후이익",   sub:`세전이익 − 부가세`,            value:unitRes.profitAfterVat,  bg:"#eff6ff",bc:"#bfdbfe",tc:"#1e40af"},
                      {label:"③ 소득세이후", sub:`× ${100-settings.incomeTaxRate}%  수익률 ${unitRes.roi}%`, value:unitRes.finalProfit, bg:unitRes.finalProfit>=0?"#f0fff4":"#fff5f5",bc:unitRes.finalProfit>=0?"#86efac":"#fca5a5",tc:unitRes.finalProfit>=0?"#166534":"#991b1b",bold:true},
                    ].map((s,i)=>(
                      <div key={i} style={{padding:"9px 11px",background:s.bg,border:`1.5px solid ${s.bc}`,borderRadius:9}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                          <div>
                            <div style={{fontWeight:s.bold?700:600,fontSize:12,color:s.tc}}>{s.label}</div>
                            <div style={{fontSize:10,color:"#999"}}>{s.sub}</div>
                          </div>
                          <span className="mono" style={{fontWeight:700,fontSize:s.bold?16:13,color:s.tc}}>₩{fmt(s.value)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 예산 플래너 ──
function BudgetPlanner({ products, settings, buildParams }) {
  const [budget, setBudget]         = useState(0);
  const [targetRoas, setTargetRoas] = useState(300);
  const [compareItems, setCompareItems] = useState([]);
  const [dragOver, setDragOver]     = useState(false);
  const validPs = products.filter(p=>p.naverPrice>0&&p.costPerUnit>0);
  const targetSales = budget>0?Math.round(budget*(targetRoas/100)):0;

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <h2 style={{margin:0,fontWeight:700,fontSize:20}}>예산 플래너</h2>
        {compareItems.length>0&&<button className="btn btn-danger" style={{fontSize:12}} onClick={()=>setCompareItems([])}>비교 초기화</button>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:20}}>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div className="card">
            <div style={{fontWeight:600,marginBottom:14}}>예산 설정</div>
            <div style={{marginBottom:11}}>
              <div className="sl">월 광고 예산</div>
              <input className="inp inp-price" value={budget||""} type="text" inputMode="numeric"
                onFocus={e=>e.target.select()} onChange={e=>setBudget(parse(e.target.value))} placeholder="0" />
            </div>
            <div>
              <div className="sl">목표 ROAS (%)</div>
              <input className="inp" value={targetRoas} type="number" min="100" step="10"
                onChange={e=>setTargetRoas(parse(e.target.value))} />
              <div style={{fontSize:11,color:"#999",marginTop:4}}>{targetRoas}% = ₩1 광고비당 ₩{(targetRoas/100).toFixed(2)} 매출</div>
            </div>
          </div>
          {budget>0&&(
            <div className="card" style={{background:"#1a365d",color:"#fff",border:"none"}}>
              <div style={{fontSize:12,opacity:.8,marginBottom:6}}>목표 월 매출</div>
              <div className="mono" style={{fontSize:26,fontWeight:700}}>₩{fmt(targetSales)}</div>
              <div style={{borderTop:"1px solid rgba(255,255,255,.2)",paddingTop:12,marginTop:12,fontSize:13}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{opacity:.7}}>광고비</span><span className="mono">₩{fmt(budget)}</span></div>
                <div style={{display:"flex",justifyContent:"space-between"}}><span style={{opacity:.7}}>목표 ROAS</span><span className="mono">{targetRoas}%</span></div>
              </div>
            </div>
          )}
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div className="card">
            <div style={{fontWeight:600,marginBottom:12}}>상품별 수익 요약</div>
            {validPs.length===0 ? (
              <div style={{textAlign:"center",padding:"28px 0",color:"#bbb"}}>마진 계산 탭에서 상품 입력</div>
            ) : (
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:"2px solid #eae7df",color:"#999"}}>
                    {["상품명","판매가","소득세이후","수익률","최소ROAS",""].map((h,i)=>(
                      <th key={i} style={{textAlign:i>0?"right":"left",padding:"0 10px 8px",fontWeight:600,fontSize:11}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {validPs.map((p,i)=>{
                    const res=calcMargin(buildParams(p,"naver",p.naverPrice));
                    return (
                      <tr key={p.id} style={{borderBottom:"1px solid #f0ede6"}}>
                        <td style={{padding:"9px 10px 9px 0",fontWeight:500}}>{p.name||`상품${i+1}`}</td>
                        <td style={{padding:"9px 10px",textAlign:"right",fontFamily:"DM Mono"}}>₩{fmt(p.naverPrice)}</td>
                        <td style={{padding:"9px 10px",textAlign:"right",fontFamily:"DM Mono",color:pColor(res.finalProfit),fontWeight:600}}>₩{fmt(res.finalProfit)}</td>
                        <td style={{padding:"9px 10px",textAlign:"right",fontWeight:600,color:pColor(res.roi)}}>{res.roi}%</td>
                        <td style={{padding:"9px 10px",textAlign:"right"}}>
                          {res.breakEvenRoas
                            ?<span style={{background:"#eef2ff",color:"#2c5282",padding:"2px 8px",borderRadius:6,fontSize:12,fontWeight:600}}>{res.breakEvenRoas}%</span>
                            :<span style={{color:"#c53030"}}>적자</span>}
                        </td>
                        <td style={{padding:"9px 0",textAlign:"right"}}>
                          <button className="btn btn-ghost" style={{fontSize:11,padding:"3px 9px"}}
                            draggable onDragStart={e=>e.dataTransfer.setData("text/plain",JSON.stringify({...p,result:res}))}
                            onClick={()=>{if(!compareItems.find(c=>c.id===p.id))setCompareItems(prev=>[...prev,{...p,result:res}].slice(0,4));}}>비교↓</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div
            onDragOver={e=>{e.preventDefault();setDragOver(true);}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={e=>{e.preventDefault();setDragOver(false);try{const item=JSON.parse(e.dataTransfer.getData("text/plain"));if(!compareItems.find(c=>c.id===item.id))setCompareItems(prev=>[...prev,item].slice(0,4));}catch{}}}
            style={{borderRadius:18,padding:22,minHeight:110,
              border:`1.5px dashed ${dragOver?"#2c5282":"#eae7df"}`,
              background:dragOver?"#eef2ff":"#fff",transition:"all .15s"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontWeight:600,fontSize:14}}>상품 비교 {compareItems.length>0?`(${compareItems.length}/4)`:""}</div>
              <div style={{fontSize:12,color:"#999"}}>드래그 또는 "비교↓" 버튼으로 추가</div>
            </div>
            {compareItems.length===0
              ?<div style={{textAlign:"center",color:"#bbb",padding:"16px 0",fontSize:13}}>상품을 여기로 드래그하세요</div>
              :(
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:12}}>
                  {compareItems.map(item=>(
                    <div key={item.id} style={{background:"#f8f7f4",borderRadius:11,padding:13,position:"relative"}}>
                      <button style={{position:"absolute",top:8,right:10,background:"none",border:"none",cursor:"pointer",color:"#bbb",fontSize:16}}
                        onClick={()=>setCompareItems(prev=>prev.filter(c=>c.id!==item.id))}>×</button>
                      <div style={{fontWeight:600,fontSize:13,marginBottom:8}}>{item.name||"미지정"}</div>
                      <div style={{fontSize:12}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{color:"#888"}}>판매가</span><span className="mono">₩{fmt(item.naverPrice)}</span></div>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{color:"#555",fontWeight:600}}>소득세이후</span><span className="mono" style={{color:pColor(item.result?.finalProfit||0),fontWeight:700}}>₩{fmt(item.result?.finalProfit)}</span></div>
                        <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"#888"}}>수익률</span><span style={{fontWeight:600,color:pColor(item.result?.roi||0)}}>{item.result?.roi}%</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>

          {budget>0&&validPs.length>0&&(
            <div className="card" style={{background:"#f0f4ff",border:"1.5px solid #c7d2fe"}}>
              <div style={{fontWeight:600,marginBottom:8,color:"#1a365d"}}>광고 시뮬레이션</div>
              <div style={{fontSize:13,color:"#444",lineHeight:1.9}}>
                <div>월 광고비 <strong>₩{fmt(budget)}</strong> × ROAS <strong>{targetRoas}%</strong> 달성 시</div>
                <div>→ 목표 매출: <strong style={{fontFamily:"DM Mono",fontSize:15}}>₩{fmt(targetSales)}</strong></div>
                <div>→ 필요 주문 (평균 판매가): <strong>{fmt(Math.round(targetSales/(validPs.reduce((s,p)=>s+p.naverPrice,0)/validPs.length)))}건</strong></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 히스토리 탭 ──
function HistoryTab({ history, deleteHistory, clearHistory }) {
  const [compareItems, setCompareItems] = useState([]);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <h2 style={{margin:0,fontWeight:700,fontSize:20}}>히스토리 ({history.length}건)</h2>
        <div style={{display:"flex",gap:8}}>
          {compareItems.length>0&&<button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>setCompareItems([])}>비교 초기화</button>}
          {history.length>0&&<button className="btn btn-danger" style={{fontSize:12}} onClick={clearHistory}>전체 삭제</button>}
        </div>
      </div>

      <div style={{marginBottom:16,borderRadius:18,padding:22,
        border:`1.5px dashed ${dragOver?"#2c5282":"#eae7df"}`,
        minHeight:100,background:dragOver?"#eef2ff":"#fff",transition:"all .15s"}}
        onDragOver={e=>{e.preventDefault();setDragOver(true);}}
        onDragLeave={()=>setDragOver(false)}
        onDrop={e=>{e.preventDefault();setDragOver(false);try{const item=JSON.parse(e.dataTransfer.getData("text/plain"));if(!compareItems.find(c=>c.id===item.id))setCompareItems(prev=>[...prev,item].slice(0,4));}catch{}}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontWeight:600}}>비교 영역 <span style={{fontSize:12,color:"#999",fontWeight:400}}>— 카드를 드래그하거나 "비교" 버튼으로 추가 (최대 4개)</span></div>
        </div>
        {compareItems.length===0
          ?<div style={{color:"#bbb",fontSize:13,textAlign:"center",padding:"14px 0"}}>히스토리 카드를 여기로 드래그하세요</div>
          :(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12}}>
              {compareItems.map(item=>(
                <div key={item.id} style={{background:"#f0f4ff",border:"1.5px solid #c7d2fe",borderRadius:11,padding:13,position:"relative"}}>
                  <button style={{position:"absolute",top:8,right:10,background:"none",border:"none",cursor:"pointer",color:"#bbb",fontSize:16}}
                    onClick={()=>setCompareItems(prev=>prev.filter(c=>c.id!==item.id))}>×</button>
                  <div style={{fontWeight:600,fontSize:13,color:"#312e81",marginBottom:6}}>{item.name||"미지정"}</div>
                  <div style={{fontSize:11,color:"#999",marginBottom:8}}>{item.savedAt}</div>
                  <div style={{fontSize:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{color:"#888"}}>판매가</span><span className="mono">₩{fmt(item.naverPrice)}</span></div>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{color:"#555",fontWeight:600}}>소득세이후</span><span className="mono" style={{color:pColor(item.result?.finalProfit||0),fontWeight:700}}>₩{fmt(item.result?.finalProfit)}</span></div>
                    <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"#888"}}>수익률</span><span style={{fontWeight:600,color:pColor(item.result?.roi||0)}}>{item.result?.roi}%</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      {history.length===0
        ?<div className="card" style={{textAlign:"center",padding:"50px 0",color:"#bbb"}}>
          <div style={{fontSize:36,marginBottom:10}}>📋</div>
          <div>마진 계산 탭에서 저장 버튼을 누르면 기록됩니다</div>
        </div>
        :(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
            {history.map(h=>(
              <div key={h.id} className="card" draggable
                onDragStart={e=>e.dataTransfer.setData("text/plain",JSON.stringify(h))}
                style={{cursor:"grab",userSelect:"none"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                  <div style={{fontWeight:600,fontSize:14}}>{h.name||"미지정"}</div>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn btn-ghost" style={{fontSize:11,padding:"2px 8px"}}
                      onClick={()=>{if(!compareItems.find(c=>c.id===h.id))setCompareItems(prev=>[...prev,h].slice(0,4));}}>비교</button>
                    <button className="btn btn-danger" style={{fontSize:11,padding:"2px 8px"}} onClick={()=>deleteHistory(h.id)}>삭제</button>
                  </div>
                </div>
                <div style={{fontSize:11,color:"#999",marginBottom:10}}>{h.savedAt}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:13}}>
                  <div><div className="sl">판매가</div><div className="mono" style={{fontWeight:600}}>₩{fmt(h.naverPrice)}</div></div>
                  <div><div className="sl">원가</div><div className="mono">₩{fmt(h.costPerUnit)}</div></div>
                  <div><div className="sl">세후이익</div><div className="mono" style={{color:pColor(h.result?.profitAfterVat||0),fontWeight:600}}>₩{fmt(h.result?.profitAfterVat)}</div></div>
                  <div><div className="sl">소득세이후</div><div className="mono" style={{color:pColor(h.result?.finalProfit||0),fontWeight:700}}>₩{fmt(h.result?.finalProfit)}</div></div>
                  <div><div className="sl">수익률</div><div style={{fontWeight:600,color:pColor(h.result?.roi||0)}}>{h.result?.roi}%</div></div>
                  {h.result?.breakEvenRoas&&<div><div className="sl">최소 ROAS</div><div style={{fontWeight:600,color:"#2c5282"}}>{h.result.breakEvenRoas}%</div></div>}
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ── 환경설정 ──
function SettingsPanel({ settings, setSettings, saveSettings, resetSettings, saveNotice }) {
  const upd = (path, value) => {
    setSettings(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split(".");
      let obj = next;
      for (let i = 0; i < keys.length-1; i++) obj = obj[keys[i]];
      obj[keys[keys.length-1]] = value;
      return next;
    });
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <div>
          <h2 style={{margin:0,fontWeight:700,fontSize:20}}>환경설정</h2>
          <p style={{margin:"3px 0 0",color:"#666",fontSize:13}}>수치 변경 후 <strong>설정 저장</strong>을 눌러야 계산에 반영됩니다</p>
        </div>
        <div style={{display:"flex",gap:9,alignItems:"center"}}>
          {saveNotice==="saved"&&<span style={{fontSize:13,color:"#1a6b3a",fontWeight:600,padding:"5px 13px",background:"#f0fff4",border:"1.5px solid #86efac",borderRadius:8}}>✓ 저장 완료</span>}
          {saveNotice==="reset"&&<span style={{fontSize:13,color:"#92400e",fontWeight:600,padding:"5px 13px",background:"#fffbeb",border:"1.5px solid #fcd34d",borderRadius:8}}>↺ 초기화됨</span>}
          <button className="btn btn-ghost" onClick={resetSettings} style={{fontSize:13}}>기본값 초기화</button>
          <button className="btn btn-primary" onClick={saveSettings} style={{fontSize:14,padding:"9px 22px"}}>설정 저장</button>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:18}}>
        <div className="card">
          <div style={{fontWeight:600,fontSize:15,marginBottom:14,paddingBottom:10,borderBottom:"2px solid #1a365d"}}>플랫폼 수수료율</div>
          {Object.entries(settings.fees).map(([key,val])=>(
            <div key={key} style={{marginBottom:12}}>
              <div className="sl">{val.label}</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input className="inp" style={{width:90,textAlign:"center"}} type="number" step=".01" value={val.rate}
                  onChange={e=>upd(`fees.${key}.rate`,parseFloat(e.target.value))} />
                <span style={{fontSize:13,color:"#666"}}>%</span>
              </div>
            </div>
          ))}
          <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #eae7df"}}>
            <div className="sl">유료배송 배송비 수수료</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <input className="inp" style={{width:90,textAlign:"center"}} type="number" step=".1" value={settings.shippingFeeCommission}
                onChange={e=>upd("shippingFeeCommission",parseFloat(e.target.value))} />
              <span style={{fontSize:13,color:"#666"}}>% (배송비에 부과)</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div style={{fontWeight:600,fontSize:15,marginBottom:14,paddingBottom:10,borderBottom:"2px solid #1a365d"}}>세금 · 예비비 · 할인율</div>
          {[
            {label:"소득세율",             key:"incomeTaxRate",      unit:"%",        step:"1"},
            {label:"예비비 (포인트·사은품)",key:"reserveRate",         unit:"% (매출)", step:".1"},
            {label:"번들 할인율",          key:"bundleDiscountRate",  unit:"%",        step:".5"},
            {label:"박스단위 할인율",      key:"boxDiscountRate",     unit:"%",        step:".5"},
          ].map(({label,key,unit,step})=>(
            <div key={key} style={{marginBottom:12}}>
              <div className="sl">{label}</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input className="inp" style={{width:90,textAlign:"center"}} type="number" step={step} value={settings[key]}
                  onChange={e=>upd(key,parseFloat(e.target.value))} />
                <span style={{fontSize:13,color:"#666"}}>{unit}</span>
              </div>
            </div>
          ))}
          <div style={{paddingTop:10,borderTop:"1px solid #eae7df",display:"flex",flexDirection:"column",gap:10}}>
            <div>
              <div className="sl">기본 실 택배비 (박스당)</div>
              <input className="inp" value={settings.defaultShippingCost} type="text" inputMode="numeric"
                onChange={e=>upd("defaultShippingCost",parse(e.target.value))} />
            </div>
            <div>
              <div className="sl">기본 유료배송비 (소비자)</div>
              <input className="inp" value={settings.defaultPaidFee} type="text" inputMode="numeric"
                onChange={e=>upd("defaultPaidFee",parse(e.target.value))} />
            </div>
            <div>
              <div className="sl">무료배송 기준금액</div>
              <input className="inp inp-price" value={settings.freeShippingThreshold} type="text" inputMode="numeric"
                onChange={e=>upd("freeShippingThreshold",parse(e.target.value))} />
              <div style={{fontSize:11,color:"#999",marginTop:4}}>이 금액 이상 구매 시 무료배송 적용 (시나리오 비교에 자동 반영)</div>
            </div>
            <div>
              <div className="sl">기본 박스 입수량</div>
              <input className="inp" style={{width:90}} value={settings.maxItemsPerBox} type="number" min="1"
                onChange={e=>upd("maxItemsPerBox",parseInt(e.target.value))} />
            </div>
          </div>
        </div>

        <div className="card">
          <div style={{fontWeight:600,fontSize:15,marginBottom:14,paddingBottom:10,borderBottom:"2px solid #1a365d"}}>박스 · 부자재</div>
          <div style={{marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div className="sl" style={{margin:0}}>박스 종류</div>
              <button className="btn btn-ghost" style={{fontSize:11,padding:"3px 10px"}}
                onClick={()=>upd("boxes",[...settings.boxes,{id:"b"+Date.now(),name:"신규박스",cost:0}])}>+ 추가</button>
            </div>
            {settings.boxes.map((b,i)=>(
              <div key={b.id} style={{display:"flex",gap:7,marginBottom:7,alignItems:"center"}}>
                <input className="inp" style={{flex:1}} value={b.name}
                  onChange={e=>{const n=[...settings.boxes];n[i]={...b,name:e.target.value};upd("boxes",n);}} />
                <input className="inp" style={{width:80,textAlign:"right"}} value={b.cost} type="text" inputMode="numeric"
                  onChange={e=>{const n=[...settings.boxes];n[i]={...b,cost:parse(e.target.value)};upd("boxes",n);}} />
                <span style={{fontSize:12,color:"#999"}}>원</span>
                <button className="btn btn-danger" style={{fontSize:11,padding:"3px 7px"}}
                  onClick={()=>upd("boxes",settings.boxes.filter((_,j)=>j!==i))}>×</button>
              </div>
            ))}
          </div>
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div className="sl" style={{margin:0}}>부자재</div>
              <button className="btn btn-ghost" style={{fontSize:11,padding:"3px 10px"}}
                onClick={()=>upd("subMaterials",[...settings.subMaterials,{id:"m"+Date.now(),name:"신규부자재",cost:0}])}>+ 추가</button>
            </div>
            {settings.subMaterials.map((m,i)=>(
              <div key={m.id} style={{display:"flex",gap:7,marginBottom:7,alignItems:"center"}}>
                <input className="inp" style={{flex:1}} value={m.name}
                  onChange={e=>{const n=[...settings.subMaterials];n[i]={...m,name:e.target.value};upd("subMaterials",n);}} />
                <input className="inp" style={{width:80,textAlign:"right"}} value={m.cost} type="text" inputMode="numeric"
                  onChange={e=>{const n=[...settings.subMaterials];n[i]={...m,cost:parse(e.target.value)};upd("subMaterials",n);}} />
                <span style={{fontSize:12,color:"#999"}}>원</span>
                <button className="btn btn-danger" style={{fontSize:11,padding:"3px 7px"}}
                  onClick={()=>upd("subMaterials",settings.subMaterials.filter((_,j)=>j!==i))}>×</button>
              </div>
            ))}
          </div>
          <div style={{marginTop:16,padding:12,background:"#f8f7f4",borderRadius:10,fontSize:12,color:"#555",lineHeight:1.9}}>
            <div style={{fontWeight:600,color:"#1a365d",marginBottom:6}}>수식 (고정)</div>
            <div>수수료 = 판매가×수수료율 + 배송수입×3.3%</div>
            <div>세전이익 = (총수입−원가−택배비−수수료−포장−예비비) ÷ 1.1</div>
            <div>부가세 = 총매출VAT − 공제VAT</div>
            <div>세후이익 = 세전이익 − 부가세</div>
            <div>소득세이후 = 세후이익 × (1−소득세율%)</div>
            <div>수익률 = 소득세이후 ÷ 판매가 (배송비 제외)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
