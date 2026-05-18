// reportUtils.js
export function _downloadSummaryReport({ parsed, getSummary, uploadedTypes, overallAiText, fmt }) {
  const date = new Date().toLocaleDateString('ko-KR');
  const toN = v => parseFloat(String(v).replace(/,/g,'').replace(/%/g,''))||0;
  const sN = getSummary('naver');
  const sA = getSummary('adboost');
  const sC = getSummary('coupang');

  const naverWaste = (parsed.naver?.data||[])
    .filter(r=>toN(r['\ucd1d\ube44\uc6a9'])>0&&toN(r['\uad6c\ub9e4\uc644\ub8cc \uc804\ud658\uc218'])===0)
    .sort((a,b)=>toN(b['\ucd1d\ube44\uc6a9'])-toN(a['\ucd1d\ube44\uc6a9'])).slice(0,15);
  const naverTop = (parsed.naver?.data||[])
    .filter(r=>toN(r['\uad6c\ub9e4\uc644\ub8cc \uc804\ud658\uc218'])>0)
    .sort((a,b)=>toN(b['\uad6c\ub9e4\uc644\ub8cc \uad11\uace0\uc218\uc775\ub960(%)'])-toN(a['\uad11\uace0\uc218\uc775\ub960(%)'.replace('\uc218\uc775\ub960','')])).slice(0,10);
  const coupWaste = (parsed.coupang?.data||[])
    .filter(r=>toN(r['\uad11\uace0\ube44'])>0&&toN(r['\uc885 \uc8fc\ubb38\uc218(1\uc77c)'])===0
      &&String(r['\uad11\uace0 \ub178\ucd9c \uc9c0\uba74']).includes('\uac80\uc0c9 \uc601\uc5ed')
      &&!String(r['\uad11\uace0 \ub178\ucd9c \uc9c0\uba74']).includes('\ube44\uac80\uc0c9'))
    .sort((a,b)=>toN(b['\uad11\uace0\ube44'])-toN(a['\uad11\uace0\ube44'])).slice(0,15);

  const T = (s) => String(s||'').replace(/&/g,'&amp;').replace(/[<]/g,'&lt;').replace(/[>]/g,'&gt;');
  const actionTag = (cpc) => {
    if (cpc>3000) return '<span style="color:#991b1b;background:#fee2e2;padding:2px 6px;border-radius:10px;font-size:11px">\uc989\uc2dc \uc81c\uc678</span>';
    if (cpc>1000) return '<span style="color:#92400e;background:#fef3c7;padding:2px 6px;border-radius:10px;font-size:11px">\uc785\ucc30\uac00 \uc778\ud558</span>';
    return '<span style="color:#166534;background:#dcfce7;padding:2px 6px;border-radius:10px;font-size:11px">\uad00\ucc30</span>';
  };

  const kpiBox = (label, value, color) =>
    '<div style="background:#f0f4ff;border-radius:8px;padding:10px 12px">' +
    '<div style="font-size:11px;color:#999;margin-bottom:3px">' + label + '</div>' +
    '<div style="font-size:16px;font-weight:700;font-family:monospace;color:' + (color||'#1a365d') + '">' + value + '</div></div>';

  const kpiGrid = (items) =>
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:10px 0 14px">' +
    items.map(([l,v,c]) => kpiBox(l,v,c)).join('') + '</div>';

  const mkTbl = (headers, rows) => {
    const thead = '<tr>' + headers.map(h => '<th style="background:#1a365d;color:#fff;padding:6px 9px;text-align:left;font-size:12px">' + h + '</th>').join('') + '</tr>';
    const tbody = rows.map((row, ri) =>
      '<tr>' + row.map(c => '<td style="padding:5px 9px;border-bottom:1px solid #eae7df;font-size:12px;background:' + (ri%2?'#f8f7f4':'#fff') + '">' + c + '</td>').join('') + '</tr>'
    ).join('');
    return '<table style="width:100%;border-collapse:collapse;margin:6px 0 14px">' +
      '<thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table>';
  };

  let body = '';

  if (sN) {
    const wasteRows = naverWaste.map(r => {
      const cost = toN(r['\ucd1d\ube44\uc6a9']);
      const click = toN(r['\ud074\ub9ad\uc218']);
      const cpc = click>0 ? cost/click : 0;
      return [T(r['\uac80\uc0c9\uc5b4']), T(r['\uce90\ud398\uc778']), T(r['\uad11\uace0\uadf8\ub8f9']),
        '\u20a9'+fmt(cost), String(click), '\u20a9'+fmt(cpc), actionTag(cpc)];
    });
    const topRows = naverTop.map(r => [
      T(r['\uac80\uc0c9\uc5b4']), T(r['\uce90\ud398\uc778']), T(r['\uad11\uace0\uadf8\ub8f9']),
      '\u20a9'+fmt(toN(r['\ucd1d\ube44\uc6a9'])), String(r['\uad6c\ub9e4\uc644\ub8cc \uc804\ud658\uc218']),
      String(r['\uad6c\ub9e4\uc644\ub8cc \uad11\uace0\uc218\uc775\ub960(%)'])+'%'
    ]);
    body += '<div style="border:1px solid #eae7df;border-radius:12px;padding:18px;margin-bottom:18px">' +
      '<h2 style="color:#276749;font-size:15px;margin:0 0 12px;border-left:4px solid #276749;padding-left:10px">\ud83d\udfe2 \ub124\uc774\ubc84 \uac80\uc0c9\uad11\uace0</h2>' +
      kpiGrid([
        ['\uc131\uad11\uace0\ube44', '\u20a9'+fmt(sN.totalCost), '#c53030'],
        ['ROAS', sN.roas.toFixed(0)+'%', sN.roas>500?'#1a6b3a':sN.roas>300?'#d97706':'#c53030'],
        ['\uc804\ud658\uc218', fmt(sN.totalConv)+'\uac74'],
        ['\ub099\ube44\ube44\uc6a9', '\u20a9'+fmt(sN.wasteCost), '#c53030'],
        ['\ud074\ub9ad\uc218', fmt(sN.totalClick)+'\ud68c'],
        ['\ud3c9\uade0 CPC', '\u20a9'+fmt(sN.cpc)],
        ['\uc804\ud658\ub9e4\ucd9c', '\u20a9'+fmt(sN.totalSales), '#1a6b3a'],
        ['\ub099\ube44\ud0a4\uc6cc\ub4dc', naverWaste.length+'\uac1c', '#c53030'],
      ]) +
      (topRows.length ? '<h3 style="font-size:13px;margin:12px 0 6px">\u2b50 \uace0\uc131\uacfc \ud0a4\uc6cc\ub4dc TOP10</h3>' + mkTbl(['\uac80\uc0c9\uc5b4','\uce90\ud398\uc778','\uad11\uace0\uadf8\ub8f9','\uad11\uace0\ube44','\uc804\ud658\uc218','ROAS'], topRows) : '') +
      (wasteRows.length ? '<h3 style="font-size:13px;margin:12px 0 6px">\u274c \ub099\ube44 \ud0a4\uc6cc\ub4dc TOP15</h3>' + mkTbl(['\uac80\uc0c9\uc5b4','\uce90\ud398\uc778','\uad11\uace0\uadf8\ub8f9','\uad11\uace0\ube44','\ud074\ub9ad\uc218','CPC','\uad8c\uc7a5\uc561\uc158'], wasteRows) : '') +
      '</div>';
  }

  if (sA) {
    body += '<div style="border:1px solid #eae7df;border-radius:12px;padding:18px;margin-bottom:18px">' +
      '<h2 style="color:#2c5282;font-size:15px;margin:0 0 12px;border-left:4px solid #2c5282;padding-left:10px">\ud83d\udd35 \ub124\uc774\ubc84 \uc560\ub4dc\ubd80\uc2a4\ud2b8</h2>' +
      kpiGrid([
        ['\uc131\uad11\uace0\ube44', '\u20a9'+fmt(sA.totalCost), '#c53030'],
        ['ROAS', sA.roas.toFixed(0)+'%', sA.roas>400?'#1a6b3a':sA.roas>200?'#d97706':'#c53030'],
        ['\uad6c\ub9e4\uc644\ub8cc', fmt(sA.totalConv)+'\uac74'],
        ['\ub099\ube44\ube44\uc6a9', '\u20a9'+fmt(sA.wasteCost), '#c53030'],
      ]) +
      '</div>';
  }

  if (sC) {
    const coupRows = coupWaste.map(r => {
      const cost = toN(r['\uad11\uace0\ube44']);
      const click = toN(r['\ud074\ub9ad\uc218']);
      const cpc = click>0 ? cost/click : 0;
      return [T(r['\ud0a4\uc6cc\ub4dc']||'-'), T((r['\uad11\uace0\uc9d1\ud589 \uc0c1\ud488\uba85']||'-').slice(0,25)),
        '\u20a9'+fmt(cost), String(click), '\u20a9'+fmt(cpc), actionTag(cpc)];
    });
    const sp = sC.totalCost>0?(sC.searchCost/sC.totalCost*100).toFixed(1):0;
    const np = sC.totalCost>0?(sC.nonSearchCost/sC.totalCost*100).toFixed(1):0;
    body += '<div style="border:1px solid #eae7df;border-radius:12px;padding:18px;margin-bottom:18px">' +
      '<h2 style="color:#9c4221;font-size:15px;margin:0 0 12px;border-left:4px solid #9c4221;padding-left:10px">\ud83d\udfe0 \ucfe0\ud321 \uad11\uace0</h2>' +
      kpiGrid([
        ['\uc131\uad11\uace0\ube44', '\u20a9'+fmt(sC.totalCost), '#c53030'],
        ['\uc804\uccb4 ROAS(14\uc77c)', sC.roas.toFixed(0)+'%', sC.roas>500?'#1a6b3a':sC.roas>300?'#d97706':'#c53030'],
        ['\uac80\uc0c9\uc601\uc5ed ROAS', sC.searchRoas.toFixed(0)+'%', '#1a6b3a'],
        ['\ube44\uac80\uc0c9\uc601\uc5ed ROAS', sC.nonSearchRoas.toFixed(0)+'%', '#d97706'],
      ]) +
      '<h3 style="font-size:13px;margin:12px 0 6px">\uac80\uc0c9 vs \ube44\uac80\uc0c9 \uc601\uc5ed</h3>' +
      mkTbl(['\uad6c\ubd84','\uad11\uace0\ube44','\ube44\uc911','ROAS(14\uc77c)'],[
        ['\ud83d\udd0d \uac80\uc0c9 \uc601\uc5ed', '\u20a9'+fmt(sC.searchCost), sp+'%', sC.searchRoas.toFixed(0)+'%'],
        ['\ud83d\udce2 \ube44\uac80\uc0c9 \uc601\uc5ed', '\u20a9'+fmt(sC.nonSearchCost), np+'%', sC.nonSearchRoas.toFixed(0)+'%'],
      ]) +
      (coupRows.length ? '<h3 style="font-size:13px;margin:12px 0 6px">\u274c \ucfe0\ud321 \ube44\ud6a8\uc728 \ud0a4\uc6cc\ub4dc TOP15</h3>' + mkTbl(['\ud0a4\uc6cc\ub4dc','\uad11\uace0\uc9d1\ud589 \uc0c1\ud488\uba85','\uad11\uace0\ube44','\ud074\ub9ad\uc218','CPC','\uad8c\uc7a5\uc561\uc158'], coupRows) : '') +
      '</div>';
  }

  if (overallAiText) {
    body += '<div style="border:1px solid #c7d2fe;border-radius:12px;padding:18px;margin-bottom:18px">' +
      '<h2 style="color:#312e81;font-size:15px;margin:0 0 12px;border-left:4px solid #312e81;padding-left:10px">\ud83e\udd16 AI \uc804\ub7b5 \ubd84\uc11d</h2>' +
      '<div style="background:#eef2ff;border-radius:8px;padding:14px;line-height:1.9;white-space:pre-wrap;font-size:13px">' + T(overallAiText) + '</div></div>';
  }

  const channels = uploadedTypes.map(t => ({naver:'\ub124\uc774\ubc84 \uac80\uc0c9\uad11\uace0',adboost:'\uc560\ub4dc\ubd80\uc2a4\ud2b8',coupang:'\ucfe0\ud321'}[t])).join(' \u00b7 ');

  const css = [
    'body{font-family:"맑은 고딕",sans-serif;color:#1a1a1a;padding:32px;max-width:1000px;margin:0 auto;font-size:13px}',
    'h1{color:#1a365d;font-size:22px;border-bottom:3px solid #1a365d;padding-bottom:10px;margin-bottom:4px}',
    'footer{margin-top:32px;padding-top:10px;border-top:1px solid #eae7df;font-size:11px;color:#999;text-align:right}',
  ].join('');

  const html = '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>\uad11\uace0 \uc131\uacfc \ubcf4\uace0\uc11c ' + date + '</title>' +
    '<style>' + css + '</style></head><body>' +
    '<h1>\ud83d\udcca \uad11\uace0 \uc131\uacfc \uc885\ud569 \ubcf4\uace0\uc11c</h1>' +
    '<p style="color:#999;font-size:12px;margin-bottom:24px">\uc791\uc131\uc77c: ' + date + ' | \ubd84\uc11d \ucc44\ub110: ' + channels + '</p>' +
    body +
    '<footer>\uad11\uace0 \uc131\uacfc \ubcf4\uace0\uc11c | ' + date + '</footer></body></html>';

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], {type:'text/html;charset=utf-8'}));
  a.download = '\uad11\uace0\uc131\uacfc\ubcf4\uace0\uc11c_' + date.replace(/\./g,'') + '.html';
  a.click();
}
