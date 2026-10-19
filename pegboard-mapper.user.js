// ==UserScript==
// @name         Pegboard Mapper
// @namespace    pegzel
// @version      2.1.1
// @description  Image-to-pegboard converter and binary pegboard pattern generator.
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/penguin-zoo/pegzel/main/pegboard-mapper.user.js
// @downloadURL  https://raw.githubusercontent.com/penguin-zoo/pegzel/main/pegboard-mapper.user.js
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  let W = 78, H = 44, N = W * H;
  let host, image = null, name = 'pegboard', zoom = 1, ox = 0, oy = 0, dragging = false;
  let edits = new Int8Array(N), grid = new Uint8Array(N), painting = false, tool = 'pan';
  let colorMode = false, colorCount = 6, paintIndex = 1, paletteUI, inventory;
  let occupancyMode = 'full';
  const palette = ['#151515','#ffffff','#d62828','#2673c9','#f4ca39','#329a58','#ec8531','#8654b3','#d581ac','#845b3a','#5ab7af','#949aa0','#9aaa3b','#b84660','#424b91','#69c4a8','#e1b57a','#a55033','#5b7343','#ddddda'];
  const rgb = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
  let source, preview, sourceCtx, previewCtx, output, status;
  let resizeObserver=null, imageLoadToken=0;
  const ui = {};
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const $ = (tag,parent,attrs={}) => { const n=document.createElement(tag); Object.assign(n,attrs); parent.appendChild(n); return n; };
  function start() {
    if (host) { closeApp(); return; }
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
    $('strong',head,{textContent:'Pegboard Mapper'}); $('span',head,{textContent:'v2.1.1'});
    const close=$('button',head,{textContent:'Close'}); close.onclick=closeApp;
    const bar=$('div',app,{className:'tools'});
    const file=$('input',bar,{type:'file',accept:'image/*'});file.style.display='none';
    const btn=(t,fn)=>{const b=$('button',bar,{textContent:t});b.onclick=fn;return b};
    btn('Open image',()=>{file.value='';file.click()});
    btn('Reset view',()=>{zoom=1;ox=oy=0;render()});
    btn('Clear edits',()=>{edits.fill(0);render()});
    btn('Export TXT',()=>download(new Blob([W+'x'+H+'\n'+(colorMode?'mode=color\noccupancy='+occupancyMode+'\npalette='+palette.slice(0,colorCount).join(',')+'\n':'')+'\n'+Array.from({length:H},(_,y)=>colorMode?Array.from(grid.slice(y*W,(y+1)*W)).map(v=>String(v).padStart(2,'0')).join(' '):Array.from(grid.slice(y*W,(y+1)*W)).join('')).join('\n')],{type:'text/plain'}),name+'_grid.txt'));
    btn('Export PNG',()=>preview.toBlob(b=>b&&download(b,name+'_preview.png')));
    btn('Export CSV',()=>download(new Blob([Array.from({length:H},(_,y)=>Array.from(grid.slice(y*W,(y+1)*W)).join(',')).join('\n')],{type:'text/csv'}),name+'_grid.csv'));
    btn('Export JSON',()=>{const rows=Array.from({length:H},(_,y)=>Array.from(grid.slice(y*W,(y+1)*W)));const data={format:'pegzel-grid-v2',width:W,height:H,mode:colorMode?'color':'binary',occupancy:colorMode?occupancyMode:'threshold',palette:colorMode?palette.slice(0,colorCount):['#151515'],grid:rows,counts:Array.from({length:(colorMode?colorCount:1)+1},(_,i)=>Array.from(grid).filter(x=>x===i).length)};download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),name+'_grid.json')});
    function slider(key,min,max,step,value){
      const l=$('label',bar);$('span',l,{textContent:key});
      const v=$('input',l,{type:'range',min,max,step,value}); const read=$('span',l,{textContent:String(value)});
      v.oninput=()=>{read.textContent=v.value;render()};ui[key]=v;
    }
    slider('Threshold',0,100,1,50);slider('Blur',0,4,.1,.5);slider('Contrast',.5,3,.05,1.3);
    const addNumber=(title,value,min,max,action)=>{const l=$('label',bar);$('span',l,{textContent:title});const n=$('input',l,{type:'number',min:String(min),max:String(max),value:String(value)});n.style.width='55px';n.onchange=()=>{const v=clamp(parseInt(n.value,10)||min,min,max);n.value=String(v);action(v)};return n;};
    addNumber('Columns',W,1,200,v=>{W=v;N=W*H;grid=new Uint8Array(N);edits=new Int8Array(N);render()});
    addNumber('Rows',H,1,200,v=>{H=v;N=W*H;grid=new Uint8Array(N);edits=new Int8Array(N);render()});
    const ml=$('label',bar);$('span',ml,{textContent:'Output'});
    const cm=$('select',ml);for(const [value,text] of [['binary','Binary'],['color','Multi-colour']])$('option',cm,{value,textContent:text});
    cm.onchange=()=>{colorMode=cm.value==='color';edits.fill(0);occupancyLabel.style.display=colorMode?'inline-flex':'none';buildPaintSelect();buildPalette();render()};
    const occupancyLabel=$('label',bar);$('span',occupancyLabel,{textContent:'Occupancy'});
    const occupancySelect=$('select',occupancyLabel);
    for(const [value,text] of [['full','Full board'],['threshold','Threshold']])$('option',occupancySelect,{value,textContent:text});
    occupancySelect.value=occupancyMode;
    occupancyLabel.style.display='none';
    occupancySelect.onchange=()=>{occupancyMode=occupancySelect.value;edits.fill(0);render();};
    addNumber('Colours',colorCount,1,20,v=>{colorCount=v;edits.fill(0);buildPalette();buildPaintSelect();render()});
    const paintLabel=$('label',bar);$('span',paintLabel,{textContent:'Paint colour'});
    const paintSelect=$('select',paintLabel);
    function buildPaintSelect(){paintSelect.replaceChildren();for(let i=1;i<=(colorMode?colorCount:1);i++)$('option',paintSelect,{value:String(i),textContent:String(i)});paintIndex=1;paintSelect.value='1'}
    paintSelect.onchange=()=>{paintIndex=Number(paintSelect.value);};
    buildPaintSelect();
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
    ts.onchange=()=>{tool=ts.value;};
    const main=$('main',app),left=$('section',main),right=$('section',main,{id:'right'});
    function buildPalette(){paletteUI.replaceChildren();if(!colorMode){paletteUI.textContent='Binary output: 0 = empty, 1 = peg';return}
      for(let i=0;i<colorCount;i++){const l=$('label',paletteUI);$('span',l,{textContent:String(i+1)});const input=$('input',l,{type:'color',value:palette[i]});input.oninput=()=>{palette[i]=input.value;render()};}
    }
    btn('Auto palette',()=>{if(!image||!colorMode)return;const rgba=samplePixels();const samples=[];
      for(let i=0;i<N;i++){const r=rgba[4*i],g=rgba[4*i+1],b=rgba[4*i+2];if(occupancyMode==='full'||.299*r+.587*g+.114*b<190)samples.push([r,g,b]);}
      if(!samples.length)return;
      let centers=Array.from({length:colorCount},(_,j)=>samples[Math.floor((j+.5)*samples.length/colorCount)%samples.length].slice());
      const nearest=p=>{let best=0,dist=Infinity;for(let j=0;j<centers.length;j++){const q=centers[j],d=(p[0]-q[0])**2+(p[1]-q[1])**2+(p[2]-q[2])**2;if(d<dist){best=j;dist=d}}return best};
      for(let step=0;step<9;step++){const sums=Array.from({length:colorCount},()=>[0,0,0,0]);for(const p of samples){const j=nearest(p);for(let k=0;k<3;k++)sums[j][k]+=p[k];sums[j][3]++}for(let j=0;j<colorCount;j++)if(sums[j][3])for(let k=0;k<3;k++)centers[j][k]=sums[j][k]/sums[j][3];}
      centers.forEach((p,i)=>{palette[i]='#'+p.map(c=>clamp(Math.round(c),0,255).toString(16).padStart(2,'0')).join('');});buildPalette();render();
    });
    $('h3',left,{textContent:'Image workspace — drag to pan, wheel to zoom'});
    const sw=$('div',left,{className:'surface'});source=$('canvas',sw);sourceCtx=source.getContext('2d');
    $('h3',right,{textContent:'Peg output — pen / eraser to edit'});
    const pw=$('div',right,{className:'surface preview'});preview=$('canvas',pw);previewCtx=preview.getContext('2d');
    paletteUI=$('div',right);paletteUI.style.cssText='display:flex;flex-wrap:wrap;gap:6px;padding:3px;max-height:95px;overflow:auto';
    inventory=$('div',right);inventory.style.cssText='font-size:11px;color:#505968;max-height:58px;overflow:auto';
    output=$('textarea',right,{readOnly:true,spellcheck:false});
    buildPalette();
    status=$('footer',app,{textContent:'Open or drop an image to begin.'});
    file.onchange=()=>load(file.files[0]);
    root.addEventListener('dragover',e=>e.preventDefault());
    root.addEventListener('drop',e=>{e.preventDefault();load(e.dataTransfer.files[0])});
    function pointer(e){const r=source.getBoundingClientRect();return {x:(e.clientX-r.left)*source.width/r.width,y:(e.clientY-r.top)*source.height/r.height}}
    source.onpointerdown=e=>{if(!image)return;dragging=true;source.setPointerCapture(e.pointerId);const p=pointer(e);source._last=p};
    source.onpointermove=e=>{if(!dragging)return;const p=pointer(e);ox+=p.x-source._last.x;oy+=p.y-source._last.y;source._last=p;render()};
    const stopDragging=()=>{dragging=false;};
    source.onpointerup=stopDragging;
    source.onpointercancel=stopDragging;
    source.onwheel=e=>{if(!image)return;e.preventDefault();const p=pointer(e),f=e.deltaY<0?1.1:1/1.1,old=zoom;zoom=clamp(zoom*f,.15,15);const k=zoom/old;ox=(ox-(p.x-source.width/2))*k+(p.x-source.width/2);oy=(oy-(p.y-source.height/2))*k+(p.y-source.height/2);render()};
    function cellAt(e){
      const r=preview.getBoundingClientRect(),px=(e.clientX-r.left)*preview.width/r.width,py=(e.clientY-r.top)*preview.height/r.height;
      const g=geometry(preview.width,preview.height,12),x=Math.floor((px-g.x)/g.cell),y=Math.floor((py-g.y)/g.cell);
      return x>=0&&x<W&&y>=0&&y<H?y*W+x:-1;
    }
    function paint(e){if(!image||tool==='pan')return;if(colorMode&&occupancyMode==='full'&&tool==='eraser')return;const i=cellAt(e);if(i<0)return;edits[i]=tool==='pen'?(colorMode?paintIndex:1):-1;render()};
    preview.onpointerdown=e=>{painting=true;preview.setPointerCapture(e.pointerId);paint(e)};
    preview.onpointermove=e=>{if(painting)paint(e)};
    const stopPainting=()=>{painting=false;};
    preview.onpointerup=stopPainting;
    preview.onpointercancel=stopPainting;
    resizeObserver=new ResizeObserver(()=>resize());resizeObserver.observe(sw);resizeObserver.observe(pw);
    function resize(){
      if(!host)return;
      for(const c of [source,preview]){const r=c.getBoundingClientRect();c.width=Math.max(1,Math.round(r.width));c.height=Math.max(1,Math.round(r.height))}
      render();
    }
    resize();
  }
  function closeApp(){
    imageLoadToken++;
    if(resizeObserver){resizeObserver.disconnect();resizeObserver=null;}
    if(host){host.remove();host=null;}
    source=null;preview=null;sourceCtx=null;previewCtx=null;output=null;status=null;
    paletteUI=null;inventory=null;
  }
  function geometry(w,h,margin=12){
    const cell=Math.max(.01,Math.min((w-2*margin)/W,(h-2*margin)/H));
    return {cell,x:(w-W*cell)/2,y:(h-H*cell)/2,w:W*cell,h:H*cell};
  }
  function load(file){
    if(!file||!file.type.startsWith('image/'))return;
    const token=++imageLoadToken;
    if(status) status.textContent='Loading '+file.name+'…';
    const url=URL.createObjectURL(file),im=new Image();
    im.onload=()=>{URL.revokeObjectURL(url);if(token!==imageLoadToken||!host)return;
      image=im;name=file.name.replace(/\.[^.]+$/,'');zoom=1;ox=0;oy=0;edits.fill(0);render()};
    im.onerror=()=>{URL.revokeObjectURL(url);if(token===imageLoadToken&&status)status.textContent='Unable to decode image: '+file.name;};
    im.src=url;
  }
  function samplePixels(){
    const sw=source.width,sh=source.height,crop=geometry(sw,sh,Math.min(sw,sh)*.04);
    const fit=Math.min(sw/image.width,sh/image.height),scale=fit*zoom;
    const dw=image.width*scale,dh=image.height*scale,ix=sw/2+ox-dw/2,iy=sh/2+oy-dh/2;
    const sample=document.createElement('canvas');sample.width=W;sample.height=H;
    const c=sample.getContext('2d',{willReadFrequently:true});c.fillStyle='#bfbfbf';c.fillRect(0,0,W,H);
    c.drawImage(image,(ix-crop.x)*W/crop.w,(iy-crop.y)*H/crop.h,dw*W/crop.w,dh*H/crop.h);
    return c.getImageData(0,0,W,H).data;
  }
  function render(){
    if(!source||!preview||!host||!status||!output||!inventory)return;
    const a=sourceCtx,b=previewCtx,sw=source.width,sh=source.height;
    a.fillStyle='#bfbfbf';a.fillRect(0,0,sw,sh);
    b.fillStyle='#f7f7f7';b.fillRect(0,0,preview.width,preview.height);
    if(!image){output.value='';inventory.textContent='';return;}
    const crop=geometry(sw,sh,Math.min(sw,sh)*.04);
    const fit=Math.min(sw/image.width,sh/image.height),scale=fit*zoom;
    const dw=image.width*scale,dh=image.height*scale;
    const ix=sw/2+ox-dw/2,iy=sh/2+oy-dh/2;
    a.drawImage(image,ix,iy,dw,dh);
    a.fillStyle='rgba(0,0,0,.25)';
    a.fillRect(0,0,sw,crop.y);a.fillRect(0,crop.y+crop.h,sw,sh-crop.y-crop.h);
    a.fillRect(0,crop.y,crop.x,crop.h);a.fillRect(crop.x+crop.w,crop.y,sw-crop.x-crop.w,crop.h);
    a.strokeStyle='#00db91';a.lineWidth=2;a.strokeRect(crop.x,crop.y,crop.w,crop.h);
    const rgba=samplePixels(), vals=new Float32Array(N), channel=ui.channel.value;
    for(let i=0;i<N;i++){
      const r=rgba[4*i],g=rgba[4*i+1],bl=rgba[4*i+2];
      let v=channel==='red'?r:channel==='green'?g:channel==='blue'?bl:channel==='max'?Math.max(r,g,bl):.299*r+.587*g+.114*bl;
      vals[i]=ui.Invert.checked?255-v:v;
    }
    const blur=+ui.Blur.value;
    if(blur>0){const radius=Math.ceil(blur),copy=vals.slice();
      for(let y=0;y<H;y++){
        for(let x=0;x<W;x++){
          let sum=0,weight=0;
          for(let yy=Math.max(0,y-radius);yy<=Math.min(H-1,y+radius);yy++){
            for(let xx=Math.max(0,x-radius);xx<=Math.min(W-1,x+radius);xx++){
              const d=(x-xx)**2+(y-yy)**2,w=Math.exp(-d/(2*blur*blur));
              sum+=copy[yy*W+xx]*w;weight+=w;
            }
          }
          vals[y*W+x]=sum/weight;
        }
      }
    }
    const contrast=+ui.Contrast.value;for(let i=0;i<N;i++)vals[i]=clamp((vals[i]-128)*contrast+128,0,255);
    if(ui['Edge preserve'].checked){const copy=vals.slice();
      for(let y=0;y<H;y++){
        for(let x=0;x<W;x++){
          const center=copy[y*W+x];let sum=0,ws=0;
          for(let dy=-1;dy<=1;dy++){
            for(let dx=-1;dx<=1;dx++){
              const xx=x+dx,yy=y+dy;
              if(xx<0||xx>=W||yy<0||yy>=H)continue;
              const v=copy[yy*W+xx],w=Math.exp(-(dx*dx+dy*dy)/2)*Math.exp(-((v-center)**2)/(2*20*20));
              sum+=v*w;ws+=w;
            }
          }
          vals[y*W+x]=sum/ws;
        }
      }
    }
    let min=255,max=0;for(const v of vals){min=Math.min(min,v);max=Math.max(max,v)}
    const threshold=min+(max-min)*(+ui.Threshold.value/100);
    const working=vals.slice();
    for(let y=0;y<H;y++){
      for(let x=0;x<W;x++){
      const i=y*W+x,old=working[i],peg=old<threshold;
      const occupied=colorMode&&occupancyMode==='full'?true:peg;
      let result=Number(occupied);
      if(colorMode && occupied){
        let nearest=1,best=Infinity;const p=[rgba[i*4],rgba[i*4+1],rgba[i*4+2]];
        for(let j=0;j<colorCount;j++){const q=rgb(palette[j]);let d=0;for(let k=0;k<3;k++)d+=(p[k]-q[k])**2;if(d<best){best=d;nearest=j+1}}
        result=nearest;
      }
      grid[i]=edits[i]>0?edits[i]:edits[i]===-1&&!(colorMode&&occupancyMode==='full')?0:result;
      if(ui.Dither.checked){const err=old-(peg?0:255);
        if(x+1<W)working[i+1]+=err*7/16;
        if(y+1<H){if(x>0)working[i+W-1]+=err*3/16;working[i+W]+=err*5/16;if(x+1<W)working[i+W+1]+=err/16}
      }
    }
    }
    const g=geometry(preview.width,preview.height,12),radius=g.cell*.39;
    let count=0;
    for(let y=0;y<H;y++){
      for(let x=0;x<W;x++){
      const i=y*W+x,cx=g.x+(x+.5)*g.cell,cy=g.y+(y+.5)*g.cell;
      if(ui['Show holes'].checked){b.beginPath();b.arc(cx,cy,radius,0,Math.PI*2);b.strokeStyle='#d2d2d2';b.lineWidth=.6;b.stroke()}
      if(grid[i]){count++;b.beginPath();b.arc(cx,cy,radius,0,Math.PI*2);b.fillStyle=colorMode?palette[grid[i]-1]:'#151515';b.fill()}
      if(edits[i]){b.beginPath();b.arc(cx,cy,radius*.35,0,Math.PI*2);b.fillStyle=edits[i]===1?'#1684ff':'#ff4b39';b.fill()}
    }
    }
    output.value=Array.from({length:H},(_,y)=>colorMode?Array.from(grid.slice(y*W,(y+1)*W)).map(v=>String(v).padStart(2,'0')).join(' '):Array.from(grid.slice(y*W,(y+1)*W)).join('')).join('\n');
    const counts=Array.from({length:(colorMode?colorCount:1)+1},(_,j)=>Array.from(grid).filter(v=>v===j).length);
    inventory.textContent=(colorMode&&occupancyMode==='full'?'Full board • ':'')+'Empty: '+counts[0]+' • '+counts.slice(1).map((v,j)=>(colorMode?'Colour '+(j+1):'Pegs')+': '+v).join(' • ');
    status.textContent=`Pegs: ${count} / ${N} (${(100*count/N).toFixed(1)}%) · Zoom: ${zoom.toFixed(2)}× · Channel: ${channel}`;
  }
  function download(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  GM_registerMenuCommand('Open / close Pegboard Mapper',start);
})();
