import { useState, useCallback, useEffect, useRef } from "react";
import { _downloadSummaryReport } from './reportUtils.js';

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
  const [serverStatus, setServerStatus] = useState('idle'); // idle | syncing | ok | error

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

  // ── 서버에서 히스토리 로드 (앱 시작 시) ──
  useEffect(() => {
    fetch('/api/db-history').then(r=>r.json()).then(d=>{
      if (d.history?.length) {
        setHistory(prev => {
          const ids = new Set(prev.map(h=>h.id));
          const merged = [...prev, ...d.history.filter(h=>!ids.has(h.id))];
          return merged.sort((a,b)=>b.id-a.id);
        });
      }
    }).catch(()=>{});
  }, []);

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

  // 광고 보고서 state — 탭 전환해도 유지
  const [adReports, setAdReports] = useState({ naver:null, coupang:null, adboost:null });
  const [adParsed, setAdParsed] = useState({ naver:null, coupang:null, adboost:null });
  const [adAnalysisStep, setAdAnalysisStep] = useState('upload');
  const [adOverallAiText, setAdOverallAiText] = useState('');
  const [adOverallAiOpen, setAdOverallAiOpen] = useState(false);

  const TABS = [
    { id:"calc",    label:"마진 계산" },
    { id:"productdb",label:"상품 DB" },
    { id:"adreport",label:"광고 보고서 분석" },
    { id:"budget",  label:"예산 플래너" },
    { id:"history", label:"히스토리" },
    { id:"settings",label:"환경설정" },
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

        {tab === "productdb" && (
          <ProductDBTab settings={settings} />
        )}

        {tab === "adreport" && (
          <AdReportTab
            settings={settings}
            reports={adReports} setReports={setAdReports}
            parsed={adParsed} setParsed={setAdParsed}
            analysisStep={adAnalysisStep} setAnalysisStep={setAdAnalysisStep}
            overallAiText={adOverallAiText} setOverallAiText={setAdOverallAiText}
            overallAiOpen={adOverallAiOpen} setOverallAiOpen={setAdOverallAiOpen}
            onSaveHistory={(item)=>{
              setHistory(prev=>[item,...prev]);
              // 서버에도 저장 (팀원 공유)
              fetch('/api/db-history',{
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body: JSON.stringify({item})
              }).catch(()=>{});
            }}
          />
        )}

        {tab === "budget" && (
          <BudgetPlanner products={products} settings={settings} buildParams={buildParams}
            removeProductFromBudget={(id)=>setProducts(prev=>prev.filter(p=>p.id!==id))} />
        )}

        {tab === "history" && (
          <HistoryTab history={history} deleteHistory={deleteHistory} clearHistory={clearHistory}
            onViewDetail={(h)=>{ setTab('adreport'); }} />
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
function BudgetPlanner({ products, settings, buildParams, removeProductFromBudget }) {
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
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontWeight:600}}>상품별 수익 요약</div>
              <div style={{fontSize:11,color:"#999"}}>마진 계산 탭에서 상품을 추가·수정할 수 있습니다</div>
            </div>
            {validPs.length===0 ? (
              <div style={{textAlign:"center",padding:"28px 0",color:"#bbb"}}>마진 계산 탭에서 상품 입력</div>
            ) : (
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:"2px solid #eae7df",color:"#999"}}>
                    {["상품명","판매가","소득세이후","수익률","최소ROAS","",""].map((h,i)=>(
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
                        <td style={{padding:"9px 0 9px 6px",textAlign:"right"}}>
                          <button className="btn btn-danger" style={{fontSize:11,padding:"3px 8px"}}
                            onClick={()=>{ if(window.confirm(`"${p.name||'상품'}"을 목록에서 제거할까요?`)) removeProductFromBudget(p.id); }}>제거</button>
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
function HistoryTab({ history, deleteHistory, clearHistory, onViewDetail }) {
  const [compareItems, setCompareItems] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState('all'); // all | margin | adreport | actions
  const [actions, setActions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('mc_actions_v1')||'[]'); } catch { return []; }
  });
  const [newAction, setNewAction] = useState({ date:'', platform:'네이버', content:'' });
  const [showActionForm, setShowActionForm] = useState(false);

  useEffect(() => {
    try { localStorage.setItem('mc_actions_v1', JSON.stringify(actions)); } catch {}
  }, [actions]);

  // 서버에서 액션 로드
  useEffect(() => {
    fetch('/api/db-actions').then(r=>r.json()).then(d=>{
      if (d.actions?.length) {
        setActions(prev => {
          const ids = new Set(prev.map(a=>a.id));
          const merged = [...prev, ...d.actions.filter(a=>!ids.has(a.id))];
          return merged.sort((a,b)=>b.id-a.id);
        });
      }
    }).catch(()=>{});
  }, []);

  const addAction = () => {
    if (!newAction.content.trim()) return;
    const action = {
      id: Date.now(),
      date: newAction.date || new Date().toLocaleDateString('ko-KR'),
      platform: newAction.platform,
      content: newAction.content.trim(),
      createdAt: new Date().toLocaleString('ko-KR'),
    };
    setActions(prev => [action, ...prev]);
    // 서버에도 저장 (팀원 공유)
    fetch('/api/db-actions', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({action})
    }).catch(()=>{});
    setNewAction({ date:'', platform:'네이버', content:'' });
    setShowActionForm(false);
  };

  const deleteAction = (id) => {
    if (!window.confirm('이 액션 기록을 삭제할까요?')) return;
    setActions(prev => prev.filter(a => a.id !== id));
    // 서버에서도 삭제
    fetch('/api/db-actions', {
      method:'DELETE',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({id})
    }).catch(()=>{});
  };

  const filtered = history.filter(h => {
    if (filter === 'margin') return h.type !== 'adreport';
    if (filter === 'adreport') return h.type === 'adreport';
    return true;
  });

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const deleteSelected = () => {
    if (!selected.size) return;
    if (!window.confirm(`선택한 ${selected.size}건을 삭제할까요?`)) return;
    selected.forEach(id => deleteHistory(id));
    setSelected(new Set());
  };

  // 보고서 HTML 다운로드
  const downloadReport = (h) => {
    const isAd = h.type === 'adreport';
    const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>${isAd ? '광고 분석 보고서' : '마진 분석 보고서'} - ${h.name || h.keyword || '미지정'}</title>
<style>
  body{font-family:'맑은 고딕',sans-serif;color:#1a1a1a;background:#fff;padding:40px;max-width:900px;margin:0 auto;}
  h1{color:#1a365d;border-bottom:3px solid #1a365d;padding-bottom:12px;font-size:22px;}
  h2{color:#2c5282;font-size:16px;margin-top:28px;border-left:4px solid #2c5282;padding-left:10px;}
  .meta{color:#999;font-size:13px;margin-bottom:24px;}
  table{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0;}
  th{background:#1a365d;color:#fff;padding:8px 12px;text-align:left;}
  td{padding:8px 12px;border-bottom:1px solid #eae7df;}
  tr:nth-child(even) td{background:#f8f7f4;}
  .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:16px 0;}
  .kpi{background:#f0f4ff;border-radius:10px;padding:14px;}
  .kpi-label{font-size:11px;color:#999;margin-bottom:4px;}
  .kpi-value{font-size:20px;font-weight:700;color:#1a365d;font-family:monospace;}
  .positive{color:#1a6b3a;} .negative{color:#c53030;} .warning{color:#d97706;}
  .ai-box{background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;padding:20px;margin:16px 0;line-height:1.8;}
  .tag{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;margin-right:4px;}
  .tag-good{background:#dcfce7;color:#166534;}
  .tag-bad{background:#fee2e2;color:#991b1b;}
  .tag-warn{background:#fef3c7;color:#92400e;}
  footer{margin-top:40px;padding-top:16px;border-top:1px solid #eae7df;font-size:12px;color:#999;text-align:right;}
</style></head><body>
<h1>${isAd ? '📊 광고 보고서 분석' : '💰 마진 분석 보고서'}</h1>
<div class="meta">저장일시: ${h.savedAt} | ${isAd ? `검색키워드: ${h.keyword}` : `상품명: ${h.name || '미지정'}`}</div>
${isAd ? generateAdReportHtml(h) : generateMarginReportHtml(h)}
<footer>마진 계산기 시스템 | ${h.savedAt}</footer>
</body></html>`;
    const blob = new Blob([html], {type:'text/html;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `보고서_${(h.name||h.keyword||'분석').slice(0,20)}_${h.savedAt?.slice(0,10)||''}.html`;
    a.click();
  };

  const generateMarginReportHtml = (h) => {
    const r = h.result || {};
    return `
<h2>상품 기본 정보</h2>
<div class="kpi-grid">
  <div class="kpi"><div class="kpi-label">판매가 (네이버)</div><div class="kpi-value">₩${fmt(h.naverPrice)}</div></div>
  <div class="kpi"><div class="kpi-label">매입 원가</div><div class="kpi-value">₩${fmt(h.costPerUnit)}</div></div>
  <div class="kpi"><div class="kpi-label">수익률</div><div class="kpi-value ${r.roi>0?'positive':'negative'}">${r.roi}%</div></div>
</div>
<h2>수익 분석</h2>
<table>
  <tr><th>항목</th><th>금액</th></tr>
  <tr><td>세전이익</td><td class="positive">₩${fmt(r.profitBeforeTax)}</td></tr>
  <tr><td>세후이익 (부가세 차감)</td><td class="positive">₩${fmt(r.profitAfterVat)}</td></tr>
  <tr><td><strong>소득세이후 최종수익</strong></td><td><strong class="${r.finalProfit>0?'positive':'negative'}">₩${fmt(r.finalProfit)}</strong></td></tr>
  <tr><td>최소 ROAS (광고 손익분기)</td><td>${r.breakEvenRoas?r.breakEvenRoas+'%':'적자'}</td></tr>
</table>
<h2>플랫폼별 추천가</h2>
<table>
  <tr><th>플랫폼</th><th>추천 판매가</th><th>비고</th></tr>
  <tr><td>네이버</td><td>₩${fmt(h.naverPrice)}</td><td>기준가</td></tr>
  <tr><td>쿠팡</td><td>₩${fmt(h.coupangPrice||0)}</td><td>동일 수익 역산가</td></tr>
  <tr><td>오픈마켓</td><td>₩${fmt(h.openmarketPrice||0)}</td><td>동일 수익 역산가</td></tr>
</table>`;
  };

  const generateAdReportHtml = (h) => {
    const summary = h.summary || {};
    const aiText = h.aiText || '';
    let html = '';
    if (summary.naver) {
      const s = summary.naver;
      html += `<h2>🟢 네이버 검색광고</h2>
<div class="kpi-grid">
  <div class="kpi"><div class="kpi-label">총 광고비</div><div class="kpi-value negative">₩${fmt(s.totalCost)}</div></div>
  <div class="kpi"><div class="kpi-label">ROAS</div><div class="kpi-value ${s.roas>500?'positive':s.roas>300?'warning':'negative'}">${s.roas?.toFixed(0)}%</div></div>
  <div class="kpi"><div class="kpi-label">낭비 비용</div><div class="kpi-value negative">₩${fmt(s.wasteCost)}</div></div>
</div>`;
    }
    if (summary.coupang) {
      const s = summary.coupang;
      html += `<h2>🟠 쿠팡 광고</h2>
<div class="kpi-grid">
  <div class="kpi"><div class="kpi-label">총 광고비</div><div class="kpi-value negative">₩${fmt(s.totalCost)}</div></div>
  <div class="kpi"><div class="kpi-label">검색영역 ROAS</div><div class="kpi-value positive">${s.searchRoas?.toFixed(0)}%</div></div>
  <div class="kpi"><div class="kpi-label">비검색영역 ROAS</div><div class="kpi-value warning">${s.nonSearchRoas?.toFixed(0)}%</div></div>
</div>`;
    }
    if (summary.adboost) {
      const s = summary.adboost;
      html += `<h2>🔵 네이버 애드부스트</h2>
<div class="kpi-grid">
  <div class="kpi"><div class="kpi-label">총 광고비</div><div class="kpi-value negative">₩${fmt(s.totalCost)}</div></div>
  <div class="kpi"><div class="kpi-label">ROAS</div><div class="kpi-value ${s.roas>400?'positive':s.roas>200?'warning':'negative'}">${s.roas?.toFixed(0)}%</div></div>
  <div class="kpi"><div class="kpi-label">전환수</div><div class="kpi-value">${fmt(s.totalConv)}건</div></div>
</div>`;
    }
    if (aiText) {
      html += `<h2>🤖 AI 전략 분석</h2><div class="ai-box">${aiText.replace(/\n/g,'<br>')}</div>`;
    }
    return html;
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <div>
          <h2 style={{margin:0,fontWeight:700,fontSize:20}}>히스토리</h2>
          <p style={{margin:"3px 0 0",color:"#666",fontSize:13}}>분석 기록 + 광고 액션 로그</p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {['all','margin','adreport','actions'].map(f=>(
            <button key={f} className={`btn ${filter===f?'btn-primary':'btn-ghost'}`}
              style={{fontSize:12,padding:"6px 14px"}} onClick={()=>setFilter(f)}>
              {f==='all'?`전체(${history.length})`:f==='margin'?'마진':f==='adreport'?'광고분석':`📋 액션로그(${actions.length})`}
            </button>
          ))}
          {filter!=='actions'&&selected.size>0&&<button className="btn btn-danger" style={{fontSize:12}} onClick={deleteSelected}>선택삭제 ({selected.size})</button>}
          {filter==='actions'&&<button className="btn btn-primary" style={{fontSize:12,background:'#276749'}} onClick={()=>setShowActionForm(true)}>+ 액션 추가</button>}
          {filter!=='actions'&&history.length>0&&<button className="btn btn-danger" style={{fontSize:12}} onClick={clearHistory}>전체삭제</button>}
        </div>
      </div>

      {/* ── 액션 추가 폼 ── */}
      {filter==='actions'&&showActionForm&&(
        <div className="card" style={{marginBottom:16,background:'#f0fff4',borderColor:'#86efac'}}>
          <div style={{fontWeight:600,marginBottom:12,color:'#276749'}}>📋 광고 액션 기록</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 3fr auto',gap:10,alignItems:'end'}}>
            <div>
              <div style={{fontSize:12,color:'#666',marginBottom:4}}>날짜</div>
              <input className="inp" type="date" value={newAction.date}
                onChange={e=>setNewAction(p=>({...p,date:e.target.value}))} />
            </div>
            <div>
              <div style={{fontSize:12,color:'#666',marginBottom:4}}>플랫폼</div>
              <select className="inp" value={newAction.platform}
                onChange={e=>setNewAction(p=>({...p,platform:e.target.value}))}>
                {['네이버','쿠팡','애드부스트','전체','기타'].map(v=><option key={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <div style={{fontSize:12,color:'#666',marginBottom:4}}>액션 내용</div>
              <input className="inp" placeholder="예: [롤팩]키워드_상위 입찰가 150→200원 조정"
                value={newAction.content}
                onChange={e=>setNewAction(p=>({...p,content:e.target.value}))}
                onKeyDown={e=>e.key==='Enter'&&addAction()} />
            </div>
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-primary" style={{background:'#276749'}} onClick={addAction}>저장</button>
              <button className="btn btn-ghost" onClick={()=>setShowActionForm(false)}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 액션 로그 탭 ── */}
      {filter==='actions'&&(
        <div>
          {!showActionForm&&actions.length===0&&(
            <div className="card" style={{textAlign:'center',padding:'40px 0',color:'#bbb'}}>
              <div style={{fontSize:32,marginBottom:8}}>📋</div>
              <div style={{marginBottom:12}}>아직 액션 기록이 없습니다</div>
              <button className="btn btn-primary" style={{background:'#276749'}} onClick={()=>setShowActionForm(true)}>+ 첫 액션 기록하기</button>
            </div>
          )}
          {actions.length>0&&(
            <div>
              {/* 플랫폼별 그룹 */}
              {['네이버','쿠팡','애드부스트','전체','기타'].map(platform=>{
                const filtered = actions.filter(a=>a.platform===platform);
                if (!filtered.length) return null;
                const colors = {네이버:'#276749',쿠팡:'#9c4221',애드부스트:'#2c5282',전체:'#1a365d',기타:'#718096'};
                const bgs = {네이버:'#f0fff4',쿠팡:'#fffaf0',애드부스트:'#ebf8ff',전체:'#f0f4ff',기타:'#f8f7f4'};
                return (
                  <div key={platform} style={{marginBottom:16}}>
                    <div style={{fontWeight:600,fontSize:14,color:colors[platform],
                      marginBottom:8,display:'flex',alignItems:'center',gap:8}}>
                      <span style={{width:10,height:10,borderRadius:'50%',background:colors[platform],display:'inline-block'}}></span>
                      {platform} <span style={{fontWeight:400,fontSize:12,color:'#999'}}>({filtered.length}건)</span>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:8}}>
                      {filtered.map(a=>(
                        <div key={a.id} style={{display:'flex',alignItems:'center',gap:12,
                          background:bgs[platform],border:`1px solid ${colors[platform]}30`,
                          borderRadius:10,padding:'10px 14px'}}>
                          <div style={{fontWeight:600,fontSize:12,color:'#999',flexShrink:0,minWidth:80}}>{a.date}</div>
                          <div style={{flex:1,fontSize:13,color:'#1a1a1a'}}>{a.content}</div>
                          <div style={{fontSize:11,color:'#bbb',flexShrink:0}}>{a.createdAt}</div>
                          <button style={{background:'none',border:'none',cursor:'pointer',color:'#bbb',fontSize:14,flexShrink:0}}
                            onClick={()=>deleteAction(a.id)}>×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 드래그 비교 영역 */}
      {filter!=='actions'&&(
      <div style={{marginBottom:16,borderRadius:18,padding:22,minHeight:80,
        border:`1.5px dashed ${dragOver?"#2c5282":"#eae7df"}`,
        background:dragOver?"#eef2ff":"#fff",transition:"all .15s"}}
        onDragOver={e=>{e.preventDefault();setDragOver(true);}}
        onDragLeave={()=>setDragOver(false)}
        onDrop={e=>{e.preventDefault();setDragOver(false);try{const item=JSON.parse(e.dataTransfer.getData("text/plain"));if(!compareItems.find(c=>c.id===item.id))setCompareItems(prev=>[...prev,item].slice(0,4));}catch{}}}>
        <div style={{fontWeight:600,marginBottom:8,fontSize:13}}>
          비교 영역 <span style={{fontSize:12,color:"#999",fontWeight:400}}>— 드래그하거나 "비교" 버튼으로 추가 (최대 4개)</span>
          {compareItems.length>=2&&compareItems.every(c=>c.type==='adreport')&&(
            <button className="btn btn-ghost" style={{fontSize:11,padding:"3px 10px",marginLeft:8,color:"#276749",borderColor:"#86efac"}}
              onClick={()=>{
                const sorted = [...compareItems].sort((a,b)=>a.id-b.id);
                const prev = sorted[0], curr = sorted[sorted.length-1];
                const diff = (curr, prev, key, sub) => {
                  const c = curr?.summary?.[key]?.[sub], p = prev?.summary?.[key]?.[sub];
                  if (c==null||p==null) return null;
                  const d = c-p, pct = p!==0?Math.round(d/p*100):0;
                  return {c:Math.round(c), p:Math.round(p), d:Math.round(d), pct};
                };
                const report = ['naver','coupang','adboost'].map(k=>{
                  if (!curr.summary?.[k]&&!prev.summary?.[k]) return null;
                  const label = {naver:'네이버',coupang:'쿠팡',adboost:'애드부스트'}[k];
                  const roasDiff = diff(curr,prev,k,'roas');
                  const costDiff = diff(curr,prev,k,'totalCost');
                  return {label, roasDiff, costDiff};
                }).filter(Boolean);
                alert(`📊 비교 분석\n${prev.savedAt} → ${curr.savedAt}\n\n`+
                  report.map(r=>`[${r.label}]\n`+
                    (r.roasDiff?`ROAS: ${r.roasDiff.p}% → ${r.roasDiff.c}% (${r.roasDiff.d>0?'+':''}${r.roasDiff.d}%p)\n`:'')+
                    (r.costDiff?`광고비: ₩${r.costDiff.p.toLocaleString()} → ₩${r.costDiff.c.toLocaleString()} (${r.costDiff.pct>0?'+':''}${r.costDiff.pct}%)`:'')).join('\n\n'));
              }}>
              📊 변화 비교
            </button>
          )}
        </div>
        {compareItems.length===0
          ?<div style={{color:"#bbb",fontSize:13,textAlign:"center",padding:"8px 0"}}>카드를 여기로 드래그하세요</div>
          :<div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12,marginBottom:compareItems.length>=2?12:0}}>
              {compareItems.map(item=>(
                <div key={item.id} style={{background:"#f0f4ff",border:"1.5px solid #c7d2fe",borderRadius:11,padding:13,position:"relative"}}>
                  <button style={{position:"absolute",top:8,right:10,background:"none",border:"none",cursor:"pointer",color:"#bbb",fontSize:16}}
                    onClick={()=>setCompareItems(prev=>prev.filter(c=>c.id!==item.id))}>×</button>
                  <div style={{fontWeight:600,fontSize:13,color:"#312e81",marginBottom:4}}>
                    {item.type==='adreport'?'📊':'💰'} {item.name||item.keyword||"미지정"}
                  </div>
                  <div style={{fontSize:11,color:"#999",marginBottom:8}}>{item.savedAt}</div>
                  {item.type==='adreport'
                    ? <div style={{fontSize:12}}>
                        {item.summary?.naver&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                          <span style={{color:"#888"}}>네이버 ROAS</span>
                          <span className="mono" style={{color:pColor(item.summary.naver.roas-300)}}>{item.summary.naver.roas?.toFixed(0)}%</span>
                        </div>}
                        {item.summary?.naver&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                          <span style={{color:"#888"}}>네이버 광고비</span>
                          <span className="mono" style={{color:"#c53030"}}>₩{fmt(item.summary.naver.totalCost)}</span>
                        </div>}
                        {item.summary?.coupang&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                          <span style={{color:"#888"}}>쿠팡 ROAS</span>
                          <span className="mono" style={{color:pColor(item.summary.coupang.roas-300)}}>{item.summary.coupang.roas?.toFixed(0)}%</span>
                        </div>}
                        {item.summary?.adboost&&<div style={{display:"flex",justifyContent:"space-between"}}>
                          <span style={{color:"#888"}}>애드부스트 ROAS</span>
                          <span className="mono" style={{color:pColor(item.summary.adboost.roas-300)}}>{item.summary.adboost.roas?.toFixed(0)}%</span>
                        </div>}
                      </div>
                    : <div style={{fontSize:12}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{color:"#888"}}>판매가</span><span className="mono">₩{fmt(item.naverPrice)}</span></div>
                        <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"#555",fontWeight:600}}>소득세이후</span><span className="mono" style={{color:pColor(item.result?.finalProfit||0),fontWeight:700}}>₩{fmt(item.result?.finalProfit)}</span></div>
                      </div>}
                </div>
              ))}
            </div>
            {/* 광고 분석 2개 이상 시 수치 변화 테이블 */}
            {compareItems.length>=2&&compareItems.filter(c=>c.type==='adreport').length>=2&&(()=>{
              const adItems = [...compareItems.filter(c=>c.type==='adreport')].sort((a,b)=>a.id-b.id);
              const platforms = ['naver','coupang','adboost'];
              const labels = {naver:'🟢 네이버',coupang:'🟠 쿠팡',adboost:'🔵 애드부스트'};
              const metrics = [
                {key:'totalCost',label:'광고비',fmt:v=>`₩${fmt(v)}`,inverted:true},
                {key:'roas',label:'ROAS',fmt:v=>`${v?.toFixed(0)}%`},
                {key:'totalConv',label:'전환수',fmt:v=>`${fmt(v)}건`},
                {key:'wasteCost',label:'낭비비용',fmt:v=>`₩${fmt(v)}`,inverted:true},
              ];
              return (
                <div style={{background:"#f0f4ff",borderRadius:12,padding:14,border:"1px solid #c7d2fe"}}>
                  <div style={{fontWeight:600,fontSize:13,color:"#312e81",marginBottom:10}}>
                    📈 기간 비교: {adItems[0].savedAt?.slice(0,10)} → {adItems[adItems.length-1].savedAt?.slice(0,10)}
                  </div>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr style={{borderBottom:"1.5px solid #c7d2fe",color:"#666"}}>
                        <th style={{textAlign:"left",padding:"4px 8px",fontWeight:600}}>플랫폼/지표</th>
                        {adItems.map(item=><th key={item.id} style={{textAlign:"right",padding:"4px 8px",fontWeight:600}}>{item.savedAt?.slice(5,10)}</th>)}
                        <th style={{textAlign:"right",padding:"4px 8px",fontWeight:600,color:"#312e81"}}>변화</th>
                      </tr>
                    </thead>
                    <tbody>
                      {platforms.flatMap(p=>metrics.map(m=>{
                        const vals = adItems.map(item=>item.summary?.[p]?.[m.key]);
                        if (vals.every(v=>v==null)) return null;
                        const first = vals[0], last = vals[vals.length-1];
                        const diff = (first!=null&&last!=null)?last-first:null;
                        const pct = (diff!=null&&first&&first!==0)?Math.round(diff/Math.abs(first)*100):null;
                        const isGood = m.inverted ? diff<0 : diff>0;
                        return (
                          <tr key={p+m.key} style={{borderBottom:"1px solid #e0e7ff"}}>
                            <td style={{padding:"4px 8px",color:"#555"}}>{labels[p]} {m.label}</td>
                            {vals.map((v,i)=><td key={i} style={{padding:"4px 8px",textAlign:"right",fontFamily:"DM Mono",color:v==null?"#bbb":"#1a1a1a"}}>{v!=null?m.fmt(v):'-'}</td>)}
                            <td style={{padding:"4px 8px",textAlign:"right",fontFamily:"DM Mono",fontWeight:700,
                              color:diff==null?"#bbb":isGood?"#1a6b3a":"#c53030"}}>
                              {diff!=null?(isGood?'▲':'▼')+m.fmt(Math.abs(diff))+(pct?` (${pct>0?'+':''}${pct}%)`:''):'-'}
                            </td>
                          </tr>
                        );
                      })).filter(Boolean)}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>}
      </div>
      )}

      {/* 히스토리 목록 */}
      {filter!=='actions'&&(filtered.length===0
        ?<div className="card" style={{textAlign:"center",padding:"50px 0",color:"#bbb"}}>
          <div style={{fontSize:36,marginBottom:10}}>{filter==='adreport'?'📊':'📋'}</div>
          <div>{filter==='adreport'?'저장된 광고 분석 보고서가 없습니다':'저장된 항목이 없습니다'}</div>
        </div>
        :<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14}}>
          {filtered.map(h=>{
            const isAd = h.type==='adreport';
            const isSelected = selected.has(h.id);
            return (
              <div key={h.id} className="card" draggable
                onDragStart={e=>e.dataTransfer.setData("text/plain",JSON.stringify(h))}
                onClick={()=>isAd&&onViewDetail&&onViewDetail(h)}
                style={{cursor:isAd?"pointer":"grab",userSelect:"none",
                  border:isSelected?"1.5px solid #2c5282":"1.5px solid #eae7df",
                  background:isSelected?"#eef2ff":"#fff",
                  transition:'box-shadow .15s'}}
                onMouseEnter={e=>{if(isAd)e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,.1)';}}
                onMouseLeave={e=>{e.currentTarget.style.boxShadow='none';}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:7}}>
                    <input type="checkbox" checked={isSelected}
                      onChange={()=>toggleSelect(h.id)}
                      onClick={e=>e.stopPropagation()} style={{cursor:"pointer"}} />
                    <div>
                      <div style={{fontWeight:600,fontSize:14}}>
                        {isAd?'📊':'💰'} {h.name||h.keyword||"미지정"}
                        {isAd&&<span style={{fontSize:10,color:'#2c5282',marginLeft:6,background:'#ebf8ff',padding:'1px 6px',borderRadius:10}}>클릭하여 열기</span>}
                      </div>
                      <div style={{fontSize:10,color:"#999",marginTop:2}}>{h.savedAt}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:5,flexShrink:0}}>
                    <button className="btn btn-ghost" style={{fontSize:11,padding:"2px 8px"}}
                      onClick={e=>{e.stopPropagation();if(!compareItems.find(c=>c.id===h.id))setCompareItems(prev=>[...prev,h].slice(0,4));}}>비교</button>
                    <button className="btn btn-ghost" style={{fontSize:11,padding:"2px 8px",color:"#1a6b3a",borderColor:"#86efac"}}
                      onClick={e=>{e.stopPropagation();downloadReport(h);}}>↓보고서</button>
                    <button className="btn btn-danger" style={{fontSize:11,padding:"2px 8px"}}
                      onClick={e=>{e.stopPropagation();deleteHistory(h.id);}}>삭제</button>
                  </div>
                </div>

                {isAd ? (
                  <div style={{fontSize:12}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      {h.summary?.naver&&<div><div className="sl">네이버 ROAS</div><div style={{fontWeight:700,color:h.summary.naver.roas>500?'#1a6b3a':'#d97706'}}>{h.summary.naver.roas?.toFixed(0)}%</div></div>}
                      {h.summary?.coupang&&<div><div className="sl">쿠팡 ROAS(14일)</div><div style={{fontWeight:700,color:h.summary.coupang.roas>500?'#1a6b3a':'#d97706'}}>{h.summary.coupang.roas?.toFixed(0)}%</div></div>}
                      {h.summary?.adboost&&<div><div className="sl">애드부스트 ROAS</div><div style={{fontWeight:700,color:h.summary.adboost.roas>400?'#1a6b3a':'#d97706'}}>{h.summary.adboost.roas?.toFixed(0)}%</div></div>}
                      <div><div className="sl">분석 플랫폼</div><div style={{color:"#666"}}>{[h.summary?.naver&&'네이버',h.summary?.coupang&&'쿠팡',h.summary?.adboost&&'애드부스트'].filter(Boolean).join(' · ')}</div></div>
                    </div>
                    {h.aiText&&<div style={{marginTop:8,padding:"6px 9px",background:"#eef2ff",borderRadius:7,fontSize:11,color:"#312e81"}}>
                      AI 분석 포함 — {h.aiText.slice(0,60)}...
                    </div>}
                  </div>
                ) : (
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:13}}>
                    <div><div className="sl">판매가</div><div className="mono" style={{fontWeight:600}}>₩{fmt(h.naverPrice)}</div></div>
                    <div><div className="sl">원가</div><div className="mono">₩{fmt(h.costPerUnit)}</div></div>
                    <div><div className="sl">세후이익</div><div className="mono" style={{color:pColor(h.result?.profitAfterVat||0),fontWeight:600}}>₩{fmt(h.result?.profitAfterVat)}</div></div>
                    <div><div className="sl">소득세이후</div><div className="mono" style={{color:pColor(h.result?.finalProfit||0),fontWeight:700}}>₩{fmt(h.result?.finalProfit)}</div></div>
                    <div><div className="sl">수익률</div><div style={{fontWeight:600,color:pColor(h.result?.roi||0)}}>{h.result?.roi}%</div></div>
                    {h.result?.breakEvenRoas&&<div><div className="sl">최소 ROAS</div><div style={{fontWeight:600,color:"#2c5282"}}>{h.result.breakEvenRoas}%</div></div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>)}
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

// ══════════════════════════════════════════════════════
// 광고 보고서 분석 탭
// ══════════════════════════════════════════════════════
function AdReportTab({
  settings, onSaveHistory,
  reports, setReports,
  parsed, setParsed,
  analysisStep, setAnalysisStep,
  overallAiText, setOverallAiText,
  overallAiOpen, setOverallAiOpen,
}) {
  // 업로드된 플랫폼 순서 고정
  const PLATFORM_ORDER = ['naver', 'adboost', 'coupang'];
  const uploadedTypes = PLATFORM_ORDER.filter(k => parsed[k]);

  // 탭 내부 전용 state (탭 전환 시 초기화돼도 무방한 것들)
  const [searchKey, setSearchKey] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [overallAiLoading, setOverallAiLoading] = useState(false);
  const [wasteModal, setWasteModal] = useState(null); // { type, rows }
  const [searchPlatformFilter, setSearchPlatformFilter] = useState(null); // null=전체

  // 파일 파싱 — 네이버CSV(1행 스킵), 쿠팡xlsx, 애드부스트CSV 모두 처리
  const parseFile = (file, type) => {
    const ext = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    const parseCSVText = (text, skipFirstRow = false) => {
      // BOM 제거
      const clean = text.replace(/^\uFEFF/, '');
      const rows = clean.split('\n').map(r => {
        // 따옴표로 감싸진 필드 처리 (쉼표 포함 필드)
        const result = [];
        let cur = ''; let inQ = false;
        for (let i = 0; i < r.length; i++) {
          if (r[i] === '"') { inQ = !inQ; }
          else if (r[i] === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
          else { cur += r[i]; }
        }
        result.push(cur.trim());
        return result;
      });
      const headerRowIdx = skipFirstRow ? 1 : 0;
      const header = rows[headerRowIdx].map(h => h.replace(/"/g,'').trim());
      const data = rows.slice(headerRowIdx + 1)
        .filter(r => r.length > 1 && r.some(c => c && c !== '""'))
        .map(r => {
          const obj = {};
          header.forEach((h, i) => { obj[h] = (r[i] || '').replace(/"/g,'').trim(); });
          return obj;
        });
      return { header, data };
    };

    if (ext === 'xlsx' || ext === 'xls') {
      // xlsx — SheetJS로 파싱
      reader.onload = (e) => {
        try {
          const XLSX = window.XLSX;
          if (!XLSX) {
            // SheetJS 없으면 동적 로드
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
            script.onload = () => {
              const wb = window.XLSX.read(e.target.result, { type: 'array' });
              const ws = wb.Sheets[wb.SheetNames[0]];
              const json = window.XLSX.utils.sheet_to_json(ws, { defval: '' });
              if (!json.length) { alert('데이터를 읽을 수 없습니다.'); return; }
              const header = Object.keys(json[0]);
              setParsed(prev => ({ ...prev, [type]: { header, data: json, type } }));
            };
            document.head.appendChild(script);
            // 스크립트 로드 후 다시 실행
            reader.onload = (e2) => {
              setTimeout(() => {
                const wb = window.XLSX.read(e2.target.result, { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const json = window.XLSX.utils.sheet_to_json(ws, { defval: '' });
                const header = Object.keys(json[0]);
                setParsed(prev => ({ ...prev, [type]: { header, data: json, type } }));
              }, 1000);
            };
            reader.readAsArrayBuffer(file);
            return;
          }
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
          if (!json.length) { alert('데이터를 읽을 수 없습니다.'); return; }
          const header = Object.keys(json[0]);
          setParsed(prev => ({ ...prev, [type]: { header, data: json, type } }));
        } catch(err) { alert('xlsx 파싱 오류: ' + err.message); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // CSV
      reader.onload = (e) => {
        try {
          const raw = e.target.result;
          // BOM 제거
          const text = raw.replace(/^\uFEFF/, '').replace(/^\ufeff/, '');
          // 네이버 검색광고: 첫 줄이 "캠페인,광고그룹" 으로 시작하지 않으면 skipFirst
          const firstLine = text.split('\n')[0] || '';
          const skipFirst = type === 'naver' && !firstLine.trim().startsWith('캠페인');
          const { header, data } = parseCSVText(text, skipFirst);
          if (!data.length) { alert('데이터가 비어있습니다. 파일을 확인해주세요.'); return; }
          setParsed(prev => ({ ...prev, [type]: { header, data, type } }));
        } catch(err) { alert('CSV 파싱 오류: ' + err.message); }
      };
      reader.readAsText(file, 'utf-8');
    }
  };

  // xlsx 동적 로드 (앱 시작 시)
  useState(() => {
    if (!window.XLSX) {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      document.head.appendChild(s);
    }
  });

  const handleFile = (e, type) => {
    const file = e.target.files[0];
    if (!file) return;
    setReports(prev => ({ ...prev, [type]: file }));
    parseFile(file, type);
    e.target.value = '';
  };

  // ── 전체 요약 계산 ──
  const getSummary = (type) => {
    const d = parsed[type];
    if (!d) return null;
    const rows = d.data;

    if (type === 'naver') {
      const toN = v => parseFloat(String(v).replace(/,/g,'')) || 0;
      const totalCost = rows.reduce((s,r) => s + toN(r['총비용']), 0);
      const totalClick = rows.reduce((s,r) => s + toN(r['클릭수']), 0);
      const totalConv = rows.reduce((s,r) => s + toN(r['구매완료 전환수']), 0);
      const totalSales = rows.reduce((s,r) => s + toN(r['구매완료 전환매출액(원)']), 0);
      const wasteRows = rows.filter(r => toN(r['총비용'])>0 && toN(r['구매완료 전환수'])===0);
      const wasteCost = wasteRows.reduce((s,r) => s + toN(r['총비용']), 0);
      return { totalCost, totalClick, totalConv, totalSales,
        roas: totalCost>0 ? totalSales/totalCost*100 : 0,
        cpc: totalClick>0 ? totalCost/totalClick : 0,
        wasteCost, wasteRows: wasteRows.length,
        label:'네이버 검색광고', color:'#276749', bg:'#f0fff4' };
    }
    if (type === 'coupang') {
      const toN = v => {
        if (typeof v === 'number') return v;
        return parseFloat(String(v).replace(/,/g,'').replace(/%/g,'').trim()) || 0;
      };
      // 실제 컬럼명: 광고비, 클릭수, 총 주문수(1일), 총 전환매출액(1일), 총 전환매출액(14일)
      const totalCost    = rows.reduce((s,r) => s + toN(r['광고비']), 0);
      const totalClick   = rows.reduce((s,r) => s + toN(r['클릭수']), 0);
      const totalOrder   = rows.reduce((s,r) => s + toN(r['총 주문수(1일)']), 0);
      const totalSales14 = rows.reduce((s,r) => s + toN(r['총 전환매출액(14일)']), 0);
      const totalSales1  = rows.reduce((s,r) => s + toN(r['총 전환매출액(1일)']), 0);
      // 검색/비검색 영역
      const areaKey = Object.keys(rows[0]||{}).find(k => k.includes('노출 지면') || k.includes('지면')) || '광고 노출 지면';
      const searchRows    = rows.filter(r => String(r[areaKey]).includes('검색 영역') && !String(r[areaKey]).includes('비검색'));
      const nonSearchRows = rows.filter(r => String(r[areaKey]).includes('비검색'));
      const searchCost    = searchRows.reduce((s,r) => s+toN(r['광고비']),0);
      const searchSales   = searchRows.reduce((s,r) => s+toN(r['총 전환매출액(14일)']),0);
      const nonSearchCost = nonSearchRows.reduce((s,r) => s+toN(r['광고비']),0);
      const nonSearchSales= nonSearchRows.reduce((s,r) => s+toN(r['총 전환매출액(14일)']),0);
      return { totalCost, totalClick, totalOrder, totalSales14, totalSales1,
        roas: totalCost>0 ? totalSales14/totalCost*100 : 0,
        cpc: totalClick>0 ? totalCost/totalClick : 0,
        searchRoas:    searchCost>0    ? searchSales/searchCost*100       : 0,
        nonSearchRoas: nonSearchCost>0 ? nonSearchSales/nonSearchCost*100 : 0,
        searchCost, nonSearchCost,
        label:'쿠팡 광고', color:'#9c4221', bg:'#fffaf0' };
    }
    if (type === 'adboost') {
      const toN = v => parseFloat(String(v).replace(/,/g,'').replace(/%/g,'')) || 0;
      const totalCost = rows.reduce((s,r) => s + toN(r['총비용']), 0);
      const totalClick = rows.reduce((s,r) => s + toN(r['클릭수']), 0);
      const totalConv = rows.reduce((s,r) => s + toN(r['구매완료 수']), 0);
      const totalSales = rows.reduce((s,r) => s + toN(r['구매완료 전환매출액']), 0);
      const wasteRows = rows.filter(r => toN(r['총비용'])>0 && toN(r['구매완료 수'])===0);
      const wasteCost = wasteRows.reduce((s,r) => s+toN(r['총비용']),0);
      return { totalCost, totalClick, totalConv, totalSales,
        roas: totalCost>0 ? totalSales/totalCost*100 : 0,
        cpc: totalClick>0 ? totalCost/totalClick : 0,
        wasteCost, wasteRows: wasteRows.length,
        label:'네이버 애드부스트', color:'#2c5282', bg:'#ebf8ff' };
    }
    return null;
  };

  // ── 상품 상세 검색 ──
  const searchProduct = () => {
    if (!searchKey.trim()) return;
    const key = searchKey.trim().toLowerCase();
    let found = { key: searchKey, groups: {} };
    const onlyPlatform = searchPlatformFilter; // null=전체

    // DB에서 상품코드로 광고그룹명/쇼핑ID/쿠팡옵션ID 자동 조회
    const dbItem = (() => {
      try {
        const db = JSON.parse(localStorage.getItem('mc_productdb_v1')||'[]');
        return db.find(p =>
          p.code?.toLowerCase() === key ||
          p.name?.toLowerCase().includes(key) ||
          p.shopId?.toLowerCase() === key ||
          p.naverShopId?.toLowerCase() === key ||
          p.coupangOptionId?.toLowerCase() === key
        );
      } catch { return null; }
    })();

    // DB에서 찾은 항목의 매핑 정보
    const dbNaverGroups = dbItem?.naverGroup ? dbItem.naverGroup.split(',').map(g=>g.trim().toLowerCase()).filter(Boolean) : [];
    const dbShopId = dbItem?.shopId?.toLowerCase() || '';
    const dbNaverShopId = dbItem?.naverShopId?.toLowerCase() || '';
    const dbCoupangOptionId = dbItem?.coupangOptionId?.toLowerCase() || '';

    // 네이버 검색광고 — 광고그룹명 또는 DB 매핑 그룹명으로 검색
    if (parsed.naver && (onlyPlatform===null||onlyPlatform==='naver')) {
      const toN = v => parseFloat(String(v).replace(/,/g,'')) || 0;
      const groups = {};
      parsed.naver.data.forEach(r => {
        const grp = String(r['광고그룹']||'').toLowerCase();
        const camp = String(r['캠페인']||'').toLowerCase();
        const keyword = String(r['검색어']||'').toLowerCase();
        // 직접 키 매칭 또는 DB 매핑 그룹명 매칭
        const directMatch = grp.includes(key) || camp.includes(key) || keyword.includes(key);
        const dbMatch = dbNaverGroups.length > 0 && dbNaverGroups.some(g => grp.includes(g) || g.includes(grp));
        if (!directMatch && !dbMatch) return;
        const grpKey = r['광고그룹'] || '기타';
        if (!groups[grpKey]) groups[grpKey] = { rows:[], cost:0, click:0, conv:0, sales:0, impression:0 };
        groups[grpKey].rows.push(r);
        groups[grpKey].cost += toN(r['총비용']);
        groups[grpKey].click += toN(r['클릭수']);
        groups[grpKey].conv += toN(r['구매완료 전환수']);
        groups[grpKey].sales += toN(r['구매완료 전환매출액(원)']);
        groups[grpKey].impression += toN(r['노출수']);
      });
      if (Object.keys(groups).length > 0) {
        found.groups.naver = groups;
        const allRows = Object.values(groups).flatMap(g => g.rows);
        found.naverWaste = allRows.filter(r => toN(r['총비용'])>0 && toN(r['구매완료 전환수'])===0)
          .sort((a,b) => toN(b['총비용'])-toN(a['총비용'])).slice(0,15);
        found.naverTop = allRows.filter(r => toN(r['구매완료 전환수'])>0)
          .sort((a,b) => toN(b['구매완료 광고수익률(%)'])-toN(a['구매완료 광고수익률(%)'])).slice(0,15);
      }
    }

    // 쿠팡: 상품명, 키워드, 옵션ID, DB 매핑 옵션ID로 검색
    if (parsed.coupang && (onlyPlatform===null||onlyPlatform==='coupang')) {
      const toN = v => parseFloat(String(v).replace(/,/g,'').replace(/%/g,'')) || 0;
      const groups = {};
      const allCoupangRows = [];
      const areaKey2 = Object.keys(parsed.coupang.data[0]||{}).find(k=>k.includes('노출 지면')||k.includes('지면')) || '광고 노출 지면';
      parsed.coupang.data.forEach(r => {
        const nm  = String(r['광고집행 상품명']||'').toLowerCase();
        const kw  = String(r['키워드']||'').toLowerCase();
        const oid = String(r['광고집행 옵션ID']||'').toLowerCase();
        const directMatch = nm.includes(key) || kw.includes(key) || oid.includes(key);
        const dbMatch = (dbCoupangOptionId && oid === dbCoupangOptionId);
        if (!directMatch && !dbMatch) return;
        const area = String(r[areaKey2]||'기타');
        const areaLabel = area.includes('비검색') ? '비검색 영역' : area.includes('검색') ? '검색 영역' : area;
        if (!groups[areaLabel]) groups[areaLabel] = { cost:0, click:0, order:0, sales14:0, sales1:0, rows:[] };
        const toNc = v => typeof v==='number'?v:parseFloat(String(v).replace(/,/g,'').replace(/%/g,''))||0;
        groups[areaLabel].cost   += toNc(r['광고비']);
        groups[areaLabel].click  += toNc(r['클릭수']);
        groups[areaLabel].order  += toNc(r['총 주문수(1일)']);
        groups[areaLabel].sales14+= toNc(r['총 전환매출액(14일)']);
        groups[areaLabel].sales1 += toNc(r['총 전환매출액(1일)']);
        groups[areaLabel].rows.push(r);
        allCoupangRows.push(r);
      });
      if (Object.keys(groups).length > 0) {
        found.groups.coupang = groups;
        // 쿠팡 고성과 키워드 (검색영역, 전환있음, ROAS 높은 순)
        found.coupangTop = allCoupangRows
          .filter(r => toN(r['총 주문수(1일)'])>0 && String(r[areaKey2]||'').includes('검색'))
          .sort((a,b)=>{
            const ra = toN(a['총 전환매출액(14일)'])>0&&toN(a['광고비'])>0 ? toN(a['총 전환매출액(14일)'])/toN(a['광고비']) : 0;
            const rb = toN(b['총 전환매출액(14일)'])>0&&toN(b['광고비'])>0 ? toN(b['총 전환매출액(14일)'])/toN(b['광고비']) : 0;
            return rb - ra;
          }).slice(0,15);
        // 쿠팡 낭비 키워드 (검색영역, 전환없음, 광고비 높은 순)
        found.coupangWaste = allCoupangRows
          .filter(r => toN(r['광고비'])>0 && toN(r['총 주문수(1일)'])===0 && String(r[areaKey2]||'').includes('검색') && !String(r[areaKey2]||'').includes('비검색'))
          .sort((a,b)=>toN(b['광고비'])-toN(a['광고비'])).slice(0,15);
      }
    }

    // 애드부스트: 상품명, 쇼핑몰ID, 네이버쇼핑ID, DB 매핑ID로 검색
    if (parsed.adboost && (onlyPlatform===null||onlyPlatform==='adboost')) {
      const toN = v => parseFloat(String(v).replace(/,/g,'').replace(/%/g,'')) || 0;
      const matchRows = parsed.adboost.data.filter(r => {
        const nm  = String(r['상품명']||'').toLowerCase();
        const sid = String(r['쇼핑몰 상품 ID']||'').toLowerCase();
        const nid = String(r['네이버쇼핑 상품 ID']||'').toLowerCase();
        const directMatch = nm.includes(key) || sid.includes(key) || nid.includes(key);
        const dbMatch = (dbShopId && sid === dbShopId) || (dbNaverShopId && nid === dbNaverShopId);
        return directMatch || dbMatch;
      });
      if (matchRows.length > 0) {
        const total = { cost:0, click:0, conv:0, sales:0, imp:0, wishlist:0 };
        matchRows.forEach(r => {
          total.cost += toN(r['총비용']); total.click += toN(r['클릭수']);
          total.conv += toN(r['구매완료 수']); total.sales += toN(r['구매완료 전환매출액']);
          total.imp += toN(r['노출수']); total.wishlist += toN(r['위시리스트 추가 수']);
        });
        found.groups.adboost = { total, rows: matchRows.slice(0,5) };
      }
    }

    // DB 정보 함께 저장
    if (dbItem) found.dbItem = dbItem;

    setSearchResult(Object.keys(found.groups).length > 0 ? found : { key: searchKey, notFound: true, dbItem });
  };

  // ── AI 전략 분석 ──
  const runAI = async (result) => {
    setAiLoading(true); setAiOpen(true); setAiText('');
    const sections = [];

    if (result.groups.naver) {
      const total = Object.values(result.groups.naver).reduce((acc, g) => ({
        cost: acc.cost+g.cost, click: acc.click+g.click,
        conv: acc.conv+g.conv, sales: acc.sales+g.sales
      }), {cost:0,click:0,conv:0,sales:0});
      const roas = total.cost>0 ? (total.sales/total.cost*100).toFixed(0) : 0;
      sections.push(`[네이버 검색광고]\n총광고비: ${fmt(total.cost)}원 / ROAS: ${roas}% / 전환수: ${total.conv}건`);
      if (result.naverWaste?.length) {
        sections.push(`낭비 키워드 TOP5: ${result.naverWaste.slice(0,5).map(r=>r['검색어']+'(₩'+fmt(r['총비용'])+')').join(', ')}`);
      }
      if (result.naverTop?.length) {
        sections.push(`고성과 키워드 TOP5: ${result.naverTop.slice(0,5).map(r=>r['검색어']+'(ROAS '+r['구매완료 광고수익률(%)']+')').join(', ')}`);
      }
    }
    if (result.groups.coupang) {
      const grps = result.groups.coupang;
      const search = grps['검색 영역'] || {cost:0,sales14:0};
      const nonSearch = grps['비검색 영역'] || {cost:0,sales14:0};
      sections.push(`[쿠팡 광고]\n검색영역 ROAS: ${search.cost>0?(search.sales14/search.cost*100).toFixed(0):0}% / 비검색영역 ROAS: ${nonSearch.cost>0?(nonSearch.sales14/nonSearch.cost*100).toFixed(0):0}%`);
    }
    if (result.groups.adboost) {
      const t = result.groups.adboost.total;
      sections.push(`[애드부스트]\n광고비: ${fmt(t.cost)}원 / ROAS: ${t.cost>0?(t.sales/t.cost*100).toFixed(0):0}% / 장바구니: ${t.wishlist}건`);
    }

    const prompt = `당신은 한국 온라인 쇼핑몰 광고 전략 전문가입니다.

검색 키워드: "${result.key}"

광고 성과 데이터:
${sections.join('\n\n')}

위 데이터를 바탕으로 다음을 분석해주세요:
1. 플랫폼별 현재 광고 효율 평가
2. 즉시 조치가 필요한 문제점 (낭비 키워드, 비효율 영역)
3. 키워드 전략 (세부→메인 전환 또는 메인→세부 전환 등)
4. 예산 재배분 방향
5. 담당자에게 요청할 구체적 액션 아이템

간결하고 실용적으로 한국어로 답변해주세요.`;

    try {
      const res = await fetch('/api/analyze', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ prompt })
      });
      const data = await res.json();
      setAiText(data.result || '분석 결과를 가져올 수 없습니다.');
    } catch { setAiText('AI 분석 요청에 실패했습니다.'); }
    finally { setAiLoading(false); }
  };


  // ── 종합 AI 분석 (히스토리 저장 없음) ──
  const runOverallAI = async () => {
    setOverallAiLoading(true); setOverallAiOpen(true); setOverallAiText('');
    const lines = uploadedTypes.map(t => {
      const s = getSummary(t);
      if (!s) return '';
      if (t==='naver')   return `[네이버 검색광고] 총광고비:${fmt(s.totalCost)}원 ROAS:${s.roas.toFixed(0)}% 클릭수:${fmt(s.totalClick)} 전환:${fmt(s.totalConv)}건 낭비비용:${fmt(s.wasteCost)}원`;
      if (t==='coupang') return `[쿠팡] 총광고비:${fmt(s.totalCost)}원 전체ROAS:${s.roas.toFixed(0)}% 검색ROAS:${s.searchRoas.toFixed(0)}% 비검색ROAS:${s.nonSearchRoas.toFixed(0)}%`;
      if (t==='adboost') return `[애드부스트] 총광고비:${fmt(s.totalCost)}원 ROAS:${s.roas.toFixed(0)}% 전환:${fmt(s.totalConv)}건 낭비비용:${fmt(s.wasteCost)}원`;
      return '';
    }).filter(Boolean);
    const prompt = `당신은 한국 온라인 쇼핑몰 광고 전략 전문가입니다.\n\n이번 달 광고 종합 성과:\n${lines.join('\n')}\n\n전략 회의용 분석:\n1. 플랫폼별 효율 평가 (A/B/C 등급)\n2. 즉시 개선 필요 문제점 Top3\n3. 예산 재배분 방향\n4. 다음달 실행 계획\n5. 담당자 요청사항\n\n한국어로 실용적으로 작성해주세요.`;
    try {
      const res = await fetch('/api/analyze', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});
      const data = await res.json();
      setOverallAiText(data.result || 'AI 분석을 가져올 수 없습니다.');
    } catch { setOverallAiText('AI 분석 요청 실패. API 키를 확인하세요.'); }
    finally { setOverallAiLoading(false); }
  };

  // ── 히스토리 저장 (수동) ──
  const saveToHistory = () => {
    const summary = {};
    uploadedTypes.forEach(t => { summary[t] = getSummary(t); });
    onSaveHistory({ id:Date.now(), type:'adreport', keyword:'종합분석',
      savedAt:new Date().toLocaleString('ko-KR'), summary, aiText:overallAiText||'' });
    alert('히스토리에 저장됐습니다.');
  };

  // ── 보고서 HTML 다운로드 ──
  const downloadSummaryReport = () => {
    _downloadSummaryReport({ parsed, getSummary, uploadedTypes, overallAiText, fmt });
  };

  return (
    <div>
      {/* ── 헤더 ── */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:18}}>
        <div>
          <h2 style={{margin:0,fontWeight:700,fontSize:20}}>광고 보고서 분석</h2>
          <p style={{margin:'3px 0 0',color:'#666',fontSize:13}}>
            {analysisStep==='upload'
              ? '보고서 파일 업로드 후 "데이터 분석하기" 클릭'
              : '종합 분석 완료 — 개별 상품 검색·AI 전략분석·보고서 다운로드 가능'}
          </p>
        </div>
        {/* 버튼 영역 — 가로 정렬 */}
        <div style={{display:'flex',gap:8,alignItems:'center',flexShrink:0}}>
          {uploadedTypes.length>0 && analysisStep==='upload' && (
            <button className='btn btn-primary' style={{fontSize:13,padding:'9px 20px'}}
              onClick={()=>setAnalysisStep('summary')}>
              📊 데이터 분석하기
            </button>
          )}
          {analysisStep!=='upload' && (<>
            <button className='btn btn-ghost' style={{fontSize:12,padding:'7px 13px'}}
              onClick={()=>downloadSummaryReport()}>
              ⬇ 보고서
            </button>
            <button className='btn btn-primary' style={{fontSize:12,padding:'7px 14px',background:'#312e81'}}
              onClick={runOverallAI} disabled={overallAiLoading}>
              {overallAiLoading ? '분석 중...' : '🤖 AI 분석'}
            </button>
            <button className='btn btn-ghost' style={{fontSize:12,padding:'7px 13px',color:'#1a6b3a',borderColor:'#86efac'}}
              onClick={saveToHistory}>
              💾 저장
            </button>
            <button className='btn btn-ghost' style={{fontSize:12,padding:'7px 13px'}}
              onClick={()=>{setAnalysisStep('upload');setSearchResult(null);setOverallAiOpen(false);}}>
              ↩ 처음으로
            </button>
          </>)}
        </div>
      </div>

      {/* ── 파일 업로드 영역 ── */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:22}}>
        {[
          {key:'naver',   label:'네이버 검색광고',  desc:'다차원보고서 CSV',    icon:'🟢', color:'#276749', bg:'#f0fff4'},
          {key:'adboost', label:'네이버 애드부스트', desc:'디스플레이광고 CSV',  icon:'🔵', color:'#2c5282', bg:'#ebf8ff'},
          {key:'coupang', label:'쿠팡 광고',         desc:'광고보고서 Excel/CSV',icon:'🟠', color:'#9c4221', bg:'#fffaf0'},
        ].map(({key,label,desc,icon,color,bg}) => (
          <label key={key} style={{cursor:'pointer'}}>
            <input type='file' accept='.csv,.xlsx,.xls' style={{display:'none'}}
              onChange={e => { handleFile(e, key); setAnalysisStep('upload'); setOverallAiOpen(false); }} />
            <div style={{
              border:`2px dashed ${parsed[key]?color:'#e0ddd6'}`,
              borderRadius:14, padding:18, textAlign:'center',
              background: parsed[key]?bg:'#fff', transition:'all .2s'
            }}>
              <div style={{fontSize:24,marginBottom:8}}>{parsed[key]?'✅':icon}</div>
              <div style={{fontWeight:600,fontSize:13,color:parsed[key]?color:'#444'}}>{label}</div>
              <div style={{fontSize:11,color:'#999',marginTop:3}}>{desc}</div>
              {parsed[key] && (
                <div style={{marginTop:8,fontSize:11,color,fontWeight:600}}>
                  {reports[key]?.name} ({parsed[key].data.length}행)
                </div>
              )}
              {!parsed[key] && <div style={{marginTop:8,fontSize:11,color:'#bbb'}}>클릭하여 업로드</div>}
            </div>
          </label>
        ))}
      </div>

      {/* ── 분석 결과 섹션 ── */}
      {uploadedTypes.length > 0 && analysisStep !== 'upload' && (
        <AdReportBody
          parsed={parsed}
          getSummary={getSummary}
          uploadedTypes={uploadedTypes}
          analysisStep={analysisStep}
          runOverallAI={runOverallAI}
          overallAiLoading={overallAiLoading}
          overallAiText={overallAiText}
          overallAiOpen={overallAiOpen}
          setOverallAiOpen={setOverallAiOpen}
          wasteModal={wasteModal}
          setWasteModal={setWasteModal}
          searchKey={searchKey}
          setSearchKey={setSearchKey}
          searchResult={searchResult}
          setSearchResult={setSearchResult}
          searchPlatformFilter={searchPlatformFilter}
          setSearchPlatformFilter={setSearchPlatformFilter}
          searchProduct={searchProduct}
          runAI={runAI}
          aiLoading={aiLoading}
          aiText={aiText}
          aiOpen={aiOpen}
          setAiOpen={setAiOpen}
          saveToHistory={saveToHistory}
          downloadSummaryReport={downloadSummaryReport}
          fmt={fmt}
          pColor={pColor}
        />
      )}
    </div>
  );
}


function AdReportBody({
  parsed, getSummary, uploadedTypes, analysisStep, runOverallAI, overallAiLoading, overallAiText, overallAiOpen, setOverallAiOpen, wasteModal, setWasteModal, searchKey, setSearchKey, searchResult, setSearchResult, searchPlatformFilter, setSearchPlatformFilter, searchProduct, runAI, aiLoading, aiText, aiOpen, setAiOpen, saveToHistory, downloadSummaryReport, fmt, pColor
}) {
  return (
    <>
    {/* ── 전체 요약 대시보드 (분석하기 버튼 누른 후) ── */}
    {uploadedTypes.length > 0 && analysisStep !== 'upload' && (
      <div style={{marginBottom:22}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <div style={{fontWeight:600,fontSize:15}}>📊 종합 성과 요약</div>
          <button className='btn btn-primary' style={{fontSize:12,padding:'7px 16px',background:'#312e81'}}
            onClick={runOverallAI} disabled={overallAiLoading}>
            {overallAiLoading?'분석 중...':'🤖 AI 전략분석'}
          </button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:`repeat(${uploadedTypes.length},1fr)`,gap:14}}>
          {uploadedTypes.map(type => {
            const s = getSummary(type);
            if (!s) return null;
            const toN = v => parseFloat(String(v).replace(/,/g,'').replace(/%/g,''))||0;
            const getWasteRows = () => {
              if (type==='naver')   return (parsed.naver?.data||[]).filter(r=>toN(r['총비용'])>0&&toN(r['구매완료 전환수'])===0).sort((a,b)=>toN(b['총비용'])-toN(a['총비용'])).slice(0,20);
              if (type==='adboost') return (parsed.adboost?.data||[]).filter(r=>toN(r['총비용'])>0&&toN(r['구매완료 수'])===0).sort((a,b)=>toN(b['총비용'])-toN(a['총비용'])).slice(0,20);
              if (type==='coupang') return (parsed.coupang?.data||[]).filter(r=>toN(r['광고비'])>0&&toN(r['총 주문수(1일)'])===0&&String(r['광고 노출 지면']).includes('검색')&&!String(r['광고 노출 지면']).includes('비검색')).sort((a,b)=>toN(b['광고비'])-toN(a['광고비'])).slice(0,20);
              return [];
            };
            return (
              <div key={type} className='card' style={{borderColor:`${s.color}30`}}>
                <div style={{fontWeight:600,fontSize:14,color:s.color,marginBottom:12,
                  paddingBottom:8,borderBottom:`2px solid ${s.color}30`}}>{s.label}</div>

                {/* 쿠팡: 검색/비검색 분리 테이블 + 낭비비용 클릭 */}
                {type==='coupang' ? (
                  <div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                      <Kpi label='총 광고비' value={`₩${fmt(s.totalCost)}`} color='#c53030' />
                      <Kpi label='전체 ROAS(14일)' value={`${s.roas.toFixed(0)}%`} color={s.roas>500?'#1a6b3a':s.roas>300?'#d97706':'#c53030'} />
                    </div>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,marginTop:6}}>
                      <thead>
                        <tr style={{background:'#9c4221',color:'#fff'}}>
                          {['구분','광고비','CPC','전환매출(14일)','ROAS'].map(h=>(
                            <th key={h} style={{padding:'5px 8px',textAlign:h==='구분'?'left':'right',fontWeight:600}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          {label:'🔍 검색 영역', cost:s.searchCost,    roas:s.searchRoas,    isSearch:true},
                          {label:'📢 비검색 영역',cost:s.nonSearchCost, roas:s.nonSearchRoas, isSearch:false},
                        ].map((row,i)=>(
                          <CoupangAreaRow key={i} row={row} idx={i} parsed={parsed} fmt={fmt} />
                        ))}
                      </tbody>
                    </table>
                    <div style={{marginTop:8,display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                      <Kpi label='총 클릭수' value={`${fmt(s.totalClick)}회`} />
                      <Kpi label='평균 CPC' value={`₩${fmt(s.cpc)}`} />
                      {/* 쿠팡 낭비비용 클릭 */}
                      <div style={{background:'#fff5f5',borderRadius:10,padding:'10px 12px',cursor:'pointer',border:'1px solid #fca5a5'}}
                        onClick={()=>setWasteModal({type:'coupang', rows:getWasteRows()})}>
                        <div style={{fontSize:11,color:'#999',marginBottom:4}}>검색영역 낭비 <span style={{color:'#c53030',fontSize:10}}>(클릭)</span></div>
                        <div style={{fontFamily:'DM Mono',fontWeight:700,fontSize:13,color:'#c53030'}}>{getWasteRows().length}개 키워드</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,fontSize:13}}>
                    <Kpi label='총 광고비' value={`₩${fmt(s.totalCost)}`} color='#c53030' />
                    <Kpi label='ROAS' value={`${s.roas.toFixed(0)}%`} color={s.roas>500?'#1a6b3a':s.roas>300?'#d97706':'#c53030'} />
                    <Kpi label='총 클릭수' value={`${fmt(s.totalClick)}회`} />
                    <Kpi label='평균 CPC' value={`₩${fmt(s.cpc)}`} />
                    <Kpi label='전환수' value={`${fmt(s.totalConv)}건`} />
                    {/* 낭비비용 — 클릭하면 상세 모달 */}
                    <div style={{background:'#fff5f5',borderRadius:10,padding:'10px 12px',cursor:'pointer',border:'1px solid #fca5a5'}}
                      onClick={()=>setWasteModal({type, rows: getWasteRows()})}>
                      <div style={{fontSize:11,color:'#999',marginBottom:4}}>낭비비용 <span style={{color:'#c53030',fontSize:10}}>(클릭해서 상세보기)</span></div>
                      <div style={{fontFamily:'DM Mono',fontWeight:700,fontSize:15,color:'#c53030'}}>₩{fmt(s.wasteCost)}</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 낭비비용 상세 모달 */}
        {wasteModal && (
          <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}
            onClick={()=>setWasteModal(null)}>
            <div style={{background:'#fff',borderRadius:18,padding:28,maxWidth:700,width:'90%',maxHeight:'80vh',overflow:'auto'}}
              onClick={e=>e.stopPropagation()}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <div style={{fontWeight:700,fontSize:16,color:'#c53030'}}>
                  ❌ 낭비 키워드 상세 ({wasteModal.type==='naver'?'네이버 검색광고':wasteModal.type==='coupang'?'쿠팡 검색영역':'애드부스트'})
                </div>
                <button style={{background:'none',border:'none',cursor:'pointer',fontSize:22,color:'#bbb'}} onClick={()=>setWasteModal(null)}>×</button>
              </div>
              <div style={{fontSize:12,color:'#666',marginBottom:14,padding:'8px 12px',background:'#fff5f5',borderRadius:8}}>
                💡 <strong>CPC 3,000원↑</strong>: 즉시 제외 | <strong>CPC 1,000~3,000원</strong>: 입찰가 인하 | <strong>CTR 낮음</strong>: 광고소재 개선 | <strong>연관도 낮음</strong>: 제외 키워드 등록
              </div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead>
                  <tr style={{background:'#c53030',color:'#fff'}}>
                    {wasteModal.type==='naver'
                      ? ['검색어','캠페인','광고그룹','광고비','클릭수','CPC','노출수','권장액션'].map(h=><th key={h} style={{padding:'6px 10px',textAlign:'left',fontWeight:600}}>{h}</th>)
                      : wasteModal.type==='coupang'
                        ? ['키워드','광고집행 상품명','광고비','클릭수','CPC','노출수','권장액션'].map(h=><th key={h} style={{padding:'6px 10px',textAlign:'left',fontWeight:600}}>{h}</th>)
                        : ['상품명','광고비','클릭수','노출수','권장액션'].map(h=><th key={h} style={{padding:'6px 10px',textAlign:'left',fontWeight:600}}>{h}</th>)
                    }
                  </tr>
                </thead>
                <tbody>
                  {wasteModal.rows.map((r,i)=>{
                    const toN = v => parseFloat(String(v).replace(/,/g,''))||0;
                    const cost = wasteModal.type==='coupang'?toN(r['광고비']):toN(r['총비용']);
                    const click = toN(r['클릭수']);
                    const cpc = click>0?cost/click:0;
                    const action = cpc>3000?'즉시 제외':cpc>1000?'입찰가 인하':click>10?'소재 개선':'관찰';
                    const actionColor = cpc>3000?'#c53030':cpc>1000?'#d97706':'#1a6b3a';
                    return (
                      <tr key={i} style={{borderBottom:'1px solid #f0ede6',background:i%2?'#fff5f5':'#fff'}}>
                        {wasteModal.type==='naver' ? <>
                          <td style={{padding:'6px 10px',fontWeight:500}}>{r['검색어']}</td>
                          <td style={{padding:'6px 10px',color:'#666',fontSize:11}}>{r['캠페인']}</td>
                          <td style={{padding:'6px 10px',color:'#666',fontSize:11}}>{r['광고그룹']}</td>
                          <td style={{padding:'6px 10px',fontFamily:'DM Mono',color:'#c53030'}}>₩{fmt(cost)}</td>
                          <td style={{padding:'6px 10px',textAlign:'right'}}>{fmt(click)}</td>
                          <td style={{padding:'6px 10px',fontFamily:'DM Mono',textAlign:'right'}}>₩{fmt(cpc)}</td>
                          <td style={{padding:'6px 10px',textAlign:'right'}}>{fmt(toN(r['노출수']))}</td>
                          <td style={{padding:'6px 10px'}}><span style={{color:actionColor,fontWeight:600,fontSize:11}}>{action}</span></td>
                        </> : wasteModal.type==='coupang' ? <>
                          <td style={{padding:'6px 10px',fontWeight:500}}>{r['키워드']||'-'}</td>
                          <td style={{padding:'6px 10px',color:'#666',fontSize:11}}>{(r['광고집행 상품명']||'-').slice(0,25)}</td>
                          <td style={{padding:'6px 10px',fontFamily:'DM Mono',color:'#c53030'}}>₩{fmt(cost)}</td>
                          <td style={{padding:'6px 10px',textAlign:'right'}}>{fmt(click)}</td>
                          <td style={{padding:'6px 10px',fontFamily:'DM Mono',textAlign:'right'}}>₩{fmt(cpc)}</td>
                          <td style={{padding:'6px 10px',textAlign:'right'}}>{fmt(toN(r['노출수']))}</td>
                          <td style={{padding:'6px 10px'}}><span style={{color:actionColor,fontWeight:600,fontSize:11}}>{action}</span></td>
                        </> : <>
                          <td style={{padding:'6px 10px',fontWeight:500,fontSize:11}}>{r['상품명']?.slice(0,30)}</td>
                          <td style={{padding:'6px 10px',fontFamily:'DM Mono',color:'#c53030'}}>₩{fmt(cost)}</td>
                          <td style={{padding:'6px 10px',textAlign:'right'}}>{fmt(click)}</td>
                          <td style={{padding:'6px 10px',textAlign:'right'}}>{fmt(toN(r['노출수']))}</td>
                          <td style={{padding:'6px 10px'}}><span style={{color:actionColor,fontWeight:600,fontSize:11}}>{action}</span></td>
                        </>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 종합 AI 결과 */}
        {overallAiOpen && (
          <div style={{border:'1.5px solid #c7d2fe',borderRadius:13,padding:16,background:'#eef2ff',marginTop:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <div style={{fontWeight:600,fontSize:14,color:'#312e81'}}>🤖 종합 광고 전략 분석</div>
              <div style={{fontSize:11,color:'#999'}}>히스토리에 자동 저장됩니다</div>
            </div>
            {overallAiLoading
              ?<div style={{color:'#666',fontSize:13}}>분석 중입니다...</div>
              :<div style={{fontSize:13,color:'#1e1b4b',lineHeight:1.9,whiteSpace:'pre-wrap'}}>{overallAiText}</div>}
          </div>
        )}

        {/* 개별 상품 검색 */}
        <div className='card' style={{marginTop:16}}>
          <div style={{fontWeight:600,fontSize:15,marginBottom:4}}>🔍 개별 상품 상세 분석</div>
          <div style={{fontSize:12,color:'#999',marginBottom:12}}>
            상품코드(ERP) · 상품명 키워드 · 광고그룹명 · 쇼핑몰ID · 쿠팡옵션ID 중 하나 입력
          </div>
          {/* 플랫폼 필터 */}
          <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
            <span style={{fontSize:12,color:'#666',alignSelf:'center'}}>검색 범위:</span>
            {[
              {key:null, label:'전체'},
              ...(parsed.naver   ? [{key:'naver',   label:'네이버 검색광고'}] : []),
              ...(parsed.adboost ? [{key:'adboost', label:'애드부스트'}]       : []),
              ...(parsed.coupang ? [{key:'coupang', label:'쿠팡'}]             : []),
            ].map(({key,label})=>(
              <button key={String(key)} className={`btn ${searchPlatformFilter===key?'btn-primary':'btn-ghost'}`}
                style={{fontSize:12,padding:'5px 12px'}}
                onClick={()=>setSearchPlatformFilter(key)}>
                {label}
              </button>
            ))}
          </div>
          <div style={{display:'flex',gap:10,marginBottom:18}}>
            <input className='inp' placeholder='예: 위생롤백 또는 롤팩 또는 AM-RB-A-0001'
              value={searchKey} onChange={e=>setSearchKey(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&searchProduct()}
              style={{maxWidth:420}} />
            <button className='btn btn-primary' onClick={searchProduct}>검색</button>
            {searchResult&&<button className='btn btn-ghost' onClick={()=>{setSearchResult(null);setSearchKey('');setAiOpen(false);}}>초기화</button>}
          </div>

        {/* 검색 결과 */}
        {searchResult && searchResult.notFound && (
          <div style={{padding:20,borderRadius:11,background:'#f8f7f4'}}>
            <div style={{textAlign:'center',color:'#999',marginBottom:searchResult.dbItem?14:0}}>
              "{searchResult.key}"에 해당하는 광고 데이터를 찾지 못했습니다.
            </div>
            {searchResult.dbItem && (
              <div style={{background:'#fff',border:'1px solid #eae7df',borderRadius:10,padding:14,fontSize:13}}>
                <div style={{fontWeight:600,marginBottom:10,color:'#1a365d'}}>
                  📦 DB 상품 정보 — {searchResult.dbItem.name}
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:10}}>
                  <div><div style={{fontSize:11,color:'#999'}}>원가</div><div style={{fontFamily:'DM Mono',fontWeight:600}}>₩{fmt(searchResult.dbItem.cost)}</div></div>
                  <div><div style={{fontSize:11,color:'#999'}}>네이버 판매가</div><div style={{fontFamily:'DM Mono',fontWeight:600,color:'#276749'}}>₩{fmt(searchResult.dbItem.naverPrice)}</div></div>
                  <div><div style={{fontSize:11,color:'#999'}}>쿠팡 판매가</div><div style={{fontFamily:'DM Mono',fontWeight:600,color:'#9c4221'}}>₩{fmt(searchResult.dbItem.coupangPrice)}</div></div>
                </div>
                <div style={{background:'#fff5f5',padding:'8px 12px',borderRadius:8,fontSize:12,color:'#c53030'}}>
                  ⚠️ 광고 보고서에서 매핑되지 않았습니다.
                  {searchResult.dbItem.naverGroup
                    ? <span style={{color:'#276749'}}> 네이버그룹: {searchResult.dbItem.naverGroup} 등록됨 (보고서에 해당 그룹 없음)</span>
                    : ' → 상품DB 탭에서 광고그룹명/쿠팡옵션ID 입력 필요'}
                </div>
              </div>
            )}
          </div>
        )}

        {searchResult && !searchResult.notFound && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div style={{fontWeight:700,fontSize:16}}>"{searchResult.key}" 검색 결과</div>
              <button className='btn btn-primary' style={{background:'#312e81',fontSize:12}}
                onClick={()=>runAI(searchResult)} disabled={aiLoading}>
                {aiLoading?'분석 중...':'🤖 AI 전략 분석'}
              </button>
            </div>

            {/* 네이버 검색광고 상세 */}
            {searchResult.groups.naver && (() => {
              const grps = searchResult.groups.naver;
              const total = Object.values(grps).reduce((a,g)=>({
                cost:a.cost+g.cost,click:a.click+g.click,conv:a.conv+g.conv,sales:a.sales+g.sales
              }),{cost:0,click:0,conv:0,sales:0});
              return (
                <div style={{marginBottom:18}}>
                  <div style={{fontWeight:600,fontSize:14,color:'#276749',marginBottom:10,
                    display:'flex',alignItems:'center',gap:8}}>
                    🟢 네이버 검색광고
                    <span style={{fontSize:11,fontWeight:400,color:'#999'}}>광고그룹별 성과</span>
                  </div>
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                      <thead>
                        <tr style={{borderBottom:'2px solid #eae7df',color:'#999'}}>
                          {['광고그룹','광고비','클릭수','CPC','전환수','전환매출','ROAS','노출수'].map(h=>(
                            <th key={h} style={{padding:'6px 10px',textAlign:h==='광고그룹'?'left':'right',fontWeight:600,fontSize:11}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(grps).map(([grp,g],i)=>{
                          const roas = g.cost>0?g.sales/g.cost*100:0;
                          return (
                            <tr key={grp} style={{borderBottom:'1px solid #f0ede6',background:i%2?'#f8f7f4':'#fff'}}>
                              <td style={{padding:'8px 10px',fontWeight:500}}>{grp}</td>
                              <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'DM Mono',color:'#c53030'}}>₩{fmt(g.cost)}</td>
                              <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'DM Mono'}}>{fmt(g.click)}</td>
                              <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'DM Mono'}}>{g.click>0?`₩${fmt(g.cost/g.click)}`:'-'}</td>
                              <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'DM Mono'}}>{fmt(g.conv)}</td>
                              <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'DM Mono',color:'#1a6b3a'}}>₩{fmt(g.sales)}</td>
                              <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'DM Mono',
                                color:roas>500?'#1a6b3a':roas>300?'#d97706':'#c53030',fontWeight:600}}>
                                {roas>0?roas.toFixed(0)+'%':'-'}
                              </td>
                              <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'DM Mono',color:'#999'}}>{fmt(g.impression)}</td>
                            </tr>
                          );
                        })}
                        {/* 합산 행 */}
                        <tr style={{borderTop:'2px solid #1a365d',background:'#eef2ff',fontWeight:700}}>
                          <td style={{padding:'8px 10px'}}>📊 합산</td>
                          <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'DM Mono',color:'#c53030'}}>₩{fmt(total.cost)}</td>
                          <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'DM Mono'}}>{fmt(total.click)}</td>
                          <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'DM Mono'}}>{total.click>0?`₩${fmt(total.cost/total.click)}`:'-'}</td>
                          <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'DM Mono'}}>{fmt(total.conv)}</td>
                          <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'DM Mono',color:'#1a6b3a'}}>₩{fmt(total.sales)}</td>
                          <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'DM Mono',
                            color:total.cost>0&&total.sales/total.cost>5?'#1a6b3a':'#d97706',fontWeight:700}}>
                            {total.cost>0?(total.sales/total.cost*100).toFixed(0)+'%':'-'}
                          </td>
                          <td style={{padding:'8px 10px'}}></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* 키워드 분석 */}
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginTop:14}}>
                    {searchResult.naverTop?.length>0 && (
                      <div style={{background:'#f0fff4',borderRadius:11,padding:14}}>
                        <div style={{fontWeight:600,fontSize:13,color:'#276749',marginBottom:10}}>⭐ 고성과 키워드 TOP{Math.min(5,searchResult.naverTop.length)}</div>
                        {searchResult.naverTop.slice(0,5).map((r,i)=>(
                          <div key={i} style={{display:'flex',justifyContent:'space-between',
                            padding:'5px 0',borderBottom:'1px solid #c6f6d5',fontSize:12}}>
                            <span style={{color:'#2d6a4f',fontWeight:500}}>{r['검색어']}</span>
                            <span style={{fontFamily:'DM Mono',color:'#1a6b3a',fontWeight:600}}>
                              ROAS {r['구매완료 광고수익률(%)']}%
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {searchResult.naverWaste?.length>0 && (
                      <div style={{background:'#fff5f5',borderRadius:11,padding:14}}>
                        <div style={{fontWeight:600,fontSize:13,color:'#c53030',marginBottom:10}}>
                          ❌ 낭비 키워드 TOP{Math.min(10,searchResult.naverWaste.length)} (전환0 + 비용발생)
                        </div>
                        {searchResult.naverWaste.slice(0,10).map((r,i)=>{
                          const toN = v=>parseFloat(String(v).replace(/,/g,''))||0;
                          const cost = toN(r['총비용']);
                          const click = toN(r['클릭수']);
                          const cpc = click>0?cost/click:0;
                          const imp = toN(r['노출수']);
                          const ctr = imp>0?(click/imp*100).toFixed(2):0;
                          const action = cpc>3000?'🔴 즉시 제외':cpc>1500?'🟡 입찰가 50% 인하':cpc>800?'🟡 입찰가 30% 인하':click>20?'🟠 소재 개선':'🟢 관찰 유지';
                          const guide = cpc>3000?'제외 키워드 등록':cpc>1500?`목표 ₩${fmt(Math.round(cpc*0.5))} 이하`:cpc>800?`목표 ₩${fmt(Math.round(cpc*0.7))} 이하`:click>20?`CTR ${ctr}% → 소재 교체`:'5회 이상 전환 없으면 제외';
                          return (
                            <div key={i} style={{padding:'6px 0',borderBottom:'1px solid #fed7d7',fontSize:11}}>
                              <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                                <span style={{color:'#c53030',fontWeight:500,fontSize:12}}>{r['검색어']}</span>
                                <span style={{fontFamily:'DM Mono',color:'#c53030'}}>₩{fmt(cost)}</span>
                              </div>
                              <div style={{display:'flex',justifyContent:'space-between',color:'#888'}}>
                                <span>{action}</span>
                                <span style={{fontSize:10,color:'#aaa'}}>{guide}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 쿠팡 상세 */}
            {searchResult.groups.coupang && (
              <div style={{marginBottom:18}}>
                <div style={{fontWeight:600,fontSize:14,color:'#9c4221',marginBottom:10}}>🟠 쿠팡 광고 (검색/비검색 영역)</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:12,marginBottom:14}}>
                  {Object.entries(searchResult.groups.coupang).map(([area,g])=>(
                    <CoupangDetailCard key={area} area={area} g={g} fmt={fmt} />
                  ))}
                </div>
                {/* 쿠팡 고성과 키워드 */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                  {searchResult.coupangTop?.length>0&&(
                    <div style={{background:'#fff8f0',borderRadius:11,padding:14}}>
                      <div style={{fontWeight:600,fontSize:13,color:'#9c4221',marginBottom:10}}>
                        ⭐ 고성과 키워드 TOP{Math.min(10,searchResult.coupangTop.length)}
                      </div>
                      {searchResult.coupangTop.slice(0,10).map((r,i)=>{
                        const toN = v=>parseFloat(String(v).replace(/,/g,''))||0;
                        const roas = toN(r['광고비'])>0 ? (toN(r['총 전환매출액(14일)'])/toN(r['광고비'])*100).toFixed(0) : 0;
                        return (
                          <div key={i} style={{display:'flex',justifyContent:'space-between',
                            padding:'5px 0',borderBottom:'1px solid #fed7aa',fontSize:12}}>
                            <span style={{color:'#9c4221',fontWeight:500}}>{r['키워드']||'-'}</span>
                            <span style={{fontFamily:'DM Mono',color:'#9c4221',fontWeight:600}}>ROAS {roas}%</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {searchResult.coupangWaste?.length>0&&(
                    <div style={{background:'#fff5f5',borderRadius:11,padding:14}}>
                      <div style={{fontWeight:600,fontSize:13,color:'#c53030',marginBottom:10}}>
                        ❌ 낭비 키워드 TOP{Math.min(10,searchResult.coupangWaste.length)}
                        <span style={{fontSize:11,fontWeight:400,color:'#999',marginLeft:6}}>전환0 + 비용발생</span>
                      </div>
                      {searchResult.coupangWaste.slice(0,10).map((r,i)=>{
                        const toN = v=>parseFloat(String(v).replace(/,/g,''))||0;
                        const cost = toN(r['광고비']);
                        const click = toN(r['클릭수']);
                        const cpc = click>0?cost/click:0;
                        const action = cpc>3000?'🔴 즉시 제외':cpc>1500?'🟡 입찰가 50% 인하':cpc>800?'🟡 입찰가 30% 인하':'🟢 관찰 유지';
                        const guide = cpc>3000?`입찰가 → 목표CPC 이하로`:cpc>1500?`₩${fmt(Math.round(cpc*0.5))} 이하 목표`:cpc>800?`₩${fmt(Math.round(cpc*0.7))} 이하 목표`:'전환 발생 시까지 관찰';
                        return (
                          <div key={i} style={{padding:'6px 0',borderBottom:'1px solid #fed7d7',fontSize:11}}>
                            <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                              <span style={{color:'#c53030',fontWeight:500}}>{r['키워드']||'-'}</span>
                              <span style={{fontFamily:'DM Mono',color:'#c53030'}}>₩{fmt(cost)}</span>
                            </div>
                            <div style={{display:'flex',justifyContent:'space-between',color:'#888'}}>
                              <span>{action}</span>
                              <span style={{fontSize:10,color:'#aaa'}}>{guide}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 애드부스트 상세 */}
            {searchResult.groups.adboost && (
              <AdboostDetail data={searchResult.groups.adboost} fmt={fmt} />
            )}

            {/* AI 분석 결과 */}
            {aiOpen && (
              <div style={{border:'1.5px solid #c7d2fe',borderRadius:13,padding:16,background:'#eef2ff',marginTop:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                  <div style={{fontWeight:600,fontSize:14,color:'#312e81'}}>🤖 AI 전략 분석</div>
                  <button className='btn btn-ghost' style={{fontSize:11,padding:'3px 10px'}} onClick={()=>setAiOpen(false)}>닫기</button>
                </div>
                {aiLoading
                  ? <div style={{color:'#666',fontSize:13}}>분석 중입니다...</div>
                  : <div style={{fontSize:13,color:'#1e1b4b',lineHeight:1.9,whiteSpace:'pre-wrap'}}>{aiText}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>  
    )}

    {uploadedTypes.length === 0 && (
      <div className='card' style={{textAlign:'center',padding:'50px 0',color:'#bbb'}}>
        <div style={{fontSize:40,marginBottom:12}}>📂</div>
        <div style={{fontSize:15,marginBottom:6}}>광고 보고서 파일을 업로드하세요</div>
        <div style={{fontSize:13,marginBottom:6}}>네이버 검색광고 · 쿠팡 · 애드부스트 중 보유한 보고서만 올리면 됩니다</div>
        <div style={{fontSize:12,color:'#bbb'}}>업로드 후 "보고서 분석하기" 버튼을 눌러주세요</div>
      </div>
    )}

    {uploadedTypes.length > 0 && analysisStep === 'upload' && (
      <div style={{textAlign:'center',padding:'30px 0'}}>
        <div style={{fontSize:14,color:'#666',marginBottom:16}}>
          {uploadedTypes.length}개 보고서 업로드 완료 — 분석을 시작하세요
        </div>
        <button className='btn btn-primary' style={{fontSize:15,padding:'12px 32px',background:'#312e81'}}
          onClick={()=>setAnalysisStep('summary')}>
          📊 보고서 분석하기
        </button>
      </div>
    )}
    </>
  );
}

// KPI 카드
function Kpi({ label, value, color='#1a1a1a' }) {
  return (
    <div style={{background:'#f8f7f4',borderRadius:10,padding:'10px 12px'}}>
      <div style={{fontSize:11,color:'#999',marginBottom:4}}>{label}</div>
      <div style={{fontFamily:'DM Mono',fontWeight:700,fontSize:15,color}}>{value}</div>
    </div>
  );
}

// 쿠팡 검색/비검색 행 (별도 컴포넌트로 분리)
function CoupangAreaRow({ row, idx, parsed, fmt }) {
  const toN = v => parseFloat(String(v).replace(/,/g,''))||0;
  const areaRows = (parsed.coupang?.data||[]).filter(r => {
    const a = String(r['광고 노출 지면']||'');
    return idx===0 ? (a.includes('검색 영역')&&!a.includes('비검색')) : a.includes('비검색');
  });
  const tc = areaRows.reduce((s,r)=>s+toN(r['광고비']),0);
  const tk = areaRows.reduce((s,r)=>s+toN(r['클릭수']),0);
  const cpc = tk>0 ? tc/tk : 0;
  return (
    <tr style={{borderBottom:'1px solid #f0ede6',background:idx%2?'#fff8f0':'#fff'}}>
      <td style={{padding:'6px 8px',fontWeight:500}}>{row.label}</td>
      <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'DM Mono',color:'#c53030'}}>₩{fmt(row.cost)}</td>
      <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'DM Mono'}}>₩{fmt(cpc)}</td>
      <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'DM Mono',color:'#1a6b3a'}}>₩{fmt(row.cost*(row.roas/100))}</td>
      <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'DM Mono',fontWeight:700,
        color:row.roas>500?'#1a6b3a':row.roas>300?'#d97706':'#c53030'}}>
        {row.roas.toFixed(0)}%
      </td>
    </tr>
  );
}

// 개별 상품 쿠팡 영역 카드
function CoupangDetailCard({ area, g, fmt }) {
  const roas14 = g.cost>0 ? g.sales14/g.cost*100 : 0;
  const cpc = g.click>0 ? g.cost/g.click : 0;
  return (
    <div style={{background:'#fffaf0',border:'1.5px solid #fed7aa',borderRadius:12,padding:14}}>
      <div style={{fontWeight:600,color:'#9c4221',marginBottom:8,fontSize:13}}>{area}</div>
      <div style={{fontSize:12,display:'flex',flexDirection:'column',gap:4}}>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#888'}}>광고비</span><span className='mono' style={{color:'#c53030'}}>₩{fmt(g.cost)}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#888'}}>클릭수</span><span className='mono'>{fmt(g.click)}회</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#888'}}>CPC</span><span className='mono'>₩{fmt(cpc)}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#888'}}>주문수(1일)</span><span className='mono'>{fmt(g.order)}건</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}>
          <span style={{color:'#888'}}>ROAS(14일)</span>
          <span className='mono' style={{fontWeight:700,color:roas14>500?'#1a6b3a':roas14>300?'#d97706':'#c53030'}}>
            {roas14.toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}

// 개별 상품 애드부스트 상세
function AdboostDetail({ data, fmt }) {
  const {total, rows} = data;
  const roas = total.cost>0 ? total.sales/total.cost*100 : 0;
  return (
    <div style={{marginBottom:18}}>
      <div style={{fontWeight:600,fontSize:14,color:'#2c5282',marginBottom:10}}>🔵 네이버 애드부스트</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:12}}>
        <Kpi label='총 광고비' value={`₩${fmt(total.cost)}`} color='#c53030' />
        <Kpi label='ROAS' value={`${roas.toFixed(0)}%`} color={roas>400?'#1a6b3a':roas>200?'#d97706':'#c53030'} />
        <Kpi label='구매완료' value={`${fmt(total.conv)}건`} color='#1a6b3a' />
        <Kpi label='위시리스트' value={`${fmt(total.wishlist)}건`} color='#2c5282' />
      </div>
      {rows.length>0 && (
        <div style={{fontSize:12,color:'#666'}}>매칭 상품: {rows.map(r=>r['상품명']?.slice(0,20)).join(' / ')}</div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// 상품 DB 탭 (이카운트 연동)
// ══════════════════════════════════════════════════════
function ProductDBTab({ settings }) {
  const [dbProducts, setDbProducts] = useState(() => {
    try { const s = localStorage.getItem('mc_productdb_v1'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [editId, setEditId] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [filterCat, setFilterCat] = useState('전체');
  const [serverSync, setServerSync] = useState('idle'); // idle | loading | saving | ok | error
  const fileRef = useState(null)[0];

  useEffect(() => {
    try { localStorage.setItem('mc_productdb_v1', JSON.stringify(dbProducts)); } catch {}
  }, [dbProducts]);

  // 앱 시작 시 서버에서 DB 로드
  useEffect(() => {
    setServerSync('loading');
    fetch('/api/db-products')
      .then(r=>r.json())
      .then(d=>{
        if (d.products?.length) {
          setDbProducts(d.products);
          setServerSync('ok');
        } else {
          setServerSync('idle');
        }
      })
      .catch(()=>setServerSync('error'));
  }, []);

  // 서버에 저장하는 함수
  const saveToServer = (products) => {
    setServerSync('saving');
    fetch('/api/db-products', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({products})
    })
    .then(r=>r.json())
    .then(d=>{ setServerSync(d.ok?'ok':'error'); setTimeout(()=>setServerSync('idle'),3000); })
    .catch(()=>{ setServerSync('error'); setTimeout(()=>setServerSync('idle'),3000); });
  };

  const parseEcountCSV = (text) => {
    const clean = text.replace(/^\uFEFF/, '');
    // CSV 파싱 (따옴표 안 줄바꿈 처리)
    const parseRows = (str) => {
      const rows = []; let row = [], cur = '', inQ = false;
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { row.push(cur); cur = ''; }
        else if ((ch === '\n' || (ch === '\r' && str[i+1] === '\n')) && !inQ) {
          if (ch === '\r') i++;
          row.push(cur); rows.push(row); row = []; cur = '';
        } else { cur += ch; }
      }
      if (cur || row.length) { row.push(cur); rows.push(row); }
      return rows;
    };
    const rows = parseRows(clean);
    if (!rows.length) return [];

    // 헤더 행 찾기 (품목코드 또는 No 포함된 행)
    let hIdx = rows.findIndex(r => r.some(c => c.replace(/\n/g,'').includes('품목코드') || c.trim()==='No'));
    if (hIdx < 0) hIdx = 0;
    const header = rows[hIdx].map(h => h.replace(/\n/g,' ').trim());

    const col = (...names) => {
      for (const n of names) {
        const i = header.findIndex(h => h.replace(/\s/g,'').includes(n.replace(/\s/g,'')));
        if (i >= 0) return i;
      }
      return -1;
    };

    const toNum = v => parseFloat(String(v||'').replace(/,/g,'').replace(/[원%]/g,'').trim()) || 0;
    const toStr = v => String(v||'').replace(/\n/g,' ').trim();

    // 헤더 다음부터 데이터, 설명 행 스킵
    return rows.slice(hIdx + 1)
      .filter(r => {
        const code = toStr(r[col('품목코드')] ?? '');
        return code && !code.includes('이카운트') && code !== '자동' && !code.includes('ERP코드');
      })
      .map(r => ({
        id:              toStr(r[col('품목코드')] ?? ''),
        code:            toStr(r[col('품목코드')] ?? ''),
        name:            toStr(r[col('상품명')] ?? ''),
        category:        toStr(r[col('카테고리')] ?? ''),
        cost:            toNum(r[col('원가')] ?? 0),
        naverPrice:      toNum(r[col('네이버판매가','네이버 판매가')] ?? 0),
        coupangPrice:    toNum(r[col('쿠팡판매가','쿠팡 판매가')] ?? 0),
        openmarketPrice: toNum(r[col('오픈마켓판매가','오픈마켓 판매가')] ?? 0),
        status:          toStr(r[col('상태')] ?? '') || '활성',
        naverGroup:      toStr(r[col('광고그룹명','네이버광고그룹')] ?? ''),
        shopId:          toStr(r[col('쇼핑몰상품ID','쇼핑몰 상품ID')] ?? ''),
        naverShopId:     toStr(r[col('네이버쇼핑상품ID','네이버쇼핑 상품ID')] ?? ''),
        coupangOptionId: toStr(r[col('쿠팡옵션ID','쿠팡 옵션ID')] ?? ''),
        memo: '',
      })).filter(r => r.code);
  };

  // 품목코드에서 브랜드 > 카테고리 자동 생성
  const getCategoryFromCode = (code) => {
    const brandMap = {
      'AM':'에이엠공구','CM':'공통/기타','MU':'모던어스','TP':'띵파우치','RE':'회수자산'
    };
    const catMap = {
      'AP':'개인위생용품','CL':'청소/세제','GL':'산업용장갑','KJ':'주방잡화','KT':'조리도구',
      'KW':'주방식기','LW':'리빙/패브릭','MS':'측정/위생전문','PK':'일회용품','PT':'파우치/부속품',
      'SH':'신발','SM':'부자재','DELI':'배송비','CR':'투명파우치','TH':'띵파우치',
      'ZP':'지퍼파우치','RB':'롤백','NG':'니트릴장갑','VG':'위생장갑','SC':'소창',
      'CT':'광목','RW':'원/부자재','CF':'커피필터','CP':'위생모','ST':'토끼캡',
      'GR':'올인원기어','PR':'프로세스','PP':'쫄대','PLT':'파레트',
    };
    try {
      const parts = String(code).split('-');
      const brand = brandMap[parts[0]] || parts[0] || '';
      const cat   = catMap[parts[1]]   || parts[1] || '기타';
      return brand ? `${brand} > ${cat}` : cat;
    } catch { return '기타'; }
  };

  const handleUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    const processRows = (rows) => {
      if (!rows.length) { alert('데이터를 읽을 수 없습니다. 파일 형식을 확인하세요.'); return; }
      if (window.confirm(`${rows.length}개 품목을 불러옵니다.\n기존 DB와 병합할까요?\n(취소 시 전체 교체)`)) {
        setDbProducts(prev => {
          const existing = new Map(prev.map(p=>[p.code,p]));
          rows.forEach(r => {
            if (existing.has(r.code)) {
              existing.get(r.code).cost = r.cost; // 원가만 갱신
            } else {
              existing.set(r.code, r);
            }
          });
          return Array.from(existing.values());
        });
      } else {
        setDbProducts(rows);
      }
    };

    if (ext === 'xlsx' || ext === 'xls') {
      // xlsx — SheetJS로 파싱
      reader.onload = (ev) => {
        const loadXlsx = (XLSX) => {
          try {
            const wb = XLSX.read(ev.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const raw = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 });
            if (!raw.length) { alert('데이터가 없습니다.'); return; }

            // 이카운트 형식 감지: 헤더 행에 '품목코드' 있는지 확인
            let headerIdx = -1;
            for (let i = 0; i < Math.min(5, raw.length); i++) {
              if (raw[i].includes('품목코드')) { headerIdx = i; break; }
            }

            if (headerIdx >= 0) {
              // 이카운트 CSV/xlsx 형식
              const header = raw[headerIdx].map(h => String(h).trim());
              const dataRows = raw.slice(headerIdx + 1).filter(r => r[header.indexOf('품목코드')]);
              const rows = dataRows.map(r => {
                const obj = {};
                header.forEach((h, i) => { obj[h] = r[i] !== undefined ? String(r[i]).trim() : ''; });
                return {
                  id: obj['품목코드'],
                  code: obj['품목코드'],
                  name: (obj['품목명']||'') + (obj['규격'] ? ' ' + obj['규격'] : ''),
                  cost: parseFloat(obj['입고단가'])||0,
                  category: getCategoryFromCode(obj['품목코드']),
                  naverPrice: 0, coupangPrice: 0, openmarketPrice: 0,
                  naverGroup: '', shopId: '', naverShopId: '', coupangOptionId: '',
                  status: '활성', memo: '',
                };
              }).filter(r => r.code);
              processRows(rows);
            } else {
              // 상품마스터DB xlsx 형식 (헤더가 2~3행)
              // 1행: No, 품목코드(ERP), 상품명, 카테고리, 원가, 네이버가, ...
              const json = XLSX.utils.sheet_to_json(ws, { defval: '', range: 1 }); // 2행부터
              if (!json.length) { alert('데이터가 없습니다.'); return; }
              const rows = json.map(r => ({
                id: String(r['품목코드\n(ERP)']||r['품목코드']||'').trim(),
                code: String(r['품목코드\n(ERP)']||r['품목코드']||'').trim(),
                name: String(r['상품명']||'').trim(),
                cost: parseFloat(r['원가\n(VAT포함)']||r['원가']||0),
                category: String(r['카테고리']||'').trim(),
                naverPrice: parseFloat(r['네이버\n판매가']||r['네이버가']||0),
                coupangPrice: parseFloat(r['쿠팡\n판매가']||r['쿠팡가']||0),
                openmarketPrice: parseFloat(r['오픈마켓\n판매가']||r['오픈마켓가']||0),
                naverGroup: String(r['네이버\n광고그룹명']||'').trim(),
                shopId: String(r['쇼핑몰\n상품ID']||'').trim(),
                naverShopId: String(r['네이버쇼핑\n상품ID']||'').trim(),
                coupangOptionId: String(r['쿠팡\n옵션ID']||'').trim(),
                status: String(r['상태']||'활성').trim(),
                memo: String(r['비고']||'').trim(),
              })).filter(r => r.code && r.code !== 'NaN');
              processRows(rows);
            }
          } catch(err) { alert('파일 읽기 오류: ' + err.message); }
        };

        if (window.XLSX) {
          loadXlsx(window.XLSX);
        } else {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
          script.onload = () => loadXlsx(window.XLSX);
          document.head.appendChild(script);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // CSV
      reader.onload = (ev) => {
        try {
          const rows = parseEcountCSV(ev.target.result);
          processRows(rows);
        } catch(err) { alert('CSV 읽기 오류: ' + err.message); }
      };
      reader.readAsText(file, 'utf-8');
    }
    e.target.value = '';
  };

  const updateProduct = (id, field, value) => {
    setDbProducts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, [field]: value };
      // 품목코드 변경 시 카테고리 자동 생성
      if (field === 'code' && value) {
        updated.category = getCategoryFromCode(value);
        updated.id = value; // id도 코드로 갱신
      }
      return updated;
    }));
  };

  const deleteProduct = (id) => {
    if (window.confirm('이 항목을 삭제할까요?')) setDbProducts(prev=>prev.filter(p=>p.id!==id));
  };

  const addProduct = () => {
    const newP = {
      id: 'NEW-'+Date.now(), code:'', name:'', cost:0, category:'기타',
      naverPrice:0, coupangPrice:0, openmarketPrice:0,
      naverGroup:'', shopId:'', naverShopId:'', coupangOptionId:'',
      status:'활성', memo:'',
    };
    setDbProducts(prev=>[newP,...prev]);
    setEditId(newP.id);
  };

  const exportCSV = () => {
    const headers = ['품목코드','상품명','카테고리','원가','네이버가','쿠팡가','오픈마켓가','광고그룹명','쇼핑몰ID','네이버쇼핑ID','쿠팡옵션ID','상태'];
    const rows = dbProducts.map(p=>[p.code,p.name,p.category,p.cost,p.naverPrice,p.coupangPrice,p.openmarketPrice,p.naverGroup,p.shopId,p.naverShopId,p.coupangOptionId,p.status].join(','));
    const csv = '\uFEFF'+[headers.join(','),...rows].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = `상품DB_${new Date().toLocaleDateString()}.csv`; a.click();
  };

  const categories = ['전체',...new Set(dbProducts.map(p=>p.category))];
  const filtered = dbProducts.filter(p=>{
    const matchQ = !searchQ || p.name.includes(searchQ)||p.code.includes(searchQ)||p.category.includes(searchQ);
    const matchCat = filterCat==='전체'||p.category===filterCat;
    return matchQ && matchCat;
  });

  const calcMinRoas = (cost, price, platformKey) => {
    if (!cost||!price) return null;
    const feeRate = (settings.fees[platformKey]?.rate||8)/100;
    const paidFee = settings.defaultPaidFee||3000;
    const shipCost = settings.defaultShippingCost||2700;
    const 수수료 = price*feeRate+paidFee*(settings.shippingFeeCommission||3.3)/100;
    const 세전 = (price+paidFee-cost-shipCost-수수료)/1.1;
    const 부가세 = (price+paidFee)/1.1*0.1-(cost+shipCost+수수료)/1.1*0.1;
    const 세후 = 세전-부가세;
    const 최종 = 세후>0?세후*(1-(settings.incomeTaxRate||15)/100):세후;
    return 최종>0?Math.round(price/최종*100):null;
  };

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
        <div>
          <h2 style={{margin:0,fontWeight:700,fontSize:20}}>상품 DB</h2>
          <p style={{margin:'3px 0 0',color:'#666',fontSize:13}}>
            이카운트 xlsx/CSV 업로드 → 원가 자동 입력 | 판매가·광고 매핑ID 직접 입력
            {serverSync==='loading'&&<span style={{marginLeft:8,color:'#d97706',fontSize:11}}>⏳ 서버에서 불러오는 중...</span>}
            {serverSync==='saving'&&<span style={{marginLeft:8,color:'#d97706',fontSize:11}}>⏳ 서버에 저장 중...</span>}
            {serverSync==='ok'&&<span style={{marginLeft:8,color:'#1a6b3a',fontSize:11}}>✅ 서버 동기화 완료</span>}
            {serverSync==='error'&&<span style={{marginLeft:8,color:'#c53030',fontSize:11}}>⚠️ 서버 연결 오류</span>}
          </p>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <label style={{cursor:'pointer'}}>
            <input type='file' accept='.csv,.xlsx,.xls' style={{display:'none'}} onChange={handleUpload} />
            <span className='btn btn-ghost' style={{fontSize:12,display:'inline-block'}}>📥 이카운트 파일 업로드</span>
          </label>
          <button className='btn btn-primary' style={{fontSize:12,background:'#276749'}}
            onClick={()=>saveToServer(dbProducts)} disabled={serverSync==='saving'||!dbProducts.length}>
            ☁️ 서버에 저장 (팀원 공유)
          </button>
          <button className='btn btn-ghost' style={{fontSize:12}} onClick={exportCSV}>📤 CSV 내보내기</button>
          <button className='btn btn-primary' style={{fontSize:12}} onClick={addProduct}>+ 상품 추가</button>
          {dbProducts.length>0&&<button className='btn btn-danger' style={{fontSize:12}}
            onClick={()=>{if(window.confirm('DB 전체를 초기화할까요?'))setDbProducts([])}}>초기화</button>}
        </div>
      </div>

      {/* 검색/필터 */}
      <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
        <input className='inp' placeholder='상품명·코드·카테고리 검색' value={searchQ}
          onChange={e=>setSearchQ(e.target.value)} style={{maxWidth:280}} />
        <select className='inp' value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{maxWidth:160}}>
          {categories.map(c=><option key={c}>{c}</option>)}
        </select>
        <span style={{fontSize:13,color:'#666',alignSelf:'center'}}>
          {filtered.length}개 / 전체 {dbProducts.length}개
        </span>
      </div>

      {dbProducts.length===0 ? (
        <div className='card' style={{textAlign:'center',padding:'60px 0',color:'#bbb'}}>
          <div style={{fontSize:40,marginBottom:12}}>📦</div>
          <div style={{fontSize:15,marginBottom:8}}>상품 DB가 비어있습니다</div>
          <div style={{fontSize:13,marginBottom:16}}>이카운트에서 품목 CSV를 다운로드해서 업로드하거나 직접 추가하세요</div>
          <div style={{fontSize:12,color:'#999'}}>이카운트 → 품목관리 → 품목조회 → 엑셀다운로드(CSV)</div>
        </div>
      ) : (
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:1200}}>
            <thead>
              <tr style={{background:'#1a365d',color:'#fff'}}>
                {['품목코드','상품명','카테고리','원가','네이버가','쿠팡가',
                  '최소ROAS(N)','네이버이익','네이버수익률',
                  '최소ROAS(C)','쿠팡이익','쿠팡수익률',
                  '광고그룹명','상태',''].map((h,i)=>(
                  <th key={i} style={{padding:'8px 8px',textAlign:i>3?'center':'left',fontWeight:600,whiteSpace:'nowrap',fontSize:11}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p,i)=>{
                const isEdit = editId===p.id;
                const naverMinRoas = calcMinRoas(p.cost, p.naverPrice, 'naver');
                const coupangMinRoas = calcMinRoas(p.cost, p.coupangPrice, 'coupang');
                // 수익/수익률 계산
                const calcProfit = (cost, price, platformKey) => {
                  if (!cost||!price) return {profit:null,roi:null};
                  const feeRate = (settings.fees[platformKey]?.rate||8)/100;
                  const paidFee = settings.defaultPaidFee||3000;
                  const shipCost = settings.defaultShippingCost||2700;
                  const 수수료 = price*feeRate+paidFee*(settings.shippingFeeCommission||3.3)/100;
                  const 세전 = (price+paidFee-cost-shipCost-수수료)/1.1;
                  const 부가세 = (price+paidFee)/1.1*0.1-(cost+shipCost+수수료)/1.1*0.1;
                  const 세후 = 세전-부가세;
                  const 최종 = 세후>0?세후*(1-(settings.incomeTaxRate||15)/100):세후;
                  return {profit:Math.round(최종), roi:price>0?Math.round(최종/price*1000)/10:null};
                };
                const nP = calcProfit(p.cost, p.naverPrice, 'naver');
                const cP = calcProfit(p.cost, p.coupangPrice, 'coupang');
                return (
                  <tr key={p.id} style={{borderBottom:'1px solid #eae7df',background:i%2?'#f8f7f4':'#fff'}}>
                    <td style={{padding:'6px 8px',fontFamily:'DM Mono',fontSize:11}}>
                      {p.id.startsWith('NEW-') ? (
                        <input className='inp' value={p.code||''} placeholder='AM-KJ-A-0001'
                          style={{fontSize:11,padding:'4px 8px',width:130,fontFamily:'DM Mono'}}
                          onChange={e=>updateProduct(p.id,'code',e.target.value.toUpperCase())} />
                      ) : (
                        <span style={{color:'#666'}}>{p.code}</span>
                      )}
                    </td>
                    <td style={{padding:'6px 8px',minWidth:180}}>
                      {isEdit ? <input className='inp' value={p.name} style={{fontSize:12,padding:'4px 8px'}}
                        onChange={e=>updateProduct(p.id,'name',e.target.value)} /> : <span style={{fontWeight:500,fontSize:12}}>{p.name}</span>}
                    </td>
                    <td style={{padding:'6px 8px',whiteSpace:'nowrap'}}>
                      <span style={{fontSize:10,color:'#4A235A',background:'#FAF5FF',
                        padding:'2px 6px',borderRadius:20,display:'inline-block'}}>
                        {p.category||getCategoryFromCode(p.code)||'기타'}
                      </span>
                    </td>
                    <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'DM Mono',color:'#c53030',fontSize:12}}>
                      {isEdit ? <input className='inp' value={p.cost} type='number' style={{fontSize:11,padding:'4px 6px',width:80,textAlign:'right'}}
                        onChange={e=>updateProduct(p.id,'cost',parseFloat(e.target.value)||0)} /> : `₩${fmt(p.cost)}`}
                    </td>
                    {['naverPrice','coupangPrice'].map(field=>(
                      <td key={field} style={{padding:'6px 8px',textAlign:'center'}}>
                        <input className='inp' value={p[field]||''} type='text' inputMode='numeric'
                          style={{fontSize:11,padding:'4px 6px',textAlign:'right',
                            background:p[field]>0?'#f0fff4':'#fff8e1',width:80}}
                          onChange={e=>updateProduct(p.id,field,parse(e.target.value))}
                          onFocus={e=>e.target.select()} placeholder='판매가' />
                      </td>
                    ))}
                    {/* 네이버 최소ROAS + 이익 + 수익률 */}
                    <td style={{padding:'6px 8px',textAlign:'center',fontFamily:'DM Mono',fontWeight:700,fontSize:12,
                      color:naverMinRoas?'#276749':'#bbb'}}>
                      {naverMinRoas?`${naverMinRoas}%`:'-'}
                    </td>
                    <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'DM Mono',fontSize:11,
                      color:nP.profit>0?'#276749':'#c53030'}}>
                      {nP.profit!==null?`₩${fmt(nP.profit)}`:'-'}
                    </td>
                    <td style={{padding:'6px 8px',textAlign:'center',fontSize:11,fontWeight:600,
                      color:nP.roi>0?'#276749':'#c53030'}}>
                      {nP.roi!==null?`${nP.roi}%`:'-'}
                    </td>
                    {/* 쿠팡 최소ROAS + 이익 + 수익률 */}
                    <td style={{padding:'6px 8px',textAlign:'center',fontFamily:'DM Mono',fontWeight:700,fontSize:12,
                      color:coupangMinRoas?'#9c4221':'#bbb'}}>
                      {coupangMinRoas?`${coupangMinRoas}%`:'-'}
                    </td>
                    <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'DM Mono',fontSize:11,
                      color:cP.profit>0?'#9c4221':'#c53030'}}>
                      {cP.profit!==null?`₩${fmt(cP.profit)}`:'-'}
                    </td>
                    <td style={{padding:'6px 8px',textAlign:'center',fontSize:11,fontWeight:600,
                      color:cP.roi>0?'#9c4221':'#c53030'}}>
                      {cP.roi!==null?`${cP.roi}%`:'-'}
                    </td>
                    <td style={{padding:'6px 8px',minWidth:150}}>
                      <input className='inp' value={p.naverGroup||''} placeholder='광고그룹명 (쉼표구분)'
                        style={{fontSize:11,padding:'4px 6px'}}
                        onChange={e=>updateProduct(p.id,'naverGroup',e.target.value)} />
                    </td>
                    <td style={{padding:'6px 8px'}}>
                      <select className='inp' value={p.status||'활성'} style={{fontSize:11,padding:'4px 6px'}}
                        onChange={e=>updateProduct(p.id,'status',e.target.value)}>
                        {['활성','단종','검토중','신규'].map(s=><option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td style={{padding:'6px 8px',textAlign:'center'}}>
                      <button className='btn btn-danger' style={{fontSize:10,padding:'3px 8px'}}
                        onClick={()=>deleteProduct(p.id)}>삭제</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
