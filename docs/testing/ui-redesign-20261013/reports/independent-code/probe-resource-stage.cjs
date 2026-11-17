// Real StudyApp/ResourceLibrary thin-interface probe, no actual DOM/storage/I/O.
// Reuse the generic shell adapter; model layout clamping while the prelude is hidden.
const fsForProbe=require('node:fs'),pathForProbe=require('node:path');
const base=fsForProbe.readFileSync(pathForProbe.join(__dirname,'probe-search-origin.cjs'),'utf8');
const boundary=base.indexOf("render();assert.equal(window.history.scrollRestoration");
if(boundary<0)throw Error('Shell adapter boundary changed');
const additions=fsForProbe.readFileSync(pathForProbe.join(__dirname,'resource-stage-cases.txt'),'utf8');
eval(base.slice(0,boundary)+additions);
