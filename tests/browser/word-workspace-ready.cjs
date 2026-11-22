'use strict';

// This is a synchronous Playwright RAF predicate. Only the card and its
// ancestors are considered; unrelated or infinite animations are ignored.
function wordWorkspaceIsStable() {
  const card=document.querySelector('.v045-stable-word-card');
  const body=document.querySelector('.workspace-body');
  const shell=document.querySelector('.v040-workspace-shell');
  if(!card||!body||!shell||shell.dataset.drawerOpen!=='false'||!document.body.dataset.uiTheme)return false;
  const margin=parseFloat(getComputedStyle(body).marginLeft);
  if(!Number.isFinite(margin)||Math.abs(margin)>.02){delete card.__qaWorkspaceReady;return false;}
  for(let node=card;node;node=node.parentElement){
    if(node.getAnimations().some(a=>a.playState==='running'&&Number.isFinite(a.effect?.getComputedTiming().endTime))){
      delete card.__qaWorkspaceReady;return false;
    }
    if(node===shell)break;
  }
  const r=card.getBoundingClientRect(),values=[r.left,r.top,r.width,r.height,scrollX,scrollY,margin];
  const prior=card.__qaWorkspaceReady;
  const same=prior&&values.every((value,index)=>Math.abs(value-prior.values[index])<=.01);
  const stable=same?prior.stable+1:0;
  card.__qaWorkspaceReady={values,stable};
  return stable>=2;
}

async function waitForWordWorkspace(page) {
  try{await page.waitForFunction(wordWorkspaceIsStable);}
  catch(error){
    const geometry=await page.evaluate(()=>{
      const body=document.querySelector('.workspace-body'),card=document.querySelector('.v045-stable-word-card');
      const rect=card?.getBoundingClientRect();
      return {theme:document.body.dataset.uiTheme,drawer:document.querySelector('.v040-workspace-shell')?.dataset.drawerOpen,
        margin:body&&getComputedStyle(body).marginLeft,card:rect&&{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
    });
    throw new Error('Word workspace did not settle before the initial baseline: '+JSON.stringify(geometry),{cause:error});
  }finally{await page.locator('.v045-stable-word-card').evaluate(el=>{delete el.__qaWorkspaceReady;}).catch(()=>{});}
}

module.exports={wordWorkspaceIsStable,waitForWordWorkspace};
