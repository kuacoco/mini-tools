// Local browser verification adapter. Renders the actual WXML/WXSS and page handlers;
// cloud storage, platform pickers, and navigation are explicitly mocked. Not a Mini Program runtime.
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const bundle = {
  page: read('pages/child-growth/child-growth.js'),
  model: read('utils/growth-model.js'),
  drawing: read('utils/growth-chart-draw.js'),
  reference: JSON.parse(read('utils/growth-reference.json')),
  markup: read('pages/child-growth/child-growth.wxml'),
}
function css(source) { return source.replace(/(\d*\.?\d+)rpx/g, (_, n) => `${Number(n) / 2}px`).replace(/(^|\n)page(?=\s*\{)/g, '$1body').replace(/\btext(?=\s*\{)/g, 'span') }
const style = css(read('pages/child-growth/child-growth.wxss') + read('components/growth-chart/index.wxss'))
const runtime = String.raw`
const clock = '2026-11-18';
let profileRows = [{id:'child_001', name:'小满', birthday:'2022-03-08', sex:'girl', revision:1, locked:true}, {id:'child_002', name:'小禾', birthday:'2025-07-12', sex:'boy', revision:1}];
let recordRows = [
 {id:'r1', date:'2026-11-12', height:106.8, weight:17.6, note:'秋天的体检，认真站直的小朋友。', revision:1},
 {id:'r2', date:'2026-08-15', height:104.2, weight:16.8, note:'暑假又长高了一点。', revision:1},
 {id:'r3', date:'2026-05-10', height:102.5, weight:16.2, note:'', revision:1},
 {id:'r4', date:'2026-02-08', height:100.1, weight:15.5, note:'', revision:1},
 {id:'r5', date:'2025-11-01', height:98.4, weight:15.1, note:'', revision:1},
];
const store = {
 listProfiles: async () => { if(window.failNext){window.failNext=false;throw new Error('网络暂不可用')} return structuredClone(profileRows) },
 listRecords: async id => structuredClone(id==='child_001' ? recordRows : []),
 saveProfile: async form => {const item={...form,id:form.id||form.requestId,revision:(form.revision||0)+1};profileRows=profileRows.filter(p=>p.id!==item.id).concat(item);return {item}},
 saveRecord: async form => {if(window.failSave){window.failSave=false;throw new Error('网络暂不可用，内容已保留')}const item={...form,id:form.id||form.requestId,height:Number(form.height),weight:Number(form.weight),revision:(form.revision||0)+1};recordRows=recordRows.filter(r=>r.id!==item.id).concat(item);return {item}},
 deleteRecord: async form => {recordRows=recordRows.filter(r=>r.id!==form.id)},
};
function moduleValue(code, req) { const module={exports:{}}; new Function('require','module','exports',code)(req,module,module.exports); return module.exports }
const model = moduleValue(bundle.model, () => bundle.reference);
const drawing = moduleValue(bundle.drawing, () => ({}));
window.wx = {showToast: o => {window.lastToast=o.title}, showModal: async () => ({confirm:window.confirmChoice!==false}), setClipboardData: o => {window.copied=o.data}};
window.Page = config => {window.page=config; config.data=structuredClone(config.data);config.setData=(changes, callback)=>{for(const [key,value] of Object.entries(changes)){const names=key.split('.');let object=config.data;while(names.length>1)object=object[names.shift()];object[names[0]]=value} render();if(callback)callback()}};
new Function('require',bundle.page)(name=>name.includes('growth-storage')?store:name.includes('course-storage')?{getCurrentDateString:()=>clock}:model);
const template = document.createElement('template');
template.innerHTML=bundle.markup.replace(/<([\w-]+)([^<>]*?)\s*\/>/g,(m,tag,attrs)=>['input','image'].includes(tag)?'<'+tag+attrs+'>':'<'+tag+attrs+'></'+tag+'>');
function evaluate(expr,scope){try{return new Function(...Object.keys(scope),'return ('+expr+')')(...Object.values(scope))}catch{return undefined}}
function interpolate(value,scope){return value.replace(/\{\{([\s\S]*?)\}\}/g,(_,expr)=>{const val=evaluate(expr,scope);return val===undefined||val===null?'':String(val)})}
function boolAttr(value,scope){return value.includes('{{')?!!evaluate(value.replace(/^\{\{|\}\}$/g,''),scope):true}
function renderNodes(nodes,scope,parent){let chain=false,taken=false;
 for(const node of nodes){if(node.nodeType===3){parent.append(document.createTextNode(interpolate(node.textContent,scope)));continue}if(node.nodeType!==1)continue;
 const repeat=node.getAttribute('wx:for');if(repeat){const values=evaluate(repeat.replace(/^\{\{|\}\}$/g,''),scope)||[];values.forEach((item,index)=>{const copy=node.cloneNode(true);copy.removeAttribute('wx:for');renderNodes([copy],{...scope,[node.getAttribute('wx:for-item')||'item']:item,index},parent)});continue}
 const cond=node.getAttribute('wx:if'),elseIf=node.getAttribute('wx:elif'),otherwise=node.hasAttribute('wx:else');
 if(cond!==null){chain=true;taken=!!evaluate(cond.replace(/^\{\{|\}\}$/g,''),scope);if(!taken)continue}
 else if(elseIf!==null||otherwise){if(!chain||taken)continue;const yes=otherwise||!!evaluate(elseIf.replace(/^\{\{|\}\}$/g,''),scope);if(!yes)continue;taken=true}
 else{chain=false;taken=false}
 const tag=node.tagName.toLowerCase();if(tag==='navigation-bar'){const bar=document.createElement('header');bar.textContent='‹　　　　　　成长手记';bar.className='mock-navigation';parent.append(bar);continue}if(tag==='page-loader')continue;
 if(tag==='block'){renderNodes([...node.childNodes],scope,parent);continue}
 if(tag==='growth-chart'){const shell=document.createElement('div');shell.className='chart-shell';const canvas=document.createElement('canvas');canvas.style.cssText='display:block;width:100%;height:220px';shell.append(canvas);const note=document.createElement('div');note.className='chart-readout';note.textContent='轻触记录点，查看当天数值';shell.append(note);parent.append(shell);requestAnimationFrame(()=>{const w=shell.clientWidth;if(!w)return;canvas.width=w*2;canvas.height=440;const ctx=canvas.getContext('2d');ctx.scale(2,2);drawing.drawGrowthChart(ctx,page.data.chart,w,220)});continue}
 const output=document.createElement(tag==='input'?'input':tag==='button'?'button':tag==='text'?'span':'div');
 for(const attr of node.attributes){if(attr.name.startsWith('wx:')||attr.name.startsWith('bind')||attr.name.startsWith('catch')||attr.name==='hover-class')continue;const value=interpolate(attr.value,scope);if(attr.name==='disabled'){output.disabled=boolAttr(attr.value,scope);continue}if(attr.name==='type'&&value==='digit'){output.type='text';output.inputMode='decimal';continue}output.setAttribute(attr.name,value)}
 if(tag==='input'){output.value=interpolate(node.getAttribute('value')||'',scope);const handler=node.getAttribute('bindinput');if(handler)output.addEventListener('input',()=>{const start=output.selectionStart;const data={...output.dataset};const text=output.value;window._editing={aria:output.getAttribute('aria-label'),start};page[handler]({currentTarget:{dataset:data},detail:{value:text}})})}
 const click=node.getAttribute('bindtap')||node.getAttribute('catchtap');if(click)output.addEventListener('click',event=>{event.stopPropagation();if(!output.disabled)page[click]({currentTarget:{dataset:{...output.dataset}},detail:{}})});
 if(tag==='picker'){output.style.position='relative';const input=document.createElement('input');input.type='date';input.value=interpolate(node.getAttribute('value')||'',scope);input.min=interpolate(node.getAttribute('start')||'',scope);input.max=interpolate(node.getAttribute('end')||'',scope);input.disabled=boolAttr(node.getAttribute('disabled')||'{{false}}',scope);input.setAttribute('aria-label',node.getAttribute('aria-label')||'选择日期');input.style.cssText='position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;z-index:1';input.addEventListener('change',()=>page[node.getAttribute('bindchange')]({detail:{value:input.value}}));output.append(input)}
 renderNodes([...node.childNodes],scope,output);parent.append(output);
 }
}
function render(){const existing=document.querySelector('.growth-scroll');const scroll=existing?.scrollTop||0;const sheetScroll=document.querySelector('.sheet-body')?.scrollTop||0;const host=document.querySelector('#app');host.replaceChildren();renderNodes([...template.content.childNodes],{...page.data},host);const current=document.querySelector('.growth-scroll');if(current)current.scrollTop=scroll;const sheet=document.querySelector('.sheet-body');if(sheet)sheet.scrollTop=sheetScroll;if(window._editing){const input=[...document.querySelectorAll('input')].find(i=>i.getAttribute('aria-label')===window._editing.aria);if(input){input.focus();try{input.setSelectionRange(window._editing.start,window._editing.start)}catch{}}window._editing=null}}
window.render=render;
page.onLoad();
`;
const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>成长手记 · 本地界面验证</title><style>html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans CJK SC",sans-serif}*{box-sizing:border-box}body{display:block!important}#app{height:100%;display:flex;flex-direction:column}.mock-navigation{height:64px;flex-shrink:0;display:flex;align-items:center;padding:0 18px;background:#f7f5ff;font-size:18px;font-weight:600}.growth-scroll,.sheet-body{overflow:auto}.child-scroll{overflow:auto}.child-tabs{width:max-content}input{font-family:inherit;border:0;background:transparent}span{white-space:normal}'+style+'</style><main id="app"></main><script>const bundle='+JSON.stringify(bundle).replace(/</g,'\\u003c')+';'+runtime+'</script></html>';
const target=process.argv[2]||'/tmp/growth-preview.html';fs.writeFileSync(target,html);console.log(target);
