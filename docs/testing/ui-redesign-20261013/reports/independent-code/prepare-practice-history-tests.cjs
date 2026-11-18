const fs=require('node:fs'),path=require('node:path');
const root=process.env.LANTERN_REVIEW_ROOT;
if(!root)throw Error('Pass LANTERN_REVIEW_ROOT explicitly');
let source=fs.readFileSync(path.join(root,'tests/ui-redesign-practice.test.cjs'),'utf8');
function replace(old,next){if(!source.includes(old))throw Error('Harness changed: '+old.slice(0,75));source=source.replace(old,next);}
replace("fs.readFileSync(path.join(root, file), 'utf8')","fs.readFileSync(file==='app/learn/practice.tsx' && process.env.LANTERN_PRACTICE_COMPONENT ? process.env.LANTERN_PRACTICE_COMPONENT : path.join(root, file), 'utf8')");
replace('function harness({attempts = [], outcomes = [true], queue} = {}) {','function harness({attempts = [], outcomes = [true], queue, browser} = {}) {');
replace('slots[i] = {deps}; effects.push(() => {old?.cleanup?.(); slots[i].cleanup = fn();});','slots[i] = {deps,setup:fn}; effects.push(() => {old?.cleanup?.(); slots[i].cleanup = fn();});');
replace("{Date: Clock, window: {speechSynthesis: {cancel(){}}}})","{Date: Clock, window: browser?.window || {speechSynthesis: {cancel(){}}},setTimeout:browser?.setTimeout || setTimeout,clearTimeout:browser?.clearTimeout || clearTimeout})");
replace('return {render, one, button, click, choose, nativeBack, calls, saved, finishes,','return {render, one, button, click, choose, nativeBack, calls, saved, finishes, strictReplay(){const active=slots.filter(slot=>slot?.setup);active.forEach(slot=>{slot.cleanup?.();slot.cleanup=undefined;});active.forEach(slot=>{slot.cleanup=slot.setup();});return render();},');
source+=fs.readFileSync(path.join(__dirname,'practice-history-cases.txt'),'utf8');
fs.writeFileSync(path.join(__dirname,'ui-redesign-practice.test.cjs'),source,'utf8');
console.log('Prepared existing 9 cases plus independent history cases in staging only.');
