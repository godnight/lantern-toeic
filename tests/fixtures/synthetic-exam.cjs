// Artificial structural fixture only. NOT TOEIC real questions or a usable practice paper.
module.exports = function syntheticExam(id = 'structural-test-only') {
  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=';
  const wav = Buffer.alloc(46); wav.write('RIFF'); wav.writeUInt32LE(38,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(2,40);
  const questions = [], groups = [];
  let number = 1;
  function group(part, count, passageCount = 0) {
    const groupId = `test-group-${number}`, ns = [];
    for (let i = 0; i < count; i++) {
      ns.push(number);
      questions.push({ number, part, groupId, prompt: part <= 2 ? '' : `TEST ONLY: structural question ${number}.`, choices: (part === 2 ? ['A','B','C'] : ['A','B','C','D']).map(c => `Fixture ${c}`), answer: number % (part === 2 ? 3 : 4), explanation: 'Artificial unit-test answer; not study content.' }); number++;
    }
    groups.push({ id: groupId, part, questionNumbers: ns, passages: Array.from({length:passageCount},(_,i)=>`TEST ONLY: synthetic document ${i+1}.`), imageIds: part === 1 ? ['pixel'] : [] });
  }
  for(let i=0;i<6;i++)group(1,1);
  for(let i=0;i<25;i++)group(2,1);
  for(let i=0;i<13;i++)group(3,3);
  for(let i=0;i<10;i++)group(4,3);
  for(let i=0;i<30;i++)group(5,1);
  for(let i=0;i<4;i++)group(6,4,1);
  for(let i=0;i<9;i++)group(7,3,1);
  group(7,2,1);
  for(let i=0;i<5;i++)group(7,5,i<2?2:3);
  return { kind:'lantern-toeic-exam', schemaVersion:1, id, version:1, title:'TEST FIXTURE ONLY — 非真题', source:{classification:'original',title:'Automated structural fixture',rightsStatement:'Artificial test data for code validation only; not official exam content.'}, listeningAudioId:'test-silence', assets:[{id:'pixel',mime:'image/png',base64:image},{id:'test-silence',mime:'audio/wav',base64:wav.toString('base64')}], groups, questions };
};
