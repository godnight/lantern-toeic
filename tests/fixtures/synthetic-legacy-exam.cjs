// Structural test data only: no real exam, answers, media or copyright material.
const modern = require('./synthetic-exam.cjs');
module.exports = function legacyExam(id = 'legacy-structure-only', singles = [5,5,5,5,5,3]) {
  const base = modern(id), questions = [], groups = [];
  let n = 1;
  function group(part, count, passages = 0) {
    const groupId = `legacy-group-${n}`, ns = [];
    for (let i=0;i<count;i++,n++) {
      ns.push(n);
      questions.push({number:n,part,groupId,prompt:part<=2?'':`LEGACY TEST ONLY ${n}`,
        choices:part===2?['A','B','C']:['A','B','C','D'],answer:n%(part===2?3:4)});
    }
    groups.push({id:groupId,part,questionNumbers:ns,passages:Array.from({length:passages},(_,i)=>`TEST ONLY passage ${i+1}`),imageIds:part===1?['pixel']:[]});
  }
  for (let i=0;i<10;i++) group(1,1);
  for (let i=0;i<30;i++) group(2,1);
  for (let i=0;i<10;i++) group(3,3);
  for (let i=0;i<10;i++) group(4,3);
  for (let i=0;i<40;i++) group(5,1);
  for (let i=0;i<4;i++) group(6,3,1);
  for (const count of singles) group(7,count,1);
  for (let i=0;i<4;i++) group(7,5,2);
  return {...base,format:'legacy-2006',title:'LEGACY STRUCTURAL TEST ONLY',questions,groups};
};
