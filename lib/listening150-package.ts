import questions from '../content/questions-v041-listening150.json';
import gate from '../content/questions-v041-listening150-text-image-gates.json';
import media from '../content/questions-v041-listening150-media.json';
import {admitListening150Package,type Listening150Input,type Listening150Pins} from './listening150-catalog';

/** Complete source-r3 and exact image/media pins. No caller activation is accepted. */
const sealed:Readonly<{input:Listening150Input;pins:Listening150Pins}>={
 input:{questions:questions as Listening150Input['questions'],gate:gate as Listening150Input['gate'],media:media as Listening150Input['media']},
 pins:{
  "sourceVersion": "v041-listening200-root-selected-text-r3",
  "packageManifestSha256": "22a242619a710983e7a3ff692c7f8ed4ed32294c2e97cb958c49806563241fc9",
  "sourceQuestionsSha256": "e80db8d64eef2725f82d1811216a41bbf77bbf5d19f3c26031a038e1a6f6e98f",
  "questionsCanonicalSha256": "cad9ee19def2f319e7641ebac493f28514ae96a0138af92d53be42980d0129f7",
  "gateCanonicalSha256": "d91cd318bad93385d8ad3e6c718164fc33a7985a0841abf8eecfe1652ae6f96e",
  "mediaCanonicalSha256": "615ff0d86824048e530111bcc0c1986f5ef6b7b23b7b730daa5c321401a931d7",
  "combined313CanonicalSha256": "040518d008a016afd40c91dcc89af695de637f6455ffdddfa916249d94968592",
  "imagePathPrefix": "/listening200-r1/",
  "unitPrefix": "listening200",
  "packDescriptors": [
    {
      "admissionBytes": 55272,
      "admissionFileSha256": "6bd7ebb1284ef65b131b0478f7575e3f1ff655c84a07be72fc6185ba15472778",
      "admissionPath": "/audio/natural/v040-natural-a72fe0737dd0/admission.json",
      "clipCount": 58,
      "declaredBytes": 5269680,
      "manifestBytes": 3606309,
      "manifestFileSha256": "7d95f92ab47735ab01a5cd38750b9c5323e2a931542642b49cdc25e38595af8b",
      "manifestPath": "/audio/natural/v040-natural-a72fe0737dd0/manifest.json",
      "manifestSha256": "a72fe0737dd03aa79f346f58873e081a6d05f90dc2261a1d3100e41611e866d8",
      "memberCount": 34,
      "packId": "v040-natural-a72fe0737dd0"
    },
    {
      "admissionBytes": 55272,
      "admissionFileSha256": "cbaa29277d61b4321541de0f683d2dcdd40b37ac382fd4eff0773b7342bde145",
      "admissionPath": "/audio/natural/v040-natural-648f1817773e/admission.json",
      "clipCount": 58,
      "declaredBytes": 5571744,
      "manifestBytes": 3682191,
      "manifestFileSha256": "839cf14c498d6a6220b4c32fee5c804f3b2a6a463fd88ecc191311c7c0cb4773",
      "manifestPath": "/audio/natural/v040-natural-648f1817773e/manifest.json",
      "manifestSha256": "648f1817773ed242702d5c6583ad218a55cb8abf633fece76b807b8adcae6e98",
      "memberCount": 34,
      "packId": "v040-natural-648f1817773e"
    },
    {
      "admissionBytes": 55272,
      "admissionFileSha256": "d9ade6451cbdf6f82e6e25b94a611928c5a34f79b292394ded6aba7d7601a6dd",
      "admissionPath": "/audio/natural/v040-natural-aaae71ed7e36/admission.json",
      "clipCount": 58,
      "declaredBytes": 5611608,
      "manifestBytes": 3748288,
      "manifestFileSha256": "d0b2805b4369e2dc4c4ff2cd746bc472c12e658522ce7f520859774ed17d66ea",
      "manifestPath": "/audio/natural/v040-natural-aaae71ed7e36/manifest.json",
      "manifestSha256": "aaae71ed7e36595a01bccbf475685c590c889b16eda528a795897e52f771cb8a",
      "memberCount": 34,
      "packId": "v040-natural-aaae71ed7e36"
    }
  ]
}
};
export const LISTENING150_ADMISSION=admitListening150Package(sealed.input,sealed.pins);
export const LISTENING150_STATUS=LISTENING150_ADMISSION?'READY_PRIVATE_EXACT_MEDIA':'PENDING_EXACT_MEDIA_AND_IMAGES';
