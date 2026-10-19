// ==UserScript==
// @name         Pegzel — Binary Pegboard Mapper
// @namespace    pegzel
// @version      1.9.0
// @description  Turn images into editable binary pegboard layouts.
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  const W = 78, H = 44, N = W * H;
  let host, image = null, name = 'pegzel', zoom = 1, ox = 0, oy = 0, dragging = false;
  let edits = new Int8Array(N), grid = new Uint8Array(N), painting = false, tool = 'pan';
  let source, preview, sourceCtx, previewCtx, output, status;
  const ui = {};
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const $ = (tag,parent,attrs={}) => { const n=document.createElement(tag); Object.assign(n,attrs); parent.appendChild(n); return n; };
  function start() {
    if (host) { host.remove(); host=null; return; }
    host=document.createElement('div');
    host.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#eceff2;color:#202632;font:13px system-ui,Arial,sans-serif';
    document.documentElement.appendChild(host);
    const root=host.attachShadow({mode:'open'});
    $('style',root,{textContent:`
      *{box-sizing:border-box} .app{height:100%;display:flex;flex-direction:column}
      header{padding:12px 16px;background:#fff;display:flex;align-items:center;gap:12px;border-bottom:1px solid #ccd1d8}
      header strong{font-size:19px} button,select{padding:7px;border:1px solid #bbc3cc;border-radius:7px;background:white;cursor:pointer}
      button:hover{background:#eef4fa}.tools{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px;background:white;border-bottom:1px solid #ccd1d8}
      label{display:inline-flex;align-items:center;gap:5px} input[type=range]{width:95px}
      main{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(350px,1fr);gap:12px;padding:12px;flex:1;min-height:0}
      section{display:flex;flex-direction:column;min-height:0;background:#fff;padding:12px;border-radius:10px;border:1px solid #cbd2d9}
      h3{margin:0 0 8px} .surface{flex:1;min-height:0;position:relative;background:#bfbfbf;border-radius:6px;overflow:hidden}
      canvas{display:block;width:100%;height:100%;touch-action:none}
      #right{display:flex;flex-direction:column;gap:8px} .preview{flex:1;min-height:200px;background:#f6f6f6}
      textarea{height:115px;resize:vertical;white-space:pre;font:10px monospace;padding:8px}
      footer{padding:8px 15px;background:#fff;border-top:1px solid #ccd1d8}
      @media(max-width:850px){main{grid-template-columns:1fr;overflow:auto}section{min-height:320px}}
    `});
    const app=$('div',root,{className:'app'}), head=$('header',app);
    $('strong',head,{textContent:'Pegzel'}); $('span',head,{textContent:'78 × 44 • v1.9.0'});
    const close=$('button',head,{textContent:'Close'}); close.onclick=()=>{host.remove();host=null};
    const bar=$('div',app,{className:'tools'});
    const file=$('input',bar,{type:'file',accept:'image/*'});file.style.display='none';
    const btn=(t,fn)=>{const b=$('button',bar,{textContent:t});b.onclick=fn;return b};
    btn('Open image',()=>file.click());
    btn('Reset view',()=>{zoom=1;ox=oy=0;render()});
    btn('Clear edits',()=>{edits.fill(0);render()});
    btn('Export TXT',()=>download(new Blob([W+'x'+H+'\n\n'+Array.from({length:H},(_,y)=>Array.from(grid.slice(y*W,(y+1)*W)).join('')).join('\n')],{type:'text/plain'}),name+'_grid.txt'));
    btn('Export PNG',()=>preview.toBlob(b=>b&&download(b,name+'_preview.png')));
    function slider(key,min,max,step,value){
      const l=$('label',bar);$('span',l,{textContent:key});
      const v=$('input',l,{type:'range',min,max,step,value}); const read=$('span',l,{textContent:String(value)});
      v.oninput=()=>{read.textContent=v.value;render()};ui[key]=v;
    }
    slider('Threshold',0,100,1,50);slider('Blur',0,4,.1,.5);slider('Contrast',.5,3,.05,1.3);
    const modeLabel=$('label',bar);$('span',modeLabel,{textContent:'Channel'});
    const select=$('select',modeLabel);
    for(const [v,t] of [['luminance','Luminance'],['red','Red'],['green','Green'],['blue','Blue'],['max','Max RGB']]) $('option',select,{value:v,textContent:t});
    select.onchange=render;ui.channel=select;
    for(const [key,checked] of [['Invert',false],['Dither',false],['Edge preserve',true],['Show holes',true]]){
      const l=$('label',bar),c=$('input',l,{type:'checkbox',checked});$('span',l,{textContent:key});
      c.onchange=render;ui[key]=c;
    }
    const tl=$('label',bar);$('span',tl,{textContent:'Tool'});
    const ts=$('select',tl);for(const t of ['pan','pen','eraser'])$('option',ts,{value:t,textContent:t});
    ts.onchange=()=>tool=ts.value;
    const main=$('main',app),left=$('section',main),right=$('section',main,{id:'right'});
    $('h3',left,{textContent:'Image workspace — drag to pan, wheel to zoom'});
    const sw=$('div',left,{className:'surface'});source=$('canvas',sw);sourceCtx=source.getContext('2d');
    $('h3',right,{textContent:'Binary peg output — pen / eraser to edit'});
    const pw=$('div',right,{className:'surface preview'});preview=$('canvas',pw);previewCtx=preview.getContext('2d');
    output=$('textarea',right,{readOnly:true,spellcheck:false});
    status=$('footer',app,{textContent:'Open or drop an image to begin.'});
    file.onchange=()=>load(file.files[0]);
    root.addEventListener('dragover',e=>e.preventDefault());
    root.addEventListener('drop',e=>{e.preventDefault();load(e.dataTransfer.files[0])});
    function pointer(e){const r=source.getBoundingClientRect();return {x:(e.clientX-r.left)*source.width/r.width,y:(e.clientY-r.top)*source.height/r.height}}
    source.onpointerdown=e=>{if(!image)return;dragging=true;source.setPointerCapture(e.pointerId);const p=pointer(e);source._last=p};
    source.onpointermove=e=>{if(!dragging)return;const p=pointer(e);ox+=p.x-source._last.x;oy+=p.y-source._last.y;source._last=p;render()};
    source.onpointerup=source.onpointercancel=()=>dragging=false;
    source.onwheel=e=>{if(!image)return;e.preventDefault();const p=pointer(e),f=e.deltaY<0?1.1:1/1.1,old=zoom;zoom=clamp(zoom*f,.15,15);const k=zoom/old;ox=(ox-(p.x-source.width/2))*k+(p.x-source.width/2);oy=(oy-(p.y-source.height/2))*k+(p.y-source.height/2);render()};
    function cellAt(e){
      const r=preview.getBoundingClientRect(),px=(e.clientX-r.left)*preview.width/r.width,py=(e.clientY-r.top)*preview.height/r.height;
      const g=geometry(preview.width,preview.height,12),x=Math.floor((px-g.x)/g.cell),y=Math.floor((py-g.y)/g.cell);
      return x>=0&&x<W&&y>=0&&y<H?y*W+x:-1;
    }
    function paint(e){if(!image||tool==='pan')return;const i=cellAt(e);if(i<0)return;edits[i]=tool==='pen'?1:-1;render()};
    preview.onpointerdown=e=>{painting=true;preview.setPointerCapture(e.pointerId);paint(e)};
    preview.onpointermove=e=>{if(painting)paint(e)};
    preview.onpointerup=preview.onpointercancel=()=>painting=false;
    const observer=new ResizeObserver(()=>resize());observer.observe(sw);observer.observe(pw);
    function resize(){
      if(!host)return;
      for(const c of [source,preview]){const r=c.getBoundingClientRect();c.width=Math.max(1,Math.round(r.width));c.height=Math.max(1,Math.round(r.height))}
      render();
    }
    resize();
  }
  function geometry(w,h,margin=12){
    const cell=Math.max(.01,Math.min((w-2*margin)/W,(h-2*margin)/H));
    return {cell,x:(w-W*cell)/2,y:(h-H*cell)/2,w:W*cell,h:H*cell};
  }
  function load(file){
    if(!file||!file.type.startsWith('image/'))return;
    const url=URL.createObjectURL(file),im=new Image();
    im.onload=()=>{URL.revokeObjectURL(url);image=im;name=file.name.replace(/\.[^.]+$/,'');zoom=1;ox=oy=0;edits.fill(0);render()};
    im.onerror=()=>URL.revokeObjectURL(url);im.src=url;
  }
  function render(){
    if(!source||!preview||!host)return;
    const a=sourceCtx,b=previewCtx,sw=source.width,sh=source.height;
    a.fillStyle='#bfbfbf';a.fillRect(0,0,sw,sh);
    b.fillStyle='#f7f7f7';b.fillRect(0,0,preview.width,preview.height);
    if(!image)return;
    const crop=geometry(sw,sh,Math.min(sw,sh)*.04);
    const fit=Math.min(sw/image.width,sh/image.height),scale=fit*zoom;
    const dw=image.width*scale,dh=image.height*scale;
    const ix=sw/2+ox-dw/2,iy=sh/2+oy-dh/2;
    a.drawImage(image,ix,iy,dw,dh);
    a.fillStyle='rgba(0,0,0,.25)';
    a.fillRect(0,0,sw,crop.y);a.fillRect(0,crop.y+crop.h,sw,sh-crop.y-crop.h);
    a.fillRect(0,crop.y,crop.x,crop.h);a.fillRect(crop.x+crop.w,crop.y,sw-crop.x-crop.w,crop.h);
    a.strokeStyle='#00db91';a.lineWidth=2;a.strokeRect(crop.x,crop.y,crop.w,crop.h);
    // Sample the image directly in source coordinates: no dependence on screen resolution.
    const sample=document.createElement('canvas');sample.width=W;sample.height=H;
    const c=sample.getContext('2d',{willReadFrequently:true});
    c.fillStyle='#bfbfbf';c.fillRect(0,0,W,H);
    const sx=(ix-crop.x)*W/crop.w,sy=(iy-crop.y)*H/crop.h;
    c.drawImage(image,sx,sy,dw*W/crop.w,dh*H/crop.h);
    const rgba=c.getImageData(0,0,W,H).data, vals=new Float32Array(N),channel=ui.channel.value;
    for(let i=0;i<N;i++){
      const r=rgba[4*i],g=rgba[4*i+1],bl=rgba[4*i+2];
      let v=channel==='red'?r:channel==='green'?g:channel==='blue'?bl:channel==='max'?Math.max(r,g,bl):.299*r+.587*g+.114*bl;
      vals[i]=ui.Invert.checked?255-v:v;
    }
    const blur=+ui.Blur.value;
    if(blur>0){const radius=Math.ceil(blur),copy=vals.slice();
      for(let y=0;y<H;y++)for(let x=0;x<W;x++){
        let sum=0,weight=0;for(let yy=Math.max(0,y-radius);yy<=Math.min(H-1,y+radius);yy++)for(let xx=Math.max(0,x-radius);xx<=Math.min(W-1,x+radius);xx++){
          const d=(x-xx)**2+(y-yy)**2,w=Math.exp(-d/(2*blur*blur));sum+=copy[yy*W+xx]*w;weight+=w;
        }vals[y*W+x]=sum/weight;
      }
    }
    const contrast=+ui.Contrast.value;for(let i=0;i<N;i++)vals[i]=clamp((vals[i]-128)*contrast+128,0,255);
    if(ui['Edge preserve'].checked){const copy=vals.slice();
      for(let y=0;y<H;y++)for(let x=0;x<W;x++){const center=copy[y*W+x];let sum=0,ws=0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||xx>=W||yy<0||yy>=H)continue;
          const v=copy[yy*W+xx],w=Math.exp(-(dx*dx+dy*dy)/2)*Math.exp(-((v-center)**2)/(2*20*20));sum+=v*w;ws+=w;
        }vals[y*W+x]=sum/ws;
      }
    }
    let min=255,max=0;for(const v of vals){min=Math.min(min,v);max=Math.max(max,v)}
    const threshold=min+(max-min)*(+ui.Threshold.value/100);
    const working=vals.slice();
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=y*W+x,old=working[i],peg=old<threshold;grid[i]=edits[i]===1?1:edits[i]===-1?0:Number(peg);
      if(ui.Dither.checked){const err=old-(peg?0:255);
        if(x+1<W)working[i+1]+=err*7/16;
        if(y+1<H){if(x>0)working[i+W-1]+=err*3/16;working[i+W]+=err*5/16;if(x+1<W)working[i+W+1]+=err/16}
      }
    }
    const g=geometry(preview.width,preview.height,12),radius=g.cell*.39;
    let count=0;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=y*W+x,cx=g.x+(x+.5)*g.cell,cy=g.y+(y+.5)*g.cell;
      if(ui['Show holes'].checked){b.beginPath();b.arc(cx,cy,radius,0,Math.PI*2);b.strokeStyle='#d2d2d2';b.lineWidth=.6;b.stroke()}
      if(grid[i]){count++;b.beginPath();b.arc(cx,cy,radius,0,Math.PI*2);b.fillStyle='#151515';b.fill()}
      if(edits[i]){b.beginPath();b.arc(cx,cy,radius*.35,0,Math.PI*2);b.fillStyle=edits[i]===1?'#1684ff':'#ff4b39';b.fill()}
    }
    output.value=Array.from({length:H},(_,y)=>Array.from(grid.slice(y*W,(y+1)*W)).join('')).join('\n');
    status.textContent=`Pegs: ${count} / ${N} (${(100*count/N).toFixed(1)}%) · Zoom: ${zoom.toFixed(2)}× · Channel: ${channel}`;
  }
  function download(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  GM_registerMenuCommand('Open / close Pegzel',start);
})();
