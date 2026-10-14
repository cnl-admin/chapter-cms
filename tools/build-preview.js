#!/usr/bin/env node
// Builds a single-file, server-less demo of the editor (for sharing a phone preview).
// Usage: node tools/build-preview.js out.html   (edits live in the viewer's browser only)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const data = { drafts: {}, site: JSON.parse(rd('data/demo/site.json')), pages: {} };
for (const f of fs.readdirSync(path.join(root, 'data/demo/pages'))) data.pages[f.slice(0, -5)] = JSON.parse(rd('data/demo/pages/' + f));
const html = rd('admin/index.html');
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const body = html.match(/<body>([\s\S]*?)<script src/)[1];
const sitecss = rd('static/site.css');
const adminJs = rd('admin/admin.js');
const mod = (name, src) => `__m['${name}']=function(module,exports,require){${src.replace(/<\/script>/g, "<\\/script>")}\n};`;
const out = `<title>Chapter Editor Demo</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${style}
.note{background:var(--card);border:1px dashed var(--line);border-radius:8px;padding:.6rem .8rem;font-size:.85rem;color:var(--mut)}
</style>
${body.replace('<button id="save"', '<button id="resetBtn">Reset demo</button><button id="save"').replace('<main>', '<div class="note" style="margin:12px max(16px,env(safe-area-inset-left,0px)) 0">Demo: your edits are saved only in this browser. Nothing is published.</div><main>')}
<script>
var __m={};
var __siteCss=${JSON.stringify(sitecss)};
var __seed=${JSON.stringify(data)};
${mod('blocks', rd('lib/blocks.js'))}
${mod('render', rd('lib/render.js').replace("require('./blocks')", "require('blocks')"))}
function __require(n){var m={exports:{}};__m[n](m,m.exports,__require);return m.exports}
(function(){
  var B=__require('blocks'),R=__require('render');
  window.confirm=function(){return true}; // dialogs are blocked in the viewer; demo data can be reset
  var KEY='chapter-cms-demo-v3',st;
  try{st=JSON.parse(localStorage.getItem(KEY))}catch(e){}
  if(!st)st=JSON.parse(JSON.stringify(Object.assign({drafts:{}},__seed)));
  var hist={};
  var save=function(){try{localStorage.setItem(KEY,JSON.stringify(st))}catch(e){}};
  var css=function(h){return h.replace('<link rel="stylesheet" href="/static/site.css">','<style>'+__siteCss+'</style>')};
  var pageOf=function(b){return{title:String(b.title||''),seo_title:String(b.seo_title||''),seo_description:String(b.seo_description||''),seo_image:String(b.seo_image||''),blocks:B.validateBlocks(b.blocks)}};
  var stamp=function(){return new Date().toISOString().replace(/[:.]/g,'-')+'.json'};
  var J=function(x){return Promise.resolve({ok:true,statusText:'OK',headers:{get:function(){return 'application/json'}},json:function(){return Promise.resolve(x)}})};
  var T=function(x){return Promise.resolve({ok:true,statusText:'OK',headers:{get:function(){return 'text/html'}},text:function(){return Promise.resolve(x)}})};
  var E=function(x){return Promise.resolve({ok:false,statusText:x,headers:{get:function(){return 'application/json'}},json:function(){return Promise.resolve({error:x})}})};
  window.fetch=function(url,o){
    o=o||{};var p=url.replace('/admin/api/','').split('/'),m=o.method||'GET',b=o.body?JSON.parse(o.body):null;
    try{
      if(p[0]==='schema')return J(B.schema());
      if(p[0]==='chapters')return J(['demo']);
      if(p[0]==='preview')return T(css(R.renderPage(st.site,pageOf(b),{pageSlug:b.page,preview:true,edit:!!b.edit})));
      var kind=p[2],slug=p[3],extra=p[4];
      if(!kind)return J({site:st.site,pages:Object.keys(Object.assign({},st.pages,st.drafts)).map(function(s){var pg=st.drafts[s]||st.pages[s];return{slug:s,title:pg.title,draft:!!st.drafts[s],live:!!st.pages[s]}})});
      if(kind==='publish'){var done=Object.keys(st.drafts);done.forEach(function(s){if(st.pages[s])(hist[s]=hist[s]||[]).push({t:stamp(),d:st.pages[s]});st.pages[s]=st.drafts[s]});st.drafts={};save();return J({published:done})}
      if(kind==='pages'){var title=String(b.title||'').trim()||'New page',base=title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'page',sl=base,n=2;while(st.pages[sl]||st.drafts[sl])sl=base+'-'+(n++);st.drafts[sl]=pageOf({title:title,blocks:[{type:'hero',props:Object.assign(B.defaultsFor('hero'),{heading:title})},{type:'text',props:B.defaultsFor('text')}]});st.site.nav=(st.site.nav||[]).concat([{label:title,path:'/'+sl}]);save();return J({slug:sl})}
      if(kind==='site'){if(m==='PUT'){st.site=Object.assign({},st.site,{name:b.name,tagline:b.tagline,footer:b.footer,contact_email:b.contact_email,theme:b.theme,social:b.social,nav:b.nav});save()}return J(st.site)}
      if(extra==='history')return J((hist[slug]||[]).map(function(h){return h.t}).reverse());
      if(extra==='restore'){var h=(hist[slug]||[]).filter(function(x){return x.t===b.version})[0];if(!h)return E('version not found');st.drafts[slug]=h.d;save();return J(h.d)}
      if(extra==='discard'){delete st.drafts[slug];save();return J(st.pages[slug]||{})}
      if(m==='PUT'){st.drafts[slug]=pageOf(b);save()}
      return J(st.drafts[slug]||st.pages[slug]);
    }catch(e){return E(e.message)}
  };
  var wire=function(){var rb=document.getElementById('resetBtn');if(!rb)return setTimeout(wire,50);rb.onclick=function(){try{localStorage.removeItem(KEY)}catch(e){}location.reload()}};wire();
})();
</script>
<script>
${adminJs}
</script>`;
fs.writeFileSync(process.argv[2] || 'preview.html', out);
console.log('wrote', process.argv[2] || 'preview.html', out.length, 'bytes');
