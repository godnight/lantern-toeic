'use strict';

// Serialized by Playwright and run once per animation frame. Keep this
// predicate synchronous: waitForFunction treats a Promise as truthy.
function headerEdgeIsStable(edge) {
  const el=document.querySelector('.phase2-word-header');
  if(!el)return false;
  const top=el.scrollTop,max=el.scrollHeight-el.clientHeight;
  // scrollHeight/clientHeight are rounded; allow 1px at the end only.
  const reached=edge==='start'?top===0:Math.abs(top-max)<=1;
  const previous=el.__qaWordHeaderEdge;
  if(!reached){el.__qaWordHeaderEdge={edge,top,max,stable:0};return false;}
  const same=previous?.edge===edge&&Math.abs(previous.top-top)<=.01&&Math.abs(previous.max-max)<=.01;
  const stable=same?previous.stable+1:0;
  el.__qaWordHeaderEdge={edge,top,max,stable};
  return stable>=2;
}

async function waitForWordHeaderEdge(page,header,edge,word) {
  await header.evaluate(el=>{delete el.__qaWordHeaderEdge;});
  try {
    await page.waitForFunction(headerEdgeIsStable,edge);
  } catch(error) {
    const position=await header.evaluate(el=>({scrollTop:el.scrollTop,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,focus:document.activeElement?.className||document.activeElement?.tagName}));
    throw new Error(`Keyboard ${edge} did not settle: ${JSON.stringify({word,...position})}`,{cause:error});
  } finally {
    await header.evaluate(el=>{delete el.__qaWordHeaderEdge;}).catch(()=>{});
  }
}

module.exports={headerEdgeIsStable,waitForWordHeaderEdge};
