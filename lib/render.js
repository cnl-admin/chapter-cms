
'use strict';
const { esc, safeUrl, renderBlock, socialLinks, blocks: BLOCKS, ATOMS } = require('./blocks');

// Yard Sign design: the chapter picks one color; everything else derives from it.
const hexOk = (c, d) => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || '') ? c : d);
const rgb = (c) => { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map((x) => x + x).join(''); const n = parseInt(c, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = (c) => { const v = rgb(c).map((x) => { x /= 255; return x > 0.03928 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const contrast = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
const readable = (c, bg, ink) => { for (let i = 0; i < 14 && contrast(c, bg) < 4.6; i++) c = mix(c, ink, 0.16); return c; };

function themeVars(theme = {}) {
  const ch = hexOk(theme.accent, '#C23B4F');
  const navy = hexOk(theme.primary, '#2C3659');
  const paper = '#FDFBE9', ink = '#22293f';
  return `--ch:${ch};--navy:${navy};--paper:${paper};--ink:${ink};--on-ch:${contrast(ch, '#ffffff') >= contrast(ch, ink) ? '#ffffff' : ink};--ch-text:${readable(ch, paper, ink)};--ch-tint:${mix(ch, paper, 0.84)}`;
}

// Injected into the admin preview: makes [data-f] text editable in place and reports edits/selection to the editor.
const EDIT_ASSETS = `<style>
.tb{position:absolute;top:8px;right:8px;display:none;gap:2px;align-items:center;background:#2C3659;color:#FDFBE9;border-radius:8px;padding:2px 4px;font:600 11px system-ui,sans-serif;z-index:20;box-shadow:3px 3px 0 #d9a521;white-space:nowrap}.tb b{padding:0 6px 0 4px;font-weight:700}.tb button{background:none;border:0;color:inherit;cursor:pointer;min-width:24px;height:24px;border-radius:5px;font-size:13px}.tb button:hover{background:rgba(253,251,233,.22)}.blk:hover>.tb,.atom:hover>.tb{display:flex}.blk:has(.atom:hover)>.tb{display:none}.atom{position:relative;outline:2px solid transparent;outline-offset:2px}.atom:hover{outline-color:rgba(44,54,89,.35)}.atom.sel{outline-color:#d9a521}.emptycol{border:1.5px dashed rgba(44,54,89,.35);padding:14px;border-radius:8px;text-align:center}
.blk{position:relative;outline:3px solid transparent;outline-offset:-3px;transition:outline-color .12s}
.blk:hover{outline-color:rgba(44,54,89,.25)}.blk.sel{outline-color:#d9a521}
[data-f]{cursor:text;outline:none;border-radius:2px}[data-f]:hover{box-shadow:0 0 0 2px rgba(217,165,33,.55)}[data-f]:focus{box-shadow:0 0 0 3px #d9a521;background:rgba(255,255,255,.12)}
[data-f]:empty:before{content:attr(data-ph);opacity:.55;text-transform:none;font-style:italic;letter-spacing:0}
[data-ml]{white-space:pre-wrap}.raw{white-space:pre-wrap;margin:.5em 0}
a.btn span{pointer-events:auto}.btn{cursor:default}
.lay{display:inline-flex;gap:2px;width:20px;height:10px;vertical-align:middle}.lay i{background:currentColor;border-radius:2px;opacity:.85}.tb .lays{display:inline-flex;padding-right:4px;margin-right:4px;border-right:1px solid rgba(253,251,233,.35)}.tb .lays button.on{background:#FDFBE9;color:#2C3659}.addatom{display:none;width:100%;margin-top:10px;background:#fff;border:1.5px dashed rgba(44,54,89,.4);border-radius:8px;padding:6px;font:600 12px system-ui,sans-serif;color:#2C3659;cursor:pointer}.scol:hover>.addatom,.scol:has(.emptycol)>.addatom{display:block}.addsec{max-width:1100px;margin:28px auto;padding:16px;border:2px dashed rgba(44,54,89,.35);border-radius:12px;font:600 13px system-ui,sans-serif;color:#2C3659}.addsec .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.addsec button{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1.5px solid #2C3659;border-radius:999px;padding:6px 14px 6px 10px;cursor:pointer;font:600 12px system-ui,sans-serif;color:#2C3659}.addsec button:hover{background:#2C3659;color:#FDFBE9}
</style><script>(function(){
var parent_=window.parent,plain=(function(){var d=document.createElement('div');try{d.contentEditable='plaintext-only'}catch(e){}return d.contentEditable==='plaintext-only'})();
function post(m){parent_.postMessage(m,'*')}
document.querySelectorAll('[data-f]').forEach(function(el){el.contentEditable=plain?'plaintext-only':'true';el.spellcheck=true});
function mark(b){document.querySelectorAll('.blk').forEach(function(x){x.classList.toggle('sel',+x.dataset.b===b)})}
document.addEventListener('click',function(e){if(e.target.closest("a"))e.preventDefault();var bl=e.target.closest('.blk'),it=e.target.closest('[data-item]'),f=e.target.closest('[data-f]');
 var b=bl?+bl.dataset.b:-1;mark(b);var at=e.target.closest('.atom');document.querySelectorAll('.atom').forEach(function(x){x.classList.toggle('sel',x===at)});post({t:'select',b:b,f:f?f.dataset.f:null,item:it?+it.dataset.item:null,atom:at?at.dataset.atom:null})},true);
document.addEventListener('focusin',function(e){var f=e.target.closest('[data-f]');if(f){var bl=f.closest('.blk');mark(+bl.dataset.b);post({t:'focus',f:f.dataset.f,b:+bl.dataset.b})}});
document.addEventListener('input',function(e){var f=e.target.closest('[data-f]');if(f)post({t:'edit',f:f.dataset.f,v:f.innerText.replace(/\\u00a0/g,' ').replace(/\\n$/,'')})});
document.addEventListener('keydown',function(e){var f=e.target.closest&&e.target.closest('[data-f]');if(f&&e.key==='Enter'&&!f.hasAttribute('data-ml')){e.preventDefault();f.blur()}});
window.addEventListener('message',function(e){var m=e.data||{};
 if(m.t==='set'){var el=document.querySelector('[data-f="'+m.f+'"]');if(el)el.innerText=m.v}
 if(m.t==='scroll')window.scrollTo(0,m.y);
 if(m.t==='select')mark(m.b);
 if(m.t==='focus'){var el2=document.querySelector('[data-f="'+m.f+'"]');if(el2){el2.focus({preventScroll:true})}}
 if(m.t==='goto'){var bb=document.querySelector('.blk[data-b="'+m.b+'"]');if(bb)bb.scrollIntoView({behavior:'smooth',block:'start'})}});
document.querySelectorAll('.blk,.atom').forEach(function(x){var t=document.createElement('div');t.className='tb';t.setAttribute('contenteditable','false');t.innerHTML='<b>'+(x.dataset.label||'')+'</b><button data-a=\"up\" title=\"Move up\">\u2191</button><button data-a=\"down\" title=\"Move down\">\u2193</button><button data-a=\"rm\" title=\"Delete\">\u00d7</button>';x.insertBefore(t,x.firstChild)});
document.addEventListener('click',function(e){var bt=e.target.closest('.tb button[data-a]');if(!bt)return;e.stopPropagation();var at=bt.closest('.atom'),bl=bt.closest('.blk');post({t:'act',a:bt.dataset.a,b:+bl.dataset.b,atom:at?at.dataset.atom:null})},true);
var LAY={full:['Full width',[1]],halves:['Two halves',[1,1]],wideL:['Wide left',[2,1]],wideR:['Wide right',[1,2]],three:['Three columns',[1,1,1]]};
function icon(k){return '<span class="lay">'+LAY[k][1].map(function(n){return '<i style="flex:'+n+'"></i>'}).join('')+'</span>'}
document.querySelectorAll('.blk').forEach(function(x){var c=x.querySelector('.cols[data-layout]');if(!c)return;var tb=x.querySelector(':scope>.tb');if(!tb)return;var h='<span class="lays">'+Object.keys(LAY).map(function(k){return '<button data-lay="'+k+'" title="'+LAY[k][0]+'" class="'+(k===c.dataset.layout?'on':'')+'">'+icon(k)+'</button>'}).join('')+'</span>';tb.querySelector('b').insertAdjacentHTML('afterend',h)});
var CMS=window.__CMS||{atoms:[]};
document.querySelectorAll('.scol').forEach(function(col){var blk=col.closest('.blk');var s=document.createElement('select');s.className='addatom';s.setAttribute('contenteditable','false');s.innerHTML='<option value="">＋ Add a block</option>'+CMS.atoms.map(function(a){return '<option value="'+a[0]+'">'+a[1]+'</option>'}).join('');s.dataset.c=col.dataset.col;s.dataset.b=blk.dataset.b;col.appendChild(s)});
document.addEventListener('change',function(e){var s=e.target.closest('.addatom');if(s&&s.value)post({t:'act',a:'addatom',b:+s.dataset.b,c:+s.dataset.c,type:s.value})});
var mainEl=document.querySelector('main');if(mainEl){var as=document.createElement('div');as.className='addsec';as.setAttribute('contenteditable','false');as.innerHTML='Add a section by layout<div class="chips">'+Object.keys(LAY).map(function(k){return '<button data-addsec="'+k+'">'+icon(k)+' '+LAY[k][0]+'</button>'}).join('')+'</div>';mainEl.appendChild(as)}
document.addEventListener('click',function(e){var l=e.target.closest('button[data-lay]');if(l){e.stopPropagation();post({t:'act',a:'layout',b:+l.closest('.blk').dataset.b,k:l.dataset.lay});return}var a=e.target.closest('button[data-addsec]');if(a){e.stopPropagation();post({t:'act',a:'addsec',k:a.dataset.addsec})}},true);
post({t:'ready',y:window.scrollY});
})();</script>`;

function renderPage(site, page, { pageSlug, base = '', preview = false, edit = false } = {}) {
  const t = site.theme || {};
  const title = page.seo_title || `${page.title} · ${site.name}`;
  const cur = '/' + (pageSlug === 'home' ? '' : pageSlug);
  const nav = (site.nav || []).map((n) => `<a href="${safeUrl(base + n.path)}"${n.path === cur ? ' aria-current="page"' : ''}>${esc(n.label)}</a>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(page.seo_description || site.tagline || '')}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(page.seo_description || site.tagline || '')}">${page.seo_image ? `<meta property="og:image" content="${safeUrl(page.seo_image)}">` : ''}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Domine:wght@400..700&display=swap">
<link rel="stylesheet" href="/static/site.css"><style>:root{${themeVars(t)}}</style></head>
<body><header class="top"><div class="wrap bar"><a class="brand" href="${safeUrl(base || '/')}">${t.logo ? `<img src="${safeUrl(t.logo)}" alt="">` : ''}<span class="sign">${esc(site.name)}</span></a><nav>${nav}</nav></div></header>
<main>${(page.blocks || []).map((b, i) => (edit ? `<div class="blk" data-b="${i}" data-label="${esc(BLOCKS[b.type]?.label || '')}">${renderBlock(b, { edit, i, site })}</div>` : renderBlock(b, { site }))).join('\n')}</main>
<footer><div class="wrap"><p class="sign foot-name">${esc(site.name)}</p><p>${esc(site.footer || '')}</p>${socialLinks(site)}${site.contact_email ? `<p><a href="mailto:${esc(site.contact_email)}">${esc(site.contact_email)}</a></p>` : ''}</div></footer>
${edit ? `<script>window.__CMS=${JSON.stringify({ atoms: ATOMS.map((t) => [t, BLOCKS[t].label]) })}</script>` + EDIT_ASSETS : preview ? '<script>document.addEventListener("click",e=>{if(e.target.closest("a"))e.preventDefault()})</script>' : ''}
</body></html>`;
}
module.exports = { renderPage, themeVars };
